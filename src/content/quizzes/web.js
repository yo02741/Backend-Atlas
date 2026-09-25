// 題庫：網路、HTTP 與 API 設計
export default [
  {
    skill: 'http-basics',
    questions: [
      {
        q: '為什麼說 PUT 是冪等的、POST 不是？',
        options: [
          'PUT 不會改變伺服器狀態、POST 會，所以 PUT 可以安全重試',
          '同一個 PUT 重送多次，伺服器最終狀態與只送一次相同；同一個 POST 重送可能建立多筆資源',
          'PUT 只能用在更新、POST 只能用在建立，兩者語意不同',
          'PUT 請求會被瀏覽器與 CDN 快取、POST 不會',
        ],
        answer: 1,
        explain: '冪等指「重複執行 N 次的結果等於執行 1 次」：PUT 對 `/orders/42` 放同一份內容不論幾次結果都一樣，所以客戶端或 proxy 遇到逾時可以直接重試；POST `/orders` 每送一次可能多一筆訂單，重試要靠 Idempotency-Key。冪等不等於「不改狀態」——那是「安全方法」（GET、HEAD）的定義，PUT 會改狀態但仍冪等。PUT 也可用來建立（客戶端指定 id），且兩者預設都不被快取。',
      },
      {
        q: '這個回應有什麼問題？',
        code: `GET /api/orders/42 HTTP/1.1
Authorization: Bearer eyJhbGci...

HTTP/1.1 200 OK
Content-Type: application/json

{"error": "order not found"}`,
        lang: 'http',
        options: [
          'Content-Type 應為 text/plain，因為 body 是錯誤訊息',
          '應回 500，找不到資料代表伺服器出錯',
          '找不到資源卻回 200，客戶端的重試、監控、快取都會把它當成功；應回 404',
          '沒有問題，狀態碼只是參考，錯誤資訊放 body 即可',
        ],
        answer: 2,
        explain: '狀態碼是 API 的第一層語意，很多東西不看 body 只看狀態碼：監控算錯誤率、客戶端 SDK 決定要不要拋例外、CDN 決定能不能快取、瀏覽器 fetch 的 `response.ok`。回 200 帶錯誤等於對整個生態系說謊。找不到是客戶端請求了不存在的東西，屬 4xx（404）；5xx 保留給伺服器自己的錯。',
      },
      {
        q: '後端每次呼叫外部 API 都新建一個 HTTP client（新 TCP + TLS 連線），延遲明顯偏高。最直接的改善是？',
        options: [
          '建立一個長存的 client 並啟用連線池 / keep-alive，讓多個請求重用同一條連線，省掉每次的 TCP 三向交握與 TLS 握手',
          '把對方網域的 DNS TTL 調長，減少解析次數',
          '每次請求後主動關閉連線，讓下一次連線更乾淨',
          '改成同步呼叫，避免 async 切換的開銷',
        ],
        answer: 0,
        explain: '一條新的 HTTPS 連線要 TCP 三向交握加 TLS 握手，跨區可能就是幾十到上百毫秒，而真正傳資料只要一趟。連線池讓這個成本只付一次，HTTP/2 還能在同一條連線多工。DNS TTL 由對方設定、不是你能控制的，而且解析結果通常已被系統快取；主動關連線正是問題本身；同步或非同步與握手成本無關。',
      },
    ],
  },
  {
    skill: 'rest-design',
    questions: [
      {
        q: '對 `/orders/42` 送 PUT 與 PATCH，兩者最核心的差別是什麼？',
        options: [
          'PUT 用來建立、PATCH 用來更新',
          'PATCH 是冪等的、PUT 不是，所以 PATCH 更適合重試',
          'PUT 需要完整驗證、PATCH 可以跳過驗證',
          'PUT 以 body 取代整筆資源（沒給的欄位視為清空）；PATCH 只修改 body 裡有給的欄位',
        ],
        answer: 3,
        explain: 'PUT 的語意是「把這個 URI 的內容替換成我給的」，所以少傳欄位就等於把它清掉；PATCH 是「套用這些修改」，只動有給的欄位。冪等性正好相反：PUT 冪等、PATCH 不一定（例如 `{"op":"increment"}`）。兩者都要驗證；PUT 也可以用來建立（客戶端指定 id）。團隊要選定一種語意寫進規範，前端才不會踩雷。',
      },
      {
        q: '這三個 endpoint 違反 REST 設計的共同問題是？',
        code: `POST /orders/42/delete
POST /getOrders?status=paid
GET  /orders/create?total=100`,
        lang: 'http',
        options: [
          '路徑沒有 /v1 版本前綴',
          '把動作寫進路徑、用錯 HTTP 方法；應為 DELETE /orders/42、GET /orders?status=paid、POST /orders',
          '查詢參數不應出現在 REST API 中，篩選應放進 body',
          '資源名稱應該用單數 /order 而非複數',
        ],
        answer: 1,
        explain: 'REST 的核心是「資源是名詞、方法是動詞」：刪除用 DELETE、查詢用 GET（安全、可快取）、建立用 POST。`GET /orders/create` 最危險——GET 應該不改狀態，爬蟲或瀏覽器預先載入就可能亂建訂單。查詢參數正是篩選的標準位置；複數名詞是常見慣例；版本前綴是另一個議題，不是這三個的共同問題。',
      },
      {
        q: '客戶端 `POST /orders` 建立訂單成功，最符合慣例的回應是？',
        options: [
          '200 OK，body 回 `{"success": true}`',
          '204 No Content，讓客戶端再 GET 列表找新訂單',
          '201 Created，帶 `Location: /orders/43` 指向新資源，body 可附上新建的訂單',
          '302 Found，把客戶端導向 /orders/43',
        ],
        answer: 2,
        explain: '201 明確表示「建立成功」，Location 標頭告訴客戶端新資源在哪，省掉一次查詢；body 附上完整資源（含伺服器產生的 id、created_at）也是常見做法。200 + success 旗標把語意藏進 body；204 是「成功但沒東西給你」，用在 DELETE 剛好，用在建立會逼客戶端多打一次；302 是導向，用在 API 會讓客戶端 SDK 自動跟隨、行為難預期。',
      },
    ],
  },
  {
    skill: 'api-patterns',
    questions: [
      {
        q: '為什麼 cursor 分頁在深頁（例如第 5000 頁）比 offset 分頁快得多？',
        options: [
          'offset 分頁資料庫仍要掃過並丟掉前 N 列；cursor 分頁用上一頁最後一筆的排序鍵當條件（WHERE id > ?），直接從索引定位',
          'cursor 分頁會把整張表快取在應用程式記憶體裡',
          'cursor 分頁每頁回傳的筆數比較少，所以比較快',
          'offset 分頁無法使用索引，cursor 分頁會自動建立索引',
        ],
        answer: 0,
        explain: '`LIMIT 20 OFFSET 100000` 資料庫得先讀出十萬零二十列再丟掉前十萬，頁數越深越慢；`WHERE id > 100000 ORDER BY id LIMIT 20` 靠索引直接跳到起點，不管第幾頁成本一樣。cursor 的代價是不能「跳到第 N 頁」、排序鍵必須唯一且穩定。它不做快取也不會建索引——你要自己確保排序欄位有索引。',
      },
      {
        q: '客戶端因為網路逾時把這個請求原封不動重送了一次，伺服器正確的行為是？',
        code: `POST /payments HTTP/1.1
Idempotency-Key: 7f3a2c9e-4b1d-4e8a-9c1e-2d5f6a7b8c9d
Content-Type: application/json

{"order_id": 42, "amount": 1200}`,
        lang: 'http',
        options: [
          '再扣一次款，HTTP 無狀態無法分辨重送',
          '因為 key 已存在回 409 Conflict，要求客戶端換新 key 重試',
          '比對 body 相同就忽略請求、回 204',
          '查到這個 key 之前已處理過，直接回傳當時儲存的結果（同狀態碼與 body），不再扣款',
        ],
        answer: 3,
        explain: 'Idempotency-Key 的實作要存「key → 請求指紋 + 回應」，重送同 key 就回放同一份結果，客戶端不需要知道自己是第一次還是第幾次。回 409 或 204 會讓客戶端拿不到原本的付款結果，還得再查一次。只有「同 key 但 body 不同」才該拒絕（通常 422）。key 要存多久取決於客戶端會重試多久，24 小時是常見起點。',
      },
      {
        q: '你要改 `/v1/orders` 的回應。哪個變更是破壞性的、需要考慮出 /v2 或至少顯式公告？',
        options: [
          '在回應 JSON 新增 `currency` 欄位',
          '把原本整數（單位為分）的 `total` 改成字串 "12.00"',
          '新增選填的查詢參數 `?status=`',
          '新增一個 endpoint `GET /v1/orders/{id}/history`',
        ],
        answer: 1,
        explain: '加欄位、加選填參數、加 endpoint 都是「加法」，舊客戶端忽略不認識的東西就好；改既有欄位的型別或語意會讓已上線的客戶端解析失敗或算錯錢——這才是破壞性變更。版本策略是「能不改就不改」，真的要破壞時用 /v2 並限制同時維護的版本數（最多兩個）。',
      },
    ],
  },
  {
    skill: 'openapi',
    questions: [
      {
        q: 'FastAPI 自動產生 /openapi.json 屬於 code-first。對 code-first 與 schema-first 的正確描述是？',
        options: [
          '只有 schema-first 會產生文件，code-first 只能手寫',
          'code-first 產出的規格不能拿來產 client，只能給人看',
          'code-first 從程式碼（型別、路由）產規格，適合小團隊快速迭代；schema-first 先寫規格再實作，適合多團隊並行；兩者都應把規格當合約',
          'schema-first 就是 GraphQL、code-first 就是 REST',
        ],
        answer: 2,
        explain: '兩種做法產出的都是同一種 OpenAPI 規格，差別只在「誰是源頭」。code-first 零額外成本、不會跟程式脫節，但規格會隨實作漂移；schema-first 讓前後端可以同時開工、規格審查在寫程式之前，但要多維護一份檔案。不管哪種，規格都要進 CI 檢查，否則就只是文件而不是合約。',
      },
      {
        q: '在 FastAPI 自動產生的 /openapi.json 裡，`status` 欄位會被描述成什麼？',
        code: `class OrderOut(BaseModel):
    id: int
    total: Decimal
    status: Literal["pending", "paid"]

@app.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: int): ...`,
        lang: 'python',
        options: [
          'type: string，沒有其他限制',
          'type: string 且 enum 只允許 "pending" 與 "paid"',
          'type: object，因為 Literal 是複合型別',
          '不會出現在規格中，Literal 無法序列化',
        ],
        answer: 1,
        explain: 'pydantic 會把 `Literal[...]` 轉成 JSON Schema 的 `enum`，FastAPI 再放進 OpenAPI，所以前端用 openapi-typescript 產出的型別會是 `"pending" | "paid"` 而不是鬆散的 string。這正是「型別即規格」的價值：`order_id: int` 會變成 integer 路徑參數、`Decimal` 會有對應的數值描述，一處定義三處生效（驗證、文件、client）。',
      },
      {
        q: '後端把回應欄位 `user_name` 改名為 `username` 並部署，前端上線後才發現壞掉。哪個做法最能在合併前就攔住？',
        options: [
          '規定後端每次改 API 都要在群組通知前端',
          '前端對所有回應加 try/catch 與預設值容錯',
          '後端把所有欄位都改成 Optional，任何變動就都不算破壞',
          '前端用 OpenAPI 規格產出型別安全的 client；CI 比對 PR 前後的 openapi.json，破壞性變更沒有顯式標記就擋下',
        ],
        answer: 3,
        explain: '把合約變成機器可檢查的東西：規格 diff 在 PR 階段就會標出「欄位被移除」，產出的 TypeScript client 在前端編譯時就會報 `user_name` 不存在。人工通知會漏、會晚；runtime 容錯只是把錯誤藏到使用者面前；全部 Optional 是讓型別系統失效——前端到處要判 undefined，等於沒有合約。',
      },
    ],
  },
  {
    skill: 'cors-cookies',
    questions: [
      {
        q: '為什麼說 CORS 不是伺服器的安全防線？',
        options: [
          '因為 CORS 只在 HTTPS 下才會生效',
          '因為 CORS 是瀏覽器執行的規則，curl 或任何非瀏覽器客戶端可以無視它；真正的授權仍要靠 token / session',
          '因為 CORS 只能限制 GET，擋不住 POST',
          '因為 preflight 可以被前端程式關掉',
        ],
        answer: 1,
        explain: 'CORS 保護的是「使用者的瀏覽器不被其他網站拿去讀你的 API 回應」，是瀏覽器單方面遵守的規則，伺服器只是宣告允許誰。攻擊者用 curl、Postman 或自己的後端打你的 API 時根本沒有 CORS 這回事，所以每個 endpoint 仍要驗 token / session 與權限。CORS 對所有方法都有規範，且與 HTTPS 無關；preflight 由瀏覽器決定發不發，前端無法關閉。',
      },
      {
        q: '前端 dev server（在 localhost 的 5173 port）帶 cookie 呼叫 API，伺服器回了這些標頭，瀏覽器仍報 CORS 錯誤。原因是？',
        code: `HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: *`,
        lang: 'http',
        options: [
          '少了 `Access-Control-Allow-Headers: Cookie`',
          'localhost 不是合法 origin，要改用 127.0.0.1',
          '帶 credentials 的請求，`Access-Control-Allow-Origin` 不能是 `*`，必須回明確的 origin（含 scheme 與 port）',
          '帶 cookie 的請求不需要 CORS，是前端 fetch 少了 `credentials: "include"`',
        ],
        answer: 2,
        explain: '瀏覽器規定：只要回應有 `Allow-Credentials: true`，`Allow-Origin` 就必須是具體的 origin，`*` 會被拒絕（`Allow-Headers: *` 在帶 credentials 時同樣不算萬用字元）。正確做法是伺服器維護允許清單，比對請求的 Origin 後原樣回傳，並加 `Vary: Origin`。Cookie 不是自訂標頭、不需列在 Allow-Headers；localhost 是合法 origin；前端就算加了 `credentials: "include"`，這組標頭仍會失敗。',
      },
      {
        q: '你要把 session id 種進 cookie。哪一組旗標最正確、且各自在防什麼？',
        options: [
          '`HttpOnly; Secure; SameSite=Lax`：JS 讀不到（防 XSS 偷 cookie）、只走 HTTPS（防明文竊聽）、跨站請求不自動帶（防 CSRF）',
          '只要 `Secure` 就夠，HTTPS 加密後 XSS 與 CSRF 都碰不到 cookie',
          '`HttpOnly` 表示 cookie 只能在 HTTP（非 HTTPS）傳送，正式環境不能用',
          '`SameSite=None` 最安全，因為它表示不允許任何跨站請求帶 cookie',
        ],
        answer: 0,
        explain: '三個旗標各擋一種攻擊，缺一不可。HttpOnly 的意思是「只給 HTTP 層用、JS 拿不到」，與加密無關；Secure 只防傳輸竊聽，XSS 是在你自己的頁面跑的 JS、CSRF 是別的網站發請求，HTTPS 都擋不住；SameSite=None 反而是「任何跨站都帶」，是最寬鬆的設定（還必須配 Secure），要限制用 Lax 或 Strict。',
      },
    ],
  },
  {
    skill: 'http-caching',
    questions: [
      {
        q: '`Cache-Control: no-cache` 與 `no-store` 的差別是？',
        options: [
          '兩者相同，都表示完全不快取',
          'no-store 完全不能存；no-cache 可以存，但每次使用前必須向伺服器驗證（例如帶 If-None-Match）',
          'no-cache 完全不能存；no-store 可以存但要驗證',
          'no-cache 只對瀏覽器有效，no-store 只對 CDN 有效',
        ],
        answer: 1,
        explain: '名字反直覺：no-cache 不是「不快取」而是「不要不驗證就直接用」，搭配 ETag 就能拿到 304 省下 body 傳輸；no-store 才是真的一個位元都不留（敏感資料、一次性回應）。兩者對瀏覽器與共用快取都有效；要區分誰能存用 private / public。API 回應多半用 `private, no-cache`。',
      },
      {
        q: '這段往返代表什麼？',
        code: `GET /api/products/7 HTTP/1.1
If-None-Match: "a1b2c3"

HTTP/1.1 304 Not Modified
ETag: "a1b2c3"
Cache-Control: private, no-cache`,
        lang: 'http',
        options: [
          '客戶端第一次請求該資源，伺服器要它稍後再試',
          'ETag 不符，客戶端必須丟棄快取重新下載',
          '伺服器回了新版資源，只是 body 被壓縮所以看不到',
          '客戶端帶著上次的 ETag 詢問是否有變；伺服器判定沒變，回 304 不帶 body，客戶端沿用本地副本',
        ],
        answer: 3,
        explain: '這是條件請求的標準流程：上次回應帶了 `ETag: "a1b2c3"`，客戶端這次用 `If-None-Match` 問「還是這版嗎」；伺服器比對後相同就回 304，不重新序列化也不傳 body，客戶端用自己存的那份。若有變，伺服器會回 200 + 新 body + 新 ETag。304 一定沒有 body，不是壓縮；第一次請求不會有 If-None-Match。',
      },
      {
        q: '為「使用者個人訂單列表」「公開商品頁（約每小時更新）」「帶檔名 hash 的靜態 JS」各選快取標頭，哪一組最合理？',
        options: [
          '全部 `public, max-age=3600`，讓 CDN 盡量吃流量',
          '全部 `no-store`，避免任何人看到舊資料',
          '訂單列表 `private, no-cache`（配 ETag）；商品頁 `public, max-age=3600`；靜態 JS `public, max-age=31536000, immutable`',
          '訂單列表 `public, max-age=60`；商品頁 `no-store`；靜態 JS `no-cache`',
        ],
        answer: 2,
        explain: '個人化資料絕不能進共用快取（public 會讓 CDN 把 A 的訂單給 B 看），用 private 讓瀏覽器存、no-cache 配 ETag 拿 304；公開且變動慢的商品頁給 CDN 存一小時，後端負載少一個數量級；檔名帶 hash 的靜態資產內容永遠不變，可以存一年並標 immutable 連驗證都省。全部 no-store 是把後端流量最大化，全部 public 是資料洩漏。',
      },
    ],
  },
  {
    skill: 'tls-dns',
    questions: [
      {
        q: '瀏覽器如何判斷一張 TLS 憑證可信？',
        options: [
          '憑證裡的網域名稱與網址相符就可信，簽發者是誰不重要',
          '憑證由作業系統／瀏覽器信任清單中的根 CA（透過中繼 CA 鏈）簽發、網域名稱相符、且在有效期內（並未被撤銷）',
          '只要伺服器用 TLS 1.3，憑證就一定可信',
          '瀏覽器會另外連到憑證上的網域，再問一次伺服器這張憑證是不是真的',
        ],
        answer: 1,
        explain: '信任來自 CA 鏈：伺服器送出自己的憑證與中繼憑證，瀏覽器沿著簽章一路驗到內建的根 CA；再檢查 SAN 裡的網域是否包含你連的主機名、現在時間是否在 notBefore / notAfter 之間、必要時查 OCSP / CRL。三個條件缺一就會出現憑證警告。TLS 版本只決定握手與加密方式，與憑證可信無關；瀏覽器也不會回頭問伺服器——那樣攻擊者說「是」就好了。',
      },
      {
        q: '這個 nginx 設定裡 `X-Forwarded-Proto` 的作用是？',
        code: `server {
    listen 443 ssl;
    server_name api.example.com;
    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        # proxy_pass 到內網的 uvicorn（127.0.0.1:8000，走純 HTTP）
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`,
        lang: 'nginx',
        options: [
          '讓 nginx 改用 HTTPS 連到後端的 8000 port',
          '告訴瀏覽器要升級到 HTTP/2',
          '把憑證轉送給後端，讓後端再驗證一次',
          'nginx 在此終結 TLS、內網以 HTTP 轉給後端；這個標頭讓後端知道原始請求是 HTTPS，才能產生正確的 redirect URL、設 Secure cookie',
        ],
        answer: 3,
        explain: 'TLS 終結在邊界：憑證只放 nginx / 負載平衡器，內網用 HTTP 省掉加密開銷與憑證分發。但後端看到的連線是 HTTP，如果不告訴它原始 scheme，它產生的絕對 URL 會變成 http、可能拒絕種 Secure cookie 或誤判成不安全連線。`$scheme` 是 nginx 收到請求時的協定（這裡是 https）。這個標頭與 HTTP/2 協商無關，也不會轉送憑證——後端要信任的是 nginx，而不是重新驗證。',
      },
      {
        q: '你要把 api.example.com 從舊主機搬到新主機，希望切換時使用者幾乎無感。DNS 上正確的操作順序是？',
        options: [
          '切換前一兩天先把 A 紀錄的 TTL 調短（如 60 秒），等舊 TTL 過期後再改成新 IP；確認穩定後把 TTL 調回較長',
          '切換當下同時把 A 紀錄改成新 IP 並把 TTL 調短',
          '直接新增第二筆 A 紀錄指向新 IP，舊的不用刪',
          '先改成 CNAME 指向舊主機名稱，切換後再改回 A 紀錄',
        ],
        answer: 0,
        explain: 'TTL 決定各地 resolver 會把舊答案快取多久。若原本 TTL 是 1 天，切換當下才調短沒用——全世界的快取仍會抱著舊 IP 最多一天。所以要先調短、等舊 TTL 走完，之後改 IP 才會在一分鐘內生效。同時保留兩筆 A 紀錄會讓流量隨機分到新舊主機，若有狀態（session、寫入）會出事；CNAME 繞一圈解決不了快取問題。',
      },
    ],
  },
  {
    skill: 'beyond-rest',
    questions: [
      {
        q: '為「即時聊天」「伺服器單向推送處理進度」「付款完成後通知第三方系統」各選一種通訊形式，哪一組最合理？',
        options: [
          '聊天用 WebSocket；單向進度用 SSE；通知第三方用 Webhook',
          '聊天用 Webhook；單向進度用 WebSocket；通知第三方用 SSE',
          '聊天用 gRPC；單向進度用 GraphQL；通知第三方用 WebSocket',
          '三者都用 WebSocket，雙向且最通用',
        ],
        answer: 0,
        explain: '聊天需要雙向即時，用 WebSocket。只有伺服器 → 客戶端的進度推送用 SSE 就夠，它走一般 HTTP、有自動重連、經過 proxy / CDN 也友善。通知另一個「伺服器」則是 Webhook：事件發生時你主動 POST 到對方 URL，對方不需要維持長連線。全部用 WebSocket 會讓第三方得常駐連線到你、也失去 HTTP 基礎設施的好處；gRPC 是服務對服務的 RPC，GraphQL 是查詢語言，都不是推播機制。',
      },
      {
        q: '你的服務收到這個 Webhook，處理前應該先做什麼？',
        code: `POST /webhooks/payment HTTP/1.1
X-Signature: sha256=3f1a8c...
X-Timestamp: 1758765187
Content-Type: application/json

{"event":"payment.succeeded","id":"evt_8812","order_id":42}`,
        lang: 'http',
        options: [
          'body 是合法 JSON 且欄位齊全就可信任，直接把訂單標為已付款',
          '用 JWT 函式庫解開 X-Signature 取得發送者身分',
          '用事先共享的 secret 對 timestamp + body 計算 HMAC，與 X-Signature 比對確認來源與內容未被改；再用 evt_8812 去重，因為同一事件可能被重送',
          '只要來源 IP 在對方公布的白名單內就直接處理',
        ],
        answer: 2,
        explain: 'Webhook 的 endpoint 是公開的，任何人都能 POST 一份假的「付款成功」。HMAC 簽章讓你確認是持有 secret 的對方送的且內容沒被改，timestamp 一併簽進去可擋重放。對方為了保證送達會重試，所以同一個 event id 可能到兩次，處理要冪等（記下已處理的 id）。IP 白名單脆弱（對方換 IP、走 CDN）且防不了內容竄改；X-Signature 是 HMAC 摘要不是 JWT。',
      },
      {
        q: '行動 App 團隊抱怨 REST 首頁要打 6 個 endpoint、又回傳一堆用不到的欄位，你考慮導入 GraphQL。後端最需要提前處理的問題是？',
        options: [
          'GraphQL 不支援認證，要另外設計一套登入',
          'N+1 查詢（用 DataLoader 批次載入）、查詢深度與複雜度限制、以及 HTTP 快取變難',
          'GraphQL 只能走 WebSocket，要重做基礎設施',
          '必須一次把所有 REST endpoint 下線改成 GraphQL',
        ],
        answer: 1,
        explain: 'GraphQL 讓前端自由組合欄位，代價轉到後端：一個查詢展開 100 筆訂單各自的使用者，天真的 resolver 會打 101 次 DB（N+1），要用 DataLoader 批次；客戶端能寫出深度巢狀的昂貴查詢，要限制深度與複雜度；所有請求都 POST 到同一個 URL，HTTP / CDN 快取幾乎失效。認證照樣用 header 或 cookie，與 REST 相同；GraphQL 走一般 HTTP（subscription 才用 WebSocket）；REST 與 GraphQL 可以並存、漸進遷移。',
      },
    ],
  },
]
