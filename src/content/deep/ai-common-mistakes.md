## 從一個具體問題開始：一個「能跑」的元件

請 AI 寫一個預約清單元件：可以搜尋、可以取消、每 30 秒通知父元件重新整理。產出貼進專案，畫面出來了，搜尋與取消看起來也正常：

```vue
<script setup>
import { ref, watch } from 'vue'
import { useFetch } from 'vue'                                    // ①

const props = defineProps(['appointments'])
const keyword = ref('')
const filtered = ref([])

watch(keyword, () => {                                            // ②
  filtered.value = props.appointments.filter((a) => a.name.includes(keyword.value))
})

function cancel(a) {
  props.appointments.splice(props.appointments.indexOf(a), 1)     // ③
  fetch(`/api/appointments/${a.id}/cancel`, { method: 'POST' })   // ④
}
</script>

<script>
export default {
  data() { return { timer: null } },                              // ⑤
  mounted() { this.timer = setInterval(() => this.$emit('refresh'), 30000) },
  beforeDestroy() { clearInterval(this.timer) },                  // ⑥
}
</script>

<template>
  <input v-model="keyword" placeholder="病患姓名">
  <ul>
    <li v-for="(a, i) in filtered" :key="i" v-if="a.status !== 'cancelled'">   <!-- ⑦ -->
      {{ a.name | upper }}                                        <!-- ⑧ -->
      <span v-html="a.note"></span>                               <!-- ⑨ -->
      <button @click="cancel(a)">取消</button>
    </li>
  </ul>
</template>
```

九個標號，每一個都是 AI 產出的 Vue 程式裡反覆出現的錯：

1. `useFetch` 不是 Vue 的 API（Nuxt 與 VueUse 才有），這一行在瀏覽器裡會讓整個模組載入失敗。
2. 用 `watch` 把篩選結果抄到另一個 ref：第一次進頁面時 `filtered` 是空的（沒有 `immediate`），`appointments` 更新時也不會重算。
3. 直接改 props：父元件的陣列被子元件改掉，伺服器卻可能沒有取消成功。
4. 取消沒有檢查結果，失敗了畫面也已經少一列。
5. 同一個元件混用 Options API（`data`、`mounted`）與 `<script setup>`。
6. `beforeDestroy` 是 Vue 2 的鉤子名，Vue 3 不會呼叫它，計時器永遠不會被清掉。
7. `key` 用 index，`v-for` 與 `v-if` 寫在同一個元素上（Vue 3 先執行 `v-if`，這時還沒有 `a`）。
8. `|` 是 Vue 2 的 filter 語法，Vue 3 把它當成位元 OR 運算，畫面印出 `0`。
9. `v-html` 顯示使用者輸入的備註，可以被插入 script。

畫面「看起來正常」只是因為測試時的資料剛好沒觸發這些問題。

## 運作原理：這些錯為什麼反覆出現

### 訓練資料裡有好幾代的寫法

Vue 2 從 2016 年用到 2023 年底停止維護，網路上大量的範例、問答、教學是 Vue 2 或 Options API；Vue 3 的 Composition API 與 `<script setup>` 也有好幾個版本的寫法（3.0 的 `setup()` 回傳物件、3.2 起的 `<script setup>`、3.4 的 `defineModel`、3.5 的 `useTemplateRef` 與 props 解構）。沒有指定版本與寫法時，產出會混用不同時期的寫法；這些寫法多半能編譯，有的在 Vue 3 裡默默失效（`beforeDestroy`、filter）。

### 「能跑」與「對」的距離

模型產生的是「看起來像正確答案」的程式。缺的東西往往不會造成錯誤訊息：

- 沒寫錯誤處理，成功的情況照樣能跑。
- 沒寫清理，元件沒被卸載前看不出來。
- `key` 用 index，沒有刪除或排序就不會錯位。
- 直接改 props，畫面反而「更新得更快」。

所以驗收不能只看畫面，要靠會主動找問題的工具，以及會觸發邊界情況的操作。

### 錯誤的分類與抓法

| 類別 | 例子 | 誰抓得到 |
|---|---|---|
| 過時的 API | `beforeDestroy`、`destroyed`、filter、`this.$set`、`.sync`、`$listeners`、`new Vue()` | eslint-plugin-vue（`flat/essential` 以上）；Vue 3 Migration Guide 有完整清單 |
| 不存在的 API | `import { useFetch } from 'vue'`、元件庫沒有的 props | `vue-tsc --noEmit`；瀏覽器載入時的 `SyntaxError` |
| 寫法混用 | `<script setup>` 加上 `data()`、`methods` | lint 規則 `vue/component-api-style`（要自己開） |
| 響應式誤用 | watch 抄資料、解構 `reactive`、computed 有副作用 | 部分 lint 規則；人工對照 [響應式](#/skill/reactivity) |
| 資料流 | 改 props、`v-model` 綁在 prop 上 | `vue/no-mutating-props`；編譯錯誤；執行時 `[Vue warn]` |
| 列表 | 沒有 `key`、`key` 用 index、`v-if` 加 `v-for` | `vue/require-v-for-key`、`vue/no-use-v-if-with-v-for`；index 要人工看 |
| 安全 | `v-html` 顯示外部內容 | `vue/no-v-html`（`flat/recommended`） |
| 只寫成功 | 沒檢查 `res.ok`、沒有 loading 與 error、沒清理 | Network 分頁與 Console 的操作驗收 |

## 實際程式：設定與修正

### 讓工具先抓

```js
// eslint.config.js（ESLint 9 的 flat config）
import pluginVue from 'eslint-plugin-vue'

export default [
  ...pluginVue.configs['flat/recommended'],   // 包含 essential：過時 API、改 props、v-for 沒 key、v-if 加 v-for
  {
    rules: {
      'vue/component-api-style': ['error', ['script-setup']],   // 只准 <script setup>
      'vue/no-ref-object-reactivity-loss': 'error',             // 不在預設組合裡，要自己開
      'vue/no-setup-props-reactivity-loss': 'error',
    },
  },
]
```

```bash
npx eslint .                 # 抓寫法
npx vue-tsc --noEmit         # 抓型別：不存在的 import、props、欄位
npm run build                # 抓建置錯誤
```

這三個指令寫進專案規範檔與 CI，AI 的每次改動都要通過；專案規範檔怎麼寫見 [專案規範檔與 context](#/skill/context-engineering)，CI 的閘門見 [AI 改程式的品質閘門](#/skill/ai-quality-gates)。

### 修正後的元件

```vue
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({ appointments: { type: Array, required: true } })
const emit = defineEmits(['cancel', 'refresh'])

const keyword = ref('')

// ② 衍生資料用 computed：keyword 或 appointments 任一個變了就重算，第一次也會算
// ⑦ 已取消的在這裡篩掉，不在 <li> 上寫 v-if
const visible = computed(() =>
  props.appointments.filter((a) => a.status !== 'cancelled' && a.name.includes(keyword.value.trim())),
)

// ③④ 不改 props，把「要取消哪一筆」交給持有資料的父元件，由它呼叫 API、處理失敗
function cancel(id) {
  emit('cancel', id)
}

// ⑤⑥ 用 Composition API 的鉤子，卸載時清掉計時器
let timer = null
onMounted(() => { timer = setInterval(() => emit('refresh'), 30_000) })
onUnmounted(() => clearInterval(timer))

// ⑧ 格式化用函式或 computed，不用 filter 語法
const upper = (s) => s.toUpperCase()
</script>

<template>
  <input v-model="keyword" placeholder="病患姓名">
  <ul>
    <li v-for="a in visible" :key="a.id">                         <!-- ⑦ key 用 id -->
      {{ upper(a.name) }}
      <span>{{ a.note }}</span>                                   <!-- ⑨ 純文字 -->
      <button type="button" @click="cancel(a.id)">取消</button>
    </li>
  </ul>
</template>
```

① 的 `useFetch` 刪掉。需要共用的請求邏輯，自己寫一個 composable，或在 `package.json` 已經有 VueUse 時從 `@vueuse/core` import。

### 審查的固定順序

拿到一份 AI 產出，依序做這幾件事，前一步沒過就先修，不往下：

1. **看 diff 的範圍**：改了哪些檔、有沒有多出套件（`package.json`）、有沒有動到不相干的檔案。
2. **跑工具**：`npx eslint .`、`npx vue-tsc --noEmit`、`npm run build`。
3. **掃一遍已知的模式**：搜尋 `beforeDestroy`、`destroyed`、`this.`、`data()`、`watch(`、`:key="index"`、`:key="i"`、`v-html`、`props.…=`。
4. **跑起來操作**：每個狀態切一遍（loading、empty、error），三個寬度，只用鍵盤；同時開著 Console 與 Network 分頁。
5. **對照描述**：每一段描述與驗收條件都有對應的實作，見 [把畫面描述成文字](#/skill/describe-ui)。

:::stop 讀到這裡可以先停：會先讓 lint 與型別檢查抓一輪，再照固定順序審一段 AI 產出。後面的錯誤訊息對照，在 Console 或 lint 出現看不懂的警告時再回來查。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `Uncaught SyntaxError: The requested module '…' does not provide an export named 'useFetch'` | import 了不存在的 API | 刪掉，改用自己的 composable 或已安裝的套件 |
| `vue-tsc`：`Module '"vue"' has no exported member 'useFetch'.` | 同上，型別檢查階段就抓得到 | 同上 |
| 畫面印出 `0`，Console 有 `[Vue warn]: Property "upper" was accessed during render but is not defined on instance.` | Vue 2 的 filter 語法（插值裡用直線符號接 filter 名稱）在 Vue 3 被當成位元 OR 運算 | 改成 `{{ upper(a.name) }}` |
| 離開頁面後計時器還在跑，沒有任何訊息 | `beforeDestroy`、`destroyed` 在 Vue 3 不會被呼叫 | 改用 `onBeforeUnmount`、`onUnmounted` |
| `[Vue warn]: Set operation on key "date" failed: target is readonly.` | 重新指定 prop | 發事件給父元件 |
| 編譯錯誤 `v-model cannot be used on a prop, because local prop bindings are not writable.` | `v-model` 綁在 prop 上 | 用 `defineModel()`，或 `:value` 加 `@input` 發事件 |
| 父元件的陣列被改掉，沒有任何訊息 | 子元件 `props.items.splice()`、`push()` 改了 prop 的內部 | `vue/no-mutating-props` 抓得到；改成發事件 |
| `[Vue warn]: Property "a" was accessed during render but is not defined on instance.` | `v-for` 與 `v-if` 在同一個元素 | 篩選改用 computed |
| 刪除一筆後輸入框內容對錯列 | `key` 用 index | 用資料的 id |
| 第一次進頁面清單是空的，打字後才出現 | 用 `watch` 抄資料，沒有 `immediate` | 改成 computed |
| dev server 顯示 `Failed to resolve import "…" from "src/…". Does the file exist?` | import 了沒安裝的套件或打錯路徑 | 確認套件在 `package.json`，不隨意新增依賴 |


## 動手

1. 把本課開頭的元件貼進一個 Vue 3.5 + Vite 專案，先不改，依序跑 `npx eslint .`、`npx vue-tsc --noEmit`，記下每個工具抓到哪幾個標號；抓不到的那幾個（④、⑦ 的 index key、②）要靠操作與人工看。
2. 操作一輪：輸入搜尋字、取消一筆、切到別的頁面再回來，對照 Console 的 `[Vue warn]` 與 Network 分頁的請求。
3. 把上面的 ESLint 設定與三個指令寫進自己專案的規範檔，下一次請 AI 改元件時，要求它在回報前跑完並貼上結果。
4. 回頭讀 [生命週期](#/skill/lifecycle) 與 [模板語法](#/skill/template-syntax)，對照 ⑥、⑦、⑧ 在 Vue 3 的正確寫法。
