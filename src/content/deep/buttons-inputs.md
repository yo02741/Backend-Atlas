## 從一個具體問題開始：按「回上一步」，掛號就送出了

門診掛號表單分兩步：第一步填基本資料，第二步確認。上線第一天就有三個回報：

- 在確認頁按「回上一步」，畫面確實回到第一步，同時多了一筆掛號。按鈕寫成 `<button @click="step--">回上一步</button>`，放在 `<form>` 裡，沒寫 `type`。
- 「手機」欄位在手機上跳出英文鍵盤，使用者要切兩次才打得到數字。欄位寫成 `<input placeholder="手機號碼">`，沒有 `type`。
- 填到一半回頭檢查，看不出每一格原本要填什麼。表單沒有任何 `<label>`，只有灰色的 placeholder，輸入之後就不見了；欄位旁邊的文字也點不到欄位。

另外，設定頁的「接收簡訊提醒」做成一個開關，可是切完還要按頁面最下面的「儲存」才生效。使用者切完就關掉頁面，以為已經設定好了。

這些問題都出在元件選錯或少寫了一個屬性：按鈕的 `type`、欄位的 `type` 與 `label`，以及開關該不該立即生效。

## 運作原理

### 按鈕的層級

一個畫面上的按鈕依重要程度分層，視覺上要拉得開：

| 層級 | 用在 | 常見樣式 | 門診系統的例子 |
|---|---|---|---|
| primary | 這個區塊最主要的下一步，一個區塊一顆 | 實心主色底 | 確認掛號、送出 |
| secondary | 其他動作 | 外框或淺色底 | 回上一步、另存草稿 |
| ghost（tertiary） | 次要、每列都重複出現的動作 | 只有文字或很細的框 | 每列的「詳細」 |
| danger | 刪除、取消預約等不可逆的動作 | 紅色系 | 取消預約、刪除病歷附件 |

兩顆 primary 並排，使用者要停下來讀文字才知道該按哪顆。danger 按鈕通常搭配確認 Dialog 或「復原」，見 [浮層](#/skill/overlays) 與 [回饋](#/skill/feedback)。

### 連結還是按鈕

| | `<a href>` | `<button>` |
|---|---|---|
| 做什麼 | 換頁、換網址 | 在原地做事：送出、開 Dialog、切換 |
| 鍵盤 | Enter | Enter 與 Space |
| 中鍵、新分頁、複製網址 | 可以 | 不行 |
| 螢幕閱讀器念出 | 連結 | 按鈕 |

外觀可以依設計調整，元素要依功能選。WAI-ARIA APG 的 Button 模式也這樣寫：元件的外觀與角色都要符合它實際的功能。

### 按鈕的 `type`

`<button>` 的 `type` 有三種：`submit`（送出表單）、`reset`（清空表單）、`button`（什麼都不做，交給程式）。沒寫 `type`、也沒有 `command` 屬性時，在表單裡就是送出按鈕。所以：

- 表單裡只有真正送出的那一顆寫 `type="submit"`，其他一律寫 `type="button"`。
- 表單有送出按鈕時，在文字欄位按 Enter 會送出表單（implicit submission），很多人習慣這樣送出；送出按鈕用 `div` 做，按 Enter 就不會送。

### 輸入框的名稱、說明與錯誤

每個欄位要有一個名稱。`<label for="phone">` 的文字會成為 `id="phone"` 欄位的名稱，點 label 也會聚焦欄位、擴大點擊範圍。placeholder 只在欄位空白時顯示，部分瀏覽器會拿它當最後的備用名稱，但輸入之後畫面上就看不到了，不能代替 label。

說明文字（「手機號碼，09 開頭共 10 碼」）與錯誤訊息（「請輸入 10 碼手機號碼」）放在欄位旁邊，用 `aria-describedby` 連到欄位，螢幕閱讀器聚焦欄位時會接著念。錯誤時欄位加 `aria-invalid="true"`；狀態的細節見 [互動狀態](#/skill/ui-states)。

### `type`、`inputmode` 與 `autocomplete`

| 欄位 | 寫法 | 手機鍵盤 | 瀏覽器驗證 |
|---|---|---|---|
| 手機 | `type="tel"` `autocomplete="tel"` | 電話鍵盤 | 不驗格式 |
| Email | `type="email"` `autocomplete="email"` | 有 `@` 的鍵盤 | 驗 email 格式 |
| 病歷號（純數字） | `type="text"` `inputmode="numeric"` | 數字鍵盤 | 不驗 |
| 姓名 | `type="text"` `autocomplete="name"` | 一般鍵盤 | 不驗 |
| 生日 | `type="date"` `autocomplete="bday"` | 系統日曆 | 驗日期 |

病歷號、身分證末碼這類「由數字組成但不是數量」的值，不用 `type="number"`：它會出現上下箭頭，聚焦時滾動滑鼠滾輪可能改到值（依瀏覽器而定）；Vue 的 `v-model` 遇到 `type="number"` 還會自動轉成數字，開頭的 0 就不見了。用 `inputmode="numeric"` 只換鍵盤。

`autocomplete` 讓瀏覽器自動填入。WCAG 2.1 的 1.3.5 Identify Input Purpose（AA）要求收集使用者本人資料的欄位，用程式能判斷的方式標出用途，`autocomplete` 就是這個方式。

### Checkbox、Radio、Switch、Select

| 元件 | 能選幾個 | 何時生效 | 鍵盤 | 例子 |
|---|---|---|---|---|
| Checkbox（單一） | 是或否 | 通常按送出才生效 | Space 切換 | 同意就診須知 |
| Checkbox 群組 | 多個 | 按送出 | Tab 逐一移動、Space 切換 | 過敏藥物（選項少時） |
| Radio 群組 | 一個，互斥 | 按送出 | Tab 進群組，方向鍵移動並選取 | 初診／複診 |
| Switch | 開或關 | 立即生效 | Space 切換（Enter 選用） | 接收簡訊提醒 |
| Select | 一個 | 按送出 | 見 [選擇類元件](#/skill/select-combobox) | 科別（選項多） |

Radio 的鍵盤行為常被誤會：Tab 進入群組時停在已選的那一個（都沒選時停在第一個），在群組裡用方向鍵移動並同時選取，再按 Tab 就離開整個群組。整組用 `<fieldset>` 包起來，`<legend>` 寫群組的題目（「初診或複診」）。

Switch 的 ARIA 角色是 `switch`，狀態用 `aria-checked`；用 `<input type="checkbox">` 做時用原生的 `checked`。APG 提醒 Switch 的 label 不能隨狀態改變：寫「接收簡訊提醒」，不要切換時改成「已開啟」。HTML 的 `<input type="checkbox" switch>` 到 2026-11 只有 Safari 支援，還不是 Baseline，目前用 `role="switch"`。

### readonly 與 disabled

| | `readonly` | `disabled` |
|---|---|---|
| 拿得到焦點 | 可以 | 不行 |
| 值隨表單送出 | 會 | 不會 |
| 能不能改 | 不能 | 不能 |
| 用在 | 給人看、要送出的值（病歷號） | 暫時不能操作的欄位 |

### 點擊範圍

WCAG 2.2 的 2.5.8 Target Size (Minimum)（AA）要求點擊目標至少 24×24 CSS px；比較小的目標，要和相鄰目標保持足夠間距（以目標為中心、直徑 24px 的圓不能互相重疊）。AAA 等級的 2.5.5 是 44×44。只有圖示的按鈕最容易不夠大：圖示 16px，按鈕本身也只有 16px。

## 實際程式

```vue
<script setup>
import { ref, computed } from 'vue'

const props = defineProps({ chartNo: { type: String, required: true } })
const emit = defineEmits(['back', 'submit'])

const phone = ref('')
const visit = ref('first')          // 'first' 初診、'return' 複診
const note = ref('')
const smsReminder = ref(true)
const phoneError = ref('')
const noteLeft = computed(() => 200 - note.value.length)

function validatePhone() {
  phoneError.value = /^09\d{8}$/.test(phone.value) ? '' : '請輸入 09 開頭的 10 碼手機號碼'
}

async function toggleSms() {
  smsReminder.value = !smsReminder.value      // 立即生效：切換就送出，不等「儲存」
  await fetch('/api/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ smsReminder: smsReminder.value }),
  })
}
</script>

<template>
  <form @submit.prevent="emit('submit', { phone, visit, note })" novalidate>
    <label for="chart">病歷號</label>
    <input id="chart" :value="props.chartNo" readonly>

    <label for="phone">手機</label>
    <input id="phone" v-model="phone" type="tel" autocomplete="tel"
           aria-describedby="phone-hint phone-error"
           :aria-invalid="phoneError ? 'true' : 'false'" @blur="validatePhone">
    <p id="phone-hint" class="hint">09 開頭共 10 碼</p>
    <p id="phone-error" class="error">{{ phoneError }}</p>

    <fieldset>
      <legend>初診或複診</legend>
      <label><input v-model="visit" type="radio" name="visit" value="first"> 初診</label>
      <label><input v-model="visit" type="radio" name="visit" value="return"> 複診</label>
    </fieldset>

    <label for="note">主訴</label>
    <textarea id="note" v-model="note" maxlength="200" aria-describedby="note-count"></textarea>
    <p id="note-count" class="hint">還可以輸入 {{ noteLeft }} 字</p>

    <!-- 立即生效的開關：role="switch"，label 不隨狀態改變 -->
    <button type="button" role="switch" :aria-checked="String(smsReminder)" @click="toggleSms">
      接收簡訊提醒
    </button>

    <div class="actions">
      <button type="button" class="btn secondary" @click="emit('back')">回上一步</button>
      <button type="submit" class="btn primary">確認掛號</button>
    </div>
  </form>
</template>

<style scoped>
.btn { min-height: 44px; padding: 0 var(--space-4); border-radius: var(--radius-md); }
.btn.primary { background: var(--color-primary); color: var(--color-on-primary); border: 0; }
.btn.secondary { background: transparent; color: var(--color-primary); border: 1px solid var(--color-primary); }
.hint { color: var(--color-text-muted); }
.error:empty { display: none; }
[role="switch"][aria-checked="true"] { background: var(--color-primary); color: var(--color-on-primary); }
textarea { min-block-size: 4.5rem; max-block-size: 12rem; field-sizing: content; }   /* 隨內容長高；不支援的瀏覽器維持最小高度 */
</style>
```

幾個細節：

- `aria-describedby` 同時指向說明與錯誤兩個元素，錯誤是空的時候用 CSS 藏起來，元素本身一直在。
- 「主訴」用 `field-sizing: content` 隨內容長高，`max-block-size` 之後改成捲動。`field-sizing` 在 2026 年 6 月才成為 Baseline（Newly available），舊瀏覽器忽略這行、維持 `min-block-size` 的高度，使用者仍可以拖右下角調整。以前的做法是監聽 `input` 事件、把 `height` 設成 `scrollHeight`。
- 「病歷號」用 `readonly`，值會送出、也能 Tab 到並被念出來。
- 開關是 `type="button"` 的按鈕，放在表單裡也不會送出表單。

:::stop 讀到這裡可以先停：會選按鈕的層級與 `type`，替欄位配好 label、`type` 與 `autocomplete`，分得清 Checkbox、Radio、Switch。後面的 icon button 與常見錯誤，在做只有圖示的按鈕或驗收別人的表單時再回來讀。

Icon button 的寫法：

```vue
<button type="button" class="icon-btn" :aria-label="`刪除 ${appt.date} 的預約`" @click="remove(appt.id)">
  <svg aria-hidden="true" width="16" height="16"><use href="#icon-trash" /></svg>
</button>

<style scoped>
.icon-btn { inline-size: 32px; block-size: 32px; display: grid; place-items: center; }   /* 圖示 16px，點擊範圍 32px */
</style>
```

`aria-label` 寫出動作與對象：清單裡每一列都有刪除按鈕時，只寫「刪除」，螢幕閱讀器使用者用按鈕清單瀏覽時會聽到十個一樣的「刪除」。

## 常見錯誤

- **表單裡的按鈕沒寫 `type`**：「回上一步」「顯示密碼」「新增一列」都會送出表單。症狀是 Network 分頁多出 POST，或頁面突然重新載入。
- **placeholder 當 label**：輸入後看不到欄位名稱；欄位錯誤時使用者也不知道是哪一格。
- **用 `type="number"` 存代碼**：搭配 Vue 的 `v-model`，病歷號 `00123` 變成數字 `123`；聚焦時滾動滑鼠滾輪也可能改到值。
- **Switch 要按儲存才生效**：外觀暗示立即生效，行為卻要另外儲存。改成立即生效，或改用 Checkbox 加「儲存」。
- **自己畫的 Checkbox 拿不到焦點**：`div` 加 `@click` 做的勾選框，Tab 跳過、Space 沒反應。用原生 `<input type="checkbox">`，外觀用 CSS 調整（`accent-color` 依 2026-11 的 web-features 資料還不是 Baseline）。
- **Radio 每個都要 Tab 一次**：同一組的 `name` 沒寫成一樣，瀏覽器當成各自獨立的 Radio。
- **Icon button 沒有名稱**：Accessibility 窗格的 Name 是空的，螢幕閱讀器只念「按鈕」。
- **disabled 當 readonly 用**：不能改但要送出的值設成 `disabled`，送出時這個欄位不見了，後端收到缺欄位的請求。

AI 產生表單時常見的組合是：沒有 `<label>`、按鈕沒有 `type`、手機欄位用 `type="number"`、自訂開關用 `div`。描述需求時把每個欄位的 `type`、`autocomplete` 與每顆按鈕的 `type` 一起寫出來。

## 動手

1. 打開 [互動狀態實驗室](#/lab/UiStatesLab)，選「按鈕」與「輸入框」，逐一切換狀態，對照每個狀態的 CSS 選擇器與驗收條件；用滑鼠點與用 Tab 移到元件，看「瀏覽器目前判定」的 `:focus-visible` 有什麼不同。
2. 找一個自己的表單，在 Elements 分頁逐一選取欄位，看 Accessibility 窗格的 Name；Name 是空的或等於 placeholder 的，補上 `<label for>`。
3. 在表單裡搜尋沒有 `type` 的 `<button>`，每一顆決定是 `submit` 還是 `button`。
4. 用手機實機把掛號表單填一次，記下每個欄位跳出的鍵盤，和上面的表比對。
5. 按鈕送出中、停用、錯誤的狀態怎麼寫，回到 [互動狀態](#/skill/ui-states)；選項多到要用下拉選單時，接著讀 [選擇類元件](#/skill/select-combobox)。
