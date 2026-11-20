// 領域 2：網路、HTTP 與 API 設計 — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d2-web.js
export default {
  'http-basics': {
    challenge: {
      task: '用 `curl -o /dev/null -s -w` 印出 `time_namelookup`、`time_connect`、`time_appconnect`、`time_starttransfer`，量三組：`https://example.com/` 分兩次執行、同一個 curl 指令裡連續請求兩次 `https://example.com/`（會重用連線）、本機[參考專案 clinic-api](https://github.com/yo02741/u-kinda-should-know/tree/main/companion/clinic-api)的 `GET /healthz`。再畫一張門診掛號請求的圖，標出客戶端、反向代理、API、資料庫，每一段寫上你量到或量不到的時間。',
      deliver: '三組 `-w` 輸出、相減後的各段時間，以及標了時間的請求圖。',
      check: [
        '各段時間是相減後的值，不是 curl 印出的累計值',
        '指出重用連線的那次哪幾段變成 0 或接近 0',
        '圖上標出 clinic-api 這種本機、沒有 TLS 的請求少了哪幾段，前面加一層 nginx 後會多出哪一段',
        '註明這些毫秒數是你這台機器、這個網路的量測',
      ],
      twist: '假設反向代理等上游 10 秒沒回應就放棄。先預測使用者拿到的狀態碼、`time_starttransfer` 大約多少，以及要看哪一層的日誌才找得到原因。',
    },
    map: {
      names: [
        { n: 'DNS、TCP、TLS', t: '請求送出前的三步：把主機名換成 IP、三次握手建立連線、驗證憑證並協商金鑰（TCP 加 TLS 1.3 共 2 RTT）。第一個請求慢、連不上，多半卡在這三段。' },
        { n: 'TTFB', t: '送出請求到收到回應第一個位元組的時間，約等於一趟來回加上伺服器處理；Chrome 開發者工具的 Timing 裡叫 `Waiting for server response`。' },
        { n: 'keep-alive 與連線池', t: '同一條連線接著送下一個請求，省掉握手：新的 HTTPS 連線至少 3 RTT 才拿到第一個位元組，重用的只要 1 RTT。後端呼叫外部服務要共用 client 的連線池。' },
        { n: '標頭', t: '`Host` 指定網站、`Content-Type` 說 body 的格式、`Accept` 說想要的格式、`Authorization` 帶憑證、`Retry-After` 說多久後再試；標頭名稱不分大小寫。' },
        { n: '狀態碼類別', t: '2xx 成功、3xx 去別處、4xx 請求有問題（不改請求就不要重送）、5xx 伺服器有問題（視情況重試）；監控、重試、CDN 都依類別判斷。' },
        { n: '`502`、`503`、`504`', t: '經過 proxy 時常見的三種 5xx：後端回應無效（例如連線被重設）、暫時無法服務（可帶 `Retry-After`）、等後端逾時。' },
        { n: '安全與冪等', t: '`GET`、`HEAD` 不改伺服器狀態（安全）；`GET`、`PUT`、`DELETE` 送 N 次和送一次的最終狀態相同（冪等）。`POST` 兩者都不是，斷線後直接重送可能建出兩筆。' },
      ],
      ask: [
        '呼叫外部服務時共用哪個 client 與連線池，連線逾時與讀取逾時各幾秒。',
        '每種失敗回哪個狀態碼，屬於 4xx（客戶端要改請求）還是 5xx（可以重試）。',
        '哪些請求失敗後自動重試：只重試冪等的方法，重試幾次、間隔多久，`POST` 重送會不會建出兩筆。',
        '請求與回應的 `Content-Type`，以及 body 大小上限（超過回 `413`）。',
        '前面經過哪些 proxy，只信任哪一層設的 `X-Forwarded-For` 與 `X-Forwarded-Proto`。',
      ],
      prompt: '掛號服務建立掛號時要呼叫院內病歷服務的 `GET /patients/{id}`。整個行程共用一個 HTTP client，用連線池重用 keep-alive 連線，連線逾時 2 秒、讀取逾時 5 秒。`GET` 是冪等的，遇到連線錯誤或 `502`、`503`、`504` 時重試，最多 2 次，`503` 帶 `Retry-After` 就照它等；4xx 不重試。病歷服務逾時時，掛號 API 回 `504`，不包成 `200` 加 `{"error": ...}`。',
      verify: [
        { c: '卡在哪個階段', t: '`curl -o /dev/null -s -w` 印出 `time_namelookup`、`time_connect`、`time_appconnect`、`time_starttransfer`；這些是累計秒數，相減才是各段花的時間。' },
        { c: '連線有沒有重用', t: 'Network 分頁點同一網域第二個請求的 Timing，還有 `Initial connection` 與 `SSL` 代表每次都開新連線；後端程式每次呼叫都 `requests.get(...)`、沒有共用 Session 或 client，也是每次新連線。' },
        { c: '狀態碼', t: '`curl -i` 打一次不存在的資源、一次不帶 token、一次讓下游逾時，應該分別是 `404`、`401`、`504`；全部 `200` 加錯誤 body，或全部 `500`，監控與重試都會判斷錯。' },
        { c: '`401` 與 `403`', t: '沒帶或帶了無效的憑證回 `401` 並附 `WWW-Authenticate`，身分有效但沒權限回 `403`；兩者寫反是常見的錯。' },
        { c: '重試條件', t: '讀重試的程式：條件只該包含連線錯誤與 `502`、`503`、`504`，方法限冪等的；`POST` 或 4xx 出現在重試清單裡就要改。' },
        { c: '改狀態的 `GET`', t: '對照路由表，找用 `GET` 卻會改資料的路徑（例如 `GET /orders/42/cancel`）；瀏覽器預先載入或爬蟲一抓，訂單就被取消。' },
      ],
    },
    points: [
      { b: 'HTTP 是無狀態的', t: '每個請求自帶全部資訊（標頭、cookie、token）。「登入狀態」是靠 session 或 token 在每次請求重建出來的。' },
      { b: '連線很貴，重用它', t: 'TCP 三向交握 + TLS 握手要來回好幾趟。keep-alive / HTTP/2 多工讓同一條連線跑很多請求；後端呼叫外部服務也要用連線池。' },
      { b: '標頭各司其職', t: '`Content-Type` 說 body 格式、`Authorization` 帶憑證、`Cache-Control` / `ETag` 管快取、`Set-Cookie` 種 cookie、`Location` 指新位置。' },
      { b: '狀態碼是 API 的第一層語意', t: '2xx 成功、3xx 去別處、4xx 客戶端的錯、5xx 伺服器的錯。回錯狀態碼會讓監控、重試、快取全部判斷錯。' },
      { b: '冪等與安全方法', t: 'GET / HEAD 安全（不改狀態）；GET / PUT / DELETE 冪等（重複執行結果相同）；POST 兩者都不是。重試邏輯與快取都依這兩個性質決定能不能做。' },
    ],
    checklist: [
      '能說出一個 HTTPS 請求從輸入網址到拿到回應經過的 7 個階段',
      '能為常見情境挑對狀態碼：找不到、沒登入、沒權限、驗證失敗、伺服器炸了',
      '能解釋為什麼 PUT 冪等而 POST 不是',
    ],
    refs: [
      { label: 'MDN：HTTP', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP' },
      { label: 'MDN：HTTP 狀態碼', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status' },
      { label: 'RFC 9110：HTTP Semantics', url: 'https://datatracker.ietf.org/doc/html/rfc9110' },
    ],
  },
  'tcp-connections': {
    challenge: {
      task: '在本機（不是瀏覽器裡的 Pyodide）用 httpx 對 `https://example.com/` 各送 5 次請求：版本 A 每次 `with httpx.Client() as c:` 新建 client，版本 B 共用同一個 client。記錄每次的耗時，並在每個版本跑完後用 `ss -tan state time-wait | grep -c :443` 數 TIME-WAIT。跑之前先預測兩個版本第 2–5 次的耗時差多少。',
      deliver: '兩個版本 5 次耗時的表、TIME-WAIT 計數，以及一行 `curl -w` 的 `time_connect`、`time_appconnect` 當對照。',
      check: [
        '版本 B 的第 2–5 次比第 1 次快，快的量和握手的時間（`time_appconnect`）同一個量級',
        '版本 A 之後 TIME-WAIT 增加、版本 B 沒有增加，並說明 TIME-WAIT 出現在主動關閉的那一方',
        '註明是本機量測，寫出網路環境（家用網路、公司 VPN 等）',
      ],
      twist: '對方的 keep-alive 逾時是 5 秒，你的連線池閒置逾時是 30 秒，每 10 秒送一次請求。先預測哪一次請求會出錯、錯誤長什麼樣，再說明池子的設定要怎麼改。',
    },
    points: [
      { b: '一條連線由四元組決定', t: '來源 IP、來源 port、目的 IP、目的 port。客戶端的來源 port 從臨時 port 範圍挑（Linux 預設 32768–60999），所以一台機器連同一個目的地的連線數有上限；每條連線也佔一個檔案描述子。' },
      { b: '握手要花來回', t: 'TCP 三次握手 1 RTT，TLS 1.2 再 2 RTT、TLS 1.3 再 1 RTT。新的 HTTPS 連線拿到第一個回應要 3–4 RTT，重用的連線只要 1 RTT。' },
      { b: 'TIME-WAIT 與 CLOSE-WAIT', t: '主動關閉的一方進 TIME-WAIT（Linux 60 秒），大量出現代表沒重用連線；CLOSE-WAIT 是對方關了、自己的程式還沒 close，持續增加通常是連線洩漏。' },
      { b: 'keep-alive 與連線池', t: 'HTTP/1.1 預設持久連線；HTTP client 與資料庫驅動用連線池重用連線。池子的閒置逾時要比對方的 keep-alive 逾時短，否則會撞到剛被關掉的連線。' },
      { b: '先算總連線數', t: '機器數 × 每台行程數 × 每池上限，要小於資料庫的 `max_connections`（PostgreSQL 預設 100）。不夠時加 PgBouncer，而不是把池子和 `max_connections` 一起調大。' },
    ],
    checklist: [
      '能畫出 TCP 三次握手與四次揮手，並標出 TIME-WAIT、CLOSE-WAIT 出現在哪一方',
      '能用 `ss -tan` 統計各狀態的連線數，並判斷問題在「沒重用連線」還是「連線沒關」',
      '能算出自己服務在最大擴展時對資料庫的總連線數',
    ],
    refs: [
      { label: 'RFC 9293：Transmission Control Protocol', url: 'https://www.rfc-editor.org/rfc/rfc9293' },
      { label: 'PostgreSQL：Connections and Authentication', url: 'https://www.postgresql.org/docs/current/runtime-config-connection.html' },
    ],
  },
  'rest-design': {
    challenge: {
      task: '以[參考專案 clinic-api](https://github.com/yo02741/u-kinda-should-know/tree/main/companion/clinic-api) README 的介面表為起點，替 `POST /api/sessions/{id}/appointments`、`POST /api/appointments/{id}/cancel`、`GET /api/appointments/{id}` 寫行為表，每個端點四種情況：正常、重複送出、資源不存在、別人的資源。先填預測，再用 `curl -i` 實測、填實際。',
      deliver: '行為表：每格有預測與實際的狀態碼，錯誤時加上 Problem Details 的 `type`。',
      check: [
        '每格都有實際 `curl -i` 的狀態碼',
        '寫出重複取消同一筆時 clinic-api 回什麼，以及這個選擇的理由',
        '「別人的掛號」寫出實際是 403 還是 404，以及這樣選對「洩漏資源存在與否」的取捨',
      ],
      twist: '同一張表改用在餐廳訂位：訂位時間前 2 小時內不能取消、同一桌可以多人共訂。先預測哪幾格的狀態碼或 `type` 要改，再分成兩欄列出：可以從掛號沿用的設計（重複送出回 409、錯誤格式），以及要跟訂位業務重新確認的條件（逾時取消算失敗還是收費、怎樣算重複訂位）。',
    },
    map: {
      names: [
        { n: '資源與路徑', t: '名詞代表資料，例如 `/appointments`、`/appointments/{id}`；動作交給 HTTP 方法，不寫成 `/getAppointments`。' },
        { n: 'HTTP 方法', t: '`GET` 讀、`POST` 建立、`PUT` 整筆取代、`PATCH` 部分更新、`DELETE` 刪除；`GET`、`PUT`、`DELETE` 重送不會多出副作用（冪等）。' },
        { n: '狀態碼', t: '`201` 建立成功、`204` 成功但沒有 body、`422` 欄位驗證失敗、`401` 沒登入、`403` 沒權限、`404` 找不到、`409` 和目前狀態衝突。' },
        { n: '`Location` 標頭', t: '建立成功時指向新資源的網址，客戶端不用自己拼。' },
        { n: 'Problem Details（RFC 9457）', t: '錯誤回應的標準格式 `application/problem+json`，有 `type`、`title`、`status`、`detail`，前端可以統一處理。' },
        { n: '查詢參數', t: '列表的過濾、排序、分頁放在 `?status=booked&sort=-created_at&limit=20`，可用的欄位列成白名單。' },
      ],
      ask: [
        '有哪些資源、彼此的從屬關係（例如掛號屬於某個診次）。',
        '每個 endpoint 的方法、路徑、成功狀態碼與回應 body。',
        '每種失敗回哪個狀態碼，錯誤 body 用哪個格式。',
        '非 CRUD 的動作（取消、報到）建模成子資源的 `POST`，還是狀態欄位的 `PATCH`。',
        '列表能用哪些欄位過濾與排序、分頁方式與筆數上限。',
      ],
      prompt: '設計門診掛號的 REST API：資源是 `/sessions/{id}/appointments`（某個診次的掛號）與 `/appointments/{id}`。建立掛號用 `POST`，成功回 `201` 並帶 `Location`；名額已滿或重複掛號回 `409`，欄位驗證失敗回 `422`，錯誤一律用 RFC 9457 的 `application/problem+json`。取消建模成 `POST /appointments/{id}/cancel`，已取消再取消回 `409`。列表只能依 `status` 過濾、依 `created_at` 排序，`limit` 上限 100。',
      verify: [
        { c: '狀態碼', t: '用 `curl -i` 打一次成功、一次重複、一次缺欄位，看是不是 `201`、`409`、`422`，而不是全部 `200` 或 `500`。' },
        { c: '錯誤格式', t: '每種錯誤的 `Content-Type` 都是 `application/problem+json`、欄位一致；AI 產生的程式常常每支 API 各寫一種。' },
        { c: '路徑與方法', t: '對照 OpenAPI 規格或路由表：路徑裡沒有動詞（`/createAppointment`），取消與刪除沒有用 `GET`。' },
        { c: '冪等', t: '同一個 `PUT` 或 `DELETE` 送兩次，資料和送一次相同；`DELETE` 第二次回 `404` 還是 `204` 要先定好並寫進測試。' },
        { c: '列表參數', t: '傳一個不在白名單裡的 `sort` 欄位，應該回 `400`，而不是被默默忽略或變成慢查詢。' },
      ],
    },
    points: [
      { b: '先畫資源樹', t: '`/orders`、`/orders/{id}`、`/orders/{id}/items`。動作用 HTTP 方法表達，不要 `/getOrders`、`/orders/delete/42`。' },
      { b: 'PUT 取代整筆、PATCH 部分更新', t: '兩者都對 `/orders/{id}`；PUT 少給欄位等於清空，PATCH 只改給的欄位。團隊要選定一種語意並寫進規範。' },
      { b: '建立回 201 + Location，刪除回 204', t: '成功的細節也要精準：建立成功回 201 並帶新資源位置；刪除成功沒有 body 就回 204。' },
      { b: '非 CRUD 的動作', t: '「取消訂單」可以是 `POST /orders/{id}/cancel`，或把它建模成狀態轉移 `PATCH /orders/{id}` `{"status": "cancelled"}`。兩者都可，一致最重要。' },
      { b: '錯誤回應統一格式', t: '固定 `{"error": {"code": "ORDER_NOT_FOUND", "message": "...", "details": [...]}}`，前端才能統一處理；RFC 9457 的 problem+json 是現成標準。' },
    ],
    checklist: [
      '能為「訂單」資源設計 6 個 endpoint 並標出方法、路徑、成功狀態碼',
      '能說明 PUT 與 PATCH 的差異並選一種寫進團隊規範',
      '能設計一個所有 endpoint 共用的錯誤回應格式',
    ],
    refs: [
      { label: 'RFC 9457：Problem Details for HTTP APIs', url: 'https://datatracker.ietf.org/doc/html/rfc9457' },
    ],
  },
  'api-patterns': {
    challenge: {
      task: '拆成兩次驗收。第一次（分頁）：在[參考專案 clinic-api](https://github.com/yo02741/u-kinda-should-know/tree/main/companion/clinic-api)用 `desk1` 呼叫 `GET /api/appointments?limit=2`，照 `next_cursor` 一頁一頁翻；翻到第二頁後替另一位病患新增一筆掛號，再翻完剩下的頁。第二次（冪等）：做完練習題 [Idempotency-Key](#/exercise/api-patterns-2) 後，替倉儲的「庫存調撥」API `POST /transfers` 寫一段冪等鍵規格。',
      deliver: '第一次：每頁的 id 與 `next_cursor` 紀錄。第二次：規格一段，加三個重送情境（同 key 同 body、同 key 不同 body、第一次還在處理中）各自的預期回應。',
      check: [
        '翻頁途中新增資料後，列出的 id 沒有重複；寫出新資料出現在哪一頁，或為什麼不會出現',
        '規格寫出 key 存多久、存什麼（請求指紋與回應），同 key 不同 body 回什麼狀態碼',
        '分成兩欄：可以從付款的冪等鍵沿用的條件，以及要跟倉儲業務確認的條件（調撥被人工取消後，同一把 key 重送要怎麼回）',
      ],
      twist: '倉儲要求列表改成依「到貨日」排序，而且到貨日可以被修改。先預測 cursor 只放 id 會出什麼問題，再寫出新的 cursor 要包含哪些欄位。',
    },
    points: [
      { b: 'offset 分頁在深頁會慢', t: '`OFFSET 100000` 資料庫還是得掃過前十萬列。cursor 分頁用「上一頁最後一筆的排序鍵」當起點（`WHERE id > ?`），永遠走索引。' },
      { b: '篩選與排序要白名單', t: '允許哪些欄位可以 filter / sort 要明列，否則 `?sort=password` 之類的怪事會發生，也可能變成慢查詢。' },
      { b: '版本：能不改就不改', t: '加欄位不算破壞；改欄位語意、刪欄位才要新版本。路徑版本 `/v1` 最直白；避免同時維護超過兩個版本。' },
      { b: 'Idempotency-Key 防重複', t: '客戶端對「建立」請求帶唯一 key，伺服器記住 key → 結果，重送同 key 回同結果而不是再建一筆。付款、下單必備。' },
    ],
    checklist: [
      '能實作 cursor 分頁並解釋為何比 offset 好',
      '能列出哪些 API 變更是破壞性的、哪些不是',
      '知道 Idempotency-Key 的實作要存什麼、存多久',
    ],
    refs: [],
  },
  'resilience': {
    challenge: {
      task: '電商結帳要呼叫物流商的運費 API，整個結帳 API 的回應預算是 3 秒，其他步驟已經用掉 1 秒。替這個呼叫分配連線逾時、讀取逾時、重試次數與退避（含抖動）。接著做完練習題 [重試](#/exercise/resilience-1)，在 [Playground](#/playground?lang=python) 用固定的 `random.seed` 模擬物流商：30% 機率 1.5 秒才回、10% 機率回 503、其他 0.2 秒成功，跑 1,000 次（用累加的模擬時間，不要真的 sleep），統計超出預算的比例與平均嘗試次數。',
      deliver: '參數表、模擬結果（超出預算的比例、平均嘗試次數），加一段取捨說明。',
      check: [
        '算得出最壞情況的總時間（每次嘗試的逾時加上退避上限），而且不超過 2 秒',
        '模擬用固定 seed，重跑結果相同；標明機率是教材設定，不是實測',
        '分成兩欄：可以從掛號呼叫病歷服務沿用的做法（只重試冪等的查詢、退避加抖動），以及要跟電商業務確認的條件（查不到運費時能不能先用預設運費結帳）',
      ],
      twist: '物流商在 503 時開始帶 `Retry-After: 5`。先預測你的參數還能不能在預算內遵守它，以及這時該重試還是直接降級。',
    },
    points: [
      { b: '每個外部呼叫都設 timeout', t: '`httpx.Client(timeout=5.0)`、DB `statement_timeout`、佇列任務 time limit。連線與讀取分開設；預設值通常是「永遠等」。' },
      { b: '重試要退避加抖動', t: '失敗後等 0.5s、1s、2s… 再加隨機抖動，避免所有客戶端同時重打（thundering herd）。次數有上限，總時間有上限。' },
      { b: '只重試冪等的、只重試值得的', t: 'GET / PUT / DELETE 可重試；POST 要有 Idempotency-Key 才能。5xx、逾時、連線錯誤值得重試；4xx 不值得（再打也一樣）。' },
      { b: '斷路器：連續失敗就先不打', t: '錯誤率超過門檻就「打開」一段時間直接快速失敗（回降級結果或錯誤），期間偶爾放一個請求試探，成功再「關上」。保護自己也保護對方。' },
      { b: '降級與隔離', t: '推薦系統掛了就顯示熱門商品；不同依賴用不同連線池（bulkhead），一個慢不會吃光全部。' },
    ],
    checklist: [
      '專案裡每個對外 HTTP 呼叫都有明確的 timeout',
      '能寫出「退避 + 抖動 + 上限」的重試，並說明哪些請求不能重試',
      '能解釋斷路器的三個狀態與切換條件',
    ],
    refs: [
      { label: 'httpx：Timeouts', url: 'https://www.python-httpx.org/advanced/timeouts/' },
    ],
  },
  'openapi': {
    challenge: {
      task: '從本機的[參考專案 clinic-api](https://github.com/yo02741/u-kinda-should-know/tree/main/companion/clinic-api)下載 `/openapi.json` 存成 `before.json`；接著在 `clinic/api/schemas.py` 的 `AppointmentOut` 把 `number` 改名成 `queue_no`、把 `status` 改成 `Literal["booked", "cancelled", "checked_in"]`，重啟後存成 `after.json`。用深入內容「一個簡化的相容性檢查」的程式比較兩份（裝得到 oasdiff 這類工具的話也跑一次）。比較之前先寫下你預測哪個變更會被判成破壞性。',
      deliver: '比較結果，標出哪個變更會讓既有前端壞掉、哪個不會，以及前端產生的型別會怎麼變。',
      check: [
        '兩份 JSON 都是實際下載的，`openapi` 欄位的值寫出來',
        '改名被判成破壞性；`status` 改成列舉時，寫出它對「讀回應的前端」是收窄還是放寬、會不會壞',
        '寫出 CI 要在哪一步跑這個比較、比對的基準是哪一份規格（例如 main 分支上的那份）',
      ],
      twist: '把 `number` 改成 `int | None`。先預測檢查器會不會報、前端哪一段程式會壞，再實際比較一次。',
    },
    points: [
      { b: 'FastAPI 從型別自動產出規格', t: 'pydantic model + 路由宣告 = `/openapi.json` + Swagger UI，零額外工作。這是選它當範例的原因之一。' },
      { b: 'code-first 與 schema-first', t: '從程式碼產規格（FastAPI）適合小團隊快速迭代；先寫規格再實作適合多團隊並行。兩者都要把規格當合約看待。' },
      { b: '用規格產 client', t: 'openapi-typescript、orval 等工具把規格變成型別安全的前端呼叫；後端改了回應型別，前端編譯就會失敗，不相容在上線前就被抓到。' },
      { b: '規格差異當 CI 檢查', t: '比對 PR 前後的 openapi.json，破壞性變更要顯式標記，避免默默改壞前端。' },
    ],
    checklist: [
      '能打開自己服務的 /docs，並解釋每個欄位的型別從哪裡來',
      '能用 OpenAPI 規格產出前端 client 並在前端專案使用',
    ],
    refs: [
      { label: 'OpenAPI Specification', url: 'https://spec.openapis.org/oas/latest.html' },
    ],
  },
  'cors-cookies': {
    challenge: {
      task: '在本機寫一個最小的 API（例如 FastAPI 加 `CORSMiddleware`）跑在 `http://localhost:8000`：`POST /login` 用 `Set-Cookie` 種一個 HttpOnly cookie、`GET /me` 回 JSON。另用 `python3 -m http.server 5173` 提供一個頁面，用 fetch 先登入再呼叫 `/me`。依序換四組設定：(1) fetch 不帶 credentials；(2) `credentials: "include"`，伺服器 `allow_origins=["*"]` 加 `allow_credentials=True`；(3) 明列 `http://localhost:5173` 加 `allow_credentials=True`；(4) 同第 3 組，但頁面改從 `http://127.0.0.1:5173` 開。',
      deliver: '4 組 × 3 欄的表：Cookie 有沒有送出、Console 有沒有 CORS 錯誤、JavaScript 讀不讀得到 body，每格附 Network 分頁的標頭摘錄。',
      check: [
        '每格都是實際觀察，附請求的 `Cookie` 與回應的 `Access-Control-Allow-Origin` 原文',
        '第 2 組寫出回應實際帶的 `Access-Control-Allow-Origin`（有的框架在這組設定下會改成回傳請求的 origin），並說明這對安全的影響',
        '第 4 組說明 `localhost` 與 `127.0.0.1` 是不同的 origin、cookie 屬於哪個 host，所以哪一欄跟著變',
      ],
      twist: '把 cookie 加上 `SameSite=Strict`。先預測第 3 組的 cookie 還會不會送出（`localhost:5173` 和 `localhost:8000` 是不是同一個 site），再實測。',
    },
    points: [
      { b: 'CORS 是瀏覽器的規則，不是伺服器的防線', t: 'curl 不理 CORS。它保護的是「使用者的瀏覽器不被其他網站拿去打你的 API」，授權還是要靠 token / session。' },
      { b: 'preflight 的來回', t: '非簡單請求（自訂標頭、JSON、PUT）先送 `OPTIONS`，伺服器回 `Access-Control-Allow-Origin / Methods / Headers`，通過才送真請求。`Access-Control-Max-Age` 可快取這個結果。' },
      { b: '帶 cookie 的請求規則更嚴', t: '`Access-Control-Allow-Credentials: true` 時 origin 不能是 `*`，必須明列。' },
      { b: 'Cookie 三個旗標', t: '`HttpOnly`（JS 讀不到，防 XSS 偷）、`Secure`（只走 HTTPS）、`SameSite=Lax/Strict`（防 CSRF）。session id 與 refresh token 放 cookie 時三個都要。' },
    ],
    checklist: [
      '能寫出允許前端 dev server 帶 cookie 呼叫 API 的正確 CORS 設定',
      '能解釋為什麼 CORS 不是安全機制、防線該放在哪裡',
      '能說出 HttpOnly / Secure / SameSite 各防什麼',
    ],
    refs: [
      { label: 'MDN：CORS', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS' },
    ],
  },
  'http-caching': {
    challenge: {
      task: '票務網站有兩個資源：「場次剩餘座位」`seats.json` 與「場館介紹」`venue.html`。在一個資料夾放這兩個檔案，用 `python3 -m http.server` 提供，瀏覽器開 `seats.json` 兩次（第二次按一般的重新整理），觀察 Network 分頁；再改一次檔案內容後重新整理。也用 `curl -i -H "If-Modified-Since: <上一次的 Last-Modified>"` 重做一次。',
      deliver: '沒改檔與改了檔兩次的請求、回應標頭與畫面內容，加一句：304 時畫面顯示的是哪一份內容。',
      check: [
        '第二次請求帶了 `If-Modified-Since`（或 `If-None-Match`），回應是 304 而且沒有 body',
        '說明 304 時畫面用的是瀏覽器快取裡的那份 body，並用改檔後的 200 對照',
        '替兩個資源各寫一組 `Cache-Control`，並分成兩欄：可以從掛號的「診次剩餘名額」沿用的條件（個人化與否、要不要每次驗證），以及要跟票務業務確認的條件（開賣當下能接受幾秒的舊資料）',
      ],
      twist: '在同一秒內改兩次 `seats.json`。先預測只靠 `Last-Modified` 會不會漏掉第二次修改、`ETag` 能不能避免，再實測。',
    },
    points: [
      { b: '`Cache-Control` 的幾個字', t: '`no-store`（別存）、`no-cache`（存但每次要驗證）、`max-age=60`（60 秒內直接用）、`private`（只有瀏覽器能存，CDN 不行）、`public`。' },
      { b: '304 Not Modified', t: '回應帶 `ETag`，客戶端下次帶 `If-None-Match`；沒變就回 304 不帶 body，省頻寬也省序列化。' },
      { b: 'API 回應多半 `private, no-cache`', t: '個人化資料不能被共用快取存；公開且變動慢的資料（商品目錄）才給 `public, max-age`。' },
      { b: '靜態資產用檔名 hash + 長快取', t: '`app.abc123.js` 配 `max-age=31536000, immutable`：檔名帶內容 hash，改了內容就是新檔名，舊快取自然失效。這在 nginx / CDN 層設定。' },
    ],
    checklist: [
      '能為「個人訂單列表」「公開商品頁」「靜態 JS」各挑一組正確的快取標頭',
      '能實作 ETag 並讓客戶端拿到 304',
    ],
    refs: [
      { label: 'MDN：HTTP caching', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching' },
    ],
  },
  'tls-dns': {
    challenge: {
      task: '製造兩種錯誤，各寫一張診斷卡。DNS：`curl -v https://no-such-host.example/` 與 `dig no-such-host.example`。憑證名稱：先用 `dig +short example.com` 取得 IP，再 `curl -v --resolve wrong.example.com:443:<那個 IP> https://wrong.example.com/`，並用 `openssl s_client -connect <IP>:443 -servername example.com </dev/null | openssl x509 -noout -ext subjectAltName` 看憑證列了哪些名字。',
      deliver: '兩張診斷卡：症狀原文、第一個要跑的指令與輸出、怎麼判斷是這一層的問題、修法。',
      check: [
        '兩張卡的錯誤訊息都是實際指令輸出的原文',
        'DNS 卡用 `dig` 的 `status:` 證明卡在解析（沒有拿到 IP）；憑證卡用 `curl -v` 的 `Connected to` 證明 TCP 已經連上',
        '憑證卡寫出 SAN 實際列了哪些名字，說明為什麼 `wrong.example.com` 不在裡面就失敗',
      ],
      twist: '同一個名字在公司內網的 DNS 解析到舊機器、外面解析到新機器。先預測兩張卡的哪一步在兩個網路會得到不同結果，再寫出要多加的檢查指令。',
    },
    points: [
      { b: 'DNS 紀錄的幾種', t: 'A / AAAA 指 IP、CNAME 指另一個名字、TXT 做驗證。TTL 決定改紀錄多久生效，換機器前先把 TTL 調短。' },
      { b: 'TLS 握手在做什麼', t: '驗證伺服器憑證（CA 簽的）、協商金鑰、之後整條連線加密。TLS 1.3 把握手縮到一趟來回。' },
      { b: 'TLS 終結在邊界', t: '憑證只放在 nginx / 負載平衡器，內網用 HTTP。後端要靠 `X-Forwarded-Proto` 知道原始請求是 HTTPS。' },
      { b: '憑證自動更新', t: "Let's Encrypt 的預設憑證 90 天；CA/Browser Forum 的規定把公開憑證的效期上限從 2026-03-15 起降到 200 天、2027-03-15 起 100 天、2029-03-15 起 47 天。手動換憑證會跟不上，用 certbot / acme.sh 自動續，並監控到期日。" },
    ],
    checklist: [
      '能解釋瀏覽器如何判斷一張憑證可信',
      '能設定 nginx 做 TLS 終結並把 HTTP 導向 HTTPS',
      '知道憑證到期怎麼被監控與自動更新',
    ],
    refs: [
      { label: "Let's Encrypt 文件", url: 'https://letsencrypt.org/docs/' },
      { label: 'RFC 8446：TLS 1.3', url: 'https://datatracker.ietf.org/doc/html/rfc8446' },
    ],
  },
  'http2-http3': {
    challenge: {
      task: '用 `curl --http1.1` 與 `curl --http2` 對同一個網站（例如 `https://example.com/`）各跑 10 次，`-w` 印 `%{http_version} %{time_appconnect} %{time_total}`；你的 curl 支援的話再加 `--http3`。也在瀏覽器 Network 分頁打開 Protocol 欄看同一個網站。跑之前先預測哪個協定在這個網站上最快、差多少。',
      deliver: '每個協定 10 次的中位數與最大值、`curl --version`、網路環境，加三句「這組數字不能推論的事」。',
      check: [
        '每次都確認了協商結果：`%{http_version}` 實際是 1.1、2 或 3，而不是只看指令參數',
        '用中位數與範圍比較，不拿單次數字下結論',
        '至少寫出兩件不能推論的事（例如：單一小頁面看不出多工的好處；網路沒有丟包時看不到 TCP 隊頭阻塞）',
      ],
      twist: '換成一頁 80 個小資源、丟包率 2% 的行動網路。先用練習題 [兩種隊頭阻塞](#/exercise/http2-http3-1) 的模型預測哪個協定差最多，再寫出要怎麼在本機模擬丟包（例如 Linux 的 `tc netem`）才能驗證。',
    },
    points: [
      { b: '語意不變，線路格式改變', t: '方法、路徑、狀態碼、標頭在三個版本都一樣；改的是怎麼編碼與傳輸。後端程式通常不用改，要改的是伺服器、proxy、負載平衡器的設定。' },
      { b: 'HTTP/2：一條連線多工', t: '二進位分幀，每個請求是一條 stream，不同 stream 的幀交錯傳送；HPACK 壓縮重複的標頭。解決 HTTP/1.1 一次一個請求的隊頭阻塞。伺服器推送已被主要瀏覽器移除。' },
      { b: 'TCP 的隊頭阻塞還在', t: '所有 stream 共用一條 TCP 連線，一個封包遺失，後面所有 stream 都要等重傳。丟包多的行動網路上最明顯。' },
      { b: 'HTTP/3 跑在 QUIC（UDP）上', t: 'stream 在傳輸層就獨立、TLS 1.3 內建在握手裡、用連線 ID 支援網路切換時的連線遷移。瀏覽器透過 `Alt-Svc` 或 DNS HTTPS 紀錄得知，UDP 不通時退回 TCP。' },
      { b: '邊界終結，後端 HTTP/1.1', t: 'CDN / nginx 對外講 HTTP/2、HTTP/3，往後端用 HTTP/1.1 加 keep-alive。gRPC 例外：整條路徑都要 HTTP/2，而且長連線需要 L7 或 client 端負載平衡。' },
    ],
    checklist: [
      '能說明 HTTP 層與 TCP 層兩種隊頭阻塞的差別，以及各由哪一版解決',
      '能用 curl 或瀏覽器開發者工具確認一個網站實際協商到的 HTTP 版本',
      '能說出開 HTTP/3 時防火牆與負載平衡器要多放行什麼',
    ],
    refs: [
      { label: 'RFC 9113：HTTP/2', url: 'https://www.rfc-editor.org/rfc/rfc9113' },
      { label: 'RFC 9114：HTTP/3', url: 'https://www.rfc-editor.org/rfc/rfc9114' },
      { label: 'RFC 9000：QUIC', url: 'https://www.rfc-editor.org/rfc/rfc9000' },
      { label: 'nginx：ngx_http_v2_module', url: 'https://nginx.org/en/docs/http/ngx_http_v2_module.html' },
    ],
  },
  'realtime-choice': {
    challenge: {
      task: '餐廳的候位叫號頁：客人在手機上等叫號。做完練習題 [解析 SSE](#/exercise/realtime-choice-1) 後，在 [Playground](#/playground?lang=js) 模擬：伺服器依序送 id 1–10 的事件，客戶端收到第 5 個後斷線，重連時帶 `Last-Event-ID`，這段期間伺服器又送了 6–8；伺服器只保留最近 N 筆事件。分別用 N=3 與 N=10 跑，先預測兩種情況客戶端收到的 id 序列。',
      deliver: '兩種 N 的預測與實際 id 序列，加上「發現漏號時客戶端怎麼補」的做法。',
      check: [
        'N=10 時沒有漏號也沒有重複；N=3 時指出漏了哪幾個，而且程式偵測得到',
        '漏號時的補救是重新取一次完整狀態（例如 `GET /queue/current`），不是當作沒發生',
        '驗收清單多列兩項：手機鎖屏或分頁進背景後恢復、多台伺服器時事件 id 怎麼產生',
        '分成兩欄：可以從門診叫號沿用的設計，以及要跟餐廳業務確認的條件（過號多久算棄號、要不要另外發推播）',
      ],
      twist: '改成演唱會開賣的排隊進度，十萬人同時在線。先預測 SSE 的連線數與心跳會在哪一層先撐不住，以及每 30 秒短輪詢在什麼條件下反而比較合理。',
    },
    points: [
      { b: '先問能接受多少延遲', t: '幾十秒可以接受就短輪詢；要即時、只有伺服器推就 SSE；客戶端也要頻繁送資料才用 WebSocket。長輪詢是受限環境的退路。' },
      { b: 'SSE：單向、純 HTTP、自動重連', t: '回應 `Content-Type: text/event-stream` 且不結束；事件由 `data` / `event` / `id` 欄位加空行組成。瀏覽器的 `EventSource` 斷線會自動重連並帶 `Last-Event-ID`。' },
      { b: 'WebSocket：雙向，但重連與補送要自己做', t: '從 HTTP/1.1 `Upgrade` 握手（101 Switching Protocols）換協定。不受 CORS 限制，握手時要檢查 `Origin`；重連要加退避與抖動。' },
      { b: 'proxy 三件事：逾時、緩衝、升級標頭', t: 'nginx `proxy_read_timeout` 預設 60 秒，要加心跳；SSE 要關 `proxy_buffering`；WebSocket 要轉送 `Upgrade` / `Connection` 並用 `proxy_http_version 1.1`。' },
      { b: '多台伺服器要 pub/sub', t: '事件可能在 A 機器產生、使用者連在 B 機器。每台訂閱共用頻道（Redis Pub/Sub 不保存訊息；要補送就用 Streams 之類有保存的日誌），客戶端重連後重新取一次完整狀態。' },
    ],
    checklist: [
      '能為「匯出進度」「聊天」「後台每分鐘更新的統計」各選一種做法並說明理由',
      '能寫出 nginx 轉送 SSE 與 WebSocket 各自需要的設定',
      '能說明擴到多台伺服器後，推送要怎麼送到正確的連線',
    ],
    refs: [
      { label: 'MDN：Server-sent events', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events' },
      { label: 'MDN：The WebSocket API', url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API' },
      { label: 'RFC 6455：The WebSocket Protocol', url: 'https://www.rfc-editor.org/rfc/rfc6455' },
      { label: 'nginx：WebSocket proxying', url: 'https://nginx.org/en/docs/http/websocket.html' },
    ],
  },
  'beyond-rest': {
    challenge: {
      task: '物流追蹤頁要顯示一張託運單的目前狀態與歷程，電商平台也要在狀態改變時收到通知。分別用 REST 輪詢、GraphQL 查詢、SSE 推送、Webhook（給電商平台）設計，列出每一種的前端或接收端要保留哪些狀態（最後看到的事件 id、重連游標、已處理的 webhook id、快取的欄位），以及這個狀態不見時（重新整理、重連、重送）會發生什麼。接著用練習題 [驗證 Webhook](#/exercise/beyond-rest-1) 實際送兩次同一個事件 id。',
      deliver: '四種介面的狀態表，加上練習題裡同一個事件送兩次的實際輸出。',
      check: [
        '四種介面各列出要保留的狀態，以及它不見時的後果',
        'Webhook 那一列附上同一個事件 id 送兩次的實際輸出，只處理一次',
        '分成兩欄：可以從付款通知沿用的條件（驗簽章、依事件 id 去重），以及要跟物流業務確認的條件（狀態會不會倒退，例如「配送中」回到「理貨中」）',
      ],
      twist: '物流商的事件不保證順序，「已送達」可能比「配送中」先到。先預測四種介面裡哪幾種的畫面會顯示錯，以及只靠事件 id 去重夠不夠。',
    },
    points: [
      { b: 'GraphQL：前端決定要什麼欄位', t: '解決 over/under-fetching，但後端要處理 N+1（DataLoader）、查詢複雜度限制、快取變難。適合多端、多變的前端需求。' },
      { b: 'gRPC：服務對服務', t: 'Protobuf 二進位 + HTTP/2，型別強、效能好，但瀏覽器直接用不方便。微服務之間常見。' },
      { b: 'WebSocket 與 SSE：伺服器主動推', t: '聊天、即時通知用 WebSocket（雙向）；只需要伺服器 → 客戶端的用 SSE 更簡單，還能走一般 HTTP 基礎設施。' },
      { b: 'Webhook：你打別人', t: '事件發生時 POST 到對方的 URL。要簽章（HMAC）讓對方驗證來源、要重試與冪等（對方可能收到兩次）。' },
    ],
    checklist: [
      '能為「即時聊天」「行動 App 的首頁」「付款完成通知第三方」各選一種形式並說明理由',
      '知道 Webhook 為什麼要簽章與重試',
    ],
    refs: [],
  },
}
