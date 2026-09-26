// 設計情境：SPA 加手機 App 的登入方案
export default {
  id: 'auth-scheme',
  order: 9,
  group: 'data',
  title: 'SPA 加手機 App 的登入方案',
  en: 'Auth scheme for SPA + mobile',
  level: 2,
  skills: ['authn-basics', 'jwt', 'oauth-oidc', 'cors-cookies', 'xss-csrf'],
  week: 7,
  lab: 'AuthSchemeScenarioLab',
  summary: '同一套 API 要服務同網域 SPA、iOS / Android App 與未來的第三方；要能「登出所有裝置」；六個微服務都要驗身分。',
  situation: '電商後台的 API 目前只有一個同站的 React SPA 在用（`app.shop.tw` 打 `api.shop.tw`）。下一季要上 iOS / Android App，明年要開放第三方物流商呼叫。客服要求：使用者按「登出所有裝置」後，其他裝置 1 分鐘內就不能再操作。後端已拆成 6 個微服務，每一個都要能判斷「這個請求是誰」。',
  constraints: [
    'SPA 與 API 同站（同一個 eTLD+1），可以用 cookie；App 沒有瀏覽器的 cookie jar 與 same-origin 保護',
    '「登出所有裝置」後，其他裝置最多 1 分鐘內失效',
    '6 個微服務都要驗身分，不能每個請求都回頭問使用者服務',
    '第三方物流商不能拿到使用者的密碼',
    '團隊沒有維護過授權伺服器',
  ],
  options: [
    {
      id: 'cookie-session', name: 'HttpOnly cookie + 伺服器端 session',
      summary: '登入後在 Redis 建 session，`Set-Cookie: __Host-sid=…; HttpOnly; Secure; SameSite=Lax`；每個服務拿 sid 查 Redis。',
      pros: ['script 讀不到 cookie，XSS 偷不走憑證', '撤銷立即：刪掉 Redis 的 session 就結束', '實作最少：框架內建'],
      cons: ['cookie 會被瀏覽器自動帶上，一定要防 CSRF（SameSite + token 或 Origin 檢查）', '每個服務每個請求都要查一次 Redis，或由 gateway 查一次再把身分往下傳', 'App 要自己管 cookie jar；第三方完全用不了'],
    },
    {
      id: 'jwt-storage', name: 'JWT 放 localStorage',
      summary: '登入回一個 JWT，前端存 `localStorage`，每個請求帶 `Authorization: Bearer`；各服務用公鑰驗簽章。',
      pros: ['各服務本地驗簽章，不連任何儲存體', '不會自動帶上，天生沒有 CSRF 問題', '瀏覽器與 App 走同一條路'],
      cons: ['任何 XSS 一行 `localStorage.getItem` 就把 token 整個帶走，可在攻擊者機器上用到 `exp`', '簽出去就收不回來：「登出所有裝置」要等 `exp`，或每個服務都查黑名單，等於放棄無狀態', '第三方要拿 token 只能跟使用者要密碼'],
    },
    {
      id: 'bff', name: 'BFF（Backend for Frontend）',
      summary: 'SPA 只跟同站的 BFF 講話、用 HttpOnly cookie session；BFF 拿 session 換成後端 token 再轉呼叫各服務。App 直接拿 token。',
      pros: ['token 從不進瀏覽器：XSS 偷不走', '撤銷立即：砍 BFF 的 session', '後端服務只驗 token 簽章，一套驗證邏輯服務 SPA 與 App'],
      cons: ['多一個要部署、要維護、會成為瓶頸的元件', 'BFF 面對的還是 cookie，CSRF 一樣要防', 'BFF 只服務自家前端，第三方仍然沒有入口'],
    },
    {
      id: 'oauth-oidc', name: '授權伺服器（OAuth 2.0 / OIDC）',
      summary: '所有客戶端向授權伺服器換 access / refresh token；App 與 SPA 用授權碼 + PKCE，第三方註冊成 client；各服務用 JWKS 驗 access token。',
      pros: ['唯一能讓第三方「不拿密碼、只拿被同意的 scope」的做法', 'App 用系統瀏覽器登入 + PKCE，是平台的標準做法', 'refresh token rotation + 重用偵測，撤銷 refresh 立即生效'],
      cons: ['要自建或引入一個授權伺服器（Keycloak、Ory、Auth0 之類），是團隊沒碰過的元件', 'SPA 端 access token 仍在瀏覽器記憶體，被注入時偷得到；正式做法通常再配 BFF', 'access token 活到 `exp`：要滿足 1 分鐘內失效，效期得 ≤ 1 分鐘或各服務查 `revoked_at`'],
    },
  ],
  tradeoffs: {
    axes: ['XSS 偷得到憑證', 'CSRF 要防', '立即撤銷', '多服務驗證成本', '實作複雜度'],
    rows: [
      { option: 'cookie-session', cells: ['好：HttpOnly', '要：cookie 自動帶', '好：刪 session', '差：每請求查 Redis', '低'] },
      { option: 'jwt-storage', cells: ['差：localStorage 直接讀', '不用', '差：等 `exp` 或查黑名單', '好：本地驗簽章', '低'] },
      { option: 'bff', cells: ['好：token 不在瀏覽器', '要：還是 cookie', '好：砍 BFF session', '好：驗簽章', '中'] },
      { option: 'oauth-oidc', cells: ['中：記憶體裡的 token', '不用', '中：refresh 立即、access 等 `exp`', '好：JWKS 本地驗', '高'] },
    ],
  },
  decisions: [
    { id: 'spa-only', situation: '只有一個同站 SPA，沒有 App 計畫，三個人的團隊，一個單體後端。', options: ['cookie-session', 'jwt-storage', 'bff', 'oauth-oidc'], answer: 'cookie-session',
      explain: '同站、沒有 App、單體：cookie session 的每個缺點都不成立，優點（XSS 偷不走、立即撤銷、框架內建）全拿到。JWT 放 localStorage 是把最大的攻擊面換一個沒人需要的「無狀態」；BFF 與授權伺服器都是為了現在沒有的客戶端付費。' },
    { id: 'spa-app', situation: 'SPA + iOS / Android App，全是自家客戶端，沒有第三方，要「登出所有裝置」1 分鐘內生效。', options: ['cookie-session', 'jwt-storage', 'bff', 'oauth-oidc'], answer: 'bff',
      explain: '瀏覽器這邊用 BFF：token 不進瀏覽器、撤銷砍 session 立即。App 直接跟登入服務拿 token 存在 Keychain / Keystore，各服務只驗簽章。要滿足 1 分鐘，App 的 access token 效期設 ≤ 1 分鐘、靠 refresh rotation 換新，撤銷時撤 refresh。授權伺服器能做到同樣的事，但為了自家客戶端多養一個系統不划算。' },
    { id: 'third-party', situation: '要讓第三方物流商用你的 API 查它負責的訂單，使用者要能授權、也要能收回。', options: ['cookie-session', 'jwt-storage', 'oauth-oidc'], answer: 'oauth-oidc',
      explain: '第三方不能拿密碼，只能拿「使用者同意過、scope 限定、可撤銷」的 token——這正是 OAuth 2.0 授權碼流程定義的東西。cookie session 給不了外部程式；讓第三方拿 JWT 等於要使用者把密碼交出去。' },
    { id: 'internal-sso', situation: '內部工具只有員工用，公司已有 Google Workspace；離職員工當天就要進不來。', options: ['cookie-session', 'jwt-storage', 'oauth-oidc'], answer: 'oauth-oidc',
      explain: '登入交給公司的 IdP（OIDC），你的工具是 relying party：帳號停用就登不進來，不用自己管密碼與 MFA。驗完 id_token 之後，工具本身用同站的 cookie session 維持狀態並設短效期——不要把 id_token 存進 localStorage 當 session 用。' },
  ],
  implementation: [
    { title: 'Cookie session：登入回應與後續請求（__Host- 前綴強制 Secure、無 Domain、Path=/）', lang: 'http', code: `POST /login HTTP/1.1
Host: api.shop.tw
Content-Type: application/json

HTTP/1.1 204 No Content
Set-Cookie: __Host-sid=7f3a9c…; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600
Set-Cookie: __Host-csrf=9c1e4b…; Path=/; Secure; SameSite=Lax

POST /orders/42/cancel HTTP/1.1
Host: api.shop.tw
Sec-Fetch-Site: same-site
Cookie: __Host-sid=7f3a9c…; __Host-csrf=9c1e4b…
X-CSRF-Token: 9c1e4b…` },
    { title: 'Refresh token rotation + 重用偵測（App 與授權伺服器兩種做法都用得到）', lang: 'python', code: `import hashlib, secrets
from datetime import timedelta

def h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

async def refresh(old_token: str) -> tuple[str, str]:
    row = await db.fetchrow(
        "SELECT id, family_id, user_id, used_at, revoked_at, expires_at "
        "FROM refresh_tokens WHERE token_hash = $1", h(old_token))
    if row is None or row["revoked_at"] or row["expires_at"] < now():
        raise Unauthorized()
    if row["used_at"] is not None:
        # 同一個 refresh token 被用第二次：有人偷走了。整個家族一起作廢
        await db.execute("UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1", row["family_id"])
        raise Unauthorized("refresh token reuse")
    new_refresh = secrets.token_urlsafe(48)
    async with db.transaction():
        await db.execute("UPDATE refresh_tokens SET used_at = now() WHERE id = $1", row["id"])
        await db.execute(
            "INSERT INTO refresh_tokens (token_hash, family_id, user_id, expires_at) "
            "VALUES ($1, $2, $3, now() + interval '30 days')",
            h(new_refresh), row["family_id"], row["user_id"])
    access = sign_jwt(sub=row["user_id"], ttl=timedelta(minutes=1))   # 要 1 分鐘內失效就設 1 分鐘
    return access, new_refresh

async def logout_everywhere(user_id: int) -> None:
    # 撤銷所有 refresh；既有 access token 最多再活一個 ttl
    await db.execute("UPDATE refresh_tokens SET revoked_at = now() "
                     "WHERE user_id = $1 AND revoked_at IS NULL", user_id)` },
    { title: 'BFF 的路徑：瀏覽器只帶 cookie 到同站的 BFF，BFF 換成 Bearer 再打內部服務', lang: 'http', code: `GET /bff/orders/42 HTTP/1.1
Host: app.shop.tw
Cookie: __Host-sid=7f3a9c…

BFF：sid → Redis session → 取出該使用者的 access token，改寫成對內部服務的請求

GET /orders/42 HTTP/1.1
Host: orders.internal
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjIwMjYtMDkifQ…
X-Request-Id: 8b2f1e…

HTTP/1.1 200 OK
Content-Type: application/json

BFF 把回應原樣轉回瀏覽器；token 從頭到尾沒出現在瀏覽器` },
  ],
  exercise: 'cors-cookies-1',
  refs: [],
}
