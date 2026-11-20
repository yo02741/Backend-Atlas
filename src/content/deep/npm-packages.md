## 從一個具體問題開始：沒有人改程式，bundle 卻多了一段程式碼

門診前端的 CI 寫的是 `npm install && npm run build`，`package-lock.json` 被列在 `.gitignore` 裡，理由是「每次合併都衝突」。專案直接依賴的日期套件寫著 `"^2.4.0"`，它底下又依賴一個格式化民國年的小套件。

某個週末，那個小套件的維護者帳號被盜，攻擊者發布了 `1.8.3`。週一的 CI 重新解析版本，`^1.8.0` 允許 `1.8.3`，於是裝了進來：

- 套件的 `postinstall` 在 CI 上執行，讀到環境變數裡的部署金鑰，送到外部主機。
- 套件本身的程式被 Vite 打包進 `dist/assets/index-<hash>.js`，部署後在每一位病患的瀏覽器裡執行，讀取掛號表單的身分證字號與電話。

同一週，另一個人請 AI 加一個農曆日期選擇器，AI 給的指令是 `npm install vue-lunar-datepicker-tw`。這個名字原本不存在，有人看到 AI 常這樣建議，搶先註冊了它。

公開的事件也是這兩種。2025 年 9 月，chalk、debug 等每週下載量極高的套件，維護者帳號被釣魚盜用，攻擊者發布的版本會在瀏覽器裡攔截加密貨幣交易、換掉收款地址；同月出現的 Shai-Hulud 蠕蟲靠安裝腳本偷 npm token 與雲端金鑰，再用偷到的 token 發布更多被感染的套件。這兩種剛好是前端專案的兩個入口：安裝時在開發機與 CI 上執行的腳本，以及打包後在使用者瀏覽器裡執行的程式。其他公開事件與 SBOM、簽章這類通用做法，見後端的 [依賴與供應鏈安全](#/skill/supply-chain)。

## 運作原理

### 版本範圍

`package.json` 寫的是可以接受的版本範圍。用 npm 解析範圍的 semver 套件（7.8.6）實際比對，從 1.2.3、1.2.9、1.3.0、1.9.9、2.0.0、0.2.3、0.2.9、0.3.0、0.0.3、0.0.4 這十個版本裡選：

| 寫法 | 展開後的範圍 | 接受的版本 |
|---|---|---|
| `^1.2.3` | `>=1.2.3 <2.0.0-0` | 1.2.3、1.2.9、1.3.0、1.9.9 |
| `~1.2.3` | `>=1.2.3 <1.3.0-0` | 1.2.3、1.2.9 |
| `1.2.3` | 只有這一版 | 1.2.3 |
| `^0.2.3` | `>=0.2.3 <0.3.0-0` | 0.2.3、0.2.9 |
| `^0.0.3` | `>=0.0.3 <0.0.4-0` | 0.0.3 |
| `1.x` | `>=1.0.0 <2.0.0-0` | 1.2.3、1.2.9、1.3.0、1.9.9 |
| `*` | 任何版本 | 全部 |

- `^` 允許「不改最左邊那個非 0 數字」的更新；`0.x` 的套件因此只跟 patch。
- 預發布版（`1.3.0-beta.1`）不在 `^1.2.3` 的範圍裡，只有範圍本身寫了同一個 `major.minor.patch` 的預發布版（`^1.3.0-beta.0`）才會接受。
- `npm install <套件>` 預設寫 `^`（`save-prefix` 預設值）；要寫固定版本用 `--save-exact`。

semver 是約定：major 變了代表不相容，minor 是新功能，patch 是修正。套件作者不一定照做，minor 更新照樣可能壞掉，所以還要 lock 檔與測試。

### lock 檔記下實際的版本

```json
"node_modules/dayjs": {
  "version": "1.11.23",
  "resolved": "https://registry.npmjs.org/dayjs/-/dayjs-1.11.23.tgz",
  "integrity": "sha512-…"
}
```

`package-lock.json` 記下每一個套件（包含依賴的依賴）裝了哪一版、從哪裡下載、檔案的雜湊。下載回來的檔案雜湊不符，npm 拒絕安裝。lock 檔要提交進版控，它的 diff 在 PR 裡也要看：一個小功能的 PR 讓 lock 檔多了三百個套件，值得問一句。

| 指令 | 怎麼用 lock 檔 | 會改 lock 檔嗎 | 用在哪裡 |
|---|---|---|---|
| `npm install` | lock 檔的版本符合 `package.json` 的範圍就照它裝 | 會，在新增、移除或範圍改變時 | 開發時 |
| `npm install <套件>` | 同上，另外解析新套件 | 會 | 新增套件 |
| `npm update` | 忽略 lock 檔的版本，升到範圍內的最新版 | 會 | 主動升級 |
| `npm ci` | 只照 lock 檔 | 不會 | CI、Dockerfile |

### `npm ci`

npm 12 的文件列出 `npm ci` 和 `npm install` 的差別：專案一定要有 `package-lock.json`；lock 檔和 `package.json` 對不上時直接失敗，不會去更新 lock 檔；開始前先刪掉整個 `node_modules`；不會寫入 `package.json` 或 `package-lock.json`。用 npm 12.2.3 實測，在 `package.json` 加了一個套件但沒更新 lock 檔：

```text
npm error code EUSAGE
npm error
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Missing: semver@7.8.6 from lock file
```

在開發機跑一次 `npm install`，把更新後的 lock 檔一起提交就好。

### `dependencies` 與 `devDependencies`

對 Vite 建置的 SPA，bundle 裡有什麼只看程式 `import` 了什麼：`dayjs` 放在 `devDependencies`，只要元件 import 了它，照樣會被打包進去；放在 `dependencies` 卻沒人 import，也不會進 bundle。兩區的差別在安裝：

- `npm ci --omit=dev` 不裝 devDependencies。環境變數 `NODE_ENV=production` 時，npm 的 `omit` 設定預設就是 `dev`。Dockerfile 在建置前設了 `NODE_ENV=production`，Vite 就沒被裝，`npm run build` 失敗，shell 印出 `vite: not found` 這類訊息。
- 寫給別人用的套件（元件庫）：使用者安裝它時會一起裝它的 `dependencies`，不會裝 `devDependencies`；`vue` 這類要和使用者共用同一份的寫在 `peerDependencies`。

慣例是執行時用到的（`vue`、`vue-router`、`pinia`、`dayjs`）放 `dependencies`，建置、測試、lint 工具放 `devDependencies`。`npm audit --omit=dev` 只看前者，依照這個慣例分好，報告才分得出哪些漏洞會跟著 bundle 到使用者的瀏覽器。

### 安裝腳本

套件的 `package.json` 可以寫 `preinstall`、`install`、`postinstall`，安裝時以你的身分執行，讀得到環境變數、SSH 金鑰與家目錄的檔案。真正需要它的套件不多，多半是要下載或編譯原生程式的。

npm 12（2026 年 7 月發布）起預設不執行依賴的安裝腳本。用同一個帶 `postinstall` 的套件實測：npm 11.21.0 照樣執行腳本，只多一行警告；npm 12.2.3 擋下，安裝結束時列出：

```text
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   clinic-dep@1.0.0 (postinstall: node -e "…")
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

- 看過腳本、確定需要，執行 `npm approve-scripts <套件>`（等同 `npm install-scripts approve`）。它把允許清單寫進 `package.json` 的 `allowScripts`，預設釘住目前的版本（`套件@版本`），升版後要重新審查；寫成 `false` 是明確拒絕。
- `strict-allow-scripts=true` 讓沒審查過的安裝腳本直接讓安裝失敗，適合放在 CI。
- `--ignore-scripts` 一律不執行；`--dangerously-allow-all-scripts` 一律執行，文件寫明只當遷移用的逃生口。
- npm 12 同時把 `allow-git` 與 `allow-remote` 的預設改成 `none`：依賴指向 git repo 或任意網址的 tarball 時，要在 `.npmrc` 明確打開。

pnpm 從 10 版起也預設不執行依賴的 build script；pnpm 12 用 `pnpm approve-builds` 把允許清單寫進 `pnpm-workspace.yaml` 的 `allowBuilds`。

擋下安裝腳本，擋不了第二個入口：打包進 bundle 的程式。開頭那個竊取表單資料的套件不需要任何安裝腳本，這部分只能靠選套件、lock 檔與延後採用。

:::stop 讀到這裡可以先停：讀得懂版本範圍與 lock 檔，知道 CI 為什麼用 `npm ci`、安裝腳本為什麼被擋。後面的延遲採用、pnpm 與新增套件前的檢查，在要加新套件或決定升級策略時再回來讀。

### 等幾天再採用

被盜帳號發布的惡意版本，通常在幾小時到幾天內被發現並下架。延後採用新版本，等於讓別人先踩：

- npm 的 `min-release-age=<天數>`（npm 11 後期版本與 12 都有，預設不啟用）：只安裝發布超過這個天數的版本；內部套件用 `min-release-age-exclude` 排除。修補漏洞的版本太新而被擋時，`npm audit fix` 會保留舊版、印出警告並以非 0 結束。
- pnpm 的 `minimumReleaseAge`，單位是分鐘；pnpm 12 內建的預設是 1440 分鐘（一天）。
- Dependabot、Renovate 這類自動更新工具也有延後開 PR 的設定，見後端的 [依賴與供應鏈安全](#/skill/supply-chain)。

### npm 與 pnpm

| | npm | pnpm |
|---|---|---|
| lock 檔 | `package-lock.json` | `pnpm-lock.yaml` |
| CI 的安裝方式 | `npm ci` | `pnpm install --frozen-lockfile` |
| `node_modules` 的結構 | 預設盡量攤平到最上層（`install-strategy` 預設 `hoisted`） | 最上層只有直接依賴，其他放在 `.pnpm` 裡用連結指過去 |
| 磁碟空間 | 每個專案一份 | 共用的 store，用硬連結放進專案 |
| 幽靈依賴 | 能 import 沒列在 `package.json` 的套件 | 找不到，會報錯 |

幽靈依賴是指程式 import 了 `package.json` 沒有列、只是被別的套件順便裝進來的套件。在 npm 攤平的 `node_modules` 裡它剛好找得到，等帶它進來的套件改版不再依賴它，或專案換成 pnpm，Vite 就報 `Failed to resolve import "dayjs" from "src/…". Does the file exist?`。要用的套件自己列進 `dependencies`。

一個專案只用一種工具，`package.json` 的 `packageManager` 欄位寫明工具與版本；同時留著 `package-lock.json` 與 `pnpm-lock.yaml`，不同人裝到的版本會不一樣。

### npx 與 create 指令

`npx <套件>` 與 `npm create vite@latest` 會下載並直接執行一個套件。專案沒有裝它時，npm 先問 `Need to install the following packages:`，列出套件與版本，最後是 `Ok to proceed?`。按下 y 之前看清楚名稱：打錯一個字，執行的就是別人的程式。AI 產生的教學步驟裡常有這類指令，逐一對照官方文件上的寫法。

### 新增套件前的檢查

```bash
npm view vue-lunar-datepicker-tw time.created time.modified repository.url maintainers
npm view vue-lunar-datepicker-tw scripts dependencies
```

npm 12 對 `npm view zod time.created time.modified repository.url maintainers` 的輸出是 `time.created = '2020-03-07T…'` 這樣一欄一行。要看的是：

- **名稱**：和官方文件上的完全一樣；熱門套件的名字差一兩個字、多一個連字號，或多了 `-tw`、`-vue3` 這種後綴，都要確認。
- **時間**：`time.created` 是昨天、`time.modified` 是今天，又沒有人知道這個套件，先停下來。
- **來源**：`repository.url` 指向的原始碼存在、有人在維護、發布的內容和原始碼對得上。
- **安裝腳本與依賴**：`scripts` 裡有沒有 `postinstall`；為了一個小功能帶進幾十個間接依賴，考慮自己寫。

## 實際程式

### `package.json`

```json
{
  "name": "clinic-frontend",
  "private": true,
  "type": "module",
  "packageManager": "npm@12.2.3",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "dayjs": "^1.11.23",
    "pinia": "^4.1.0",
    "vue": "^3.5.45",
    "vue-router": "^5.5.1"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.11",
    "typescript": "~6.0.3",
    "vite": "^8.3.8",
    "vitest": "^5.1.1",
    "vue-tsc": "^3.3.14"
  },
  "allowScripts": {}
}
```

`typescript` 用 `~`：TypeScript 的 minor 版本常帶來新的型別錯誤，只自動跟 patch。`allowScripts` 是空的：目前沒有任何依賴需要安裝腳本，之後有人要加，PR 裡一定看得到。

### `.npmrc`

```ini
# 發布未滿 7 天的版本不裝；院內的套件不受限制
min-release-age=7
min-release-age-exclude[]=@clinic/*
# 沒審查過的安裝腳本讓安裝失敗，而不只是警告
strict-allow-scripts=true
```

### CI 與 Dockerfile

```yaml
# .github/workflows/ci.yml 的步驟
- run: npm ci
- run: npm audit --omit=dev --audit-level=high   # 會進 bundle 的依賴有高風險漏洞就失敗
- run: npm run build
```

```dockerfile
# 建置階段：需要 devDependencies（Vite、vue-tsc），不設 NODE_ENV=production
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# 執行階段只放靜態檔，見 spa-deploy
FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

`node:24-alpine` 內建的 npm 不一定是 12 版；要和 `packageManager` 寫的版本一致，在 `npm ci` 之前先執行 `npm install -g npm@12.2.3`。

### 一段可以跑的範圍比對

```js run
// 極簡的 semver 範圍比對：只處理 x.y.z 與 ^、~、固定版本（實務上用 semver 套件）
const parse = (v) => v.split('.').map(Number)
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }

function satisfies(version, range) {
  const v = parse(version)
  const op = range[0] === '^' || range[0] === '~' ? range[0] : ''
  const base = parse(op ? range.slice(1) : range)
  if (op === '') return cmp(v, base) === 0
  if (cmp(v, base) < 0) return false
  if (op === '~') return v[0] === base[0] && v[1] === base[1]
  // ^：最左邊那個非 0 的數字不能變
  if (base[0] > 0) return v[0] === base[0]
  if (base[1] > 0) return v[0] === 0 && v[1] === base[1]
  return v[0] === 0 && v[1] === 0 && v[2] === base[2]
}

const versions = ['1.2.3', '1.2.9', '1.3.0', '1.9.9', '2.0.0', '0.2.3', '0.2.9', '0.3.0', '0.0.3', '0.0.4']
for (const range of ['^1.2.3', '~1.2.3', '1.2.3', '^0.2.3', '^0.0.3']) {
  console.log(range.padEnd(8), '→', versions.filter((v) => satisfies(v, range)).join('、'))
}
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| `npm ci` 失敗，說 package.json 與 package-lock.json 不同步，並列出 `Missing: … from lock file` | 改了 `package.json`，沒更新或沒提交 lock 檔 | 在開發機 `npm install`，把 lock 檔一起提交 |
| 同一個 commit，CI 每次裝到的版本不同 | 沒有提交 lock 檔，或 CI 用 `npm install` | 提交 lock 檔，CI 改用 `npm ci` |
| `npm warn install-scripts … had install scripts blocked because they are not covered by allowScripts` | npm 12 預設不執行依賴的安裝腳本 | 看過腳本再 `npm approve-scripts <套件>`；不需要就不管它 |
| Docker 建置時 `vite: not found` | 建置前設了 `NODE_ENV=production`，devDependencies 沒裝 | 建置階段不設，或用 `npm ci --include=dev` |
| `Failed to resolve import "dayjs" from "src/…". Does the file exist?`（換成 pnpm 後） | 幽靈依賴：沒列在 `package.json` | 加進 `dependencies` |
| 升 minor 版之後畫面壞了 | 套件沒照 semver 發布，或 `^` 自動升了 | 看 lock 檔的 diff 找出升了哪個；有測試擋住再合併 |
| `^0.2.3` 一直沒升到 0.3.0 | `0.x` 的 `^` 只跟 patch | 手動改範圍，看 changelog 的不相容變更 |
| `npm audit` 列出幾十個漏洞 | 多數在建置工具裡 | `--omit=dev` 先看會進 bundle 的；建置工具另外排時間升級 |
| `npm install` 抓不到剛發布的修補版本 | `min-release-age` 擋住了 | 把那個套件加進 `min-release-age-exclude`，或暫時調低 |
| 依賴指向 git repo 時安裝失敗（npm 12） | `allow-git` 預設 `none` | 確認來源可信後，在 `.npmrc` 設 `allow-git=root` |

AI 寫前端時常見的：沒有確認就加一個新套件（甚至不存在的名字）、只改 `package.json` 不提交 lock 檔、把建置工具放進 `dependencies`、為了消除警告建議 `--dangerously-allow-all-scripts` 或 `--legacy-peer-deps`。

## 動手

1. 按上面那段範圍比對的「在 Playground 開啟」，加一個 `~0.2.3` 的分支，確認結果和 `^0.2.3` 一樣；再對照表格裡 semver 套件的輸出。
2. 在自己的專案跑 `npm outdated`，看 `Wanted` 與 `Latest` 不同的套件，各自的 changelog 寫了哪些不相容的變更。
3. 挑一個最近加進來的套件，用 `npm view <套件> time.created repository.url maintainers scripts` 查一次，再用 `npm ls <套件>` 看它帶進了哪些間接依賴。
4. 模組怎麼匯入、bare specifier 怎麼對到 `node_modules`，見 [模組與套件](#/skill/modules)；第三方 script 的風險見 [前端的資安](#/skill/frontend-security)。
