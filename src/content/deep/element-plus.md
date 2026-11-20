## 從一個具體問題開始：換成元件庫之後，第二次的錯誤訊息不見了

門診系統的櫃台掛號頁從手寫元件換成 Element Plus 2.14.8。上線第一週收到四則回報：

1. 櫃台的舊電腦開掛號頁要等好幾秒。`vite build` 的輸出裡有一支 1 MB 的 JS 和 363 KB 的 CSS，頁面只用了表單、按鈕、表格和一個 Dialog。
2. 預約清單沒有資料時寫著「No Data」，確認取消的對話框按鈕是「Cancel」「OK」。
3. 院方的品牌色是深綠，主按鈕改成綠色了，滑鼠移上去卻變成淺藍。
4. 病歷號打錯，後端回 422「查無此病歷號」，欄位下方出現紅字。櫃台改了病歷號再送，後端回了同一則訊息，這次欄位下什麼都沒有。

四件事都不是 Element Plus 的 bug：第 1 件是全量引入，第 2 件是沒設語系，第 3 件是只改了一個 CSS 變數，第 4 件是 `el-form-item` 的 `error` 只在值改變時才重新顯示。這一課講元件庫在這幾個地方怎麼運作、它給了什麼、沒給什麼。要不要用元件庫、用哪一種，設計情境 [元件自己做、用元件庫，還是 headless](#/scenario/ui-library) 比較過，這裡不重講。

## 運作原理

### 元件庫給了什麼、沒給什麼

| 項目 | Element Plus 2.14.8 給的 | 要自己做或自己驗的 |
|---|---|---|
| 外觀 | 整套樣式，顏色、圓角、字級都是 CSS 變數 | 對應到專案的 token；預設主色 `#409eff` 上的白字對比約 2.78:1，欄位錯誤的紅字 `#f56c6c` 在白底上約 2.9:1，都不到一般文字要求的 4.5:1 |
| 互動狀態 | hover、focus、disabled、loading 的樣式 | 狀態表裡每一格和設計稿對過一次，見 [互動狀態](#/skill/ui-states) |
| 表單 | `rules` 驗證、錯誤訊息、`role="alert"` | 後端錯誤對回欄位；輸入框沒有 `aria-invalid`，錯誤也沒有用 `aria-describedby` 連到輸入框 |
| Dialog | `role="dialog"`、`aria-modal="true"`、焦點鎖在裡面、Esc 關閉、焦點歸還 | 開啟後焦點落在對話框本身，不是第一個欄位；要聚焦欄位就在 `@opened` 裡處理 |
| 表格 | 欄位、排序、篩選、勾選、固定表頭 | 表頭和內容是兩個 `<table>`（`.el-table__header` 與 `.el-table__body`），螢幕閱讀器讀內容時對不到欄名；伺服器分頁時的排序 |
| 語系 | 68 個語言檔，含 `zh-tw` | 部分 `aria-label` 沒翻：排序按鈕是 `Sort by 號碼`、全選是 `Select all rows` |

上面的對比值與屬性都是在 Chromium 裡掛上 2.14.8 實測的結果。元件庫省下的是外觀與大部分行為；無障礙的最後一段、和後端的接法、設計稿的差異，還是在自己的程式裡。

### 引入：全量與按需

全量引入是官方 Quick Start 的第一種寫法：

```js
// main.js：全量引入
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

createApp(App).use(ElementPlus).mount('#app')
```

`app.use(ElementPlus)` 把所有元件與指令註冊成全域，`index.css` 是全部元件的樣式。按需引入改由建置工具處理：unplugin-vue-components 掃描模板，看到 `<el-button>` 就替這個檔案加上 `import { ElButton } from 'element-plus/es'` 與它的樣式檔；unplugin-auto-import 掃描 script，看到 `ElMessage` 就加上 import。兩個外掛用同一個 `ElementPlusResolver`。

同一個畫面（表單、輸入框、按鈕、表格、Dialog、`ElMessage`、`v-loading`）在 Vite 7.3.8 建置的結果：

| 寫法 | JS | CSS |
|---|---|---|
| 全量引入 | 1,011 KB（gzip 332 KB） | 363 KB（gzip 48 KB） |
| 按需引入（兩個外掛） | 368 KB（gzip 132 KB） | 93 KB（gzip 13 KB） |
| 按需引入，只裝 unplugin-vue-components、手動 import `ElMessage` | 368 KB | 87 KB，少了 `.el-message` 的樣式 |

數字包含 Vue 本身，表格元件占了按需版本的一大塊。第三列是常見的漏洞：模板裡的元件有樣式，script 裡呼叫的 `ElMessage` 沒有，提示框接在頁面最下面、勾勾圖示撐滿整個寬度。chunk 怎麼切、怎麼看建置結果，見 [chunk 與內容 hash](#/skill/bundles-chunks)。

### 語系：`el-config-provider`

Element Plus 預設是英文。兩種設定方式：

- `app.use(ElementPlus, { locale: zhTw })`：全量引入時用。
- `<el-config-provider :locale="zhTw">` 包住根元件：按需引入時用，也能只包一個區塊。

語言檔從 `element-plus/es/locale/lang/zh-tw` 匯入。實測在根元件包了 `el-config-provider` 之後，用函式呼叫的 `ElMessageBox.confirm()` 按鈕也變成「取消」「確定」；沒設定時是「Cancel」「OK」。日期元件的月份與星期另外由 dayjs 的語系決定，官方文件要求另外 `import 'dayjs/locale/zh-tw'`。

語言檔裡沒翻的字串可以自己補：語言檔是一般物件，例如 `zhTw.el.table.sortLabel` 是 `'Sort by {column}'`，複製一份改成 `'依{column}排序'` 再傳給 `locale`。這類字串多半是 `aria-label`，畫面上看不到，只有螢幕閱讀器念得出來，要用 Accessibility 分頁才查得到。

### 主題：CSS 變數

Element Plus 的樣式分兩層變數：

```text
:root
  --el-color-primary: #409eff            ← 全站的主色
  --el-color-primary-light-3: #79bbff    ← 預先算好的淺色（3、5、7、8、9）
  --el-color-primary-dark-2: #337ecc     ← 預先算好的深色
.el-button--primary
  --el-button-bg-color: var(--el-color-primary)
  --el-button-hover-bg-color: var(--el-color-primary-light-3)
  --el-button-active-bg-color: var(--el-color-primary-dark-2)
  --el-button-disabled-bg-color: var(--el-color-primary-light-5)
```

官方文件的寫法是在 `:root` 覆寫 `--el-color-primary`。開頭第 3 件事就出在這裡：`light-3` 是建置時用 SCSS 算好的固定色碼，不會跟著 `--el-color-primary` 重算，所以按鈕底色變綠，hover 仍是 `#79bbff`。三種做法：

1. 把 `light-3`、`light-5`、`light-7`、`light-8`、`light-9`、`dark-2` 一起覆寫。Element Plus 的算法是主色與白色（深色是黑色）依比例混合，`light-3` 是混 30% 白。
2. 用 SCSS 變數（`element-plus/theme-chalk/src/common/var.scss` 的 `$colors`）重新編譯樣式，衍生色由它產生。
3. 只想改某一種元件時，覆寫元件層的變數，例如 `.el-button--primary { --el-button-hover-bg-color: … }`。

不要覆寫內部 class 的屬性（`.el-button--primary { background: … }`）：它和元件庫自己的規則比權重，hover、active、disabled 各要再寫一次，升級時 class 名稱或結構一改就失效。對應到專案的 token 時，讓 `--el-color-primary` 指向語意 token，見 [design token 與主題](#/skill/design-tokens)。改完主色要重驗對比：深綠 `#0b6e4f` 上的白字是 6.25:1，自動算出的 `light-3`（`#549a84`）只剩 3.32:1，hover 狀態的文字就不到 4.5:1。

暗色主題是另一個檔案 `element-plus/theme-chalk/dark/css-vars.css`，選擇器是 `html.dark`：在 `<html>` 加上 `dark` class 才生效，不會自己跟隨 `prefers-color-scheme`。

### 表單：`rules`、`validate()` 與 `error`

`el-form` 收 `model`（資料）與 `rules`（規則）；每個 `el-form-item` 用 `prop` 指出自己對應哪個欄位。規則格式來自 async-validator：`required`、`pattern`、`min`、`max`、`validator`，`trigger` 決定什麼時候驗（`blur`、`change`）。送出時呼叫 `formRef.value.validate()`：

| 結果 | `validate()` 的回傳 |
|---|---|
| 全部通過 | resolve `true` |
| 有欄位沒過 | reject，值是 `{ patientNo: [{ message, field, fieldValue }] }` 這種物件 |
| 傳了 callback（`validate((valid, fields) => …)`） | 不 reject，結果交給 callback |

沒過時 reject，所以 `await formRef.value.validate()` 不加 try／catch，Console 會出現 `Uncaught (in promise)` 和那個欄位物件。

後端的錯誤走另一條路：`el-form-item` 的 `error` prop。元件內部用 `watch` 監看 `error`，值改變時把欄位設成錯誤狀態、顯示那段字。流程照時間排：

| 時間點 | `error` 的值 | 欄位狀態 | 畫面 |
|---|---|---|---|
| 第一次送出，後端回 422 | `''` → `'查無此病歷號'` | error | 約 100 ms 後顯示紅字（狀態有 100 ms 的 debounce） |
| 櫃台改病歷號，再按送出，`validate()` 通過 | 還是 `'查無此病歷號'` | success | 紅字消失 |
| 後端又回 422，程式再設一次 | `'查無此病歷號'` → `'查無此病歷號'` | 不變（值沒變，`watch` 不觸發） | 沒有紅字 |

修法是送出前把 `error` 清成空字串，回應後再設；值經過一次改變，`watch` 就會觸發。後端欄位名（`patient_no`）和前端的 `prop`（`patientNo`）不同時要有一張對照表，對不到的訊息放在表單上方，規則和 [表單送出](#/skill/form-submit) 一樣。v-model 綁定與驗證時機見 [表單綁定與驗證](#/skill/forms)。

### 表格、Dialog、提示與載入

- **`el-table`**：`sortable` 只排傳進去的那幾筆。資料是伺服器分頁時，改成 `sortable="custom"`，在 `@sort-change` 收到 `{ prop, order }`（`order` 是 `ascending`、`descending` 或 `null`），帶進查詢參數重抓，否則只排了這一頁，見 [資料顯示元件](#/skill/data-display)。排序中的表頭有 `aria-sort="ascending"`，沒排序時是空字串。沒資料時顯示 `empty-text`，或用 `#empty` 插槽放「這個診次還沒有掛號」與下一步的按鈕。
- **`el-dialog`**：`v-model` 開關，`title` 會成為 `aria-label`。開啟後焦點在 `.el-dialog`（`tabindex="-1"`），Tab 在對話框裡循環，Esc 關閉，關閉後焦點回到開啟前的元素。`append-to-body` 把它移到 `body` 底下，避免被父層的 `overflow` 或 `z-index` 擋住。和原生 `<dialog>` 的比較見 [浮層](#/skill/overlays)。
- **`ElMessage`**：函式呼叫，元素加在 `body` 最後，`role="alert"`，預設 3 秒後消失。成功的確認用它，錯誤要留在原處讓人讀，用 `el-alert` 或欄位錯誤。
- **`v-loading`**：在元素上蓋一層 `.el-loading-mask`。遮罩擋住滑鼠，但下面的按鈕仍然 Tab 得到、按 Enter 也會觸發；送出中要停用按鈕，用 `el-button` 的 `loading` prop（會加上 `disabled`）。

### 設計稿和元件庫不一樣時

依序試，前面的做法能解決就不往下：

1. 改全站變數（`--el-color-*`、`--el-border-radius-base`、`--el-font-size-base`）。
2. 改單一元件的變數（`--el-button-*`、`--el-table-*`），範圍用 class 限制。
3. 用元件給的插槽與 prop（`#header`、`#empty`、`#footer`、`size`、`plain`）。
4. 包一層自己的元件，例如 `AppButton` 只開放設計稿有的 variant。
5. 這個元件和設計差太多：這一個改用 headless 元件或自己做，其他照用。

每一步的決定寫進 [畫面規格](#/skill/screen-spec)，例如「表格密度用 Element Plus 的 `size="small"`，不照設計稿的 36px 列高」，讓設計師與驗收的人知道差異是刻意的。

### 升級

Element Plus 用 2.x 發布多年，但 minor 版也標過 Breaking changes（CHANGELOG 的 2.7.0、2.9.0），2.14.0 把 `el-menu-item` 的 `index` 改成必填、拿掉了 `el-teleport`。準備在 3.0.0 移除的寫法會在 Console 警告，例如 `el-button` 的 `type="text"`：

```text
ElementPlusError: [props] [API] type.text is about to be deprecated in version 3.0.0, please use link instead.
```

這個警告出自 npm 套件的 `es` 建置；瀏覽器用的 `dist/index.full.min.mjs` 裡的警告函式是空的，看不到。做法：`package.json` 寫精確版本（`"element-plus": "2.14.8"`），升級時讀 CHANGELOG 的 Breaking changes 與 Refactors，在 dev server 清掉 Console 裡的棄用警告，跑元件測試與截圖比對。

## 實際程式碼

### 按需引入的設定

```js
// vite.config.js（Vite 7、unplugin-vue-components 32.1、unplugin-auto-import 21.1）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),   // script 裡的 ElMessage、ElMessageBox
    Components({ resolvers: [ElementPlusResolver()] }),   // 模板裡的 <el-*> 與 v-loading
  ],
})
```

`ElementPlusResolver` 從 `unplugin-vue-components/resolvers` 匯入，兩個外掛共用；unplugin-auto-import 21 沒有自己的 `resolvers` 子路徑。

### 根元件：語系與主題

```vue
<!-- App.vue -->
<script setup>
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import 'dayjs/locale/zh-tw'
import './styles/element.css'
</script>

<template>
  <el-config-provider :locale="zhTw">
    <RouterView />
  </el-config-provider>
</template>
```

```css
/* styles/element.css：Element Plus 的變數指向專案的語意 token（token 定義在 tokens/semantic.css） */
:root {
  --el-color-primary: var(--color-primary);           /* #0b6e4f */
  --el-color-primary-light-3: var(--color-primary-300);
  --el-color-primary-light-5: var(--color-primary-200);
  --el-color-primary-light-7: var(--color-primary-100);
  --el-color-primary-light-8: var(--color-primary-75);
  --el-color-primary-light-9: var(--color-primary-50);
  --el-color-primary-dark-2: var(--color-primary-700);
  --el-color-danger: var(--color-danger);              /* 換成對比夠的紅，欄位錯誤的字也跟著變 */
  --el-border-radius-base: var(--radius-md);
  --el-font-size-base: var(--font-size-md);
}
```

### 掛號表單

```vue
<!-- RegistrationForm.vue -->
<script setup>
import { ref, reactive } from 'vue'

const FIELD_MAP = { patient_no: 'patientNo', phone: 'phone' }   // 後端欄位 → 表單 prop

const formRef = ref()
const form = reactive({ patientNo: '', phone: '' })
const serverErrors = reactive({ patientNo: '', phone: '' })
const formError = ref('')
const submitting = ref(false)
const rules = {
  patientNo: [{ required: true, message: '請輸入病歷號', trigger: 'blur' }],
  phone: [{ pattern: /^09\d{8}$/, message: '手機格式是 09 開頭的 10 碼', trigger: 'blur' }],
}

async function onSubmit() {
  if (submitting.value) return
  for (const k of Object.keys(serverErrors)) serverErrors[k] = ''   // 先清空：值要改變，el-form-item 才會重新顯示
  formError.value = ''
  const ok = await formRef.value.validate().catch(() => false)     // 沒過時 reject，接住
  if (!ok) return
  submitting.value = true
  try {
    const res = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_no: form.patientNo, phone: form.phone }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 201) return ElMessage.success(`已完成掛號，號碼 ${body.number}`)   // AutoImport 帶入
    if (res.status === 422) {
      const other = []
      for (const e of body.errors ?? []) {
        const prop = FIELD_MAP[e.field]
        if (prop) serverErrors[prop] ||= e.message
        else other.push(e.message)
      }
      formError.value = other.join('；')
      return
    }
    formError.value = body.detail ?? '送出失敗，請再試一次'
  } catch {
    formError.value = '網路連線失敗，請再試一次'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="onSubmit">
    <el-form-item label="病歷號" prop="patientNo" :error="serverErrors.patientNo">
      <el-input v-model="form.patientNo" autocomplete="off" />
    </el-form-item>
    <el-form-item label="手機" prop="phone" :error="serverErrors.phone">
      <el-input v-model="form.phone" inputmode="tel" autocomplete="tel" />
    </el-form-item>
    <el-alert v-if="formError" type="error" :title="formError" :closable="false" show-icon />
    <el-button type="primary" native-type="submit" :loading="submitting">送出掛號</el-button>
  </el-form>
</template>
```

`el-form` 渲染成 `<form>`，`@submit.prevent` 接到原生的 submit 事件，在輸入框按 Enter 也會送出；`native-type="submit"` 讓按鈕是 `type="submit"`。

:::stop 讀到這裡可以先停：會按需引入 Element Plus、設好繁體中文與主題變數，並把後端的 422 放進 `el-form-item`。後面的表格排序、瀏覽器裡的主題檢查與升級，在做清單頁或改主題色時再回來讀。

### 預約清單：後端排序與空狀態

```vue
<!-- AppointmentTable.vue（節錄） -->
<el-table
  :data="rows"
  v-loading="loading"
  :default-sort="{ prop: 'number', order: 'ascending' }"
  @sort-change="({ prop, order }) => load({ sort: prop, order })"
>
  <el-table-column prop="number" label="號碼" sortable="custom" width="96" />
  <el-table-column prop="patient" label="病患" />
  <el-table-column prop="status" label="狀態" />
  <template #empty>
    <p>這個診次還沒有掛號</p>
  </template>
</el-table>
```

`load()` 把 `sort` 與 `order` 放進網址的查詢參數再打 API，讀取失敗時不要讓表格顯示空狀態，改顯示 `el-alert` 與重試按鈕，四種狀態的分法見 [API 四種狀態](#/skill/api-states)。

### 在瀏覽器裡看主題變數與語系

下面這段在沙箱裡載入 Element Plus 2.14.8，印出兩顆按鈕的底色與 hover 色、空表格的文字。左邊只改主色，右邊連衍生色一起改：

```js run vue
import { createApp, ref } from 'vue'
import ElementPlus from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'

const style = document.createElement('style')
style.textContent = `
  .only-primary { --el-color-primary: #0b6e4f; }
  .all-shades {
    --el-color-primary: #0b6e4f;
    --el-color-primary-light-3: #549a84;
    --el-color-primary-light-5: #85b6a7;
    --el-color-primary-light-7: #b6d4ca;
    --el-color-primary-light-8: #cee2dc;
    --el-color-primary-light-9: #e7f0ed;
    --el-color-primary-dark-2: #09583f;
  }`
document.head.append(style)

const App = {
  setup() { return { zhTw, rows: ref([]) } },
  template: `
    <el-config-provider :locale="zhTw">
      <span class="only-primary"><el-button type="primary">只改主色</el-button></span>
      <span class="all-shades"><el-button type="primary">連衍生色一起改</el-button></span>
      <el-table :data="rows" style="margin-top: 12px"><el-table-column prop="number" label="號碼" sortable /></el-table>
    </el-config-provider>`,
}
createApp(App).use(ElementPlus).mount('#app')

setTimeout(() => {
  for (const sel of ['.only-primary', '.all-shades']) {
    const b = getComputedStyle(document.querySelector(sel + ' .el-button'))
    console.log(sel, '底色', b.backgroundColor, 'hover', b.getPropertyValue('--el-button-hover-bg-color'))
  }
  console.log('空表格：', document.querySelector('.el-table__empty-text').textContent)
  console.log('排序按鈕的名稱：', document.querySelector('.caret-wrapper').getAttribute('aria-label'))
}, 300)
```

第一行的 hover 是 `#79bbff`（預設的淺藍），第二行是 `#549a84`。把 `:locale="zhTw"` 拿掉，空表格會變成 `No Data`；排序按鈕的名稱在兩種情況下都是英文。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `[Vue warn]: Failed to resolve component: el-button`，畫面上那裡是空的 | 元件沒註冊：沒有 `app.use(ElementPlus)`，也沒有設定 resolver；或 resolver 只設在 `AutoImport` | `Components({ resolvers: [ElementPlusResolver()] })` |
| `[Vue warn]: Failed to resolve directive: loading` | `v-loading` 沒註冊 | 同上；`ElementPlusResolver` 的 `directives` 預設是 `true` |
| 提示框接在頁面最下面、沒有樣式 | 手動 `import { ElMessage }`，只有元件外掛，樣式沒帶入 | 加 unplugin-auto-import，或手動 import 它的樣式 |
| `Uncaught (in promise)` 後面是 `{ patientNo: [...] }` | `await formRef.value.validate()` 沒接住 reject | `.catch(() => false)` 或 try／catch |
| 後端第二次回同一則錯誤，欄位下沒有字 | `error` 的值沒變，`watch` 沒觸發 | 送出前清成空字串 |
| `validate()` 沒有檢查某個欄位 | `el-form-item` 沒寫 `prop`，或 `prop` 和 `model` 的 key 不同 | `prop` 寫成 `model` 裡的欄位名 |
| 按鈕底色變了，hover 還是藍色 | 只覆寫 `--el-color-primary` | 一起覆寫 `light-*` 與 `dark-2`，或用 SCSS 變數重新產生 |
| 表格點了排序，只排了這一頁 | `sortable` 在前端排目前的 `data` | `sortable="custom"` 加 `@sort-change` 重抓 |
| 空表格寫「No Data」、對話框按鈕是英文 | 沒設語系 | `el-config-provider :locale="zhTw"` |
| Console：`ElementPlusError: … is about to be deprecated in version 3.0.0` | 用了準備移除的寫法 | 照訊息裡的 `please use … instead` 改 |

## 動手

1. 做程式題「把後端的 422 對回 el-form-item」：沙箱裡載入的就是 Element Plus 2.14.8，起始碼有三個錯，對照上面的時間表一個一個修。
2. 在上面的 run 區塊裡把 `.all-shades` 的 `light-3` 改成更深的綠，用 Elements 分頁強制 `:hover`，看按鈕底色與白字的對比（顏色選擇器的 Contrast ratio）。
3. 在自己的專案跑 `npx vite build`，比較全量與按需引入的輸出大小；搜尋 `element-plus/dist/index.css` 與 `app.use(ElementPlus)`，確認只用一種方式。
4. 只用鍵盤操作一次掛號表單與取消預約的 Dialog，記下焦點去哪、念出什麼；照 [元件的鍵盤操作與 ARIA](#/skill/a11y-components) 的方法，把表單錯誤補上 `aria-invalid` 與 `aria-describedby`，用 Accessibility 分頁確認。
5. 讀 [design token 與主題](#/skill/design-tokens)，把 `--el-*` 變數接到專案的語意 token，亮暗兩個主題各驗一次對比。
