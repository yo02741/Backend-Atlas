// 領域 2：網路、HTTP 與 API 設計 — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d2-web.js
export default {
  'http-basics': {
    points: [
      { b: 'HTTP 是無狀態的', t: '每個請求自帶全部資訊（標頭、cookie、token）。「登入狀態」是靠 session 或 token 在每次請求重建出來的。' },
      { b: '連線很貴，重用它', t: 'TCP 三向交握 + TLS 握手要來回好幾趟。keep-alive / HTTP/2 多工讓同一條連線跑很多請求；後端呼叫外部服務也要用連線池。' },
      { b: '標頭各司其職', t: '`Content-Type` 說 body 格式、`Authorization` 帶憑證、`Cache-Control` / `ETag` 管快取、`Set-Cookie` 種 cookie、`Location` 指新位置。' },
      { b: '狀態碼是 API 的第一層語意', t: '2xx 成功、3xx 去別處、4xx 客戶端的錯、5xx 伺服器的錯。回錯狀態碼會讓監控、重試、快取全部判斷錯。' },
      { b: '冪等與安全方法', t: 'GET / HEAD 安全（不改狀態）；GET / PUT / DELETE 冪等（重複執行結果相同）；POST 兩者都不是——重試邏輯與快取都靠這個性質。' },
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
    points: [
      { b: '沒有 timeout 就是無上限的等待', t: '`httpx.Client(timeout=5.0)`、DB `statement_timeout`、佇列任務 time limit。連線與讀取分開設；預設值通常是「永遠等」。' },
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
    points: [
      { b: 'FastAPI 從型別自動產出規格', t: 'pydantic model + 路由宣告 = `/openapi.json` + Swagger UI，零額外工作。這是選它當範例的原因之一。' },
      { b: 'code-first 與 schema-first', t: '從程式碼產規格（FastAPI）適合小團隊快速迭代；先寫規格再實作適合多團隊並行。兩者都要把規格當合約看待。' },
      { b: '用規格產 client', t: 'openapi-typescript、orval 等工具把規格變成型別安全的前端呼叫；後端改了回應型別，前端編譯就會失敗——這是好事。' },
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
    points: [
      { b: 'CORS 是瀏覽器的規則，不是伺服器的防線', t: 'curl 不理 CORS。它保護的是「使用者的瀏覽器不被其他網站拿去打你的 API」，真正的授權還是要靠 token / session。' },
      { b: 'preflight 的來回', t: '非簡單請求（自訂標頭、JSON、PUT）先送 `OPTIONS`，伺服器回 `Access-Control-Allow-Origin / Methods / Headers`，通過才送真請求。`Access-Control-Max-Age` 可快取這個結果。' },
      { b: '帶 cookie 的請求規則更嚴', t: '`Access-Control-Allow-Credentials: true` 時 origin 不能是 `*`，必須明列。' },
      { b: 'Cookie 三個旗標', t: '`HttpOnly`（JS 讀不到，防 XSS 偷）、`Secure`（只走 HTTPS）、`SameSite=Lax/Strict`（防 CSRF）。session id 與 refresh token 放 cookie 時三個都要。' },
    ],
    checklist: [
      '能寫出允許前端 dev server 帶 cookie 呼叫 API 的正確 CORS 設定',
      '能解釋為什麼 CORS 不是安全機制、真正的防線是什麼',
      '能說出 HttpOnly / Secure / SameSite 各防什麼',
    ],
    refs: [
      { label: 'MDN：CORS', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS' },
    ],
  },
  'http-caching': {
    points: [
      { b: '`Cache-Control` 的幾個字', t: '`no-store`（別存）、`no-cache`（存但每次要驗證）、`max-age=60`（60 秒內直接用）、`private`（只有瀏覽器能存，CDN 不行）、`public`。' },
      { b: '304 Not Modified', t: '回應帶 `ETag`，客戶端下次帶 `If-None-Match`；沒變就回 304 不帶 body，省頻寬也省序列化。' },
      { b: 'API 回應多半 `private, no-cache`', t: '個人化資料不能被共用快取存；公開且變動慢的資料（商品目錄）才給 `public, max-age`。' },
      { b: '靜態資產用檔名 hash + 長快取', t: '`app.abc123.js` 配 `max-age=31536000, immutable`：檔名帶內容 hash，改了內容就是新檔名，舊快取自然失效。這是 nginx / CDN 層的事。' },
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
    points: [
      { b: 'DNS 紀錄的幾種', t: 'A / AAAA 指 IP、CNAME 指另一個名字、TXT 做驗證。TTL 決定改紀錄多久生效——換機器前先把 TTL 調短。' },
      { b: 'TLS 握手在做什麼', t: '驗證伺服器憑證（CA 簽的）、協商金鑰、之後整條連線加密。TLS 1.3 把握手縮到一趟來回。' },
      { b: 'TLS 終結在邊界', t: '憑證只放在 nginx / 負載平衡器，內網用 HTTP。後端要靠 `X-Forwarded-Proto` 知道原始請求是 HTTPS。' },
      { b: '憑證自動更新', t: "Let's Encrypt 憑證 90 天，而且業界已決議逐步把公開憑證最長效期縮到 47 天（2029 年前分階段）——手動換憑證不再可行，用 certbot / acme.sh 自動續，並監控到期日。" },
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
