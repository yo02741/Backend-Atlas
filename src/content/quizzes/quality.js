// 題庫：品質：測試、效能、無障礙
export default [
  {
    skill: 'a11y-basics',
    questions: [
      {
        q: '把「儲存」做成 `<div role="button" @click="save">儲存</div>`，和原生的 `<button type="button">` 相比，差在哪裡？',
        options: [
          '沒有差別，`role="button"` 會讓瀏覽器自動補上按鈕的所有行為',
          '螢幕閱讀器念不出「按鈕」，但 Tab 停得到，Enter 也能觸發',
          '螢幕閱讀器會念成按鈕，但 Tab 停不到、Enter 與 Space 沒反應，要自己補 `tabindex="0"` 與按鍵處理',
          '只有樣式不同，換成 `button` 後要重寫所有 CSS',
        ],
        answer: 2,
        explain: 'ARIA 只改變 accessibility tree 裡的資訊：`role="button"` 讓它被念成按鈕，但不會加上任何行為，`div` 不在 Tab 順序裡，也不會因為 Enter、Space 觸發 click。原生的 `button` 這些都有，所以能用原生元素就不用 ARIA。第二個選項把兩件事說反了。',
      },
      {
        q: 'Lighthouse 對這個按鈕報出 `Buttons do not have an accessible name`。最合適的修法是？',
        code: `<button class="icon-btn" type="button" @click="clearDate">
  <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
</button>`,
        lang: 'html',
        options: [
          '按鈕加 `aria-label="清除日期"`，`svg` 加 `aria-hidden="true"`',
          '按鈕加 `role="button"`，讓螢幕閱讀器知道它是按鈕',
          '按鈕加 `tabindex="0"`，讓它可以被聚焦',
          '按鈕加 `alt="清除日期"`，和圖片一樣提供替代文字',
        ],
        answer: 0,
        explain: '按鈕的名稱預設取自它的文字內容，這顆按鈕只有圖示，所以名稱是空的，螢幕閱讀器只念「按鈕」。`aria-label` 提供名稱，圖示加 `aria-hidden` 避免被當成內容。`button` 本來就是按鈕、本來就能聚焦，`role` 與 `tabindex` 都是多餘的；`alt` 是 `img` 的屬性，放在 `button` 上沒有作用。',
      },
      {
        q: '掛號送出成功後，畫面右上角用 `v-if` 插入一個 `<div role="status">已完成掛號</div>` 的 Toast，3 秒後移除。測試時 NVDA 常常沒有念出這句話。比較可靠的改法是？',
        options: [
          '把 Toast 停留的時間從 3 秒延長到 10 秒',
          '把整個表單加上 `role="alert"`，送出後整個表單都會被念一次',
          '頁面一開始就放一個一直存在的 `role="status"` 容器，送出成功時才改它的文字',
          'Toast 加上 `aria-hidden="true"`，避免和表單的內容一起被念',
        ],
        answer: 2,
        explain: '螢幕閱讀器監聽的是已經存在的 live region 裡的內容變化；容器和訊息同時插進 DOM 時，很多螢幕閱讀器不會念。讓容器一直在、只改文字最可靠。停留更久不會讓它被念出來；`role="alert"` 加在整個表單上會打斷使用者並念出不相干的內容；`aria-hidden` 會讓它完全不被念。',
      },
    ],
  },
]
