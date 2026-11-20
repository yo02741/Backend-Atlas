// 領域 5：資安（以 OWASP Top 10 為地圖） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d5-security.js
import m6 from './parts/d5-security-m6.js'
const base = {
  'owasp-top10': {
    points: [
      { b: 'A01 存取控制失效', t: '第一名。改網址的 id 就看到別人的訂單（IDOR）、一般使用者打 admin API。解法：每個資源操作都驗擁有權與角色。' },
      { b: 'A02 加密機制失效', t: '明文存密碼、用 MD5、HTTP 傳敏感資料、自己實作加密。解法：TLS、bcrypt/argon2、用成熟函式庫。' },
      { b: 'A03 注入', t: 'SQL / NoSQL / OS 命令 / LDAP 注入。解法：參數化查詢、ORM、輸入驗證、避免拼接 shell 命令。' },
      { b: 'A05 安全設定錯誤 & A06 過時元件', t: 'debug 模式開在正式環境、預設密碼、CORS `*`、依賴有已知漏洞沒更新。解法：設定檢查清單、依賴掃描。' },
      { b: 'A07 身分驗證失效 & A09 日誌監控不足', t: '沒限流的登入（暴力破解）、弱密碼政策、session 不過期；出事了沒有 log 可查。' },
      { b: 'A04 不安全設計、A08 完整性失效、A10 SSRF', t: '設計階段沒做威脅建模；未驗證的更新 / 反序列化；伺服器被誘導去請求內網位址（拿使用者給的 URL 去 fetch 時要白名單）。' },
      { b: '2021 版與 2025 版編號不同', t: '上面用的是 2021 版編號（多數文章仍用它）。2025 版重新排序：軟體供應鏈失效升到 A03、SSRF 併入 A01、新增 A10「例外狀況處理不當」。看到編號先確認是哪一版，觀念本身沒變。' },
    ],
    checklist: [
      '能不看清單說出至少 6 類並各舉一個例子',
      '能對自己負責的一個 API 用 Top 10 過一遍並列出風險',
    ],
    challenge: {
      task: '拿一個自己負責的 API（沒有的話用參考專案 `companion/clinic-api`），照本課「用它做程式碼審查清單」那張表挑出至少四類風險，每一類交一份開發者自己做得出來的修正證據：修正前成功、修正後被拒的請求，一個會失敗的測試，或一段設定的 diff。A01 至少要有一筆用兩個帳號互打的 `curl -i`。',
      deliver: '一張表：風險類別（寫明 2021 或 2025 版編號）、出問題的程式位置、修正證據（指令與狀態碼、測試名稱或 diff）',
      check: [
        '每一列的證據都能照著重跑：附上指令或測試名稱，不寫「已檢查」這類描述',
        'A01 那一列有用 B 帳號讀 A 帳號資源的請求，修正前 200、修正後 403 或 404',
        '每一列都寫明編號來自 2021 版還是 2025 版',
        '至少一列是「看過但不適用」，寫出不適用的理由',
      ],
      twist: '主管要求報告改用 2025 版編號，還說「2025 版沒有 SSRF 了，那一列刪掉」。先預測：表裡哪些列的編號會變、SSRF 那一列該刪還是併到哪一類、證據要不要重做。',
    },
    refs: [
      { label: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/' },
      { label: 'OWASP API Security Top 10', url: 'https://owasp.org/www-project-api-security/' },
      { label: 'OWASP Cheat Sheet Series', url: 'https://cheatsheetseries.owasp.org/' },
    ],
  },
  'injection': {
    map: {
      names: [
        { n: '參數化查詢', t: 'SQL 骨架與值分開送到資料庫，值永遠被當成值；psycopg 寫 `%s`、SQLAlchemy 的 `text()` 寫 `:name`、sqlite3 寫 `?`。' },
        { n: '識別字白名單', t: '表名、欄名、`ASC`／`DESC` 不能參數化；使用者傳選項名，程式查 dict 換成寫死的欄位名，查不到就拒絕。' },
        { n: 'ORM 的 raw SQL', t: '`text()`、`.raw()`、`extra()` 這類直接寫 SQL 的地方，裡面再用 f-string 一樣會被注入。' },
        { n: '運算子注入', t: 'MongoDB 的 filter 直接放使用者的 JSON，`{"$ne": null}` 就能繞過比對；要先把輸入驗成純值。' },
        { n: '命令注入與 `shell=True`', t: '`os.system`、`subprocess.run(..., shell=True)` 把整串交給 shell 解讀；改用陣列形式，參數直接成為 argv。' },
        { n: '最小權限的資料庫帳號', t: 'API 用的帳號只拿得到需要的表與動作；就算被注入，也刪不了表、讀不到別的 schema。' },
      ],
      ask: [
        '每個查詢的值都走 placeholder，以及哪幾個查詢有動態的表名、欄名或排序。',
        '排序欄位與方向允許哪些值，不在清單時回哪個狀態碼、錯誤 body 長什麼樣。',
        '搜尋輸入裡的 `%`、`_` 要當萬用字元還是字面值。',
        '呼叫外部指令時用陣列形式、不經 shell，檔名由伺服器產生。',
        'API 用的資料庫帳號有哪些權限。',
      ],
      prompt: '訂單搜尋 API `GET /orders?email=…&sort=created_at&dir=desc`，用 psycopg 3：`email` 走 `%s` 參數，不用 f-string、`%` 或 `.format()` 組 SQL。`sort` 只允許 `created_at`、`amount`，`dir` 只允許 `asc`、`desc`，用 dict 對照成寫死的 SQL 片段，不在清單就回 400 與 `{"error": "invalid_sort"}`。資料庫帳號 `shop_api` 只有 `orders` 的 SELECT。',
      verify: [
        { c: '拼接的痕跡', t: '`grep -rnE \'execute\\((f"|.*%|.*\\.format\\()\' .` 找出 `execute` 前格式化字串的地方；AI 產生的程式常在 `text(f"...")` 裡混用參數與 f-string。' },
        { c: '惡意輸入', t: '`curl -G --data-urlencode "email=x\' OR \'1\'=\'1" http://localhost:8000/orders` 應該回 0 筆；回出整張表代表輸入還在拼進 SQL。' },
        { c: '排序白名單', t: '`?sort=amount;DROP TABLE orders--` 要回 400；回 500 而且錯誤訊息帶著 SQL 片段，代表字串進了 SQL。' },
        { c: '資料庫實際收到什麼', t: 'PostgreSQL 開 `log_statement = \'all\'`：psycopg 3 預設在伺服器端綁定，log 裡是 `WHERE email = $1` 加一行 `DETAIL: parameters:`；psycopg2 在客戶端代入，log 會直接看到值，這時要看程式碼判斷。' },
        { c: '帳號權限', t: '用 API 的帳號 `psql -U shop_api -c \'DROP TABLE orders\'` 要失敗（`must be owner of table orders`）；成功代表 API 用的是擁有者或超級使用者。' },
      ],
    },
    points: [
      { b: '程式碼與資料的邊界', t: '`f"... WHERE name = \'{name}\'"` 讓輸入可以「關掉引號、寫自己的 SQL」。參數化把 SQL 與值分開送，資料庫永遠把值當值。' },
      { b: 'ORM 預設安全，但有逃生口', t: 'SQLAlchemy 的 `text()` 裡如果自己 f-string 一樣會中。動態的表名 / 欄名 / 排序欄位無法參數化，要用白名單對照。' },
      { b: 'NoSQL 也會被注入', t: 'MongoDB 的 filter 直接放使用者 JSON 會被 `{"$ne": null}` 繞過；輸入型別要驗證成純值。' },
      { b: 'OS 命令注入', t: '`os.system(f"convert {filename}")` 讓檔名變命令。用 `subprocess.run([...])` 陣列形式、不經 shell。' },
      { b: '最小權限的資料庫帳號', t: 'API 用的帳號不該能 DROP TABLE；就算被注入，損害也有上限。' },
    ],
    checklist: [
      '能示範一個 SQL 注入 payload 並用參數化修好',
      '能說出 ORM 什麼情況下仍然可能被注入',
      '知道 MongoDB 運算子注入怎麼發生、怎麼防',
    ],
    challenge: {
      task: '情境換成倉儲的庫存查詢 `GET /stock?name=…&sort=…`。在 [Playground](#/playground?lang=python) 用 `sqlite3` 建 `stock(sku, name, qty, warehouse)` 並放 6 筆虛構資料，其中兩筆的名稱帶單引號或 `%`（例如 `O\'Neil 托盤`、`100% 棉手套`）。先寫字串拼接的版本，再照本課改成參數化加排序白名單，用同一組正常輸入與惡意輸入跑兩個版本。',
      deliver: '一張對照表：每組輸入在兩個版本回傳的筆數與錯誤，加一段說明哪些正常輸入在拼接版本就已經出錯',
      check: [
        '帶單引號的正常名稱在參數化版本查得到，在拼接版本出現語法錯誤',
        '`x\' OR \'1\'=\'1` 在參數化版本回 0 筆，在拼接版本回出整張表',
        '不在白名單的 `sort` 值被拒絕，錯誤訊息不帶 SQL 片段',
        '列出從原案例沿用的規則（值走參數、識別字走白名單），以及要跟倉儲業務確認的事（料號要精確比對還是前綴、`%` 要不要當萬用字元）',
      ],
      twist: '業務要求名稱搜尋支援「包含」：輸入 `棉` 要找到 `100% 棉手套`。先預測：改成 `name LIKE \'%\' || ? || \'%\'` 之後，輸入 `%` 會回幾筆、這算不算注入、要怎麼處理。',
    },
    refs: [
      { label: 'OWASP：SQL Injection Prevention Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html' },
    ],
  },
  'password-storage': {
    points: [
      { b: '三個詞三件事', t: '編碼是換表示法（誰都能解）；雜湊是單向摘要（驗證用、不能還原）；加密是有金鑰的可逆轉換（傳輸與靜態資料用）。密碼要的是雜湊。' },
      { b: 'salt 讓相同密碼不同雜湊', t: '每個使用者一個隨機 salt 存在雜湊旁邊；彩虹表與「一次破全部」失效。' },
      { b: '雜湊要故意慢', t: '每次雜湊花幾十到幾百毫秒，攻擊者每秒只能試幾千次而不是幾十億次。work factor 隨硬體進步調高。' },
      { b: '用函式庫的 hash / verify', t: '`argon2-cffi`、`bcrypt`、Django / passlib 內建。它們處理 salt、格式、常數時間比對，你只呼叫兩個函式。' },
      { b: '為什麼不加密', t: '加密需要金鑰，金鑰放在伺服器上，外洩時金鑰跟著走，等於明文。而且驗證密碼不需要還原它。' },
    ],
    checklist: [
      '能解釋為什麼 SHA-256(password) 不夠、加了 salt 還是不夠',
      '能用 argon2 或 bcrypt 實作註冊與登入的雜湊與驗證',
      '能說出「密碼不加密」的理由',
    ],
    challenge: {
      task: '情境換成餐廳訂位系統：舊會員的密碼存成 `sha256(salt + password)`，要換成慢雜湊。在 Playground 開本課「登入時升級舊雜湊」那段，改成兩條路：舊格式的人登入成功時立刻重算並寫回新格式；一直沒登入的人，用包裝的方式把舊值放進 PBKDF2，讓資料庫裡不再留著快雜湊。瀏覽器裡把迭代次數調低（例如 5,000），註明正式環境要用的值。動手前先寫下預測：模擬跑完後各格式剩幾筆。',
      deliver: '程式的修改、跑完前後各格式的帳號數，以及一段說明 `verify` 怎麼認出包裝格式',
      check: [
        '舊格式的帳號登入成功後變成新格式，登入失敗的那筆不變',
        '包裝之後資料庫裡找不到任何一筆純 sha256 的值，原密碼仍然登入得了',
        '儲存的字串帶著演算法與參數，`verify` 依前綴分流',
        '說明哪些條件從原案例沿用（不還原密碼、只有登入時拿得到明文），哪些要跟訂位業務確認（多久沒登入要強制重設密碼、要不要通知會員）',
      ],
      twist: '資安要求把 PBKDF2 的迭代次數再加倍。先預測：已經升級過的帳號會不會再升一次、包裝過的帳號怎麼辦、訂位尖峰時登入端點的 CPU 會怎樣。',
    },
    refs: [
      { label: 'OWASP：Password Storage Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html' },
    ],
  },
  'crypto-toolbox': {
    points: [
      { b: '雜湊：單向、固定長度、驗完整性', t: 'SHA-256 給檔案校驗、ETag、內容定址；密碼要用慢雜湊（argon2 / bcrypt）不是 SHA。MD5 / SHA-1 已不安全，別用在安全用途。' },
      { b: 'HMAC：有金鑰的雜湊，驗來源', t: '雙方共享 secret，`HMAC(secret, message)` 證明「訊息來自持有 secret 的人且沒被改」。JWT HS256、webhook 簽章、簽名 cookie 都是它。比對一律用常數時間函式（`hmac.compare_digest`）。' },
      { b: '對稱加密：藏內容', t: 'AES-GCM 這類 AEAD 同時給機密性與完整性；nonce 絕不重複；金鑰不放程式碼（KMS / Secret Manager）。用在靜態資料欄位加密。' },
      { b: '非對稱：簽章與金鑰交換', t: '私鑰簽、公鑰驗（JWT RS256 / ES256、TLS 憑證）；多服務只需散布公鑰。TLS 握手用它交換對稱金鑰，之後走對稱。' },
      { b: '亂數要用 CSPRNG', t: 'token、session id、重設連結、salt 用 `secrets.token_urlsafe()` / `os.urandom()`；`random` 模組可預測，只能拿來洗牌遊戲。' },
    ],
    checklist: [
      '能為「webhook 驗證」「密碼儲存」「重設密碼連結」「加密身分證欄位」各挑對工具並說明理由',
      '能解釋為什麼比對簽章要用常數時間函式',
      '知道 HS256 與 RS256 在多服務架構下的差別',
    ],
    challenge: {
      task: '情境換成物流公司 `ship.example`，有五筆要保護的資料：(a) 合作商送來的出貨 webhook；(b) 收件人手機號碼，客服畫面要顯示、保存 2 年；(c) 司機 App 的登入密碼；(d) 簽收連結裡的一次性 token，24 小時內有效；(e) 每日對帳檔，保存 7 年，要能證明沒被改過。替每一筆選工具與參數，再到 [CryptoLab](#/lab/CryptoLab) 或本課的 WebCrypto 區塊，挑兩筆各做一次「竄改後驗證失敗」。',
      deliver: '一張表（資料、用途、保存期間、工具與參數、金鑰放哪、怎麼輪替），加上兩次竄改測試的輸出',
      check: [
        '五筆各選一種工具，沒有一把金鑰同時拿來做兩種用途',
        '(b) 用可以解密的 AEAD（例如 AES-GCM），寫出 nonce 怎麼產生，以及金鑰輪替後舊資料怎麼解',
        '(d) 用 CSPRNG 產生，伺服器只存雜湊與到期時間，不能從收件人資料推算出來',
        '列出哪些判斷從原案例沿用（依用途選工具），哪些要跟物流業務確認（誰能看到手機號碼、7 年後由誰驗證對帳檔）',
      ],
      twist: '合作商要求「我們能自己驗證對帳檔是你們出的，但不能自己產生一份」。先預測：(e) 的工具要不要換、能不能直接把 HMAC 的 secret 給對方。',
    },
    refs: [
      { label: 'Python secrets 模組', url: 'https://docs.python.org/3/library/secrets.html' },
      { label: 'OWASP：Cryptographic Storage Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html' },
    ],
  },
  'xss-csrf': {
    points: [
      { b: 'XSS 的後端責任', t: 'API 回 JSON 時 `Content-Type: application/json`（別讓瀏覽器當 HTML 渲染）；伺服器端渲染的模板預設要跳脫；使用者上傳的 HTML 要用白名單清洗。' },
      { b: 'CSP 是最後一道', t: '`Content-Security-Policy: default-src \'self\'` 讓注入的 inline script 跑不起來。從 report-only 模式開始調。' },
      { b: 'CSRF：瀏覽器自動帶 cookie 的副作用', t: '惡意網站的表單能讓使用者的瀏覽器帶著你的 cookie 送 POST。`SameSite=Lax` 擋掉大多數；狀態改變操作用 POST 不用 GET；表單型網站加 CSRF token。' },
      { b: '安全標頭基本盤', t: '`Strict-Transport-Security`、`X-Content-Type-Options: nosniff`、`X-Frame-Options` / `frame-ancestors`、`Referrer-Policy`。在 nginx 或 middleware 一次加。' },
      { b: 'Bearer token 不會被 CSRF', t: 'Authorization 標頭不會被瀏覽器自動帶，所以純 token API 不受 CSRF 影響，但要防 XSS 偷 token。' },
    ],
    checklist: [
      '能說出 cookie session 與 Bearer token 各要防 CSRF 還是 XSS、為什麼',
      '能為自己的服務加上五個安全標頭並用瀏覽器 devtools 驗證',
    ],
    challenge: {
      task: '在 [XssCsrfLab](#/lab/XssCsrfLab) 對儲存型 XSS 與跨站表單 CSRF 各跑一輪，每次只開一道防線（輸出跳脫、CSP、HttpOnly、SameSite、CSRF token），記下攻擊成不成功。再對一個自己能控制的網站或本機服務，找出每道防線各要在哪裡驗收：哪些用 `curl -i` 就看得到，哪些一定要開瀏覽器。',
      deliver: '一張矩陣：五道防線 × 兩種攻擊（擋下或沒擋），加一欄「在哪裡驗收」（`curl -i` 的哪個標頭、Application 分頁的 cookie 屬性、Console 的 CSP 違規訊息、伺服器回的 403）',
      check: [
        '每一格的結果都和實驗室實際跑出來的一致',
        '指出 HttpOnly 擋不了 CSRF、SameSite 擋不了 XSS',
        '「在哪裡驗收」分清楚伺服器端看得到的（標頭、狀態碼）與只有瀏覽器看得到的（CSP 有沒有擋下 inline script、cookie 有沒有跨站送出）',
      ],
      twist: '前端改成把 Bearer token 放在 localStorage，cookie 不再帶身分。先預測：矩陣裡哪幾格會變、哪道防線變得沒有作用、哪道變得更重要。',
    },
    refs: [
      { label: 'OWASP：CSRF Prevention Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html' },
      { label: 'MDN：Content Security Policy', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP' },
    ],
  },
  'input-validation': {
    points: [
      { b: '在邊界一次驗完', t: '請求進來就轉成型別明確的 model；之後的程式碼相信這個 model。內部函式不重複驗。' },
      { b: '白名單優於黑名單', t: '狀態只能是三個值之一、排序欄位只能是明列的幾個、上傳只接受特定副檔名與 MIME。列出允許的，其他全拒。' },
      { b: '長度與數量上限', t: '字串長度、陣列元素數、分頁 limit 上限、request body 大小（nginx `client_max_body_size`）。沒設上限的地方都能拿來做 DoS。' },
      { b: '檔案上傳', t: '檢查 MIME 與 magic bytes 而非副檔名、重新命名成隨機檔名、存到物件儲存不存在 web root、圖片重新編碼（去除惡意內容）、掃毒視需求。' },
      { b: '別信 Content-Length 與客戶端算的值', t: '總金額由伺服器算、折扣由伺服器查，前端傳來的價格只是參考。' },
    ],
    checklist: [
      '能為一個「建立訂單」API 列出每個欄位的驗證規則',
      '能設計安全的檔案上傳流程',
    ],
    challenge: {
      task: '情境換成票務網站 `tickets.example` 的活動海報上傳：只收 png、jpg、webp，5 MB 以內。照本課的上傳程式補上 webp 的 `sniff` 與大小檢查，再替每一種拒絕原因設計 API 回應：狀態碼、錯誤代碼、給使用者看的一句話、使用者下一步能做什麼。用五個檔案測：正常的 png、改了副檔名的 pdf、6 MB 的 jpg、空檔案、檔名是 `../../poster.png` 的 png。',
      deliver: '五個檔案各自的 API 回應（狀態碼與 body），以及使用者會看到的訊息草稿',
      check: [
        '五個檔案都得到預期的結果，正常的 png 以隨機檔名存在 web root 之外',
        '每種拒絕各有自己的錯誤代碼（例如 `unsupported_type`、`too_large`），訊息說出限制與下一步，不帶伺服器路徑',
        '說明選 413、415 或 422 的理由，以及 nginx 的 `client_max_body_size` 先擋下時使用者會看到什麼',
        '列出從原案例沿用的驗證（magic bytes、隨機命名、存在 web root 之外），以及要跟票務業務確認的事（海報尺寸、能不能重傳覆蓋、主辦單位上傳後誰審核）',
      ],
      twist: '業務改成「超過 5 MB 時自動壓縮，不要拒絕」。先預測：哪個驗證點要搬位置、413 還會不會出現、壓縮前要不要先檢查 magic bytes。',
    },
    refs: [
      { label: 'OWASP：Input Validation Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html' },
    ],
  },
  'secrets': {
    points: [
      { b: '.env 只在本機', t: '`.env` 進 `.gitignore`，repo 放 `.env.example`（只有 key 沒有值）。pre-commit 加 secret 掃描（gitleaks）。' },
      { b: 'CI/CD 的 secrets 功能', t: 'GitHub Actions secrets / GitLab CI/CD variables（masked + protected）。log 會自動遮罩，但別自己 echo 出來。' },
      { b: 'Docker image 裡不能有 secret', t: '`COPY .env` 或 build arg 傳 secret 都會留在層裡。build 時需要（例如私有套件庫）用 BuildKit 的 `RUN --mount=type=secret,id=…`，不進任何層；runtime 用環境變數或 secret mount。' },
      { b: '輪替要能做', t: '任何 secret 都假設會外洩：能不停機換、知道誰在用、有到期日。簽 JWT 的 key 也要能換（kid 標頭）。' },
      { b: '外洩了怎麼辦', t: '立刻撤銷與輪替、查 log 看有沒有被用、從 git 歷史清掉只是順便（已經被爬走了）。' },
    ],
    checklist: [
      'repo 裡沒有任何 secret，且有自動掃描',
      '能說出 secret 在本機、CI、正式環境各放哪裡',
      '知道外洩後的處理順序',
    ],
    challenge: {
      task: '情境換成物流平台：`dispatch-api`、`tracking-worker` 與夜間對帳批次共用一組資料庫帳密，要在不停機的情況下輪替。在本機的 PostgreSQL（例如參考專案 compose 裡那一個）建 `dispatch_v1`、`dispatch_v2` 兩個角色模擬：建好新角色、逐一把服務切過去、確認、最後 `ALTER ROLE dispatch_v1 NOLOGIN`。故意讓批次最後才換。每一步動手前寫下：這時誰用舊的、誰用新的，撤銷後誰會失敗。',
      deliver: '一張時間線（步驟 × 三個服務當下用的角色），加上撤銷舊角色後實際看到的錯誤訊息',
      check: [
        '撤銷之前附上 `SELECT usename, application_name FROM pg_stat_activity` 的結果，證明誰已經換到新角色',
        '故意晚換的批次在撤銷後新連線失敗，錯誤是 `role "dispatch_v1" is not permitted to log in`',
        '說明已經建立的連線在撤銷後還能不能用，連線池要怎麼處理',
        '列出從原案例沿用的條件（秘密不進 repo、能不停機換），以及要跟物流業務確認的事（批次能不能延後、要不要通知外部合作商）',
      ],
      twist: '改用秘密管理服務的自動輪替：每 30 天直接改同一個帳號的密碼，舊密碼立刻失效。先預測：時間線少了哪一步、連線池裡的既有連線會怎樣、批次會在什麼時候出錯。',
    },
    refs: [
      { label: 'OWASP：Secrets Management Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html' },
    ],
  },
  'logs-pii': {
    points: [
      { b: '常見的外洩點', t: '整包記下的請求 body、URL 的 query string（`?token=…`）、`Authorization` 與 `Cookie` 標頭、例外訊息裡的輸入值、ORM 印出的 SQL 參數。這些經常不是誰刻意寫的，是框架或預設設定帶進來的。' },
      { b: '白名單優於黑名單', t: '結構化日誌只輸出明列的欄位（method、path、status、duration、request_id）；黑名單式遮罩（看到 password 就遮）永遠漏新欄位。白名單之外，再加一層 pattern 遮罩當保險（身分證字號、email、Bearer token）。' },
      { b: '遮罩要在寫出之前', t: '在 logging Filter / processor 裡處理，日誌一離開程式就會被複製到收集器、搜尋引擎、備份，事後刪不乾淨。' },
      { b: '稽核紀錄是另一種東西', t: '稽核紀錄回答「誰、何時、對哪筆資料、做了什麼、結果如何」，要完整、不可竄改、保存較久、存取受限；一般日誌是除錯用，可以抽樣、可以較短保存。兩者分開存、分開授權。' },
      { b: '保存期限與假名化', t: '依個資法與主管機關規範訂保存期限並自動刪除；需要追蹤同一人的行為時，用帶金鑰的 HMAC 產生假名 id，而不是記 email 或身分證字號。假名化資料仍屬個資，只是降低風險。' },
    ],
    checklist: [
      '能列出自己服務的日誌裡可能出現個資或 token 的五個位置',
      '能寫一個 logging Filter 遮罩 email、身分證字號與 Bearer token',
      '能說明稽核紀錄與一般日誌在內容、保存與權限上的差別',
    ],
    challenge: {
      task: '情境換成訂位平台 `booking.example`：會員客訴「我 11 月 3 日晚上的訂位被別人取消了」。照本課的 Filter 與結構化日誌那兩段，產生 20 筆虛構日誌（含 email、手機、Bearer token、訂位編號），遮罩與假名化之後，只用處理過的日誌與稽核紀錄回答：哪個帳號、哪個 request_id、什麼時間取消的。',
      deliver: '遮罩後的日誌片段、查詢的步驟（用哪些欄位串起來），以及答不出來的部分',
      check: [
        '用 `grep` 證明處理後的日誌裡找不到 email、手機與 token 的原文',
        '只靠假名 id、request_id 與訂位編號串得出取消的人與時間',
        '指出哪一個欄位遮掉之後就查不下去，以及它該放在稽核紀錄還是一般日誌',
        '列出從原案例沿用的規則（白名單、寫出前遮罩、稽核紀錄另外存），以及要跟訂位業務確認的事（客服能不能看到假名對應的會員、日誌保存多久）',
      ],
      twist: '法務訂了保存期限：一般日誌 30 天、稽核紀錄 1 年，客訴在 45 天後才進來，中間假名化的金鑰換過一次。先預測：還查得出來嗎、靠的是哪一份紀錄、換金鑰前後的假名接不接得起來。',
    },
    refs: [
      { label: 'OWASP：Logging Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html' },
      { label: 'Python：logging', url: 'https://docs.python.org/3/library/logging.html' },
      { label: 'Python：Logging Cookbook', url: 'https://docs.python.org/3/howto/logging-cookbook.html' },
    ],
  },
  'supply-chain': {
    points: [
      { b: 'lock 檔固定版本與 hash', t: '沒有 lock，今天跟明天裝到的東西不同；有 hash 才能確定沒被掉包。' },
      { b: '定期掃描依賴', t: '`pip-audit` / `uv` 生態的漏洞掃描、GitHub Dependabot 自動開 PR。放進 CI 每週跑。' },
      { b: 'image 也要掃', t: 'base image 的系統套件有漏洞很常見。用 slim / distroless base、定期重 build、Trivy 掃描。' },
      { b: '別裝來路不明的套件', t: 'typosquatting（名字差一個字母的仿冒套件）是實際發生過的攻擊；新依賴看一下下載量、維護狀態、原始碼。' },
      { b: 'CI 的 action 也是依賴', t: 'GitHub Actions 的第三方 action 釘 commit SHA 而非 tag；最小權限的 `permissions:`。' },
    ],
    checklist: [
      '專案有 lock 檔且 CI 用 frozen 安裝',
      'CI 有依賴與 image 漏洞掃描',
    ],
    challenge: {
      task: '先在 [SupplyChainLab](#/lab/SupplyChainLab) 跑「漏洞」那個情境。再拿一個自己的專案，挑一筆 `pip-audit` 或 `npm audit` 報出、上游已經發布修補版的依賴，開一個只升這一個套件的分支，用審別人 PR 的標準審自己的變更：lock 檔裡除了它還動了哪些套件、修補版的 changelog 有沒有行為改變、測試結果如何。',
      deliver: '一段 PR 描述：漏洞編號與受影響的版本範圍、lock 檔差異的摘要（升了哪些、為什麼連帶升）、測試結果、合併與否的判斷',
      check: [
        'lock 檔的每一項差異都有解釋，沒有說不出為什麼會變的套件',
        '附上升級後重跑掃描的結果，那一筆消失',
        '判斷的理由提到專案有沒有用到受影響的函式或設定，不是只看嚴重度',
        '說明 CI 用 `--locked` 或 `npm ci` 安裝時，合併後其他人裝到的是不是同一份',
      ],
      twist: '修補版順便把一個間接依賴升了一個大版本，測試全過。先預測你會直接合併、拆成兩個 PR，還是先釘住那個間接依賴，理由是什麼。',
    },
    refs: [],
  },
}

// 後續新增的課，內文放在 parts/ 底下，這裡合併
export default { ...base, ...m6 }
