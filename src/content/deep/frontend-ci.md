## 從一個具體問題開始：在我的電腦上是好的

門診前端的一個 PR 合併進 `main`，自動部署之後，「我的掛號」整頁空白。回頭查，三件事同時發生：

1. 作者在 macOS 上開發，import 寫成 `./components/appointmentCard.vue`，實際的檔名是 `AppointmentCard.vue`。macOS 的檔案系統預設不分大小寫，本機一切正常；部署用的 Linux 機器分大小寫，建置失敗，部署腳本沒有檢查結果，把上一份殘留的檔案又推了上去。
2. 同一個 PR 改了 API 回應的型別，`AppointmentCard.vue` 裡用到 `item.patinet`（拼錯）。`npm run dev` 與 `npm run build` 都不檢查型別，沒有人發現。
3. 審查的人只看了 diff，沒有人實際打開畫面。

這三件事，一條在每個 PR 都會跑的 CI 管線就能在合併前擋下：在乾淨的 Linux 機器上 `npm ci`、lint、型別檢查、測試、建置，把建置結果部署成預覽網址給人點。下面是前端這條管線的組成；通用的 CI 概念與 GitLab CI 的寫法見 [CI 管線：lint、test、build](#/skill/ci-pipeline)。

## 運作原理

### 每一步檢查什麼、失敗時長什麼樣

| 步驟 | 指令 | 抓到什麼 | 失敗時的 exit code |
|---|---|---|---|
| 安裝 | `npm ci` | `package.json` 與 lock 檔對不上、套件下載不到 | 非 0 |
| lint | `eslint . --max-warnings 0` | `v-for` 沒有 `key`、直接改 props、沒用到的變數 | 有 error 是 1；只有 warning 預設是 0，加 `--max-warnings 0` 才會失敗 |
| 型別 | `vue-tsc --noEmit` | `.vue` 與 `.ts` 的型別錯誤、拼錯的屬性 | 有錯誤是 2 |
| 單元與元件測試 | `vitest run` | 邏輯與元件行為 | 有失敗就非 0 |
| 建置 | `vite build` | import 找不到（含大小寫）、語法錯誤 | 非 0 |
| E2E | `playwright test` | 整個流程在真的瀏覽器裡走不走得完 | 有失敗就非 0 |
| 預覽部署 | 部署到每個 PR 一個網址 | 讓人看畫面 | |

CI 的每一步只看 exit code：0 是通過，其他值讓這一步、這個 job 失敗。`vitest` 不加 `run` 時在終端機會進入 watch 模式；在 CI 明確寫 `vitest run`，不依賴它自己判斷環境。

### 為什麼一定要 `npm ci`

`npm install` 會在需要時更新 lock 檔，`npm ci` 只照 lock 檔安裝、先刪掉 `node_modules`、對不上就直接失敗。CI 要的是「和 lock 檔一模一樣」的安裝結果。在 `package.json` 加了套件卻沒 commit 更新後的 lock 檔，`npm ci` 的訊息是：

```
npm error code EUSAGE
npm error
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Missing: dayjs@1.11.23 from lock file
```

### 型別檢查不在建置裡

Vite 只把 TypeScript 的型別拿掉，不檢查。`.vue` 檔裡的型別錯誤要用 `vue-tsc`。上面那個拼錯的屬性，`vue-tsc --noEmit` 印出：

```
src/AppointmentCard.vue(4,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/AppointmentCard.vue(6,30): error TS2551: Property 'patinet' does not exist on type 'Appointment'. Did you mean 'patient'?
```

這裡有一個 2026 年的版本陷阱：npm 上 `typescript` 的 latest 是 7.0，原生（Go）實作的編譯器，套件裡沒有 vue-tsc 依賴的 JavaScript API。實測 vue-tsc 3.3.14 搭 TypeScript 7.0.2 一啟動就失敗：

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined by "exports" in …/node_modules/typescript/package.json
```

換成 TypeScript 6.0.3 就正常。所以 `package.json` 裡把 `typescript` 固定在 `~6.0`，不要寫 `latest` 或 `*`，等 vue-tsc 支援 TypeScript 7 再升級。

### lint 的設定

ESLint 10 只認 flat config（`eslint.config.js`）。eslint-plugin-vue 10.12 的 `flat/recommended` 會抓 Vue 特有的錯，實測一個直接改 props、`v-for` 沒有 `key` 的元件：

```
src/WaitingList.vue
  3:20  error    Unexpected mutation of "items" prop                    vue/no-mutating-props
  6:7   error    Elements in iteration expect to have 'v-bind:key' directives  vue/require-v-for-key
  6:33  warning  '@click' should be on a new line                       vue/max-attributes-per-line

✖ 6 problems (2 errors, 4 warnings)
```

格式類的 warning（換行、屬性位置）交給 Prettier 或關掉，留下真的會出錯的規則，再用 `--max-warnings 0` 讓新的 warning 也擋下。不然 warning 會越積越多，最後沒有人看。

### 預覽部署

審查的人點一個網址就能看到這個 PR 的畫面，比讀 diff 更容易發現版面與狀態的問題。做法依主機而定：

- **Firebase Hosting**：`FirebaseExtended/action-hosting-deploy@v0` 不指定 `channelId` 時，每個 PR 建一個預覽頻道，網址在同一個 PR 的後續 commit 都不變；給它 `repoToken` 就會把網址留言在 PR 上，`expires` 設過期時間。本站部署正式版也用同一個 action，只是 `channelId: live`。
- **GitHub Pages**：`actions/deploy-pages` 有一個 `preview` 參數，但它的說明寫著這個功能還在 alpha、沒有對外開放，目前不能用來做 PR 預覽。
- Netlify、Vercel、Cloudflare Pages 這類平台連上 repo 後，每個 PR 自動有預覽網址。

預覽環境要連測試用的後端。建置時的 `VITE_` 變數會寫死在產物裡（見 [建置時設定與執行時設定](#/skill/env-config)），預覽與正式用同一份建置時，改用執行時的 `/config.js`。

### 權限、secret 與 fork

- workflow 的 `permissions` 先設 `contents: read`，只有部署的 job 另外加權限。
- 從 fork 開來的 PR，`pull_request` 事件拿不到 repo 的 secret。預覽部署這類需要 secret 的 job 要加條件跳過，lint、測試、建置照跑。
- `concurrency` 讓同一個 PR 推了新 commit 時取消還在跑的舊執行，省時間也避免舊的結果蓋過新的。

最後在 repo 的分支規則把這些 job 設成必要檢查（required status checks），紅燈就不能合併。

## 實際程式

### `package.json` 的 scripts

本機與 CI 跑同一組指令，CI 裡只呼叫 npm scripts：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "typescript": "~6.0.3",
    "vue-tsc": "^3.3.14"
  }
}
```

Node 版本寫在 `.nvmrc`（例如一行 `24`），本機用 nvm 或 fnm 切換，CI 用 `node-version-file` 讀同一個檔。Vite 8 需要 Node 20.19 或 22.12 以上。

### GitHub Actions workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm              # 快取 ~/.npm，不是 node_modules
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e   # playwright.config 的 webServer 會先 build 再 preview
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14

  preview:
    needs: [check, e2e]
    # 只在同一個 repo 開的 PR 部署；fork 拿不到 secret
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write      # 讓 action 在 PR 上留言預覽網址
      checks: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v8   # 和 upload-artifact@v7 搭配
        with:
          name: dist
          path: dist
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: clinic-web-staging
          expires: 7d
```

`check` 與 `e2e` 平行跑；`preview` 等兩者都通過，直接部署 `check` 上傳的那份 `dist`，部署的就是測過的那一份。

Playwright 讓 E2E 自己啟動伺服器：

```js
// playwright.config.js
import { defineConfig } from '@playwright/test'

export default defineConfig({
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
```

### 再加一道：首頁 JS 的大小

[bundle、chunk 與 hash](#/skill/bundles-chunks) 談過首頁該下載多少。可以在 `build` 之後加一步，超過預算就失敗：

```js
// scripts/check-size.mjs：加總 index.html 引用的 JS（入口與 modulepreload）的 gzip 大小
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const LIMIT_KB = 150
const html = readFileSync('dist/index.html', 'utf8')
const files = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1])
let total = 0
for (const f of new Set(files)) {
  const kb = gzipSync(readFileSync(`dist/${f}`)).length / 1000
  console.log(`${f.padEnd(40)} ${kb.toFixed(1)} kB`)
  total += kb
}
console.log(`首頁 JS 合計 ${total.toFixed(1)} kB（上限 ${LIMIT_KB} kB）`)
if (total > LIMIT_KB) process.exit(1)
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| `npm ci` 印出 `can only install packages when your package.json and package-lock.json … are in sync` | 改了 `package.json` 沒更新 lock 檔 | 本機 `npm install` 後一起 commit lock 檔 |
| `[UNRESOLVED_IMPORT] Could not resolve './components/appointmentCard.vue'`（Vite 8），本機正常 | import 的大小寫和檔名不同，macOS 與 Windows 不分大小寫 | 照實際檔名修正；`git mv` 改檔名大小寫 |
| `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined by "exports"` | vue-tsc 搭到 TypeScript 7 | `typescript` 固定 `~6.0` |
| `error TS2551: Property 'patinet' does not exist on type …` | 型別錯誤，`vite build` 不會抓 | 修正；確認 `typecheck` 是 CI 的一步 |
| lint 有一堆 warning，CI 還是綠燈 | ESLint 只有 warning 時 exit code 是 0 | 加 `--max-warnings 0`，或把該擋的規則設成 error |
| `browserType.launch: Executable doesn't exist at …`，下面提示 `npx playwright install` | CI 機器上沒有下載瀏覽器 | 加 `npx playwright install --with-deps chromium` |
| E2E 只在 CI 失敗，找不到原因 | 沒有保留報告與 trace | 上傳 `playwright-report/`，`trace: 'on-first-retry'` |
| 預覽部署的 job 在 fork 的 PR 失敗 | fork 的 PR 拿不到 secret | 加 `if` 條件跳過 |
| 一步失敗了 job 還是綠燈 | 指令後面接了「或 true」讓它永遠成功，或接了管線（例如把輸出導給 `tee`），exit code 變成最後一個指令的 | 拿掉永遠成功的寫法；需要管線時先 `set -o pipefail` |

## 動手

1. 在自己的專案依序執行 `npm ci`、`npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`，每一步看 `echo $?` 的值；缺哪個 script 就補上。
2. 執行 `npm ls typescript vue-tsc` 確認版本；若是 TypeScript 7，改成 `~6.0` 再跑一次 `vue-tsc --noEmit`。
3. 把上面的 workflow 放進 `.github/workflows/ci.yml`，開一個故意寫錯型別的 PR，確認 `typecheck` 紅燈、PR 不能合併。
4. 在 repo 的分支規則把 `check` 與 `e2e` 設成必要檢查。
5. 加上 `scripts/check-size.mjs`，把上限設得比目前小一點，確認 CI 會失敗，再調回合理的值。
