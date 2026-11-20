// 領域 4：驗證與授權（AuthN & AuthZ） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d4-auth.js
import m6 from './parts/d4-auth-m6.js'
const base = {
  'authn-basics': {
    map: {
      names: [
        { n: 'session', t: '伺服器端存一筆登入紀錄（Redis 或資料表），客戶端只拿一個隨機的 session id；刪掉紀錄就立即失效。' },
        { n: 'cookie 屬性', t: '`HttpOnly`（JS 讀不到）、`Secure`（只走 HTTPS）、`SameSite`（跨站請求帶不帶）、`Path`、`Max-Age`。' },
        { n: 'Bearer token', t: '客戶端在 `Authorization: Bearer <token>` 帶憑證；token 可以是隨機字串（要查表）或 JWT（驗簽章不查表）。' },
        { n: '撤銷', t: '讓已發出的憑證失效。session 刪紀錄即可；無狀態 token 只能等 `exp`，或加撤銷清單（又變回查表）。' },
        { n: 'CSRF', t: '瀏覽器會自動帶 cookie，別的網站可以借用使用者的登入送請求；用 `SameSite` 與 CSRF token 擋。' },
        { n: 'XSS 偷憑證', t: '存在 `localStorage` 的 token，任何注入的腳本都讀得到；HttpOnly cookie 讀不到，但仍能被拿來發請求。' },
        { n: 'session 固定攻擊', t: '登入前後沿用同一個 session id，攻擊者先種好 id 就能等著接手；登入成功時換發新的 id。' },
      ],
      ask: [
        '憑證放哪裡：HttpOnly cookie 或 `Authorization` 標頭，以及 cookie 的 `Secure`、`SameSite`、`Max-Age`。',
        'session 或 token 的效期，閒置多久要重新登入。',
        '登出、改密碼、停用帳號時要多快失效，「登出所有裝置」怎麼做。',
        '有幾台伺服器、session 存在哪個共用儲存（Redis、資料表）。',
        '用 cookie 時的 CSRF 防護，以及登入後換發 session id。',
      ],
      prompt: '門診系統的網頁版用伺服器端 session：登入成功後換發新的 session id（`secrets.token_urlsafe(32)`），紀錄存在 Redis，閒置 30 分鐘或登入滿 12 小時失效。cookie 名稱 `sid`，設 `HttpOnly; Secure; SameSite=Lax; Path=/`。登出刪掉這一筆；改密碼與「登出所有裝置」刪掉這位使用者的所有 session。會改資料的請求另外檢查 CSRF token。',
      verify: [
        { c: 'cookie 屬性', t: '用 `curl -i` 打登入 API，看 `Set-Cookie` 有沒有 `HttpOnly`、`Secure`、`SameSite`；瀏覽器 DevTools 的 Application 分頁也看得到。缺 `HttpOnly` 時，Console 執行 `document.cookie` 會印出 sid。' },
        { c: '登出', t: '登出之後拿舊的 sid 再打一次需要登入的 API，要回 `401`；還是 `200` 代表只清了前端的 cookie，伺服器的紀錄沒刪。' },
        { c: '登出所有裝置', t: '用兩個瀏覽器（或兩組 `curl -b`）登入，改密碼後兩邊的舊 sid 都要回 `401`。' },
        { c: '換發 session id', t: '記下登入前拿到的 sid，登入後再看一次，兩個值要不同；相同代表有 session 固定攻擊的風險。' },
        { c: '存放位置', t: '搜尋前端程式的 `localStorage.setItem`；把長效 token 或 refresh token 放在那裡，任何 XSS 都拿得走。' },
      ],
    },
    challenge: {
      task: '改本課「查表 vs 驗簽章」那段 Python：alice 在「手機」與「網咖」各登入一次，兩邊都拿到 session id 與 token。依序做四件事：(1) 網咖那台按登出；(2) 一小時後手機繼續用；(3) alice 改密碼並「登出所有裝置」；(4) 關掉網咖的分頁再打開，瀏覽器帶著同一份 cookie 或 token 回來。每一步之後，先預測兩台裝置的 session 版與 token 版各會不會通過，再執行。',
      deliver: '一張「步驟 × 裝置 × session 版／token 版」的預測與實際對照表，加上 token 版在「登出所有裝置」之後還能用多久。',
      check: [
        '預測寫在執行之前',
        '單一裝置登出時，session 版只刪那一筆；token 版要說明伺服器沒有東西可刪，只能靠前端丟掉 token',
        '登出所有裝置之後，token 版到 `exp` 之前都還通過，並寫出縮短空窗的做法與代價（短效期、撤銷清單）',
        '重開分頁那一步說明 cookie 有沒有 Max-Age 或 Expires 的差別',
      ],
      twist: '把 token 的 `ttl` 改成 15 分鐘，另外加一個存在伺服器、可以撤銷的 refresh token。先預測「登出所有裝置」之後兩台裝置最晚多久失效、伺服器要多存什麼，再修改程式驗證。',
    },
    points: [
      { b: 'Session：伺服器記、客戶端拿號碼牌', t: '登入後伺服器在 Redis / DB 存一筆 session，把 session id 種進 HttpOnly cookie。每次請求靠 id 查回使用者。可即時撤銷，但要有共用儲存。' },
      { b: 'Token：客戶端帶證明', t: '登入後發一個 token（隨機字串或 JWT），客戶端放 `Authorization: Bearer`。伺服器驗證即可，不需查表（JWT）或查一次（opaque token）。' },
      { b: '撤銷是核心差異', t: 'session 刪掉就失效；無狀態 JWT 發出去就收不回，只能靠短效期 + refresh token 或黑名單。' },
      { b: 'Cookie 與 Bearer 的攻擊面不同', t: 'cookie 自動帶 → 要防 CSRF（SameSite）；Bearer 存在 JS 可讀處 → 要防 XSS 偷走。沒有絕對安全的地方，只有對應的防護。' },
      { b: '單一伺服器用 session、跨服務用 token', t: '一台 API + 一個前端，session 最簡單安全；多個服務、行動 App、第三方要呼叫時 token 比較方便。' },
    ],
    checklist: [
      '能畫出 session 與 token 兩種登入流程的時序圖',
      '能說出各自怎麼撤銷、各自要防什麼攻擊',
      '能為自己的專案選一種並說明理由',
    ],
    refs: [
      { label: 'OWASP：Session Management Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html' },
    ],
  },
  'jwt': {
    map: {
      names: [
        { n: 'header、payload、signature', t: '用 `.` 分開的三段，前兩段是 Base64URL 編碼的 JSON。Base64URL 不是加密，拿到 token 的人都讀得到 payload，簽章只保證內容沒被改過。' },
        { n: '標準聲明', t: '`sub`（使用者）、`iss`（發行者）、`aud`（給哪個服務用）、`exp`／`nbf`／`iat`（時間）、`jti`（token 的 id）；驗證時 `exp`、`iss`、`aud` 都要檢查。' },
        { n: 'HS256 與 RS256／ES256', t: 'HS256 用同一把 secret 簽與驗，能驗的人就能簽；RS256、ES256 私鑰簽、公鑰驗，多個服務驗同一種 token 時用它們。' },
        { n: '允許的演算法', t: '驗證時由伺服器指定接受哪個 `alg`，不照 header 寫的做；`alg: none` 與把 RS256 換成 HS256 的混淆攻擊都靠這一步擋下。' },
        { n: '`kid` 與 JWKS', t: '`kid` 指出用哪一把金鑰驗，公鑰以 JWK Set 公布在一個網址；輪替時先讓驗證端認得新金鑰，再開始用它簽。' },
        { n: 'access token 與 refresh token', t: 'access token 短效（5～15 分鐘），每個請求帶著；refresh token 效期較長、放 HttpOnly cookie，伺服器端有紀錄可撤銷，每用一次換一張新的（rotation）。' },
        { n: '撤銷', t: 'JWT 發出去收不回，只能靠短效期、`jti` 撤銷清單、使用者層級的 `tokens_valid_after`，或改用 opaque token 查狀態；停用帳號要多快生效決定選哪一種。' },
        { n: 'leeway', t: '時間檢查容許的時鐘誤差，常見 30～60 秒；設成幾小時等於沒有到期檢查。' },
      ],
      ask: [
        '誰簽發、誰驗證：一個服務自己簽自己驗用 HS256；授權伺服器簽、多個服務驗用 RS256 或 ES256。',
        'payload 放哪些聲明：`sub`、`role`、`exp` 可以，密碼、身分證號、病歷內容不放。',
        'access token 與 refresh token 各自的效期與存放位置（記憶體、HttpOnly cookie）。',
        '驗證要檢查的項目：允許的 `alg`、`iss` 與 `aud` 的值、時鐘誤差、必須存在的聲明。',
        '撤銷要多快生效（例如停用帳號 10 分鐘內），用哪種方式做到。',
        '金鑰怎麼輪替：`kid` 怎麼命名、新舊金鑰並存多久。',
      ],
      prompt: '門診系統的 API（`aud` 是 `https://api.clinic.example`）要驗證授權伺服器 `https://auth.clinic.example` 簽發的 access token。只接受 `ES256`，依 header 的 `kid` 在快取的 JWKS 裡找公鑰，遇到不認得的 `kid` 才重抓一次並限流；簽章通過後檢查 `exp`、`nbf`（leeway 30 秒）、`iss`、`aud`，缺 `exp` 或 `sub` 一律拒絕，任何一項失敗回 `401`。payload 只放 `sub` 與 `role`，不放病歷號或身分證號。access token 效期 10 分鐘；停用帳號時撤銷伺服器端的 refresh token，最晚 10 分鐘後失效，不另做撤銷清單。',
      verify: [
        { c: '竄改', t: '把 payload 的 `role` 改成 `admin`、重新 Base64URL 編碼後換掉中間那段送出，要回 `401`；通過代表沒驗簽章，或先讀 payload 才驗。' },
        { c: '`alg: none`', t: '送一張 header 是 `{"alg":"none"}`、第三段空白的 token，要被拒絕；程式的 decode 呼叫要寫死允許的演算法（PyJWT 的 `algorithms=[...]`）。' },
        { c: '`aud` 與 `iss`', t: '拿發給別的服務的 token（`aud` 不同）打你的 API，要回 `401`；PyJWT 沒傳 `issuer` 時不檢查 `iss`，讀程式確認有傳。' },
        { c: '關掉檢查的選項', t: '搜尋 `verify_signature`、`verify_aud` 被設成 `False` 的地方；這類選項常是為了讓測試先通過而加上的，出現在授權判斷前面，代表 token 沒有被完整驗證。' },
        { c: '過期與時鐘', t: '用 `exp` 已過的 token 打 API 要回 `401`；大量出現 `ExpiredSignatureError` 或 `ImmatureSignatureError` 時，先查伺服器時鐘（NTP）與 leeway。' },
        { c: 'payload 內容', t: '把開發環境 token 的中間那段做 Base64URL 解碼，確認沒有個資、列出缺了哪些聲明；不要把正式環境的 token 貼到第三方網站。' },
      ],
    },
    challenge: {
      task: '改本課 `js run` 範例的輸出：對五個案例各印兩欄。第一欄「解碼看得到什麼」：不驗證，直接把 header 與 payload 解出來。第二欄「驗證後可以信任什麼」：依序列出 alg、kid、簽章、exp、iss、aud 每一項的結果，第一個失敗的項目之後寫「未檢查」。改程式之前，先在表上預測每個案例的第二欄。',
      deliver: '五個案例的兩欄對照表（預測與實際），加上第二欄每一項由 `verify` 的哪一行判定。',
      check: [
        '第一欄五個案例都讀得到 payload，包括 `role: admin` 那兩張，並寫明讀得到不代表可信',
        '第二欄只有正常的 token 全部通過，其他四張各指出第一個失敗的項目',
        '`alg: none` 那張說明是伺服器的允許清單擋下的，不是因為簽章欄位空白',
        '程式裡沒有任何地方在驗證之前就拿 payload 做授權判斷',
      ],
      twist: '授權伺服器開始輪替金鑰，新 token 的 header 帶著沒看過的 `kid`。先預測你的 `verify` 會回什麼、該不該立刻重抓 JWKS、怎麼避免攻擊者送一堆亂編的 `kid` 讓你一直重抓，再對照本課「金鑰輪替與 `kid`」那一段。',
    },
    points: [
      { b: 'base64url 不是加密', t: 'payload 任何人解開都能讀。放 user id、role、exp 可以；密碼、個資、信用卡不行。' },
      { b: '簽章保證完整性', t: 'HS256 用共享 secret（單一服務）、RS256 / ES256 用私鑰簽、公鑰驗（多服務只需公鑰）。改一個字元簽章就不符。' },
      { b: '標準欄位', t: '`sub`（主體）、`iss`（發行者）、`aud`（受眾）、`exp` / `iat` / `nbf`（時間）。驗證時 exp、iss、aud 都要檢查，不只簽章。' },
      { b: 'access 短、refresh 長', t: 'access token 15 分鐘內、放記憶體或 Bearer；refresh token 幾天、放 HttpOnly cookie、用一次換一次（rotation），被盜用可偵測。' },
      { b: 'alg 由伺服器決定', t: '驗證時指定允許的演算法，不要信 header 裡的 `alg`。`none` 與 HS/RS 混淆攻擊都利用這個欄位。' },
    ],
    checklist: [
      '能手動解開一個 JWT 並指出三段各是什麼',
      '能說明為什麼 JWT 不能即時撤銷，以及實務上怎麼補',
      '能列出驗證 JWT 時要檢查的五件事',
    ],
    refs: [
      { label: 'RFC 7519：JSON Web Token', url: 'https://datatracker.ietf.org/doc/html/rfc7519' },
      { label: 'jwt.io', url: 'https://jwt.io/' },
    ],
  },
  'oauth-oidc': {
    challenge: {
      task: '開 [OAuth 授權碼流程](#/lab/OAuthLab) 實驗室並打開 PKCE，**從最後一步往回走到第一步**。每一步填一列：瀏覽器、你的後端、授權伺服器、資源伺服器四個角色手上各有哪些值（state、code_verifier、code_challenge、code、access token、ID token、refresh token、session cookie），並標出哪些值出現在網址列。',
      deliver: '一張「步驟 × 四個角色」的表，每格列出持有的值，網址列出現過的值另外標記。',
      check: [
        'code_verifier 只在發起授權的那一端，到換 token 那一步才送給授權伺服器',
        'access token 與 refresh token 從來不出現在網址列；機密型 client 時瀏覽器最後只拿到自己系統的 session cookie',
        'ID token 標出由誰驗證，以及要檢查 `aud` 等於 client_id、`nonce` 與發起時相同',
        'state 標出在哪一步產生、在哪一步比對',
      ],
      twist: '改成沒有後端的 SPA（公開型 client）。先預測表上哪幾格會改變、哪些值改由瀏覽器持有、多出什麼風險，再對照本課與 [Device Code 與 PKCE](#/skill/oauth-device-pkce)。',
    },
    points: [
      { b: '四個角色', t: 'Resource Owner（使用者）、Client（你的 App）、Authorization Server（Google 的登入）、Resource Server（Google 的 API）。OAuth 解決的是「使用者授權 Client 存取 Resource Server」。' },
      { b: '授權碼流程：拿 code 換 token', t: '導回時網址列只出現短命的 code，token 由 client 拿 code 向授權伺服器換：機密型 client（有後端）在後端帶 client_secret 換；公開型 client（SPA、手機）在自己這端帶 PKCE verifier 換。token 從不出現在網址列。' },
      { b: 'PKCE 給公開型 client', t: 'SPA 與手機 App 藏不住 secret，用 code_verifier / code_challenge 證明「換 token 的人就是發起請求的人」。現在所有 client 都建議用。' },
      { b: 'state 防 CSRF', t: '導向前產生隨機 state 存起來，回來時比對。少了它攻擊者能把自己的 code 塞給你。' },
      { b: 'OIDC = OAuth + 身分', t: 'OAuth 只說「可以存取」，OIDC 多回一個 id_token（JWT）告訴你「這個人是誰」。「用 Google 登入」用的是 OIDC。' },
    ],
    checklist: [
      '能畫出授權碼流程 8 步並標出哪一步在瀏覽器、哪一步在後端',
      '能解釋 PKCE 與 state 各防什麼',
      '能說出 OAuth 與 OIDC 的差別、access_token 與 id_token 的差別',
    ],
    refs: [
      { label: 'RFC 6749：OAuth 2.0', url: 'https://datatracker.ietf.org/doc/html/rfc6749' },
      { label: 'RFC 7636：PKCE', url: 'https://datatracker.ietf.org/doc/html/rfc7636' },
      { label: 'OpenID Connect Core', url: 'https://openid.net/specs/openid-connect-core-1_0.html' },
    ],
  },
  'rbac-abac': {
    map: {
      names: [
        { n: 'RBAC', t: '使用者 → 角色 → 權限；權限綁在角色上，新人指派角色即可。回答不了「這份是不是你的」。' },
        { n: 'ABAC', t: '政策看使用者、資源、環境的屬性（部門、擁有者、狀態、時間）決定允許或拒絕。' },
        { n: '擁有權檢查', t: '資源層的規則：只能改自己建立的草稿。和角色無關，要拿到資源之後才判斷得了。' },
        { n: 'IDOR', t: '改網址裡的 id 就讀到別人的資料，原因是只檢查了「能不能讀這類資料」，沒檢查「是不是這一筆」。' },
        { n: '預設拒絕、拒絕優先', t: '沒有規則明確允許就拒絕；允許與拒絕同時成立時拒絕勝出。' },
        { n: '租戶隔離', t: '多租戶系統裡，跨租戶的存取一律拒絕，而且回 404，和資源不存在時一樣。' },
        { n: '政策引擎', t: '決策函式收主體、動作、資源、環境，回傳允許或拒絕與理由；OPA、Casbin 是現成的實作。' },
      ],
      ask: [
        '有哪些角色、每個角色能做哪些動作（角色與權限矩陣）。',
        '哪些規則要看資源本身：擁有者、狀態（草稿或已送出）、所屬租戶或部門。',
        '沒權限時回 403 還是 404：別人的、別的租戶的資源通常回 404。',
        '檢查放在哪一層：每一條進入路徑（API、背景工作、管理工具）都經過的服務層。',
        '規則衝突時誰勝出，以及決策理由要不要寫進 log。',
      ],
      prompt: '門診系統的病歷摘要 API：角色有 `doctor`、`nurse`、`clerk`。doctor 可以讀與修改自己科別的摘要，nurse 只能讀自己病房的病人，clerk 不能讀摘要。已簽署的摘要誰都不能改。跨醫院（租戶）的請求一律回 404，其他拒絕回 403。檢查寫在 service 層的 `authorize(user, action, record)`，預設拒絕、拒絕優先，每次決策把理由寫進 log。',
      verify: [
        { c: '換 id', t: '用 nurse 的 token 打 `curl -i /api/summaries/<別病房的 id>`，要回 `403` 或 `404`；回 `200` 就是 IDOR。' },
        { c: '跨租戶', t: '用另一家醫院的帳號讀同一個 id，回應要和讀一個不存在的 id 完全一樣（狀態碼與 body）。' },
        { c: '每條路徑', t: '列出所有會修改摘要的地方（API、批次匯入、管理後台），確認都呼叫同一個 `authorize`；只在 router 或前端擋的路徑，換個入口就繞過了。' },
        { c: '矩陣測試', t: '每個角色對每個動作與資源狀態各一個測試；AI 產生的程式常只測「有權限會成功」，缺了「沒權限會被拒」那一半。' },
        { c: '決策紀錄', t: '拒絕時 log 裡要看得到使用者、動作、資源 id 與是哪一條規則；只寫 `forbidden` 的話，事後查不出原因。' },
      ],
    },
    challenge: {
      task: '在本課「一個小型政策引擎」那段 Python 加一位 `carol = User("carol", "acme", {"accountant"})`，再加兩張發票：carol 建立的草稿，以及另一個租戶 globex 的草稿。讓 alice 與 carol（同樣是 accountant）對四張發票（alice 的草稿、carol 的草稿、alice 已寄出的發票、globex 的草稿）各做 read 與 update。執行前先填好預期的允許或拒絕。',
      deliver: '16 格的預期與實際對照表，與預期不同的格子寫出是哪一條規則決定的。',
      check: [
        '預期寫在執行之前',
        '同一個角色、不同建立者時結果不同，並說出決定的是資源層的擁有權規則，不是 RBAC 的角色',
        '跨租戶的請求全部拒絕，並指出是哪一條規則',
        '把 `decide` 改成允許優先之後，指出哪幾格變成越權或租戶外洩',
      ],
      twist: '換成共享辦公室的會議室訂位：「成員」只能取消自己的訂位，「樓層管理員」可以取消自己樓層的任何訂位。先預測要加的是角色、屬性規則還是關係，用同一個引擎寫出規則，再說出哪些規則可以沿用（預設拒絕、拒絕優先、跨租戶一律拒絕），哪些要跟業務確認（能不能代訂、離職員工的預約怎麼處理）。',
    },
    points: [
      { b: 'RBAC：使用者 → 角色 → 權限', t: '權限綁在角色上、角色指派給使用者。新人來指派角色即可。缺點：需求細到「只能改自己的」時角色會爆炸。' },
      { b: 'ABAC：政策看屬性', t: '規則像「部門相同且工作時間內可讀」，屬性來自使用者、資源、環境。彈性高，但規則多了難以回答「誰能看這份文件」。' },
      { b: '實務混搭', t: '角色決定大方向（admin / member），資源層再加擁有權與狀態檢查（只能編輯自己的草稿）。' },
      { b: '授權檢查放在服務層', t: '不要只擋在 UI 或路由；每個操作的服務函式都要驗，因為同一操作可能從多條路徑進來（API、背景工作、admin 工具）。' },
      { b: '拒絕優先、預設拒絕', t: '沒有規則明確允許就拒絕；多條規則衝突時拒絕勝出。' },
    ],
    checklist: [
      '能為一個內容平台設計角色與權限矩陣',
      '能指出哪些需求 RBAC 做不到、要加什麼',
      '能說出授權檢查應該放在哪一層、為什麼',
    ],
    refs: [
      { label: 'OWASP：Authorization Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html' },
    ],
  },
  'auth-in-practice': {
    challenge: {
      task: '用本課「用純函式模擬 middleware 鏈」那段 Python，整理五種情況：沒帶 token、token 過期、帳號已停用、登入但不是 admin、讀別人的訂單。每一種先寫下預測的狀態碼、`WWW-Authenticate` 與 body，以及前端該顯示的提示與下一步動作（導去登入、顯示沒有權限、顯示找不到）。再執行程式核對後端那三欄。',
      deliver: '五列的對照表：情況、狀態碼、標頭與 body、前端畫面與動作，以及實際跑出的回應。',
      check: [
        '401 對應「重新取得憑證或導去登入」，403 對應「已登入但不能做，不要重試」',
        '別人的訂單回 404，前端畫面也和真的不存在時一樣',
        '錯誤 body 有前端可以分辨的穩定欄位（例如 `detail` 或另外的 `code`），前端不靠比對訊息文字判斷',
        'token 過期與帳號停用在前端的處理有寫出是否相同與理由',
      ],
      twist: '前端加了自動換發：收到 401 就用 refresh token 換新的 access token，再重送一次原本的請求。先預測哪一種情況會讓前端陷入一直換發、一直重送，再寫出前端的停止條件與後端該回的狀態碼。',
    },
    points: [
      { b: '`get_current_user` 依賴', t: '從 cookie 或 Bearer 取 token → 驗證 → 查使用者 → 回傳；失敗丟 401。所有需要登入的 endpoint 都 `Depends` 它。' },
      { b: '`require_role("admin")` 依賴工廠', t: '回傳一個依賴函式，內部呼叫 get_current_user 再檢查角色，失敗丟 403。401 是「不知道你是誰」、403 是「知道你是誰但不行」。' },
      { b: '資源層的擁有權檢查', t: '`get_order_or_403(order_id, user)`：查到訂單後比對 owner；找不到回 404 而不是 403（避免洩漏存在性）。' },
      { b: '密碼比對用常數時間', t: '用 hasher 內建的 verify，不要自己 `==`。登入失敗訊息統一（不要說「帳號不存在」）。' },
      { b: '測試要涵蓋三種身分', t: '未登入、登入但無權、有權，每個受保護 endpoint 至少三個測試。' },
    ],
    checklist: [
      '能寫出 get_current_user 與 require_role 兩個依賴並在 endpoint 使用',
      '能正確區分 401 / 403 / 404 的使用時機',
      '每個受保護 endpoint 都有三種身分的測試',
    ],
    refs: [
      { label: 'FastAPI：Security', url: 'https://fastapi.tiangolo.com/tutorial/security/' },
    ],
  },
  'account-lifecycle': {
    challenge: {
      task: '用本課的 `account_tokens` 資料表，寫出「忘記密碼」從頭到尾的帳號狀態。至少包含五步：寄出重設連結、企業郵件掃描器先 GET 了連結一次、使用者送出新密碼（POST）、同一個連結再用一次、另一封信的連結過期後才點。每一步寫出 `account_tokens` 那一列（`used_at`、`expires_at`）、使用者的 session 與 refresh token、密碼雜湊有沒有變，以及 API 回應。',
      deliver: '一張五步的狀態表，加上在 [Playground](#/playground?lang=sql) 實際跑出的兩次兌換結果（第一次 1 列、第二次 0 列）。',
      check: [
        'GET 不改變任何狀態，只有 POST 才兌換 token',
        '兌換是一句 `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`，兩個並行請求只會有一個成功',
        '重設完成後撤銷所有 session 與 refresh token，並寄通知信',
        '每一步的回應都不洩漏帳號是否存在',
      ],
      twist: '使用者在重設之前已經開了 MFA。先預測重設流程哪一步要改，以及攻擊者能不能靠重設密碼繞過 MFA，再寫出改法。',
    },
    points: [
      { b: '一次性 token 的標準做法', t: '`secrets.token_urlsafe(32)` 產生、只存 SHA-256 雜湊、記錄用途與 `expires_at`、用過即失效、發新的就作廢舊的。GET 只顯示表單，POST 才兌換（郵件掃描器會先點連結）。' },
      { b: '不洩漏帳號是否存在', t: '忘記密碼、登入失敗、註冊都回一樣的訊息；寄信丟背景佇列讓回應時間一致。不存在的帳號也要做一次假的雜湊比對。' },
      { b: '重設密碼後撤銷所有登入', t: '更新密碼雜湊、撤銷全部 session 與 refresh token、寄通知信、請使用者重新登入。重設不能繞過 MFA。' },
      { b: '鎖定要防被濫用', t: '「錯 5 次鎖帳號」讓任何人都能鎖住別人。以「帳號 + IP」為單位限制、對單一 IP 打很多帳號限流、逐步延遲與 CAPTCHA，計數放共用儲存。' },
      { b: '敏感操作要重新驗證', t: '改密碼要輸入舊密碼；改 email 要確認新地址並通知舊地址；停用帳號要撤銷 token，換發時檢查狀態；刪除帳號要列出所有資料副本。' },
    ],
    checklist: [
      '能設計重設 token 的資料表，並寫出一句完成「檢查 + 標記已使用」的兌換 SQL',
      '能列出忘記密碼流程中可能洩漏帳號存在的三個地方',
      '能說明 session 與 JWT 兩種架構各怎麼做「登出所有裝置」',
    ],
    refs: [
      { label: 'OWASP：Forgot Password Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html' },
      { label: 'OWASP：Authentication Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html' },
    ],
  },
  'api-keys-mfa': {
    challenge: {
      task: '為一個虛構的倉儲系統（入庫、出庫、盤點報表）列出所有會呼叫 API 的身分：倉管人員、倉庫主管、夜間對帳腳本、合作物流商的系統、手持掃描器。每一個標出是人還是機器，選擇驗證方式（密碼加 MFA、passkey、API key、client credentials、mTLS），並寫出憑證存在哪裡、誰負責輪替、撤銷後多快生效。',
      deliver: '一張身分清單表，加上一段說明：哪一個身分最可能被做成「共用某個人的帳號」，你怎麼避免。',
      check: [
        '人與機器分開：機器身分不借用人員帳號，也不做互動式 MFA',
        'API key 只存雜湊、有 scope 與到期日，合作商的 key 可以單獨撤銷',
        '高風險操作（例如直接調整庫存數量）有 step-up 或第二人核准',
        '寫出哪些做法可以沿用到門診系統，哪些要跟業務或廠商確認（掃描器能不能放憑證、合作商的系統支援哪種方式）',
      ],
      twist: '合作物流商說他們的系統只能在網址的 query string 帶一把固定的 key。先預測這把 key 會留在哪些地方（存取 log、代理伺服器、監控工具），再提出可以接受的折衷與必須拒絕的底線。',
    },
    points: [
      { b: 'API key 當密碼對待', t: '只在建立時顯示一次、資料庫存雜湊、可命名可撤銷、可設 scope 與到期、記錄最後使用時間。' },
      { b: '服務對服務用 client credentials', t: '服務用自己的 client_id / secret 向授權伺服器換 token，或在內網用 mTLS。不要讓服務共用某個人類使用者的帳號。' },
      { b: 'MFA 補第二因素', t: 'TOTP（Authenticator App）最普及、WebAuthn / passkey 最安全；簡訊 OTP 最弱。高風險操作（改密碼、提款）要再驗一次（step-up）。' },
      { b: 'SSO 交給 IdP', t: '企業客戶要求 SAML / OIDC 登入：你的系統當 Service Provider，身分由客戶的 IdP（Okta、Entra ID）提供。' },
      { b: '憑證輪替要能不停機', t: '同時接受新舊兩把 key 一段時間，切換完再撤舊的。' },
    ],
    checklist: [
      '能設計 API key 的資料表與產生 / 驗證 / 撤銷流程',
      '能說明 client credentials 流程與授權碼流程的差別',
      '知道 TOTP 與 passkey 的差異',
    ],
    refs: [],
  },
}

// 後續新增的課，內文放在 parts/ 底下，這裡合併
export default { ...base, ...m6 }
