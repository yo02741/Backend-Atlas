## 從一個具體問題開始：同一個錯，每個新對話都再犯一次

門診前端用 Vue 3.5、Element Plus，共用元件在 `src/components/ui/`，顏色都是 `tokens.css` 裡的變數，API 一律透過 `src/api/client.ts`（它會帶 token、處理 401）。這些約定只存在團隊成員的腦袋裡。用 AI 改了兩週，重複出現的錯：

- 新增「重新整理」按鈕時，另外寫了一個 `BaseButton.vue`，專案裡早就有 `AppButton.vue`。
- 按鈕底色寫成 `#2563eb`，暗色主題下變成一塊亮藍。
- 新的清單元件直接 `fetch('/api/appointments')`，繞過了 client，token 過期時沒有導向登入，畫面停在一片空白。
- 為了格式化日期裝了 `dayjs`，專案原本用 `Intl.DateTimeFormat`。
- 新檔案用 Options API 的 `data()` 與 `methods`。
- 為了讓型別檢查通過，直接在產生的 `schema.d.ts` 裡加了一個欄位。
- 改完說「測試都通過了」，實際上它跑的是不存在的 `npm test`，專案的指令是 `npm run test:unit`。

每一次都在對話裡糾正，下一個對話又從頭來過。模型對這個 repo 沒有記憶，對話結束後，口頭交代的規則就不在了。

## 規範檔是什麼、誰讀它

專案規範檔是放在 repo 裡、由 coding agent 工具自動讀進 context 的文字檔。AGENTS.md 是其中一種開放格式（agents.md 網站上的說法是「a README for agents」），幾個事實：

- 就是一般的 Markdown，**沒有必填的欄位或標題**。
- 放在 repo 根目錄；大型 monorepo 可以在每個子專案各放一份，**離被修改的檔案最近的那一份優先**。
- **使用者在對話裡的明確指示，優先於所有規範檔**。
- 列出的測試指令，agent 會嘗試執行，並在回報完成前修好失敗的部分。
- 由 Linux Foundation 底下的 Agentic AI Foundation 維護；agents.md 網站列出的支援工具包括 Codex、Cursor、Gemini CLI、VS Code、Zed 等。

不同工具讀的檔名不一樣。Claude Code 讀 `CLAUDE.md`，可以在裡面寫一行 `@AGENTS.md` 引入同一份內容，本站的 repo 就是這樣做的：`CLAUDE.md` 只有一句說明加上 `@AGENTS.md`。各工具讀哪些檔名、從哪些目錄讀、怎麼合併，以各自的文件為準；這一課沒有逐一實測每個工具。

規範檔該寫什麼、不該寫什麼的通用原則（常駐的內容要精簡、會過期的不要寫、能從程式碼看出來的不要寫），在 AI 路線的 [專案規範檔與 context](#/skill/context-engineering) 有完整說明。這一課講前端專案要寫的具體內容。

## 前端專案要寫的六類

| 類別 | 寫什麼 | 沒寫時常見的產出 | 能交給工具嗎 |
|---|---|---|---|
| 技術與版本 | Vue 3.5、`<script setup lang="ts">`、Pinia、Vue Router；不用 Options API | Options API、Vue 2 的寫法、混用兩套 API | 部分：`vue/component-api-style` |
| 元件庫與位置 | 元件庫是哪個、共用元件在 `src/components/ui/`、新元件先找現成的 | 重做一個已經存在的 Button、Dialog | 不容易；靠規範與審查 |
| token 與樣式 | 只用 `var(--color-*)`、`var(--space-*)`；樣式寫在 `<style scoped>` | 寫死 hex 與任意 px，暗色主題壞掉 | 可以：Stylelint 的 `color-no-hex` |
| 資料夾與資料流 | 頁面、元件、composable、store、API client 各放哪；元件不直接呼叫 fetch | 繞過 client，少了 token 與錯誤處理 | 可以：ESLint 的 `no-restricted-globals` |
| 禁止事項 | 不新增套件、不改產生的檔案、不用 `v-html`、不改測試的期望值 | 為了方便裝套件、手改 `schema.d.ts`、改測試讓它通過 | 部分：`vue/no-v-html`；套件與期望值靠審查 |
| 交付前 | 要跑的指令與要貼的輸出；要手動看過的寬度與鍵盤操作 | 跑錯指令、宣稱通過卻沒有輸出 | 指令本身可以放進 CI |

### 寫成答案，不寫成願望

| 願望（沒辦法檢查） | 答案（看得出有沒有遵守） |
|---|---|
| 寫出乾淨、好維護的程式 | 單一 SFC 超過 300 行就拆；邏輯放 `src/composables/` |
| 注意無障礙 | 互動元件用原生 `button`、`a`、`input`；Dialog 用 `<dialog>` 的 `showModal()` |
| 符合設計規範 | 顏色與間距只用 `src/styles/tokens.css` 的變數 |
| 確保品質 | 交付前 `npm run lint`、`npx vue-tsc --noEmit`、`npm run test:unit`、`npm run build` 都通過 |

「300 行就拆」是團隊自己訂的數字，不是業界標準；重點是有一個能檢查的數字，並且可以用 `vue/max-lines-per-block` 交給 lint。

## 一份範例

```markdown
# 門診前端

Vue 3.5 + TypeScript + Vite。後端 API 規格在 ../clinic-api 的 /openapi.json。

## 技術
- 元件一律 `<script setup lang="ts">`，Composition API；不用 Options API。
- 狀態：元件內用 ref／computed；跨頁共用才放 Pinia（src/stores/）；篩選與頁碼放網址。
- 元件庫：Element Plus。共用元件在 src/components/ui/（AppButton、AppDialog、AppToast…），
  新元件先找這裡與 Element Plus 有沒有現成的。

## 規則
- 顏色、間距、圓角只用 src/styles/tokens.css 的變數，不寫 hex 與任意 px。
- 元件不直接呼叫 fetch：一律用 src/api/client.ts 的 `api`（帶 token、處理 401）。
- API 型別從 src/api/schema.d.ts 取（`components['schemas'][…]`），不手寫 interface。
- src/api/schema.d.ts 是 `npm run api:types` 產生的，不手改；缺欄位就回報，不自己加。

## 禁止
- 不新增 npm 套件；需要時先說明理由並停下來。
- 不用 v-html。
- 不修改既有測試的期望值、不加 .skip；規格有變時先停下來說明。

## 交付前
- 依序執行並貼上最後幾行輸出：
  `npm run lint`、`npx vue-tsc --noEmit`、`npm run test:unit`、`npm run build`
- 在 390 與 1280 兩個寬度看過改到的畫面；只用鍵盤操作過改到的互動。
- 回報：改了哪些檔案、為什麼、怎麼驗證、刻意沒做的事。

## 其他文件
- 畫面規格：docs/screens/（改畫面時先讀對應的那份）
- 元件的寫法與命名：docs/components.md（新增元件時才讀）
```

這份大約 40 行。每一行不是指令，就是從程式碼看不出來的限制，或是指到另一份文件的位置。

## 寫明瀏覽器目標，讓 agent 先查再寫

模型的訓練資料裡舊寫法占多數：用 `div` 加 `z-index: 9999` 做 Dialog、用 `100vh` 撐滿手機畫面、裝一個套件做原生 `popover` 就能做的事。規範檔裡寫明兩件事，產出比較不會退回舊寫法：

- **瀏覽器目標**：例如「只用 2024 年底以前進入 Baseline 的功能；更新的功能要有降級做法，並在 PR 說明」。這同時是 `vite.config` 的 `build.target` 與 browserslist 該對齊的目標。
- **先查再寫**：讓 agent 在寫 UI 之前查現代寫法的指南。Chrome 團隊發布的 Modern Web Guidance（npm 套件 `modern-web-guidance`，1.0.1 版，Apache-2.0）就是這類 skill：README 寫的理由是「LLM 的訓練資料含有大量舊程式碼，coding agent 常預設用舊寫法」，套件裡是一批依主題分類的指南（CSS 版面、表單、無障礙、效能等），用 `search` 找、`retrieve` 取全文，另有 `legacy-scan` 掃描專案裡的舊寫法（它自己說明只涵蓋約兩成的指南）。README 寫明由 Chrome、Edge、Firefox 與 MDN 團隊共同維護。

在規範檔裡寫一行「寫 HTML、CSS、前端 JS 之前先用 modern-web-guidance 查對應的指南」即可；它要能連外網執行 `npx`，沙箱環境要先放行。這類工具的建議仍要經過同樣的驗收：版本、瀏覽器支援與專案的目標對得上才採用。

## 把規則交給工具

寫在規範檔的規則是請求，模型可能漏看、可能在長對話裡被擠出 context。能機械檢查的規則，寫成 lint 規則或測試，違反時 CI 直接失敗。

```js
// eslint.config.js（flat config；用 ESLint 10.15 與 eslint-plugin-vue 10.12 跑過）
import pluginVue from 'eslint-plugin-vue'

export default [
  ...pluginVue.configs['flat/recommended'],              // 已包含 vue/no-v-html（warn）
  {
    rules: {
      'vue/no-v-html': 'error',                             // 提高成錯誤
      'vue/component-api-style': ['error', ['script-setup']],   // 只允許 <script setup>
      'vue/max-lines-per-block': ['warn', { script: 200, template: 150 }],
      'no-restricted-globals': ['error', { name: 'fetch', message: '請用 src/api/client.ts 的 api' }],
    },
  },
  {
    files: ['src/api/**'],                                  // client 本身可以用 fetch
    rules: { 'no-restricted-globals': 'off' },
  },
]
```

用這份設定檢查一個寫了 `data()`、`v-html` 與 `fetch` 的元件，輸出是：

```text
  2:8   error  'v-html' directive can lead to XSS attack                                 vue/no-v-html
  6:3   error  Options API is not allowed in your project. Use `<script setup>` instead  vue/component-api-style
  7:37  error  Unexpected use of 'fetch'. 請用 src/api/client.ts 的 api                     no-restricted-globals
```

規範檔裡對應的那幾條，可以縮成一句「API 風格、`v-html`、直接呼叫 fetch 由 lint 檢查」。

交給工具之後，規範檔仍然留一行：AI 在寫的當下就知道規則，不用等 lint 失敗再改一輪。

## 常見錯誤

- **規範檔越寫越長**：每次出錯就加一段，半年後幾百行，後面的規則反而被忽略。定期刪掉已經交給工具的規則、過期的指令與背景說明。
- **指令過期**：規範檔寫 `npm test`，`package.json` 早就改成 `test:unit`。AI 每次都先失敗一輪再去猜。改指令的 PR 一起改規範檔。
- **只寫原則**：「遵守設計系統」「注意效能」沒有一條能檢查。改寫成具體的路徑、變數名、指令與數字。
- **寫了卻沒人讀到**：檔名或位置不對，或工具讀的是另一個檔名。開一個新對話問「這個專案的元件庫是什麼、交付前要跑哪些指令」，答錯就是沒讀到。
- **把秘密寫進去**：API key、內部主機的帳密不能放在規範檔，它會進版控，也會被送進模型。
- **規範與 lint 互相矛盾**：規範檔說可以用 Options API，lint 卻禁止；AI 會在兩者之間來回改。以工具的設定為準，規範檔跟著改。

## 動手

1. 回想最近三次在對話裡糾正 AI 的事，各寫成一條規範（答案的形式），再判斷哪一條可以改成 lint 規則。
2. 照上面的六類，替自己的前端專案寫一份 60 行以內的 AGENTS.md；如果用 Claude Code，在 `CLAUDE.md` 寫 `@AGENTS.md` 引入。
3. 在乾淨的 clone 上照「交付前」一條條跑，每條都要成功。
4. 交給 AI 一個小任務（例如在清單上方加一個篩選 Popover），對照規範檢查產出，違反的那一條改寫得更具體。接著讀 [審 AI 的改動](#/skill/ai-review-diff)，看規範檔沒擋住的東西怎麼在審查時抓出來。
