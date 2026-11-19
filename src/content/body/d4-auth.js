// 領域 4：驗證與授權（AuthN & AuthZ） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d4-auth.js
import m6 from './parts/d4-auth-m6.js'
const base = {
  'authn-basics': {
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
