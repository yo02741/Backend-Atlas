## 從一個具體問題開始：「按了取消掛號，沒有反應」

病患回報：在「我的掛號」頁按「取消」，按鈕轉了一下又恢復，掛號還在。同一個回報可能有好幾種原因，各自出現在開發者工具的不同地方：

| 原因 | 在哪裡看得到 |
|---|---|
| 按鈕的點擊事件沒綁上，或被別的元素蓋住 | Elements 的 Event Listeners；Console 沒有任何輸出 |
| 程式在送請求前就出錯 | Console 的紅色錯誤，例如 `Uncaught TypeError: Cannot read properties of undefined (reading 'id')` |
| 請求送了，但網址或 body 錯 | Network 的 Headers 與 Payload |
| 請求送對了，後端回 `409` 或 `500` | Network 的狀態碼與 Response |
| 請求被瀏覽器擋下 | Network 的狀態顯示 `CORS error`，Console 有 `blocked by CORS policy` |
| 後端成功了，畫面沒更新 | Network 是 `200`，但 Vue DevTools 裡的資料沒變 |

照「Console → Network → Elements」的順序看，多半幾分鐘內就能說出問題在前端還是後端，以及卡在哪一步。驗收 AI 產出的畫面也是同一套動作：先確認沒有錯誤，再確認送出的請求和規格一致，最後才看版面細節。

## 驗收的固定路線

| 順序 | 分頁 | 看什麼 | 錯的時候長什麼樣 |
|---|---|---|---|
| 1 | Console | 重新整理並把每個狀態切一遍，錯誤計數 | 紅色錯誤、`Uncaught (in promise)`、`[Vue warn]` |
| 2 | Network（篩 `Fetch/XHR`） | 每個操作送出的方法、路徑、次數、body、狀態碼 | 同一支 API 送兩次、該送的沒送、`(canceled)`、`CORS error` |
| 3 | Elements | DOM 結構、套到的規則、盒模型、`:hover` 與 `:focus-visible` 狀態 | 規則被劃掉、用 `div` 做按鈕、沒有焦點框 |
| 4 | 裝置模式 | 390、768、1280 三個寬度 | 橫向捲軸、文字被切掉、按鈕太小 |
| 5 | Application | cookie 屬性、localStorage、sessionStorage | 登入 cookie 沒有 `HttpOnly`、儲存了不該存的資料 |
| 6 | Lighthouse | Accessibility 與 Performance | `Buttons do not have an accessible name` 等待修項目 |

Performance 分頁用在「覺得卡」的時候，細節在 [瀏覽器怎麼把網頁畫出來](#/skill/how-browsers-render)。Vue DevTools 是另外安裝的擴充功能，用來看元件樹、props、Pinia store 與目前的路由，第 6 步之後需要時再開。

以下的分頁與選項名稱以 Chrome 為準（2026 年 11 月核對）。Firefox 與 Safari 有對應的面板，名稱略有不同。

:::stop 讀到這裡可以先停：會照 Console、Network、Elements 的順序驗收一個畫面，說出問題在前端還是後端。後面各分頁的細節，在固定路線找不到原因時再回來查。

## Network 分頁怎麼讀

### 讓問題重現的設定

- **`Disable cache`**：只在開發者工具開著時有效。排除「看到的是舊的 JS 或舊的回應」。
- **節流選單**：`No throttling`、`Fast 4G`、`Slow 4G`、`3G`、`Offline`。載入太快時 loading 狀態一閃而過，切到 `3G` 才看得清楚；`Offline` 用來看網路錯誤的畫面。
- **`Preserve log`**（新版 Chrome 顯示為 `Keep log`）：勾了之後換頁或重新整理不清空清單。送出表單後被導到另一頁、想看送出的那一筆時一定要勾。
- **篩選**：`Fetch/XHR` 只留 API 請求；搜尋框可以輸入路徑的一部分，例如 `appointments`。
- **對單一請求按右鍵**：`Block request URL` 讓那支 API 失敗，用來看部分失敗的畫面；Copy 選單裡的 `Copy as cURL` 把整個請求複製成 `curl` 指令，交給後端在終端機重現。

### 狀態欄的值

| 狀態欄 | 意思 | 常見原因 |
|---|---|---|
| `200`、`201`、`204` | 成功 | |
| `304` | 用快取的版本，伺服器說沒變 | 正常的條件請求（見 [HTTP 快取](#/skill/http-caching)） |
| `401`、`403`、`404`、`409`、`422` | 伺服器拒絕或找不到 | 沒登入、沒權限、路徑錯、狀態衝突、欄位驗證失敗 |
| `500`、`502`、`503` | 伺服器或中間的 proxy 出錯 | 交給後端，附上 `Copy as cURL` 的內容 |
| `(pending)` | 還沒回來 | 慢，或一直沒有回應 |
| `(canceled)` | 瀏覽器取消了 | 程式呼叫了 `AbortController.abort()`、頁面已經離開，或同一個請求被新的取代 |
| `(failed)` | 網路層失敗，沒有拿到 HTTP 回應 | 斷線、DNS 失敗、連線被拒 |
| `(blocked:devtools)` | 被開發者工具擋下 | 自己設了 `Block request URL` |
| `CORS error` | 瀏覽器收到回應但不讓 JavaScript 讀 | 伺服器沒回正確的 CORS 標頭（見 [CORS、Cookie 與同源](#/skill/cors-cookies)） |

Size 欄顯示 `(disk cache)` 或 `(memory cache)` 代表這次沒有發出請求，直接用了快取。

### 一個請求的分頁

點開一筆請求：

- **Headers**：完整網址、方法、狀態碼、請求與回應的標頭。檢查 `Content-Type`、`Authorization` 有沒有帶、`Set-Cookie` 的屬性。
- **Payload**：送出的 query string 與 body。表單送出前端驗證過的值，和這裡看到的是否一樣。
- **Preview** 與 **Response**：前者是排版過的 JSON，後者是原始回應。後端說「有回 `errors` 欄位」時，在 Response 確認拼字與層級。
- **Initiator**：誰發出這個請求，附呼叫堆疊。同一支 API 送了兩次時，從這裡找出是哪兩段程式。
- **Timing**：時間花在排隊、連線、等伺服器（`Waiting for server response`）還是下載。等伺服器很久是後端的問題，排隊很久代表同時發了太多請求。

## Console 的訊息怎麼讀

Console 依層級分成 Errors、Warnings、Info、Verbose。驗收時至少看 Errors 與 Warnings。常見的訊息：

| 訊息 | 意思 | 怎麼找原因 |
|---|---|---|
| `Uncaught TypeError: Cannot read properties of undefined (reading 'id')` | 對 `undefined` 讀屬性 | 點右邊的檔名與行號跳到 Sources；多半是資料還沒回來就用了 |
| `Uncaught (in promise) …` | 有 Promise 失敗沒人處理 | 找出沒有 `catch` 的 `await` 或 `.then()`（見 [非同步：Promise 與 async/await](#/skill/async-js)） |
| `Access to fetch at '…' from origin '…' has been blocked by CORS policy: …` | 跨來源請求被擋 | 冒號後面的句子說明少了哪個標頭；修的位置在後端 |
| `Failed to load resource: the server responded with a status of 404 (Not Found)` | 某個資源或 API 回 404 | 回 Network 看是哪個網址 |
| `[Vue warn]: …` | Vue 偵測到用法錯誤 | 訊息下面附了元件的路徑，例如 props 型別不符、`v-for` 沒有 `key` |

錯誤訊息裡的行號對的是建置後的檔案時，代表沒有 source map；開發模式（`npm run dev`）通常會對回原始碼。

Console 也是可以下指令的地方。Chrome 提供幾個只在 Console 能用的函式：

```js
$0                                  // Elements 目前選取的元素
$$('button')                        // 等於 document.querySelectorAll，回傳陣列
copy($0.outerHTML)                  // 把值複製到剪貼簿
getEventListeners(window).resize    // 列出 window 上的 resize 監聽（Chrome 專屬）
```

## Elements、Application 與 Lighthouse

**Elements**：

- **Styles** 依權重列出套到這個元素的規則，被蓋掉的屬性會被劃掉；屬性值可以直接改、勾選框可以暫時停用。這裡的修改重新整理就消失。
- **`:hov`** 強制元素進入 `:hover`、`:focus`、`:focus-visible`、`:active` 等狀態，滑鼠移開後還能繼續檢查樣式。
- **Computed** 列出每個屬性最後的值與盒模型（content、padding、border、margin 的尺寸）。
- **Event Listeners** 列出元素與祖先上的事件監聽。按鈕沒反應時，先確認 `click` 有沒有在清單裡。
- **Accessibility** 顯示元素的角色（role）與名稱（Name），按鈕與欄位的名稱是空的，螢幕閱讀器就念不出來。

**Application** 的 Cookies 表格有 `HttpOnly`、`Secure`、`SameSite` 欄。登入 cookie 沒有勾 `HttpOnly`，前端的 JavaScript 就讀得到它，遇到 XSS 時也會被讀走。`Clear site data` 一次清掉 cookie、儲存與 Service Worker，重現「第一次來的使用者」。

**Lighthouse** 可以只勾單一類別。無障礙的項目（`Form elements do not have associated labels`、`Image elements do not have [alt] attributes`）是確定性的檢查，每次跑結果相同；效能分數會受電腦負載影響，同一頁連跑幾次分數不同是正常的，比較時固定裝置與節流設定。

## 常見錯誤

- **沒開 `Disable cache` 就判斷「改了沒效果」**：看到的是快取裡的舊檔。Size 欄出現 `(memory cache)` 時，先排除快取。
- **換頁後找不到剛剛的請求**：沒勾 `Preserve log`（`Keep log`）。
- **只看 Preview**：Preview 會把 JSON 排版好，回應的實際格式（例如多了一層 `data`）要在 Response 看。
- **擴充功能干擾**：廣告阻擋器會擋掉某些請求，Network 顯示 `(blocked:other)` 之類的狀態。用無痕視窗或沒有擴充功能的設定檔重測。
- **裝置模式當成實機**：裝置模式改的是寬度、觸控與 User-Agent，模擬不了手機的螢幕鍵盤、網址列收合與真實的 CPU 速度。驗收手機版時，最後仍要用實機看一次。
- **在 Elements 改好就以為修好了**：Elements 的修改不會寫回原始碼。確定要改哪一行之後，回到編輯器改，再重新整理確認。

## 動手

- 打開本站任何一個技能頁，Network 篩 `JS`，重新整理後找出深入內容是哪一個檔案載入的、Initiator 是誰。
- 把節流切到 `3G` 重新整理，觀察哪些區塊先出現；再切到 `Offline`，看看頁面怎麼回應。
- 在 Console 執行 `getEventListeners(window)`，看本站在 `window` 上掛了哪些監聽。
- 用 Lighthouse 只勾 Accessibility 跑本站首頁，逐條讀待修項目的說明，對照 [語意化 HTML 與表單元素](#/skill/semantic-html)。
