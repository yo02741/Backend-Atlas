// 設計情境：CLI、Agent 與服務的身分怎麼統一（各自發金鑰 / 共用 IdP 各自整合 / 集中式身分閘道）
export default {
  id: 'identity-gateway',
  order: 24,
  group: 'agent',
  title: 'CLI、Agent 與服務的統一身分',
  en: 'Unified identity for CLIs, agents and services',
  level: 2,
  week: 21,
  skills: ['identity-gateway', 'oauth-device-pkce', 'cli-token-storage', 'oauth-oidc'],
  lab: 'IdentityGatewayScenarioLab',
  summary: '桌機 CLI、SSH 主機上的 CLI、背景服務、agent、網頁都要呼叫內部 API：每個服務自己發金鑰、各自接 IdP，還是收到一個身分閘道？',
  situation: '虛構的軟體公司「北辰科技」有 12 個內部 API（報表、部署、工單、資料查詢……），呼叫它們的有：工程師筆電上的 `atlas` CLI、SSH 進跳板機後執行的同一個 CLI、6 個背景排程服務、代表工程師操作的 agent，以及各服務的網頁介面。公司已經有 Microsoft Entra ID 當 IdP。目前有的服務自己做帳號表與 API key，有的接了 Entra ID 但只做了網頁登入，CLI 使用者只能去各服務後台產生永不過期的個人 key。',
  constraints: [
    '員工在 IdP 被停用後，他在所有服務上的 token 要在短時間內全部失效',
    '跳板機與容器裡沒有瀏覽器，也通常沒有 OS keyring',
    '背景服務沒有使用者，不能借用某位工程師的帳號',
    'agent 的操作要在稽核紀錄裡和「本人親自操作」分得開，權限也要比本人小',
    '每季會新增一到兩個內部服務，整合登入不能每次都花上幾週',
  ],
  options: [
    {
      id: 'diy', name: '各服務自己做登入與發金鑰',
      summary: '每個服務自己的帳號表、密碼雜湊、登入頁；CLI 與排程用服務後台產生的 API key，寫在設定檔或環境變數。',
      pros: ['不依賴任何外部系統，每個團隊自己決定時程', '對單一服務來說最快能上線'],
      cons: ['同一件事做 12 遍、品質不一：有的有 MFA、有的連到期日都沒有', '離職要記得到 12 個後台停用；個人 key 跟 IdP 無關', '金鑰多半永不過期、寫在明文設定檔，agent 讀檔就讀進 context', '稽核散在各服務，分不出是人、腳本還是 agent'],
    },
    {
      id: 'shared-idp', name: '共用 IdP，各服務各自整合',
      summary: '每個服務向 Entra ID 註冊自己的 client，自己實作授權碼流程、驗 token、管 session 與 refresh；CLI 與 agent 的流程看各服務有沒有做。',
      pros: ['密碼與 MFA 交給 IdP，服務不碰密碼', '網頁登入一致，帳號停用後就登不進新的 session'],
      cons: ['每個服務都要自己實作流程與 token 驗證，常見只做了網頁、沒做 Device Code', 'CLI 與 agent 拿不到合適的 token 時，又退回後台產生的個人 key', '服務自己發的 session 與 key 不跟著 IdP 失效，撤銷規則 12 種', '每個服務一組 client secret，各自保管與輪替'],
    },
    {
      id: 'gateway', name: '集中式身分閘道',
      summary: '閘道接 Entra ID，對所有用戶端統一提供 Device Code、授權碼 + PKCE、Client Credentials；發 `aud` 指定服務、短效、有 scope 的 JWT；服務只用 JWKS 驗 token。CLI 的 refresh token 存 OS keyring。',
      pros: ['服務只做一件事：驗閘道簽的 token（JWKS、`aud`、`exp`、`scope`）', '每種用戶端都有對的流程，不再需要個人長效 key', 'refresh token rotation、按家族撤銷：只撤一台筆電或一個 agent', '一份使用紀錄：誰、哪個用戶端、哪種流程、打哪個服務'],
      cons: ['閘道是單點也是高價值目標：掛了所有人都登不進新 session', '多一個要維運的元件（自建或用 Keycloak 這類現成系統）', 'JWT 發出去就收不回：撤銷要等 access token 到期，高風險操作要改用 introspection', '遷移期間舊的登入路徑要一個一個關掉，否則只是多一條路'],
    },
  ],
  tradeoffs: {
    axes: ['新增一個服務的整合', '長效金鑰散落', '離職撤銷', 'CLI / agent 的流程', '維運成本'],
    rows: [
      { option: 'diy', cells: ['差：帳號、密碼、MFA、key 全部重做', '差：每人每服務一把', '差：逐個後台停用', '差：只有個人 key', '分散在每個團隊'] },
      { option: 'shared-idp', cells: ['中：流程與驗證各寫一次', '中：client secret + 退回的個人 key', '中：新登入擋住，舊 key 不擋', '中：看各服務做了沒', '中'] },
      { option: 'gateway', cells: ['好：登記 audience + 驗 JWT', '好：只剩背景服務的 client 憑證', '好：IdP 停用 → refresh 失敗', '好：Device Code / PKCE 統一提供', '集中：閘道要高可用'] },
    ],
  },
  decisions: [
    { id: 'one-app', situation: '只有一個內部網頁工具，十幾位同事用瀏覽器登入，沒有 CLI、沒有排程呼叫它，公司已有 Entra ID。', options: ['diy', 'shared-idp', 'gateway'], answer: 'shared-idp',
      explain: '只有一個服務，「各自整合」就只有一份：直接把這個工具註冊成 Entra ID 的 OIDC client，帳號停用就登不進來。為了一個網頁多建一個閘道，省不到任何整合工作，還多一個要維運的單點。' },
    { id: 'hackathon', situation: '為期兩週的離線實驗環境，沒有接任何 IdP，三個人、資料全是假的，結束就整個拆掉。', options: ['diy', 'shared-idp', 'gateway'], answer: 'diy',
      explain: '沒有身分系統可接，環境的壽命比導入閘道還短，自己發幾把 key 是合理的。但 key 仍要有範圍與到期日（兩週後全部失效），而且環境裡不能放真實資料或正式環境的憑證：拆掉的時候不留任何還能用的東西。' },
    { id: 'jump-host', situation: '12 個內部服務，工程師常在沒有瀏覽器的跳板機上用 CLI，還有 6 個排程服務；稽核要求每次呼叫都能對到人或服務。', options: ['diy', 'shared-idp', 'gateway'], answer: 'gateway',
      explain: '跳板機需要 Device Code、排程需要 Client Credentials，這兩個流程要 12 個服務各自實作幾乎不可能做齊，最後就是個人 key。閘道統一提供三種流程、發 aud 指定服務的短效 token，服務只驗 JWT；使用紀錄集中，對得到是誰、用哪個用戶端。' },
    { id: 'agent', situation: '要讓 agent 代表工程師呼叫部署與工單 API，資安要求 agent 只能唯讀、要能單獨撤銷，且不影響本人的 CLI 與網頁登入。', options: ['diy', 'shared-idp', 'gateway'], answer: 'gateway',
      explain: 'agent 在閘道上是一個獨立的用戶端：用 Device Code 讓本人在瀏覽器同意，拿到 scope 只有唯讀、自己一個 refresh 家族的 token。撤銷這個家族只影響 agent。各服務自己發 key 的做法，agent 只能拿本人那把，權限一樣大、撤了本人也斷。' },
  ],
  implementation: [
    { title: '閘道上的用戶端登記：每種用戶端對應一種流程（示意格式）', lang: 'yaml', code: `clients:
  atlas-cli:                      # 有瀏覽器的桌機 CLI
    type: public
    grants: [authorization_code]  # 一律搭配 PKCE（S256），redirect 到 127.0.0.1 隨機 port
    pkce: required
  atlas-cli-headless:             # SSH 主機、容器裡的 CLI
    type: public
    grants: [urn:ietf:params:oauth:grant-type:device_code]
    refresh_token: false          # 沒有 keyring 的環境：只發短效 access token，過期重新登入
  eng-agent:                      # 代表工程師的 agent：獨立用戶端，權限比本人小
    type: public
    grants: [urn:ietf:params:oauth:grant-type:device_code]
    allowed_scopes: [deploy.read, tickets.read]
  nightly-report:                 # 背景服務：沒有使用者
    type: confidential
    grants: [client_credentials]
    auth: private_key_jwt         # 不傳共享 secret，閘道只存公鑰
    allowed_scopes: [reports.read]

tokens:
  access_ttl: 10m
  refresh_idle: 7d
  refresh_absolute: 30d
  refresh_rotation: true          # 舊的 refresh token 再出現 → 整個家族撤銷` },
    { title: '服務端：只驗閘道簽的 JWT（PyJWT）', lang: 'python', code: `import jwt
from jwt import PyJWKClient

ISSUER = "https://id.example.com"
AUDIENCE = "https://reports.internal"            # 這個服務自己的資源識別碼
jwks = PyJWKClient(ISSUER + "/.well-known/jwks.json")   # 依 kid 取公鑰並快取

def authenticate(bearer: str, required_scope: str) -> dict:
    key = jwks.get_signing_key_from_jwt(bearer).key
    claims = jwt.decode(bearer, key, algorithms=["ES256"],   # alg 白名單
                        audience=AUDIENCE, issuer=ISSUER,     # 發給別的服務的 token 在這裡被擋
                        leeway=30)                            # exp 容許 30 秒時鐘誤差
    if required_scope not in claims.get("scope", "").split():
        raise PermissionError(f"insufficient_scope: {required_scope}")   # 回 403，不是 401
    return claims   # sub、client_id（atlas-cli / eng-agent / nightly-report）寫進稽核` },
    { title: 'CLI：refresh token 存 OS keyring，沒有 keyring 就明說', lang: 'python', code: `import keyring
from keyring.errors import NoKeyringError, PasswordDeleteError

SERVICE = "atlas-cli"

def save_refresh_token(account: str, token: str) -> None:
    try:
        keyring.set_password(SERVICE, account, token)
    except NoKeyringError:
        # 跳板機、容器：不要偷偷改存明文
        raise SystemExit("找不到系統 keyring。請改用 atlas login --device（只保留短效 token）。")

def logout(account: str, revoke) -> None:
    rt = keyring.get_password(SERVICE, account)
    if rt:
        revoke(rt)                                 # 先呼叫閘道的撤銷端點，再刪本機
    try:
        keyring.delete_password(SERVICE, account)
    except PasswordDeleteError:
        pass` },
  ],
  exercise: null,
}
