// 前端路線：品質：測試、效能、無障礙 的技能內文（以技能 id 為 key）
export default {
  'a11y-basics': {
    map: {
      names: [
        { n: 'accessibility tree', t: '瀏覽器從 DOM 整理給輔助科技（螢幕閱讀器、語音控制）用的樹，每個節點有 role（按鈕、連結、標題）、name（念出來的名稱）與狀態（勾選、展開、停用）。' },
        { n: 'accessible name', t: '控制項被念出來的名稱：按鈕取自文字內容、欄位取自 `<label>`、圖片取自 `alt`；只有圖示的按鈕要補 `aria-label`。沒有名稱的按鈕只會被念成「按鈕」。' },
        { n: '替代文字（`alt`）', t: '有意義的圖寫出它要傳達的內容，裝飾用的圖寫 `alt=""` 讓螢幕閱讀器跳過；完全沒寫 `alt` 時，部分螢幕閱讀器會念出檔名。' },
        { n: '色彩對比', t: 'WCAG 2.2 AA：一般文字與背景至少 4.5:1，大字（約 24px 以上，或 18.66px 以上的粗體）至少 3:1；輸入框邊框、焦點框、圖示這類非文字元素至少 3:1。' },
        { n: '鍵盤操作與焦點', t: '所有功能只用 Tab、Shift+Tab、Enter、Space、方向鍵、Esc 就能完成；焦點順序跟著閱讀順序，焦點框看得見（`:focus-visible`），也不被固定的頁首蓋住。' },
        { n: '`tabindex`', t: '`0` 讓原本不能聚焦的元素加入 Tab 順序，`-1` 只能用程式呼叫 `focus()`；大於 0 的值會打亂整頁的順序，不要用。' },
        { n: 'ARIA', t: '`role` 與 `aria-*` 屬性補充 HTML 表達不了的語意與狀態，例如 `aria-expanded`、`aria-invalid`。ARIA 只改變念出來的資訊，不會加上鍵盤行為；有原生元素就不用 ARIA。' },
        { n: 'live region', t: '`role="status"`（等目前的朗讀結束再念）與 `role="alert"`（立刻打斷）讓內容變化被念出來，例如「已完成掛號」；容器要先在 DOM 裡，之後再改它的文字。' },
      ],
      ask: [
        '每個控制項的名稱：只有圖示的按鈕念什麼，欄位的 `label` 與錯誤訊息怎麼連起來（`aria-describedby`）',
        '鍵盤操作與焦點移動：開 Dialog 時焦點到哪裡、關掉後回到哪裡、換頁後焦點放在哪',
        '對比的標準（WCAG 2.2 AA），以及顏色以外的狀態標示（文字、圖示）',
        '要念出來的狀態變化：送出成功、載入完成、驗證錯誤，各用 `role="status"` 還是 `role="alert"`',
        '驗收方式：Lighthouse 的 Accessibility 項目全過、只用鍵盤走完流程、用哪個螢幕閱讀器念一遍',
      ],
      prompt: '掛號表單 `AppointmentForm` 照 WCAG 2.2 AA：每個欄位有 `<label>`，錯誤訊息用 `aria-describedby` 連到欄位並設 `aria-invalid="true"`，送出失敗時焦點移到第一個錯誤的欄位；必填用文字「（必填）」標示，不只靠紅色星號。只有圖示的清除按鈕加 `aria-label="清除日期"`，圖示本身 `aria-hidden="true"`。送出成功時，在頁面一直存在的 `role="status"` 容器裡寫入「已完成掛號，號碼 A012」。文字對比至少 4.5:1，焦點框用 `:focus-visible` 畫 2px 外框，不用 `outline: none` 拿掉。',
      verify: [
        { c: '只用鍵盤', t: '不碰滑鼠，從網址列按 Tab 走完整個流程：每個控制項都停得到、焦點框看得見、順序和畫面一致。跳不到的按鈕多半是 `div` 加 `@click`；焦點跑到看不見的地方，代表隱藏的元素還能聚焦。' },
        { c: '名稱與角色', t: 'Elements 選取元素，右側 Accessibility 分頁的 Computed properties 看 `Name` 與 `Role`：只有圖示的按鈕 `Name` 是空的，螢幕閱讀器只會念「按鈕」。' },
        { c: '對比', t: 'Elements 的 Styles 點文字顏色前的色塊，顏色選擇器會顯示 `Contrast ratio` 與 AA、AAA 是否通過；Lighthouse 出現 `Background and foreground colors do not have a sufficient contrast ratio.` 時，列出的元素都要改。' },
        { c: 'Lighthouse 無障礙', t: '只勾 Accessibility 跑一次：`Image elements do not have [alt] attributes`、`Form elements do not have associated labels`、`Buttons do not have an accessible name` 都要清空。分數 100 只代表自動檢查得到的項目過了。' },
        { c: '狀態有被念出來', t: '開 VoiceOver（macOS 按 Cmd+F5）或 NVDA 送出一次表單：沒有聽到「已完成掛號」，常見原因是 `role="status"` 的容器和訊息同時才插進 DOM，例如整個容器包在 `v-if` 裡。' },
        { c: '不只靠顏色', t: 'Rendering 面板的 `Emulate vision deficiencies` 選一種色覺模擬：只用紅綠表示「可預約、額滿」的地方分不出來，就要加文字或圖示。' },
      ],
    },
    points: [
      { b: '先用原生元素', t: '`button`、`a href`、`label`、`input` 自帶名稱、角色、鍵盤操作與焦點；`div` 加 `role="button"` 還得自己補 `tabindex="0"` 與 Enter、Space 的處理。ARIA 只補 HTML 沒有的東西，例如 `aria-expanded`、`aria-live`。' },
      { b: '每個控制項都要有名稱', t: '按鈕的文字、欄位的 `label`、圖片的 `alt` 就是螢幕閱讀器念的名稱。只有圖示的按鈕補 `aria-label`，裝飾圖用 `alt=""`，`placeholder` 不能當名稱。' },
      { b: '對比與不只靠顏色', t: 'WCAG 2.2 AA：一般文字 4.5:1、大字 3:1，輸入框邊框與焦點框這類元件 3:1。錯誤、必填、可預約與額滿不能只用顏色區分，要有文字或圖示。' },
      { b: '焦點看得見、去對地方', t: '`outline: none` 拿掉焦點框就要補一個看得見的樣式。開 Dialog 時焦點進 Dialog，關掉回到開啟它的按鈕；SPA 換頁後焦點不會自己移動，要移到新頁面的開頭或標題。' },
      { b: '自動檢查只是起點', t: 'Lighthouse 與 axe 抓得到缺 `alt`、缺 `label`、對比不足、ARIA 屬性用錯；焦點順序合不合理、替代文字寫得對不對、念出來聽不聽得懂，要用鍵盤與螢幕閱讀器自己走一遍。' },
    ],
    checklist: [
      '能說出一個控制項的名稱從哪裡來，並用 Accessibility 分頁檢查',
      '能只用鍵盤走完一個表單流程，指出焦點順序、焦點框與焦點移動的問題',
      '能判斷一個需求該用原生元素、`aria-*` 屬性還是 live region，並用 Lighthouse 與顏色選擇器的對比值驗收',
    ],
    refs: [
      { label: 'W3C：WCAG 2.2', url: 'https://www.w3.org/TR/WCAG22/' },
      { label: 'WCAG 2.2 Understanding：Contrast (Minimum)', url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html' },
      { label: 'W3C：Using ARIA', url: 'https://www.w3.org/TR/using-aria/' },
      { label: 'Chrome DevTools：Accessibility features reference', url: 'https://developer.chrome.com/docs/devtools/accessibility/reference' },
      { label: 'Vue：Accessibility', url: 'https://vuejs.org/guide/best-practices/accessibility.html' },
    ],
  },
}
