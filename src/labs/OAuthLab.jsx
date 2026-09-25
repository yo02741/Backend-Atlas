import React, { useRef } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Toggle, Stepper, usePlayer, Code, Callout, useWidth } from './ui.jsx'

/* ============================================================
   OAuth 2.0 授權碼流程（+PKCE）：4 個參與者、8 步時序圖
   - 左：SVG 時序圖，目前步驟的箭頭流動、過去的變淡
   - 右：該步實際的 HTTP 請求／回應，重點行高亮；PKCE 開關會改內容
   ============================================================ */

const LANES = [
  { name: '瀏覽器', sub: '使用者' },
  { name: '你的 App', sub: 'Client 後端' },
  { name: '授權伺服器', sub: '例如 Google' },
  { name: '資源 API', sub: '受保護的資料' },
]

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

/* from/to 是 lane index；label 是箭頭上的短字；code(pkce) 回傳 { src, hl } */
const STEPS = [
  {
    label: '點「用 Google 登入」', from: 0, to: 1, title: '① 使用者點「用 Google 登入」',
    text: (p) => [
      'App 後端先產生一個隨機的 state 存進 session，等一下用來確認「回來的人就是出去的人」。',
      p ? '同時產生 code_verifier（43–128 字元隨機字串），算出 code_challenge = base64url(sha256(code_verifier))。verifier 留在自己手上，只把 challenge 送出去。'
        : '沒開 PKCE 時，這一步只有 state。公開型 client（SPA、手機 App）拿不住 client_secret，等一下換 token 時就沒有任何東西能證明「換 code 的人就是發起授權的人」。',
    ],
    code: (p) => ({
      src: `GET /login HTTP/1.1\nHost: app.example.com\n\n→ App 在 session 記下：\n  state          = "k3Qx7f…"（隨機）${p ? `\n  code_verifier  = "${VERIFIER}"\n  code_challenge = base64url(sha256(code_verifier))` : ''}`,
      hl: p ? [5, 6, 7] : [5],
    }),
  },
  {
    label: 'GET /authorize?…', from: 0, to: 2, title: '② 瀏覽器被導向授權伺服器的 /authorize',
    text: (p) => [
      'App 回 302，瀏覽器跟著跳到授權伺服器。網址裡帶著 response_type=code（我要授權碼）、client_id（我是誰）、redirect_uri（等一下送回哪）、scope（要哪些權限）、state。',
      p ? 'code_challenge 也在這裡送出。授權伺服器會把它和即將發出的 code 綁在一起記下來。'
        : '沒有 code_challenge：任何人只要攔到 code（例如手機上惡意 App 註冊了同一個 custom URL scheme），就能直接拿去換 token。',
    ],
    code: (p) => ({
      src: `HTTP/1.1 302 Found\nLocation: https://accounts.google.com/o/oauth2/v2/auth\n  ?response_type=code\n  &client_id=1234.apps.googleusercontent.com\n  &redirect_uri=https://app.example.com/callback\n  &scope=openid email profile\n  &state=k3Qx7f…${p ? `\n  &code_challenge=${CHALLENGE}\n  &code_challenge_method=S256` : ''}`,
      hl: p ? [3, 7, 8, 9] : [3, 7],
    }),
  },
  {
    label: '登入 + 同意', from: 0, to: 2, title: '③ 使用者在授權伺服器上登入並同意',
    text: () => [
      '帳號密碼、2FA 都發生在授權伺服器的網域，你的 App 從頭到尾看不到密碼——這就是 OAuth 的重點：委託授權，不交出憑證。',
      '同意畫面列出 scope 對應的白話描述。使用者按下同意後，授權伺服器產生一個一次性的 code，並記住它對應的 client_id、redirect_uri（和 code_challenge）。',
    ],
    code: () => ({
      src: `（在 accounts.google.com 的頁面上）\n\n使用者輸入帳密、通過 2FA\n同意畫面：\n  app.example.com 想要存取\n  ・你的 email\n  ・你的基本個人資料\n\n→ 授權伺服器發出 code，記下它綁定的\n  client_id / redirect_uri / code_challenge`,
      hl: [9, 10],
    }),
  },
  {
    label: '/callback?code&state', from: 0, to: 1, title: '④ 導回 redirect_uri，帶著 code 與 state',
    text: () => [
      '授權伺服器 302 到你登記過的 redirect_uri（只能是事先登記的，防止 code 被送去別的網址），瀏覽器再次跟著跳，query 裡有 code 與 state。',
      'App 第一件事：比對 state 是否等於 session 裡存的。不相等就中止——這防的是 CSRF：攻擊者把「他的」授權結果塞到你的瀏覽器裡，讓你的帳號綁到他的 Google。',
      'code 本身很短命（通常 10 分鐘內）、只能用一次，而且它還不是 token——瀏覽器攔到也沒直接用處。',
    ],
    code: () => ({
      src: `HTTP/1.1 302 Found\nLocation: https://app.example.com/callback\n  ?code=4/0AX4XfWh…\n  &state=k3Qx7f…\n\n→ App 檢查：state === session.state ?\n  不符 → 400，流程中止`,
      hl: [3, 4, 6],
    }),
  },
  {
    label: 'POST /token', from: 1, to: 2, title: '⑤ App 後端用 code 換 token',
    text: (p) => [
      '這一步是 back-channel：App 伺服器直接對授權伺服器發 POST，瀏覽器完全不參與，所以 client_secret（機密型 client 才有）不會經過使用者的裝置。',
      p ? '同時送上 code_verifier。授權伺服器算 base64url(sha256(verifier)) 和第 ② 步存的 code_challenge 比對——攔到 code 的人沒有 verifier，換不到 token。這就是 PKCE 補上的那一塊。'
        : '沒有 PKCE 的公開型 client 在這裡什麼都證明不了：code 是誰的、誰都能換。這就是為什麼現在的規範要求 SPA 與手機 App 一律用 PKCE。',
    ],
    code: (p) => ({
      src: `POST /token HTTP/1.1\nHost: oauth2.googleapis.com\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code\n&code=4/0AX4XfWh…\n&redirect_uri=https://app.example.com/callback\n&client_id=1234.apps.googleusercontent.com\n&client_secret=GOCSPX-…（機密型 client 才加）${p ? `\n&code_verifier=${VERIFIER}` : ''}`,
      hl: p ? [5, 6, 10] : [5, 6, 9],
    }),
  },
  {
    label: '200 {access_token,…}', from: 2, to: 1, title: '⑥ 授權伺服器回 access_token（與 refresh_token、id_token）',
    text: () => [
      'access_token 是拿去叫資源 API 的鑰匙，通常很短命（expires_in 約一小時）。refresh_token 用來在過期後換新的 access_token，不必再打擾使用者。',
      'id_token 只有 OIDC（scope 含 openid）才有：它是一個 JWT，內容是「這個使用者是誰」，給你的 App 自己看的。access_token 則是給資源 API 看的，格式不一定是 JWT。',
    ],
    code: () => ({
      src: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n{\n  "access_token": "ya29.a0AfH6…",\n  "token_type": "Bearer",\n  "expires_in": 3599,\n  "refresh_token": "1//0gK3…",\n  "id_token": "eyJhbGciOiJSUzI1NiIs…",\n  "scope": "openid email profile"\n}`,
      hl: [5, 8, 9],
    }),
  },
  {
    label: 'Authorization: Bearer …', from: 1, to: 3, title: '⑦ 帶著 Bearer token 呼叫資源 API',
    text: () => [
      '把 access_token 放進 Authorization: Bearer 標頭。Bearer 的意思就是「持有者」——誰拿著就當誰，所以 token 要走 HTTPS、不要進 log、不要放 URL。',
      '這一步可以是你的後端代打，也可以是前端直接打（若 token 交給了前端）；前者 token 不出伺服器，較安全。',
    ],
    code: () => ({
      src: `GET /oauth2/v3/userinfo HTTP/1.1\nHost: openidconnect.googleapis.com\nAuthorization: Bearer ya29.a0AfH6…`,
      hl: [3],
    }),
  },
  {
    label: '200 資料', from: 3, to: 1, title: '⑧ 資源 API 驗 token、回資料',
    text: () => [
      '資源 API 驗證 token：是誰簽的、過期沒、aud 是不是我、scope 夠不夠。JWT 型 token 可以本地驗簽章；不透明 token 則回頭問授權伺服器（introspection）。',
      '驗過就回資料。整個流程裡，你的 App 只拿到「被授權的那一小塊」——使用者隨時可以在 Google 帳號設定裡撤銷。',
    ],
    code: () => ({
      src: `HTTP/1.1 200 OK\nContent-Type: application/json\n\n{\n  "sub": "110169484474386276334",\n  "email": "alice@example.com",\n  "email_verified": true,\n  "name": "Alice"\n}`,
      hl: [5, 6],
    }),
  },
]

export default function OAuthLab() {
  const [pkce, setPkce] = React.useState(true)
  const { step, setStep, playing, toggle } = usePlayer(STEPS.length, 2200)
  const s = STEPS[step]
  const code = s.code(pkce)
  const ref = useRef(null)
  const w = useWidth(ref, 600)
  const compact = w < 430

  return (
    <Lab accent="orange" kicker="AUTH LAB" title="OAuth 2.0 授權碼流程（+PKCE）：8 步看懂"
         blurb="逐步播放「用 Google 登入」背後的 8 個來回。左邊時序圖亮出目前這一步的箭頭，右邊是該步真正的 HTTP 內容；關掉 PKCE 看少了哪兩樣東西、為什麼公開型 client 少不得。">
      <LabControls>
        <div className="oa-ctl"><Stepper step={step} total={STEPS.length} onStep={setStep} playing={playing} onPlay={toggle} /></div>
        <span className="spacer" />
        <Toggle label="PKCE（code_challenge / code_verifier）" checked={pkce} onChange={setPkce} />
      </LabControls>

      <LabGrid>
        <div ref={ref} className="oa-col">
          <LabStage label="OAuth 授權碼流程時序圖" caption={compact ? '窄版只顯示步驟編號；每一步的內容見下方說明。' : '實線箭頭 = HTTP 請求／回應；⑤⑥ 在後端之間進行，瀏覽器看不到。'}>
            <Sequence step={step} compact={compact} pkce={pkce} />
          </LabStage>
        </div>

        <div className="lab-stack">
          <Code lang="http" title={`第 ${step + 1} 步`} highlight={code.hl}>{code.src}</Code>
          <LabExplain title={s.title}>{s.text(pkce).map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <Callout title="工作上什麼時候用">
            <b>讓使用者用既有帳號登入</b>（Google / GitHub / 公司 SSO），或<b>代替使用者存取第三方資料</b>（讀他的行事曆、貼文到他的帳號）。
            自家前後端之間的登入不需要 OAuth——那是一般 session / JWT 的事；OAuth 的價值在「跨組織委託授權，不交出密碼」。
          </Callout>
          <Callout tone="good" title="三個常被混在一起的觀念">
            <b>OAuth 是「授權」，OIDC 加上「身分」：</b>OAuth 2.0 只給你 access_token 去叫 API；OpenID Connect 疊在上面，多回一個 id_token（JWT）告訴你使用者是誰。
            <b>為什麼不再用 implicit flow：</b>它把 access_token 直接放在導回網址的 fragment 裡，會留在瀏覽器歷史、被 referrer 外洩，也沒有 refresh 機制；授權碼 + PKCE 取代了它。
            <b>state 防 CSRF：</b>沒有 state，攻擊者能把自己的授權結果塞進你的流程，讓你的帳號綁到他的身分。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .oa-col { min-width: 0; }
        .oa-ctl .stepper { flex-wrap: wrap; }
        .oa-ctl .stepper button, .oa-ctl .stepper .count { white-space: nowrap; }
        .oa-life { stroke: var(--hairline); stroke-width: 1.5; stroke-dasharray: 3 4; }
        .oa-edge { transition: opacity 0.3s ease; }
        .oa-edge.past { opacity: 0.45; }
        .oa-edge.todo { opacity: 0.26; }
        .oa-edge .oa-head { fill: var(--ink-3); }
        .oa-edge.now .oa-head { fill: var(--lab-accent); }
        .oa-edge .oa-num { fill: var(--surface-1); stroke: var(--ink-3); stroke-width: 1.2; }
        .oa-edge.now .oa-num { fill: var(--lab-accent); stroke: var(--lab-accent); }
        .oa-edge .oa-numtxt { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--ink-2); }
        .oa-edge.now .oa-numtxt { fill: var(--page); }
        .oa-edge.now .oa-label { fill: var(--lab-accent); font-weight: 700; }
        .oa-back { fill: color-mix(in srgb, var(--ink-3) 8%, transparent); }
        .oa-pkce { fill: var(--lab-accent); font-family: var(--mono); font-size: 9.5px; font-weight: 700; }
      `}</style>
    </Lab>
  )
}

function Sequence({ step, compact, pkce }) {
  const W = compact ? 400 : 640, X = compact ? [52, 150, 250, 348] : [80, 240, 400, 560], bw = compact ? 92 : 124
  const top = 14, boxH = 40, y0 = 92, dy = 40
  const H = y0 + (STEPS.length - 1) * dy + 26
  const cur = STEPS[step]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`OAuth 時序圖，目前第 ${step + 1} 步：${cur.title}`}>
      {/* back-channel 區（App ↔ 授權伺服器，⑤⑥） */}
      <rect className="oa-back" x={X[1]} y={y0 + 4 * dy - 16} width={X[2] - X[1]} height={dy * 2 - 8} rx="4" />
      {!compact && <text className="svg-text small" x={(X[0] + X[1]) / 2} y={y0 + 4.5 * dy + 4} textAnchor="middle">← back-channel，瀏覽器看不到</text>}

      {LANES.map((l, i) => {
        const on = i === cur.from || i === cur.to
        return (
          <g key={l.name}>
            <line className="oa-life" x1={X[i]} x2={X[i]} y1={top + boxH} y2={H - 6} />
            <rect className={`svg-node${on ? ' on' : ''}`} x={X[i] - bw / 2} y={top} width={bw} height={boxH} rx="5" />
            <text className="svg-text" x={X[i]} y={top + 17} textAnchor="middle" style={{ fontWeight: 700 }}>{l.name}</text>
            <text className="svg-text small" x={X[i]} y={top + 31} textAnchor="middle">{l.sub}</text>
          </g>
        )
      })}

      {STEPS.map((st, i) => {
        const y = y0 + i * dy
        const x1 = X[st.from], x2 = X[st.to]
        const dir = x2 > x1 ? 1 : -1
        const tip = x2 - dir * 4          // 留一點空隙給生命線
        const head = `${tip},${y} ${tip - dir * 10},${y - 5} ${tip - dir * 10},${y + 5}`
        const state = i === step ? 'now' : i < step ? 'past' : 'todo'
        const nx = x1 + dir * 16
        const mx = (x1 + dir * 30 + tip) / 2     // 標籤置中在「圓圈之後 → 箭頭尖」之間
        const pk = pkce && (i === 1 || i === 4)
        return (
          <g key={i} className={`oa-edge ${state}`}>
            <line className={`svg-edge${state === 'now' ? ' on svg-flow' : ''}`} x1={x1 + dir * 26} x2={tip - dir * 8} y1={y} y2={y} />
            <polygon className="oa-head" points={head} />
            <circle className="oa-num" cx={nx} cy={y} r="8" />
            <text className="oa-numtxt" x={nx} y={y + 3.5} textAnchor="middle">{i + 1}</text>
            {!compact && (
              <text className="svg-mono oa-label" x={mx} y={y - 7} textAnchor="middle">{st.label}</text>
            )}
            {pk && <text className="oa-pkce" x={mx} y={y + 13} textAnchor="middle">+ PKCE</text>}
          </g>
        )
      })}
    </svg>
  )
}
