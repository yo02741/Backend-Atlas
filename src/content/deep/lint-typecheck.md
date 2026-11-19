## 從一個具體問題開始：`npm run build` 過了，病患姓名一片空白

「今日門診」頁的預約卡片是 AI 產生的。`npm run dev` 正常、`npm run build` 成功、Console 沒有紅字，上線後卻有三個問題：

1. 卡片上的病患姓名是空白的。
2. 已經取消的預約，卡片上從來不會出現「已取消」。
3. 按「取消預約」後，就算 API 回 409，頁首「今日預約」的數字也立刻少了一筆，重新整理才變回來。

元件的原始碼：

```vue
<script setup lang="ts">
import type { Appointment } from './types'

const props = defineProps<{ appt: Appointment }>()
const emit = defineEmits<{ cancel: [id: string] }>()

const label: string = props.appt.queueNo          // queueNo 是 number
function cancel() {
  props.appt.status = 'cancelled'                 // 直接改 props
  emit('cancel', props.appt.queueNo)              // 應該傳 id（string）
}
</script>

<template>
  <article>
    <h3>{{ appt.patientNmae }}</h3>                  <!-- 拼錯 -->
    <p v-if="appt.status === 'canceled'">已取消</p>  <!-- 型別裡是 'cancelled' -->
    <button @click="cancel">取消預約（{{ label }}）</button>
  </article>
</template>
```

這幾個錯沒有一個需要執行程式才找得到。`npx vue-tsc --build` 列出四個：

```text
src/AppointmentCard.vue(7,7): error TS2322: Type 'number' is not assignable to type 'string'.
src/AppointmentCard.vue(10,18): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
src/AppointmentCard.vue(16,17): error TS2551: Property 'patientNmae' does not exist on type 'Appointment'. Did you mean 'patientName'?
src/AppointmentCard.vue(17,14): error TS2367: This comparison appears to be unintentional because the types '"booked" | "checked-in" | "cancelled"' and '"canceled"' have no overlap.
```

`npx eslint .` 抓到第 3 個問題的原因，子元件直接改了父元件傳進來的物件：`Unexpected mutation of "appt" prop  vue/no-mutating-props`。emit 的參數傳成了號碼（number），父元件拿號碼去呼叫取消的 API，也會失敗。

專案有型別檢查，CI 裡跑的是 `tsc --noEmit`：`tsc` 不處理 `.vue` 檔，整個元件不在檢查範圍裡，所以永遠是綠的。專案也有 ESLint，但設定還是舊範本留下的 `.eslintrc.cjs`，升到 ESLint 10 之後一執行就停在 `ESLint couldn't find an eslint.config.* file.`，有人把那一步從 CI 拿掉了。

## 運作原理

### 三個工具各管一件事

| 工具 | 管什麼 | 例子 | 指令 |
|---|---|---|---|
| Prettier | 格式 | 縮排、引號、分號、換行、屬性一行幾個 | `prettier --write src/` |
| ESLint（加 eslint-plugin-vue、typescript-eslint） | 寫法 | 改 props、`v-for` 沒 `key`、`v-if` 與 `v-for` 混用、`any`、沒用到的變數 | `eslint .` |
| `vue-tsc` | 型別 | 拼錯的欄位、傳錯型別的 prop 與 emit、比較永遠不成立 | `vue-tsc --build` 或 `vue-tsc --noEmit` |

Vite 在開發與建置時只把 TypeScript 轉成 JavaScript，不檢查型別，所以 `npm run dev` 與 `vite build` 都不會因為型別錯誤停下來。型別檢查要另外跑；create-vue 3.24 產生的 `build` 指令是 `run-p type-check "build-only {@}" --`，把 `vue-tsc --build` 與 `vite build` 並行執行。

### ESLint 10 的 flat config

ESLint 9 把預設的設定檔換成 `eslint.config.js`（flat config），ESLint 10 完全移除舊的 `.eslintrc.*`：即使設了 `ESLINT_USE_FLAT_CONFIG=false`，ESLint 10.15 仍然只找 `eslint.config.*`。

flat config 是一個陣列，每個元素是一組設定，ESLint 對每個檔案由前往後套用符合的設定，後面的覆蓋前面的：

```text
export default defineConfig([
  { files: ['**/*.{vue,js}'] },        ← 要檢查哪些檔
  globalIgnores(['**/dist/**']),       ← 全部略過的路徑
  js.configs.recommended,              ← JavaScript 的基本規則
  ...pluginVue.configs['flat/essential'],   ← Vue 的規則（本身是好幾組設定，所以要展開）
  { rules: { 'vue/no-v-html': 'error' } },  ← 自己的調整，放在後面才蓋得過前面
  skipFormatting,                      ← 最後：關掉所有和 Prettier 衝突的格式規則
])
```

每條規則的嚴重度是 `off`、`warn`、`error`。`error` 讓 `eslint` 以非 0 的代碼結束，CI 就會失敗；`warn` 只印出來。要讓警告也擋下 CI，加 `--max-warnings 0`。想知道某個檔案最後套用了哪些規則：`npx eslint --print-config src/App.vue`。

### eslint-plugin-vue 的三個組合

eslint-plugin-vue 10.12.1 的 Vue 3 組合，數字是實際數過的規則數：

| 組合 | 規則數 | 內容 | 例子 |
|---|---|---|---|
| `flat/essential` | 85 | 會造成錯誤或非預期行為的寫法 | `vue/no-mutating-props`、`vue/require-v-for-key`、`vue/no-use-v-if-with-v-for`、`vue/no-side-effects-in-computed-properties`、`vue/no-ref-as-operand`、`vue/no-deprecated-destroyed-lifecycle`、`vue/multi-word-component-names` |
| `flat/strongly-recommended` | 再加 25 | 可讀性，大多是模板的格式 | `vue/html-indent`、`vue/html-quotes`、`vue/max-attributes-per-line`、`vue/attribute-hyphenation` |
| `flat/recommended` | 再加 8 | 一致性與少用的寫法 | `vue/attributes-order`、`vue/block-order`、`vue/no-v-html`、`vue/this-in-template` |

`flat/essential` 是底線，AI 產出的元件最常踩的幾種錯（改 props、`v-for` 沒 `key`、Vue 2 的生命週期名稱）都在裡面，完整清單見 [AI 寫前端的常見錯誤](#/skill/ai-common-mistakes)。`strongly-recommended` 多出來的規則大部分是格式，和 Prettier 重疊；用了 Prettier 時，把 `eslint-config-prettier/flat` 放在設定陣列的最後，這些規則就會被關掉。`vue/no-v-html` 在 `recommended` 才有，專案有用到 `v-html` 時值得單獨打開：`v-html` 插入的字串不會被跳脫，是 XSS 的常見來源。

### TypeScript：`.vue` 要交給 vue-tsc

`tsc` 只認得 `.ts`、`.tsx`、`.js` 這類副檔名，`.vue` 不在它的範圍裡。`vue-tsc` 用 Vue 的語言工具把 SFC 轉成 TypeScript 看得懂的形式，`<script setup lang="ts">` 與模板裡的運算式一起檢查：`{{ appt.patientNmae }}` 會被當成「存取 `Appointment` 型別上不存在的屬性」。實測同一個專案，`tsc --noEmit` 沒有任何輸出，`vue-tsc --build` 列出上面四個錯並以代碼 1 結束。

兩種常見的執行方式：

| 指令 | 用在哪裡 |
|---|---|
| `vue-tsc --build` | create-vue 的範本：根目錄的 `tsconfig.json` 用 `references` 指向 `tsconfig.app.json`、`tsconfig.node.json`，`--build` 逐一檢查 |
| `vue-tsc --noEmit` | 單一 `tsconfig.json` 的專案 |

TypeScript 的版本要注意：vue-tsc 3.3 用的是 TypeScript 的 JavaScript API，TypeScript 7.0 的 `typescript` 套件已經不提供這套 API。實測 vue-tsc 3.3.14 搭配 typescript 7.0.2，一啟動就丟出 `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined by "exports"`。create-vue 3.24 的範本把 `typescript` 鎖在 `~6.0.0`。TypeScript 6 與 7 的差別見 [TypeScript 基礎](#/skill/ts-basics)。

ESLint 要讀懂 `.vue` 裡的 TypeScript，用 `@vue/eslint-config-typescript`：`defineConfigWithVueTs()` 取代 `defineConfig()`，`vueTsConfigs.recommended` 帶進 typescript-eslint 的建議規則，例如 `@typescript-eslint/no-explicit-any`（`Unexpected any. Specify a different type`）與 `@typescript-eslint/ban-ts-comment`。

### oxlint

create-vue 3.24 也可以選擇加入 oxlint：一個用 Rust 寫的 linter，規則與 ESLint 的常用規則相容、速度快很多。範本的做法是 `lint` 先跑 `oxlint . --fix`，再跑 `eslint . --fix`，並用 `eslint-plugin-oxlint` 在 ESLint 裡關掉 oxlint 已經檢查過的規則。eslint-plugin-vue 的模板規則仍然由 ESLint 負責。

### 什麼時候跑

| 時機 | 跑什麼 | 範圍 | 要多快 |
|---|---|---|---|
| 編輯器 | ESLint 擴充、Vue 官方擴充（Volar）的型別提示、存檔時 Prettier | 開著的檔案 | 即時 |
| pre-commit | `eslint --fix`、`prettier --write` | 這次暫存的檔案 | 幾秒內 |
| CI（pull request） | `eslint .`、`vue-tsc --build`、測試、`vite build` | 整個專案 | 幾分鐘內 |

pre-commit 用 husky 掛 git hook、lint-staged 挑出暫存的檔案：`npx husky init` 會在 `package.json` 加上 `"prepare": "husky"`，並建立 `.husky/pre-commit`（內容預設是 `npm test`，改成 `npx lint-staged`）。lint-staged 會把暫存的檔名接在指令後面，例如 `eslint --fix src/AppointmentCard.vue src/List.vue`。

型別檢查不能這樣跑。檔名一出現在指令列，TypeScript 就不讀 `tsconfig.json`：

- TypeScript 6.0 直接報錯：`error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig' to skip this error.`
- TypeScript 5.9 不報錯，默默用預設值檢查：實測一個 `strict: true` 才會報錯的檔案，`tsc --noEmit a.ts` 以代碼 0 結束，`tsc --noEmit -p .` 才報出 `TS7006`。

型別錯誤也常發生在沒改到的檔案（改了 `types.ts`，壞的是用到它的元件）。型別檢查放在 CI 跑整個專案；一定要放進 pre-commit 時，用 lint-staged 的函式寫法回傳不帶檔名的指令。

pre-commit 可以用 `git commit --no-verify` 跳過，只是加快回饋；合併前的關卡在 CI。

## 實際程式碼

### `eslint.config.js`（Vue + TypeScript + Prettier）

```js
// eslint.config.js：ESLint 10、eslint-plugin-vue 10、@vue/eslint-config-typescript 14
import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  { name: 'app/files-to-lint', files: ['**/*.{vue,ts,mts,tsx}'] },
  globalIgnores(['**/dist/**', '**/coverage/**']),

  ...pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,

  {
    name: 'app/rules',
    rules: {
      'vue/component-api-style': ['error', ['script-setup']],   // 只准 <script setup>
      'vue/no-v-html': 'error',
    },
  },

  skipFormatting,   // 一定放最後：關掉和 Prettier 衝突的格式規則
)
```

設定檔是 TypeScript（`eslint.config.ts`）時，要另外安裝 `jiti` 讓 ESLint 載入，create-vue 的 TypeScript 範本就是這樣做的。

### `package.json`

```json
{
  "scripts": {
    "lint": "eslint . --max-warnings 0 --cache",
    "format": "prettier --write src/",
    "type-check": "vue-tsc --build",
    "test:unit": "vitest run",
    "build": "vite build",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{vue,ts,js}": ["eslint --fix", "prettier --write"],
    "*.{css,json,md}": "prettier --write"
  },
  "devDependencies": {
    "typescript": "~6.0.0",
    "vue-tsc": "^3.3.14"
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

兩組 glob 沒有重疊：lint-staged 預設讓不同 glob 的任務同時執行，同一個 glob 底下的陣列依序執行；兩組 glob 都會改同一個檔案時，會互相蓋掉對方的修改。

要在 pre-commit 做型別檢查，lint-staged 的設定改寫成 JS 檔，值寫成函式：函式回傳的指令 lint-staged 不會再加上檔名，要檔名就自己接。

```js
// lint-staged.config.js
const quote = (files) => files.map((f) => `"${f}"`).join(' ')

export default {
  '*.{vue,ts}': (files) => [
    `eslint --fix ${quote(files)}`,
    `prettier --write ${quote(files)}`,
    'vue-tsc --build',                 // 不帶檔名：讀 tsconfig、檢查整個專案
  ],
}
```

專案大的時候 `vue-tsc --build` 要跑十幾秒以上，每次 commit 都等會讓人想用 `--no-verify`；多數團隊只在 CI 跑型別檢查。

### CI 的步驟

```yaml
# .github/workflows/ci.yml 的 steps（節錄）
- run: npm ci
- run: npm run lint
- run: npm run type-check
- run: npm run test:unit
- run: npm run build
```

每一步都以非 0 結束就讓 job 失敗。完整的前端 CI 寫法（快取、預覽部署、E2E）另有一課；通用的管線見後端路線的 [CI 管線](#/skill/ci-pipeline)。

### 允許例外的寫法

```ts
// eslint-disable-next-line vue/no-v-html -- 內容是後端用 DOMPurify 清過的院內公告
// @ts-expect-error -- 第三方套件的型別少了 locale 參數，已回報 issue #123
```

`--` 後面是原因，ESLint 會略過這段說明。`@ts-expect-error` 在下一行沒有錯誤時會反過來報錯，套件修好之後這行註解就會被發現；`@ts-ignore` 不會，typescript-eslint 的 `ban-ts-comment` 會擋下它：`Use "@ts-expect-error" instead of "@ts-ignore", as "@ts-ignore" will do nothing if the following line is error-free`。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 修法 |
|---|---|---|
| `ESLint couldn't find an eslint.config.* file.`，並提到 `From ESLint v9.0.0, the default configuration file is now eslint.config.*.` | 只有舊的 `.eslintrc.*` | 照 ESLint 的 migration guide 改寫成 `eslint.config.js`；ESLint 10 沒有退回舊格式的開關 |
| `Unexpected mutation of "appt" prop  vue/no-mutating-props` | 子元件直接改 props | emit 事件讓父元件改，或用 `defineModel` |
| `Elements in iteration expect to have 'v-bind:key' directives  vue/require-v-for-key` | `v-for` 沒有 `key` | 加上穩定的 id 當 `key` |
| `The 'slots' variable inside 'v-for' directive should be replaced with a computed property that returns filtered array instead. You should not mix 'v-for' with 'v-if'  vue/no-use-v-if-with-v-for` | 同一個元素上同時有 `v-for` 與 `v-if` | 用 computed 先篩選 |
| `Unexpected side effect in "first" computed property  vue/no-side-effects-in-computed-properties` | computed 裡呼叫了會改原陣列的 `sort()` | 改用 `toSorted()` 或先複製 |
| `Component name "Queue" should always be multi-word  vue/multi-word-component-names` | 單字的元件名稱，可能和未來的 HTML 元素撞名 | 改成 `QueueList` 這類兩個字以上的名稱 |
| `error TS2551: Property 'patientNmae' does not exist on type 'Appointment'. Did you mean 'patientName'?` | 模板裡拼錯欄位 | 照建議修正；只有 `vue-tsc` 看得到模板裡的這種錯 |
| `error TS2367: This comparison appears to be unintentional because the types … have no overlap.` | 和型別裡不存在的字串比較（`'canceled'` 與 `'cancelled'`） | 改成型別裡的值 |
| `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline.` | lint-staged 把檔名傳給了 `tsc` 或 `vue-tsc` | 用函式回傳不帶檔名的指令，或把型別檢查移到 CI |
| `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined by "exports"` | vue-tsc 3.3 搭配了 TypeScript 7 | `typescript` 鎖在 `~6.0.0` |
| `tsc --noEmit` 永遠沒有錯誤 | `.vue` 不在 `tsc` 的範圍裡 | 改用 `vue-tsc` |
| 存檔時 Prettier 改一次、`eslint --fix` 又改回去 | 少了 `eslint-config-prettier`，或沒放在設定陣列的最後 | 把 `skipFormatting` 放到最後 |

另外兩種不會有訊息的狀況：CI 裡沒有 lint 或型別檢查那一步（打開 workflow 檔確認），以及用 `// eslint-disable` 不帶規則名稱、關掉整個檔案的所有規則。`grep -rnE "eslint-disable|@ts-ignore|as any" src/` 定期看一次。

## 動手

1. 在自己的專案執行 `npx eslint --print-config src/App.vue`，確認 ESLint 讀得到設定、用的是哪個 eslint-plugin-vue 組合；再把組合從 `flat/essential` 改成 `flat/recommended`，看多出哪些錯誤。
2. 把本課開頭的元件貼進一個 Vue 3.5 + TypeScript 的專案，分別跑 `npx tsc --noEmit` 與 `npx vue-tsc --build`，比較兩者的輸出。
3. 用 `npx husky init` 與 lint-staged 設好 pre-commit，暫存一個 `v-for` 沒 `key` 的檔案，確認 commit 會被擋下；再故意把 `vue-tsc` 直接寫進 lint-staged 的陣列，看 TS5112 的錯誤。
4. 打開 CI 的 workflow，確認 lint、型別檢查、測試、建置四步都在，而且失敗會讓 pull request 不能合併。
5. 讀後端路線的 [型別檢查、lint 與格式化](#/skill/code-quality)（ruff、pyright）與 AI 路線的 [AI 改程式的品質閘門](#/skill/ai-quality-gates)，比較兩邊在 pre-commit 與 CI 的分工；這些檢查在整體驗收裡的位置見 [前端測試的分層](#/skill/test-layers)。
