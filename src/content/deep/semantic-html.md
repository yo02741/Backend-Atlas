## 從一個具體問題開始：按「清除」卻送出了掛號

一段 AI 產生的掛號表單，畫面看起來沒問題：

```html
<div class="form">
  <div class="title">預約掛號</div>
  <input placeholder="姓名">
  <input type="number" placeholder="病歷號">
  <div class="slot" onclick="pick('am')">上午診</div>
  <div class="slot" onclick="pick('pm')">下午診</div>
  <form>
    <button onclick="resetForm()">清除</button>
    <button>送出掛號</button>
  </form>
</div>
```

上線後陸續出現幾種回報：

- 按「清除」之後，頁面重新整理，有時還送出了一筆空的掛號。`form` 裡沒寫 `type` 的 `button` 預設是 `submit`。
- 用鍵盤操作的使用者按 Tab 跳不到「上午診」「下午診」，只能放棄。`div` 不能聚焦，也不會回應 Enter。
- 螢幕閱讀器念到輸入框時只說「編輯文字」，不知道要填什麼；開始輸入後 `placeholder` 消失，連看得到畫面的人也忘了這格是什麼。
- 病歷號 `0012345` 存進資料庫變成 `12345`。`type="number"` 的值轉成數字時，前導的 0 不見了。

每一個問題都來自「用外觀相近的元素代替有語意的元素」。HTML 元素除了外觀，還帶著角色、名稱、鍵盤行為與表單行為，換成 `div` 之後這些全部消失。

## 運作原理：元素帶來角色、名稱與行為

瀏覽器從 DOM 建出一棵**無障礙樹**（accessibility tree），每個節點有三樣東西：角色（role，例如 button、link、textbox）、名稱（name，例如「送出掛號」）、狀態（例如勾選、停用、展開）。螢幕閱讀器、語音控制與自動化測試工具讀的是這棵樹。在 Chrome 的 Elements 面板選取元素，右側 Accessibility 分頁看得到它的 Role 與 Name。

原生元素自動得到角色與鍵盤行為：

| 元素 | 角色 | 鍵盤 | 用 `div` 代替時要自己補的 |
|---|---|---|---|
| `<button>` | button | Tab 聚焦，Enter、Space 觸發 | `tabindex="0"`、`role="button"`、Enter 與 Space 的按鍵處理、停用狀態 |
| `<a href="…">` | link | Tab 聚焦，Enter 前往 | 換頁、新分頁開啟、右鍵選單都做不出來 |
| `<input type="checkbox">` | checkbox | Space 切換 | `role="checkbox"`、`aria-checked`、按鍵處理 |
| `<input type="radio">` 一組 | radio | 方向鍵在同組內移動 | `role="radiogroup"`、焦點管理、方向鍵處理 |
| `<select>` | combobox（加了 `multiple` 是 listbox） | 方向鍵選、輸入字母跳選 | 整套鍵盤互動 |

ARIA 屬性（`role`、`aria-*`）只改無障礙樹上的角色與狀態，不會幫元素加上鍵盤行為。有原生元素可以用時，就用原生元素；ARIA 留給原生元素做不到的元件，例如 Tabs、Combobox。

### 地標與標題

| 元素 | 對應的地標角色 | 說明 |
|---|---|---|
| `<header>` | banner | 放在 `body` 底下（不在 `article`、`aside`、`main`、`nav`、`section` 裡）時才算 |
| `<nav>` | navigation | 主要的導覽連結 |
| `<main>` | main | 頁面的主要內容，一頁一個 |
| `<aside>` | complementary | 和主內容相關、但可以拿掉的區塊 |
| `<footer>` | contentinfo | 條件同 `header` |
| `<section>` | region | 有名稱（例如 `aria-labelledby` 指到它的標題）時才算 |

螢幕閱讀器可以列出頁面的地標直接跳過去，也可以列出所有標題。標題 `h1`–`h6` 是內容的大綱：一頁通常一個 `h1`，`h2` 底下的小節用 `h3`。要讓字變小就用 CSS，不要為了字級選 `h4`。

### 表單欄位

**名稱從哪來**：欄位的名稱依序取自 `aria-labelledby`、`aria-label`、關聯的 `<label>`，最後才可能用到 `placeholder` 或 `title`。`label` 有兩種關聯方式：

```html
<!-- 用 for 對到 id -->
<label for="phone">手機</label>
<input id="phone" type="tel">

<!-- 或把欄位包在 label 裡 -->
<label>手機 <input type="tel"></label>
```

關聯好之後，點「手機」兩個字會把焦點放進欄位，checkbox 與 radio 的可點範圍也跟著變大。

**`fieldset` 與 `legend`**：一組 radio 共用一個問題（「看診時段」），問題寫在 `legend`。螢幕閱讀器進入這組時先念 `legend`，再念每個選項。

**`button` 的三種 `type`**：`submit`（預設）、`button`、`reset`。`submit` 會觸發表單的 `submit` 事件，沒有攔截時瀏覽器照 `action` 送出並載入新頁。在任一欄位裡按 Enter，瀏覽器也會找表單裡的送出鈕觸發送出（implicit submission）。

**`type`、`inputmode` 與手機鍵盤**：

| 寫法 | 手機上通常的鍵盤 | 內建檢查 | 適合 |
|---|---|---|---|
| `type="text"` | 一般鍵盤 | 無 | 姓名、地址 |
| `type="email"` | 帶 `@` 的鍵盤 | 要像 email | email |
| `type="tel"` | 撥號鍵盤 | 無（電話格式各國不同） | 電話 |
| `type="url"` | 帶 `/` 與 `.` 的鍵盤 | 要是完整網址 | 網址 |
| `type="number"` | 數字鍵盤或數字列 | `min`、`max`、`step` | 數量、年齡 |
| `type="date"` | 日期選擇器 | 日期格式 | 生日、預約日期；`value` 一律是 `YYYY-MM-DD` |
| `type="text"` + `inputmode="numeric"` | 數字鍵盤 | 無（可以搭配 `pattern`） | 病歷號、驗證碼、卡號 |

實際的鍵盤樣子依作業系統與輸入法而定。`type="number"` 給「可以加減的數量」用：它有調整箭頭，桌機上滑鼠滾輪可能改到值，程式轉成數字後前導的 0 會消失。

**`autocomplete`** 告訴瀏覽器欄位的內容：`name`、`email`、`tel`、`postal-code`、`street-address`、`bday`、`username`、`current-password`、`new-password`、`one-time-code`。值寫對了，手機上可以一鍵帶入；`one-time-code` 讓部分手機直接帶入簡訊收到的驗證碼。

## 實際程式碼

改寫上面的表單：

```html
<main>
  <h1>預約掛號</h1>
  <form id="appointment-form" action="/api/appointments" method="post">
    <label for="name">姓名</label>
    <input id="name" name="name" autocomplete="name" required>

    <label for="phone">手機</label>
    <input id="phone" name="phone" type="tel" autocomplete="tel" required>

    <label for="chart-no">病歷號</label>
    <input id="chart-no" name="chartNo" type="text" inputmode="numeric" pattern="[0-9]{7}">

    <fieldset>
      <legend>看診時段</legend>
      <label><input type="radio" name="slot" value="am" required> 上午診</label>
      <label><input type="radio" name="slot" value="pm"> 下午診</label>
      <label><input type="radio" name="slot" value="night"> 夜診</label>
    </fieldset>

    <button type="button" id="reset-btn">清除</button>
    <button type="submit">送出掛號</button>
  </form>
</main>
```

在 Vue 的元件裡，送出交給 `@submit.prevent` 處理，按鈕維持原生元素：

```vue
<template>
  <form @submit.prevent="submit">
    <!-- 欄位同上 -->
    <button type="button" @click="clear">清除</button>
    <button type="submit" :disabled="submitting">送出掛號</button>
  </form>
</template>
```

把送出寫在 `form` 的 `submit` 事件，而不是送出鈕的 `click`：在欄位裡按 Enter 送出也會走同一段程式，`required`、`pattern` 這些內建檢查也會先跑。

## 常見錯誤與錯誤訊息

Chrome 開發者工具的 Issues 分頁會列出表單的問題，訊息原文如下：

| Issues 的標題 | 原因 | 修法 |
|---|---|---|
| `Form field without valid aria-labelledby attribute or associated label` | 欄位沒有關聯的 `label` | 加 `label for`，或把欄位包在 `label` 裡 |
| `Incorrect use of <label for=FORM_ELEMENT>` | `for` 對不到任何 `id`，或對到的是 `name` | `for` 改成欄位的 `id` |
| `Duplicate form field id in the same form` | 同一個表單裡有重複的 `id` | 元件重複使用時，用 Vue 3.5 起的 `useId()` 或加前綴產生唯一的 `id` |
| `A form field element should have an id or name attribute` | 欄位既沒有 `id` 也沒有 `name` | 至少給 `name`，自動填入才認得 |

Lighthouse 的 Accessibility 類別裡對應的項目：

- `Form elements do not have associated labels`：同上，欄位沒有名稱。
- `Buttons do not have an accessible name`：只有圖示的按鈕沒有文字，加 `aria-label="關閉"` 或畫面上看不見的文字。
- `Heading elements are not in a sequentially-descending order`：標題跳級，例如 `h2` 之後直接 `h4`。
- `Document does not have a main landmark.`：頁面沒有 `main`。

其他常見的錯：

- **`div` 加 `role="button"` 就收工**：螢幕閱讀器念得出「按鈕」，但 Tab 跳不到、Enter 沒反應。要嘛補齊 `tabindex` 與按鍵處理，要嘛換成 `button`。
- **把焦點框拿掉**：`outline: none` 之後鍵盤使用者不知道焦點在哪。要換樣式就用 `:focus-visible` 畫一個新的。
- **用 `a href="#"` 做動作**：網址多了 `#`、頁面捲回頂端，右鍵還能「在新分頁開啟」。動作用 `button`。
- **radio 沒有共同的 `name`**：每一個都能各自勾選，方向鍵也不會在它們之間移動。

## 動手

- 打開本站任一頁，Elements 選取一個按鈕，看右側 Accessibility 分頁的 Role 與 Name；再選一個輸入框比較。
- 只用 Tab、Shift+Tab、Enter、Space 走一遍本站的選擇題：每個選項與按鈕都停得到嗎，焦點框看得到嗎。
- 在任何有表單的頁面打開 Issues 分頁，看看有沒有上面那幾條訊息。
- 版面的下一步是 [Flexbox：一維排列](#/skill/flexbox)：表單的欄位與按鈕列怎麼排。
