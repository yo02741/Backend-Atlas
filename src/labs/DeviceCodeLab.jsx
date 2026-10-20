import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, useWidth } from './ui.jsx'

/* ============================================================
   三種 OAuth 授權流程：Device Code（RFC 8628）、授權碼 + PKCE（RFC 7636）、Client Credentials（RFC 6749 §4.4）
   - 左：時序圖（角色當欄、訊息當箭頭），Stepper 逐步播放
   - 右：該步的 HTTP 請求／回應原文；PKCE 的 verifier / challenge 用 WebCrypto 真的算
   ============================================================ */

const DC = 'GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS'
const UC = 'WDJB-MJHT'
const TOKEN_REQ = `POST /oauth2/token HTTP/1.1\nHost: sso.example.com\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=urn:ietf:params:oauth:grant-type:device_code\n&device_code=${DC}\n&client_id=atlas-cli`
const err = (status, e) => `HTTP/1.1 ${status}\nContent-Type: application/json\nCache-Control: no-store\n\n{ "error": "${e}" }`

/* kind：'' 一般單向、'rt' 一來一回（輪詢）、'self' 自己內部動作、'oob' 不是 HTTP（人看螢幕轉抄）、'ghost' 沒發生 */
const DEVICE_LANES = [
  { name: '使用者的瀏覽器', short: '瀏覽器', sub: '手機或筆電' },
  { name: '授權伺服器', short: 'SSO', sub: '公司 SSO' },
  { name: 'CLI', short: 'CLI', sub: '終端機裡的工具' },
  { name: 'API', short: 'API', sub: '受保護的資源' },
]
const D_START = [
  { from: 2, to: 1, label: 'POST /device_authorization', title: '① CLI 向授權伺服器要一組裝置代碼',
    text: ['CLI 跑在終端機、可能在 SSH 進去的遠端機器上，開不了瀏覽器、也接不到 redirect。所以它不走「導去登入頁再導回來」，而是先要一組代碼。', 'CLI 是公開客戶端（每個使用者都裝得到同一支執行檔），所以只帶 client_id，不帶 client_secret。'],
    code: { src: `POST /oauth2/device_authorization HTTP/1.1\nHost: sso.example.com\nContent-Type: application/x-www-form-urlencoded\n\nclient_id=atlas-cli\n&scope=openid%20offline_access%20projects.read`, hl: [6, 7] } },
  { from: 1, to: 2, label: '200 device_code…', title: '② 拿回兩組代碼：一組給機器、一組給人',
    text: ['device_code 很長，只有 CLI 自己留著，之後輪詢時拿來問「核准了沒」；user_code 很短（例如 WDJB-MJHT），是要讓人手動輸入的。', 'expires_in 是這組代碼的壽命（秒），interval 是輪詢最短間隔（秒，沒給就是 5）。這兩個數字是伺服器說了算，CLI 必須照做。'],
    code: { src: `HTTP/1.1 200 OK\nContent-Type: application/json\nCache-Control: no-store\n\n{\n  "device_code": "${DC}",\n  "user_code": "${UC}",\n  "verification_uri": "https://sso.example.com/device",\n  "verification_uri_complete": "https://sso.example.com/device?user_code=${UC}",\n  "expires_in": 900,\n  "interval": 5\n}`, hl: [6, 7, 8, 10, 11] } },
  { from: 2, to: 0, kind: 'oob', label: `顯示網址與 ${UC}`, title: '③ CLI 把網址和 user_code 印給人看',
    text: ['這一步不是 HTTP：使用者看著終端機，自己拿手機或筆電打開網址、輸入代碼。授權因此可以發生在「另一台」有瀏覽器的裝置上。', '也可以把 verification_uri_complete 印成 QR code，掃了就不必手打代碼——但要不要核准仍由使用者在瀏覽器上決定。'],
    code: { src: `$ atlas login\n\n請用瀏覽器開啟：https://sso.example.com/device\n並輸入代碼：    ${UC}\n\n（代碼 15 分鐘內有效，等待核准中…）`, hl: [3, 4] } },
  { from: 2, to: 1, kind: 'rt', tone: 'bad', label: '/token → pending · t=5s', title: '④ CLI 開始輪詢：還沒核准',
    text: ['CLI 每 interval 秒拿 device_code 打一次 /token。grant_type 是一長串 URN，告訴伺服器「這是裝置流程」。', '使用者還沒核准，所以回 400 authorization_pending。這不是錯誤，是「繼續等」的意思。'],
    code: { src: `${TOKEN_REQ}\n\n${err('400 Bad Request', 'authorization_pending')}`, hl: [5, 13] } },
  { from: 2, to: 1, kind: 'rt', tone: 'bad', label: '太快 → slow_down · t=7s', title: '⑤ 打太快：slow_down',
    text: ['假設 CLI 的計時器寫錯，隔 2 秒就又打一次。伺服器回 slow_down，規範要求 CLI 把間隔加 5 秒，而且之後每一次都用新的間隔（5 → 10 秒）。', '輪詢是在燒授權伺服器的資源；成千上萬個 CLI 同時登入時，這條規則保護的是 SSO 本身。'],
    code: { src: `POST /oauth2/token HTTP/1.1   ← 距上次只隔 2 秒\n…（同上）\n\n${err('400 Bad Request', 'slow_down')}\n\n→ CLI：interval = 5 + 5 = 10 秒（之後一直用 10）`, hl: [1, 8, 10] } },
]
const D_OK = [
  { from: 0, to: 1, label: '登入 + 輸入代碼 + 核准', title: '⑥ 使用者在瀏覽器登入、輸入代碼、按核准',
    text: ['登入（含 MFA）發生在 SSO 的網域，CLI 從頭到尾碰不到密碼。輸入 user_code 後，核准頁要清楚寫出「哪個應用、要哪些權限」。', '使用者按拒絕的話，CLI 下一次輪詢會拿到 access_denied。/device 之後的頁面與欄位是各家 SSO 自訂的，下面只是示意。'],
    code: { src: `GET /device?user_code=${UC} HTTP/1.1\nHost: sso.example.com\nCookie: sso_session=…（登入 + MFA 之後）\n\n核准畫面（示意）：\n  atlas-cli 想要存取：projects.read、離線存取\n  代碼 ${UC}——請確認和你終端機上的一致\n  [核准]  [拒絕]\n\nPOST /device/consent HTTP/1.1   ← 實作自訂\nuser_code=${UC}&decision=approve`, hl: [6, 7, 11] } },
  { from: 2, to: 1, kind: 'rt', tone: 'good', label: '/token → 200 · t=27s', title: '⑦ 下一次輪詢拿到 token',
    text: ['t=17s 那次仍是 pending（省略）；使用者約在 t=20s 核准，t=27s 的輪詢就拿到 access_token 和 refresh_token。device_code 用過即失效。', 'refresh_token 讓 CLI 在 access_token 過期後默默續期，使用者不必每小時重登一次——也因此它比 access_token 更值得保護。'],
    code: { src: `POST /oauth2/token HTTP/1.1   ← t=27s\n…（同上）\n\nHTTP/1.1 200 OK\nContent-Type: application/json\nCache-Control: no-store\n\n{\n  "access_token": "eyJhbGciOiJSUzI1NiIs…",\n  "token_type": "Bearer",\n  "expires_in": 3600,\n  "refresh_token": "8xLOxBtZp8…",\n  "scope": "openid offline_access projects.read"\n}`, hl: [1, 9, 12] } },
  { from: 2, to: 2, kind: 'self', label: '存進 OS keyring', title: '⑧ token 存進作業系統 keyring，不寫設定檔',
    text: ['token 交給作業系統的憑證儲存：macOS Keychain、Windows Credential Manager、Linux 的 Secret Service。它們有存取控制，也不會跟著 dotfiles 被同步或 commit。', '設定檔只放「連哪台 SSO、用哪個帳號」這種不敏感的東西。沒有 keyring 的環境（例如容器裡）要明確提示使用者風險，而不是默默寫明文檔。'],
    code: { src: `→ CLI 呼叫 keyring：\n  service = "atlas-cli"\n  account = "alice@corp.example"\n  secret  = { access_token, refresh_token, expires_at }\n\n~/.config/atlas/config.toml 只寫：\n  sso_host = "sso.example.com"\n  account  = "alice@corp.example"\n  # 不寫任何 token`, hl: [4, 9] } },
  { from: 2, to: 3, label: 'Authorization: Bearer …', title: '⑨ 帶 Bearer token 呼叫 API',
    text: ['之後每個指令從 keyring 取出 access_token 放進 Authorization 標頭。過期就用 refresh_token 換新的，再寫回 keyring。', 'API 驗 token 的方式和其他流程一樣：簽章、iss、aud、exp、scope。它不在乎 token 是用哪種流程拿到的。'],
    code: { src: `GET /v1/projects HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer eyJhbGciOiJSUzI1NiIs…\n\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n[{ "id": "p_17", "name": "backend-atlas" }]`, hl: [3] } },
]
const D_EXPIRED = [
  { from: 0, to: 1, kind: 'ghost', label: '（使用者一直沒去核准）', title: '⑥ 使用者沒有核准',
    text: ['使用者分心去做別的事，瀏覽器那端什麼都沒發生。CLI 照著 10 秒的間隔繼續輪詢，每次都是 authorization_pending。', '代碼的壽命是第 ② 步的 expires_in：900 秒。時間一到，這組 device_code 和 user_code 就作廢。'],
    code: { src: `（瀏覽器端沒有任何請求）\n\nt=17s  POST /token → 400 authorization_pending\nt=27s  POST /token → 400 authorization_pending\n…\nt=897s POST /token → 400 authorization_pending`, hl: [1] } },
  { from: 2, to: 1, kind: 'rt', tone: 'bad', label: '/token → expired_token', title: '⑦ 過期：expired_token',
    text: ['超過 expires_in 之後的輪詢拿到 expired_token。這是終止型錯誤：再怎麼輪詢都不會變成功。', '就算使用者這時才去輸入代碼，授權伺服器也會說代碼無效。唯一的路是重新發起一次 /device_authorization。'],
    code: { src: `POST /oauth2/token HTTP/1.1   ← t≈900s\n…（同上）\n\n${err('400 Bad Request', 'expired_token')}`, hl: [8] } },
  { from: 2, to: 2, kind: 'self', tone: 'bad', label: '停止輪詢，請使用者重跑', title: '⑧ CLI 停止輪詢，提示重新登入',
    text: ['正確的 CLI 收到 expired_token（或 access_denied）就停止輪詢、清楚告訴使用者發生什麼事，而不是無限重試。', '沒有 token，keyring 也不會被寫入；後面呼叫 API 的步驟根本不會發生。'],
    code: { src: `$ atlas login\n…\n✕ 代碼已過期（15 分鐘內沒有核准）。\n  請重新執行 atlas login。\n\n→ 不寫 keyring、不呼叫 API`, hl: [3, 4] } },
]

const PKCE_LANES = [
  { name: 'App', short: 'App', sub: '公開客戶端' },
  { name: '瀏覽器', short: '瀏覽器', sub: '系統瀏覽器' },
  { name: '授權伺服器', short: '授權', sub: 'code / token' },
  { name: 'API', short: 'API', sub: '受保護的資源' },
]
const ATTACKER = { name: '攻擊者', short: '攻擊者', sub: '惡意 App' }
const REDIRECT = 'com.example.notes:/callback'
const pkceSteps = ({ v, c, av, ah, attack }) => {
  const start = [
    { from: 0, to: 0, kind: 'self', label: 'verifier → challenge', title: '① App 自己產生 code_verifier，算出 code_challenge',
      text: ['手機或桌面 App 是公開客戶端：程式碼在使用者手上，藏不住 client_secret。PKCE 改成每次登入現做一把一次性的鑰匙。', `這裡真的用 WebCrypto 產生 32 bytes 亂數，base64url 後是 ${v.length} 字元的 code_verifier（規範要求 43–128 字元）；再算 SHA-256、base64url、去掉 padding 得到 code_challenge。`],
      code: { src: `crypto.getRandomValues(32 bytes) → base64url\n  code_verifier  = "${v}"\n                   （${v.length} 字元，留在 App 裡）\n\nBASE64URL(SHA256(code_verifier))，無 padding\n  code_challenge = "${c}"`, hl: [2, 6] } },
    { from: 0, to: 1, label: '/authorize + challenge', title: '② App 打開系統瀏覽器，送出 code_challenge',
      text: ['授權請求帶上 code_challenge 與 code_challenge_method=S256。challenge 是雜湊值，被看到也推不回 verifier。', '用系統瀏覽器而不是 App 內嵌 WebView：使用者能看到真的網址列，App 也碰不到密碼欄位。'],
      code: { src: `GET /authorize\n  ?response_type=code\n  &client_id=notes-app\n  &redirect_uri=${REDIRECT}\n  &scope=openid%20notes.read\n  &state=af0ifjsldkj\n  &code_challenge=${c}\n  &code_challenge_method=S256\nHost: auth.example.com`, hl: [7, 8] } },
    { from: 1, to: 2, label: '登入 + 同意', title: '③ 使用者登入並同意；伺服器把 challenge 綁在 code 上',
      text: ['帳密與 MFA 都在授權伺服器的頁面上完成。使用者同意後，伺服器產生一次性的授權碼，並記下它對應的 client_id、redirect_uri 與 code_challenge。', '從這一刻起，這個 code 只能由「拿得出對應 verifier 的人」兌換。'],
      code: { src: `（在 auth.example.com 的頁面上）\n使用者登入、通過 MFA、按「允許」\n\n→ 伺服器記下：\n  code           = SplxlOBeZQQYbYS6WxSbIA\n  client_id      = notes-app\n  redirect_uri   = ${REDIRECT}\n  code_challenge = ${c.slice(0, 20)}…（S256）`, hl: [5, 8] } },
  ]
  if (attack) return [...start,
    { from: 2, to: 4, tone: 'bad', label: '302 → code 被惡意 App 接走', title: '④ 授權碼被攔截',
      text: ['手機上另一個惡意 App 也註冊了同樣的 custom scheme（com.example.notes:），系統把導回網址交給了它。攻擊者現在手上有 code。', '沒有 PKCE 的話，這就結束了：攻擊者直接拿 code 去換 token。'],
      code: { src: `HTTP/1.1 302 Found\nLocation: ${REDIRECT}\n  ?code=SplxlOBeZQQYbYS6WxSbIA\n  &state=af0ifjsldkj\n\n→ 作業系統把這個網址交給了惡意 App`, hl: [3, 6] } },
    { from: 4, to: 2, label: '/token + 亂猜的 verifier', title: '⑤ 攻擊者拿 code 去換 token，但沒有 verifier',
      text: ['verifier 從頭到尾沒離開正牌 App 的記憶體，攻擊者只能自己亂生一個。', `伺服器照規則重算：BASE64URL(SHA256(攻擊者的 verifier)) 得到 ${ah.slice(0, 12)}…，和第 ③ 步存的 ${c.slice(0, 12)}… 不同。`],
      code: { src: `POST /token HTTP/1.1\nHost: auth.example.com\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code\n&code=SplxlOBeZQQYbYS6WxSbIA\n&redirect_uri=${REDIRECT}\n&client_id=notes-app\n&code_verifier=${av}\n\n→ 伺服器重算 BASE64URL(SHA256(code_verifier))\n  = ${ah}\n  存的 challenge\n  = ${c}\n  ✕ 不相等`, hl: [9, 12, 14, 15] } },
    { from: 2, to: 4, tone: 'bad', label: '400 invalid_grant', title: '⑥ 換 token 失敗：invalid_grant',
      text: ['比對不上，規範要求回 invalid_grant。攔到 code 的人拿不到 token，攻擊在這裡被擋下。', '正牌 App 沒收到 code，使用者重試一次即可；被攔走的 code 本來就是一次性、短效期的。'],
      code: { src: `HTTP/1.1 400 Bad Request\nContent-Type: application/json\nCache-Control: no-store\n\n{\n  "error": "invalid_grant",\n  "error_description": "PKCE verification failed"\n}`, hl: [6] } },
  ]
  return [...start,
    { from: 2, to: 0, label: '302 redirect_uri?code=…', title: '④ 經由瀏覽器導回 App，帶著 code',
      text: ['授權伺服器 302 到 redirect_uri，系統把網址交給 App。App 先比對 state，確認這是自己發起的那一次。', 'code 不是 token，而且綁著 challenge：就算被看到，少了 verifier 也換不到東西。'],
      code: { src: `HTTP/1.1 302 Found\nLocation: ${REDIRECT}\n  ?code=SplxlOBeZQQYbYS6WxSbIA\n  &state=af0ifjsldkj\n\n→ App 檢查 state 與自己存的相同`, hl: [3, 6] } },
    { from: 0, to: 2, label: '/token + code_verifier', title: '⑤ App 拿 code + code_verifier 換 token',
      text: ['這次送出的是 verifier 原文。伺服器自己算 BASE64URL(SHA256(verifier))，和第 ③ 步存的 challenge 比對。', '比對用的是同一個公式，所以右邊的「重算結果」就是瀏覽器剛剛實際算出來的值——兩者一致。'],
      code: { src: `POST /token HTTP/1.1\nHost: auth.example.com\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code\n&code=SplxlOBeZQQYbYS6WxSbIA\n&redirect_uri=${REDIRECT}\n&client_id=notes-app\n&code_verifier=${v}\n\n→ 伺服器重算 BASE64URL(SHA256(code_verifier))\n  = ${c}\n  ✓ 等於授權時存的 code_challenge`, hl: [9, 12, 13] } },
    { from: 2, to: 0, tone: 'good', label: '200 access_token', title: '⑥ 拿到 token',
      text: ['比對通過，回 access_token（通常也有 refresh_token，視伺服器政策）。公開客戶端從頭到尾沒有用到任何 secret。', 'App 一樣把 token 存進系統的安全儲存（iOS Keychain、Android Keystore 加密的儲存），而不是一般偏好設定檔。'],
      code: { src: `HTTP/1.1 200 OK\nContent-Type: application/json\nCache-Control: no-store\n\n{\n  "access_token": "eyJhbGciOiJFUzI1NiIs…",\n  "token_type": "Bearer",\n  "expires_in": 3600,\n  "refresh_token": "tGzv3JOkF0XG5Qx2TlKWIA"\n}`, hl: [6, 9] } },
    { from: 0, to: 3, label: 'Authorization: Bearer …', title: '⑦ 帶 Bearer token 呼叫 API',
      text: ['之後和其他流程一樣：Authorization 標頭帶 access_token，API 驗簽章、aud、exp、scope。', 'PKCE 只保護「code 換 token」這一步；token 拿到之後的保管，仍是 App 自己的責任。'],
      code: { src: `GET /v1/notes HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer eyJhbGciOiJFUzI1NiIs…\n\nHTTP/1.1 200 OK`, hl: [3] } },
  ]
}

const CC_LANES = [
  { name: '服務 A', short: '服務 A', sub: '報表排程' },
  { name: '授權伺服器', short: '授權', sub: '發 token' },
  { name: '服務 B', short: '服務 B', sub: '發票 API' },
]
const ccSteps = (pkj) => [
  { from: 0, to: 1, label: 'POST /token（client_credentials）', title: '① 服務 A 用自己的身分直接換 token',
    text: ['沒有使用者、沒有瀏覽器、沒有 redirect：服務 A 拿自己的憑證向授權伺服器證明「我是 billing-report」。', pkj ? 'private_key_jwt：服務 A 用自己的私鑰簽一張短命 JWT（iss = sub = client_id、aud = token 端點、exp 幾分鐘、jti 不重複），授權伺服器用事先登記的公鑰驗。私鑰不出服務 A，伺服器端也不必保存共享秘密。'
      : 'client_secret_basic：client_id 與 client_secret 用 Basic 認證送出。簡單，但 secret 是共享秘密，兩邊都要保管、也要定期輪換。'],
    code: pkj
      ? { src: `POST /oauth2/token HTTP/1.1\nHost: sso.example.com\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials\n&scope=invoices.write\n&client_id=billing-report\n&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n&client_assertion=eyJhbGciOiJSUzI1NiIsImtpZCI6InJwdC0yMDI2In0…`, hl: [5, 8, 9] }
      : { src: `POST /oauth2/token HTTP/1.1\nHost: sso.example.com\nAuthorization: Basic YmlsbGluZy1yZXBvcnQ6czNjcjN0…\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials\n&scope=invoices.write`, hl: [3, 6] } },
  { from: 1, to: 0, tone: 'good', label: '200 access_token（沒有 refresh_token）', title: '② 拿到 access_token，沒有 refresh_token',
    text: ['回應裡沒有 refresh_token：規範建議這個流程不發。服務隨時能用自己的憑證再換一張，refresh token 只是多一個要保管的東西。', 'token 的 sub 就是 client 本身。權限完全由這個 client 被授予的 scope 決定，和任何人的帳號無關。'],
    code: { src: `HTTP/1.1 200 OK\nContent-Type: application/json\nCache-Control: no-store\n\n{\n  "access_token": "eyJhbGciOiJSUzI1NiIs…",\n  "token_type": "Bearer",\n  "expires_in": 3600,\n  "scope": "invoices.write"\n}\n\n（沒有 refresh_token、沒有 id_token）`, hl: [6, 12] } },
  { from: 0, to: 2, label: 'Authorization: Bearer …', title: '③ 服務 A 帶 token 呼叫服務 B',
    text: ['和其他流程一樣放在 Authorization 標頭。服務 B 不需要知道服務 A 的 secret 或私鑰，只要信任授權伺服器。'],
    code: { src: `POST /v1/invoices HTTP/1.1\nHost: billing.internal.example\nAuthorization: Bearer eyJhbGciOiJSUzI1NiIs…\nContent-Type: application/json\n\n{ "period": "2026-09" }`, hl: [3] } },
  { from: 2, to: 0, tone: 'good', label: '201 Created', title: '④ 服務 B 驗 token 後回應',
    text: ['服務 B 驗簽章、iss、aud（是不是發給我的）、exp、scope 有沒有 invoices.write。', 'token 裡沒有使用者，所以「以哪個使用者身分」的授權檢查不適用；要做的是「這個服務能不能做這件事」。'],
    code: { src: `→ 服務 B 驗 token：\n  iss   = https://sso.example.com  ✓\n  aud   = billing-api              ✓\n  sub   = billing-report（client 本身）\n  scope = invoices.write           ✓\n\nHTTP/1.1 201 Created\nLocation: /v1/invoices/inv_2026_09`, hl: [4, 7] } },
  { from: 0, to: 0, kind: 'self', label: '快取 token，快過期再換', title: '⑤ 快取 token，快過期才重換',
    text: ['token 有效一小時就快取一小時（提早一點更新，例如剩 60 秒時），不要每個請求都去打授權伺服器。', '服務的 secret 或私鑰放在 secret manager、由部署平台注入，不寫進程式碼或 repo 裡的設定檔。'],
    code: { src: `cache = { token, expires_at = now + 3600 }\n\n每次呼叫前：\n  if now > expires_at - 60:\n    重新 POST /oauth2/token`, hl: [4, 5] } },
]

const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const randVerifier = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return b64url(a) }
const s256 = async (v) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))

export default function DeviceCodeLab() {
  const subtleOk = typeof globalThis.crypto?.subtle?.digest === 'function'
  const [flow, setFlow] = useState('device')
  const [expire, setExpire] = useState(false)
  const [attack, setAttack] = useState(false)
  const [pkj, setPkj] = useState(false)
  const [v, setV] = useState(() => (subtleOk ? randVerifier() : 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
  const [av] = useState(() => (subtleOk ? randVerifier() : 'attacker-guess-0000000000000000000000000000'))
  const [hash, setHash] = useState({ c: '', ah: '' })
  useEffect(() => {
    if (!subtleOk) return
    let alive = true
    Promise.all([s256(v), s256(av)]).then(([c, ah]) => { if (alive) setHash({ c, ah }) })
    return () => { alive = false }
  }, [v, av, subtleOk])
  const c = hash.c || '（計算中…）', ah = hash.ah || '（計算中…）'

  const lanes = flow === 'device' ? DEVICE_LANES : flow === 'pkce' ? (attack ? [...PKCE_LANES, ATTACKER] : PKCE_LANES) : CC_LANES
  const steps = flow === 'device' ? [...D_START, ...(expire ? D_EXPIRED : D_OK)] : flow === 'pkce' ? pkceSteps({ v, c, av, ah, attack }) : ccSteps(pkj)
  const { step: raw, setStep, playing, toggle } = usePlayer(steps.length, 2400)
  useEffect(() => { if (raw > steps.length - 1) setStep(steps.length - 1) }, [raw, steps.length, setStep])
  const step = Math.min(raw, steps.length - 1)
  const s = steps[step]
  const ref = useRef(null)
  const w = useWidth(ref, 640)
  const compact = w < 520
  const pick = (f) => { setFlow(f); setStep(0) }

  return (
    <Lab accent="blue" kicker="AUTH LAB" title="三種授權流程：Device Code、PKCE、Client Credentials"
         blurb="同樣是「拿到 access token」，裝置上有沒有瀏覽器、有沒有使用者、藏不藏得住秘密，決定了該走哪條路。逐步播放每條流程，右邊是每一步的 HTTP 原文；PKCE 的雜湊是瀏覽器當場用 WebCrypto 算的。">
      <LabControls>
        <Seg label="流程" tinted value={flow} onChange={pick} options={[
          { value: 'device', label: 'Device Code' }, { value: 'pkce', label: '授權碼 + PKCE' }, { value: 'cc', label: 'Client Credentials' }]} />
        {flow === 'device' && <Toggle label="使用者沒核准直到過期" checked={expire} onChange={setExpire} />}
        {flow === 'pkce' && <Toggle label="攻擊者攔截授權碼" checked={attack} onChange={setAttack} />}
        {flow === 'pkce' && subtleOk && <button type="button" className="btn ghost small" onClick={() => setV(randVerifier())}>重新產生 verifier</button>}
        {flow === 'cc' && <Toggle label="改用 private_key_jwt" checked={pkj} onChange={setPkj} />}
        <span className="spacer" />
        <div className="dc-ctl"><Stepper step={step} total={steps.length} onStep={setStep} playing={playing} onPlay={toggle} /></div>
      </LabControls>

      <LabGrid>
        <div ref={ref} className="dc-col">
          <LabStage label="授權流程時序圖" caption={compact ? `第 ${step + 1} 步：${s.label}` : '實線 = HTTP；雙箭頭 = 一來一回的輪詢；虛線 = 人看螢幕轉抄；繞回自己 = 本機動作。'}>
            <Sequence lanes={lanes} steps={steps} step={step} compact={compact} w={w - 38} />
            <Strip flow={flow} step={step} expire={expire} attack={attack} pkj={pkj} v={v} c={c} subtleOk={subtleOk} />
          </LabStage>
        </div>
        <div className="lab-stack">
          <Code lang="http" title={`第 ${step + 1} 步`} highlight={s.code.hl}>{s.code.src}</Code>
          <LabExplain title={s.title}>{s.text.map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
        </div>
      </LabGrid>

      <div className="dc-bottom">
        <div className="dtable-wrap">
          <table className="dtable dc-cmp">
            <caption>三種流程怎麼選</caption>
            <thead><tr><th /><th className={flow === 'device' ? 'on' : ''}>Device Code</th><th className={flow === 'pkce' ? 'on' : ''}>授權碼 + PKCE</th><th className={flow === 'cc' ? 'on' : ''}>Client Credentials</th></tr></thead>
            <tbody>
              {CMP.map(([k, ...cells]) => (
                <tr key={k}><th>{k}</th>{cells.map((x, i) => <td key={i} className={['device', 'pkce', 'cc'][i] === flow ? 'hit' : ''}>{x}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dc-callouts">
          <Callout title="實際用在哪裡">
            <b>Device Code：</b>CLI 登入（例如 <code>az login --use-device-code</code>、<code>gh auth login</code> 顯示一次性代碼的那種）、智慧電視、IoT、SSH 進去的遠端機器。
            <b>授權碼 + PKCE：</b>手機 App、SPA、桌面 App；一般有後端的網站也建議加上。
            <b>Client Credentials：</b>排程任務、微服務互相呼叫、CI 呼叫內部 API——任何「沒有人在場」的情境。
          </Callout>
          <Callout tone="warn" title="Device Code 的釣魚風險">
            攻擊者可以自己發起 /device_authorization，把拿到的 user_code 傳給受害者：「請到 sso.example.com/device 輸入 {UC} 完成驗證」。網址是真的公司 SSO，受害者登入核准後，token 卻進了攻擊者的機器——「檢查網址」防不住這招。
            核准頁要寫清楚是哪個應用在要權限、提醒「只輸入你自己剛在裝置上看到的代碼」；用不到的組織可以停用這個流程或限定可用的 client。
          </Callout>
          <Callout tone="good" title="token 不放設定檔">
            設定檔會被 commit、被 dotfiles 同步、被備份、被同一台機器的其他程式讀到。使用者 token 放 OS keyring；服務的 secret / 私鑰放 secret manager 由平台注入。CI 不要借用某個人的個人 token，改用 Client Credentials 或平台提供的工作負載身分。
          </Callout>
        </div>
      </div>

      <style>{`
        .dc-col { min-width: 0; }
        .dc-ctl .stepper button, .dc-ctl .stepper .count { white-space: nowrap; }
        .dc-life { stroke: var(--hairline); stroke-width: 1.5; stroke-dasharray: 3 4; }
        .dc-edge { transition: opacity 0.3s ease; }
        .dc-edge.past { opacity: 0.5; } .dc-edge.todo { opacity: 0.22; }
        .dc-edge .dc-head { fill: var(--ink-3); }
        .dc-edge.now .dc-head { fill: var(--lab-accent); }
        .dc-edge.now .svg-edge { stroke: var(--lab-accent); }
        .dc-edge.bad .dc-head { fill: var(--critical); }
        .dc-edge.bad.now .svg-edge { stroke: var(--critical); }
        .dc-edge.good .dc-head { fill: var(--good); }
        .dc-edge.good.now .svg-edge { stroke: var(--good); }
        .dc-edge.oob .svg-edge, .dc-edge.ghost .svg-edge { stroke-dasharray: 5 4; animation: none; }
        .dc-edge.ghost .dc-label { text-decoration: line-through; }
        .dc-edge .dc-num { fill: var(--surface-1); stroke: var(--ink-3); stroke-width: 1.2; }
        .dc-edge.now .dc-num { fill: var(--lab-accent); stroke: var(--lab-accent); }
        .dc-edge .dc-numtxt { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--ink-2); }
        .dc-edge.now .dc-numtxt { fill: var(--page); }
        .dc-edge.now .dc-label { fill: var(--lab-accent); font-weight: 700; }
        .dc-edge.bad.now .dc-label { fill: var(--critical); }
        .dc-edge.good.now .dc-label { fill: var(--good); }
        .dc-lane { font-size: 12px; font-weight: 700; }
        .dc-sub { font-size: 10.5px; }
        .dc-c .dc-lane { font-size: 12.5px; } .dc-c .dc-numtxt { font-size: 11px; }
        .dc-strip { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hairline); font-size: 0.78rem; color: var(--ink-3); }
        .dc-strip b { font-family: var(--mono); font-weight: 600; color: var(--ink-1); }
        .dc-strip b.bad { color: var(--critical); } .dc-strip b.ok { color: var(--good); } .dc-strip b.wait { color: var(--serious); }
        .dc-strip .mono { font-family: var(--mono); font-size: 0.74rem; color: var(--ink-2); overflow-wrap: anywhere; word-break: break-all; }
        .dc-strip > span { min-width: 0; }
        .dc-bottom { display: grid; gap: 14px; margin-top: 18px; }
        .dc-callouts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; align-items: start; }
        .dc-cmp td { white-space: normal; font-family: var(--sans); min-width: 9em; }
        .dc-cmp td.hit { background: color-mix(in srgb, var(--lab-accent) 9%, transparent); }
        .dc-cmp th.on { color: var(--lab-accent); }
        .dc-cmp tbody th { white-space: nowrap; color: var(--ink-3); font-weight: 600; }
        .dc-cmp td { transition: background 0.2s ease; }
      `}</style>
    </Lab>
  )
}

const CMP = [
  ['使用者', '有，在另一台裝置上核准', '有，在同一台裝置上', '沒有'],
  ['裝置需要', '能連網、能顯示文字', '能開瀏覽器並接回 redirect', '後端能保管 secret 或私鑰'],
  ['客戶端', '公開客戶端', '公開或機密皆適用', '機密客戶端'],
  ['refresh token', '通常有（看 scope 與政策）', '通常有', '不發，過期就再換'],
  ['主要風險', '代碼釣魚、輪詢過量', 'redirect 被攔截（PKCE 擋）', 'secret 外洩、權限給太大'],
]

function Strip({ flow, step, expire, attack, pkj, v, c, subtleOk }) {
  if (flow === 'device') {
    const st = step < 1 ? ['—', ''] : expire ? (step >= 6 ? ['expired', 'bad'] : ['pending', 'wait']) : step >= 6 ? ['已兌換（失效）', 'ok'] : step >= 5 ? ['approved', 'ok'] : ['pending', 'wait']
    return (
      <div className="dc-strip" aria-live="polite">
        <span>device_code：<b className={st[1]}>{st[0]}</b></span>
        <span>輪詢間隔：<b>{step >= 4 ? '10 s' : step >= 1 ? '5 s' : '—'}</b></span>
        <span>代碼壽命：<b>900 s</b></span>
        <span>keyring：<b className={!expire && step >= 7 ? 'ok' : ''}>{!expire && step >= 7 ? '已存 token' : '空'}</b></span>
      </div>
    )
  }
  if (flow === 'pkce') return (
    <div className="dc-strip">
      {!subtleOk && <span>這個環境沒有 crypto.subtle（需要 HTTPS 或 localhost），下面是固定示範值。</span>}
      <span>code_verifier（{v.length} 字元，只在 App）：<span className="mono">{v}</span></span>
      <span>code_challenge（S256）：<span className="mono">{c}</span></span>
      {attack && <span>結果：<b className={step >= 5 ? 'bad' : ''}>{step >= 5 ? '攻擊者換 token 失敗' : '進行中'}</b></span>}
    </div>
  )
  return (
    <div className="dc-strip">
      <span>客戶端驗證：<b>{pkj ? 'private_key_jwt' : 'client_secret_basic'}</b></span>
      <span>使用者：<b>無</b></span>
      <span>refresh_token：<b>不發</b></span>
    </div>
  )
}

function Sequence({ lanes, steps, step, compact, w }) {
  const n = lanes.length
  const W = Math.max(280, Math.round(w))
  const pad = 4
  const X = lanes.map((_, i) => pad + ((W - 2 * pad) * (i + 0.5)) / n)
  const bw = Math.min(128, (W - 2 * pad) / n - (compact ? 6 : 12))
  const top = 6, boxH = compact ? 36 : 42, y0 = top + boxH + 30, dy = compact ? 34 : 40
  const H = y0 + (steps.length - 1) * dy + 22
  return (
    <svg className={compact ? 'dc-c' : ''} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`時序圖，第 ${step + 1} 步：${steps[step].title}`}>
      {lanes.map((l, i) => {
        const on = i === steps[step].from || i === steps[step].to
        return (
          <g key={l.name}>
            <line className="dc-life" x1={X[i]} x2={X[i]} y1={top + boxH} y2={H - 4} />
            <rect className={`svg-node${on ? ' on' : ''}`} x={X[i] - bw / 2} y={top} width={bw} height={boxH} rx="5" />
            <text className="svg-text dc-lane" x={X[i]} y={top + (compact ? 22 : 18)} textAnchor="middle">{compact ? l.short : l.name}</text>
            {!compact && <text className="svg-text small dc-sub" x={X[i]} y={top + 33} textAnchor="middle">{l.sub}</text>}
          </g>
        )
      })}
      {steps.map((st, i) => {
        const y = y0 + i * dy
        const state = i === step ? 'now' : i < step ? 'past' : 'todo'
        const cls = `dc-edge ${state} ${st.kind || ''} ${st.tone || ''}`
        const x1 = X[st.from], x2 = X[st.to]
        if (st.kind === 'self') {
          const right = st.from < n - 1
          const d = right ? 1 : -1
          return (
            <g key={i} className={cls}>
              <path className={`svg-edge${state === 'now' ? ' on' : ''}`} d={`M${x1 + d * 4} ${y - 9} h${d * 24} v18 h${-d * 16}`} />
              <polygon className="dc-head" points={`${x1 + d * 4},${y + 9} ${x1 + d * 13},${y + 4} ${x1 + d * 13},${y + 14}`} />
              <circle className="dc-num" cx={x1 - d * 16} cy={y} r={compact ? 9 : 8} />
              <text className="dc-numtxt" x={x1 - d * 16} y={y + 3.5} textAnchor="middle">{i + 1}</text>
              {!compact && <text className="svg-mono dc-label" x={x1 + d * 36} y={y + 4} textAnchor={right ? 'start' : 'end'}>{st.label}</text>}
            </g>
          )
        }
        const dir = x2 > x1 ? 1 : -1
        const tip = x2 - dir * 4
        const head = (t, dd) => `${t},${y} ${t - dd * 10},${y - 5} ${t - dd * 10},${y + 5}`
        const nx = x1 + dir * 16
        const mx = (x1 + dir * 30 + tip) / 2
        return (
          <g key={i} className={cls}>
            <line className={`svg-edge${state === 'now' ? ' on' + (st.kind === 'oob' || st.kind === 'ghost' ? '' : ' svg-flow') : ''}`} x1={x1 + dir * 26} x2={tip - dir * 8} y1={y} y2={y} />
            <polygon className="dc-head" points={head(tip, dir)} />
            {st.kind === 'rt' && <polygon className="dc-head" points={head(x1 + dir * 26, -dir)} />}
            {st.kind === 'ghost' && <text className="svg-text" x={mx} y={y + 4} textAnchor="middle" style={{ fill: 'var(--critical)', fontWeight: 700 }}>✕</text>}
            <circle className="dc-num" cx={nx} cy={y} r={compact ? 9 : 8} />
            <text className="dc-numtxt" x={nx} y={y + 3.5} textAnchor="middle">{i + 1}</text>
            {!compact && <text className="svg-mono dc-label" x={mx} y={y - 9} textAnchor="middle">{st.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}
