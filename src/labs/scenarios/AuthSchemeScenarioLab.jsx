import React, { useEffect, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Slider, Callout, Status, useReducedMotion } from '../ui.jsx'

/* 登入方案模擬器：
   左上：三種客戶端 × 四種做法的矩陣，點一格看細節
   左下：按「模擬 XSS」「模擬 CSRF」「登出所有裝置」，四種做法並排逐步演出結果
   右：選中那格的攻擊面 / 撤銷 / 多服務成本燈號；Slider 調 access token 效期看撤銷延遲 */

const CLIENTS = [
  { id: 'spa', name: '同站 SPA', sub: 'app.shop.tw → api.shop.tw' },
  { id: 'app', name: 'iOS / Android App', sub: '沒有 cookie jar 與 same-origin' },
  { id: 'third', name: '第三方整合', sub: '物流商的伺服器' },
]
const APPROACHES = [
  { id: 'cookie-session', name: 'Cookie + session', short: 'Cookie' },
  { id: 'jwt-storage', name: 'JWT 在 localStorage', short: 'JWT' },
  { id: 'bff', name: 'BFF', short: 'BFF' },
  { id: 'oauth-oidc', name: '授權伺服器', short: 'OAuth' },
]
const LEVEL = { ok: '適合', warn: '有條件', bad: '不適合' }
const FIT = {
  spa: {
    'cookie-session': ['ok', '同站 cookie 最省事；SameSite=Lax 再加 CSRF token'],
    'jwt-storage': ['bad', 'localStorage 任何一段 XSS 都讀得到，整個 token 帶走'],
    bff: ['ok', '瀏覽器只有 HttpOnly cookie，token 留在 BFF'],
    'oauth-oidc': ['warn', 'access token 在瀏覽器記憶體；正式做法通常再配 BFF'],
  },
  app: {
    'cookie-session': ['warn', '可行：App 自己存 cookie 當 bearer 用，但沒有瀏覽器那套保護，也和第三方無法共用'],
    'jwt-storage': ['warn', 'token 存 Keychain / Keystore（不是 localStorage）；撤銷仍要等 exp'],
    bff: ['bad', 'BFF 是給瀏覽器的；App 直接拿 token 就好'],
    'oauth-oidc': ['ok', '授權碼 + PKCE、系統瀏覽器登入，是平台的標準做法'],
  },
  third: {
    'cookie-session': ['bad', '外部程式拿不到、也不該拿使用者的 session'],
    'jwt-storage': ['bad', '要拿 token 只能跟使用者要密碼'],
    bff: ['bad', 'BFF 只服務自家前端，沒有入口'],
    'oauth-oidc': ['ok', '註冊成 client，使用者同意後拿 scope 限定、可撤銷的 token'],
  },
}
/* 每種做法的四個屬性燈號（XSS / CSRF 以瀏覽器為對象） */
const PROPS = {
  'cookie-session': { xss: ['ok', 'HttpOnly：script 讀不到 cookie；但頁面開著時注入的 script 仍可代發請求'], csrf: ['warn', 'cookie 會自動帶：要 SameSite=Lax + CSRF token 或 Origin 檢查'], revoke: ['ok', '刪 Redis 裡的 session，立即'], multi: ['warn', '每個服務每個請求都要查 Redis，或 gateway 查一次再往下傳身分'], cx: '低', delay: 0 },
  'jwt-storage': { xss: ['bad', 'localStorage.getItem 一行就偷走，可帶到攻擊者機器用到 exp'], csrf: ['ok', 'Authorization header 不會自動帶，不用防'], revoke: ['bad', '簽出去就收不回：等 exp，或每個服務查黑名單'], multi: ['ok', '公鑰驗簽章，不連任何儲存體'], cx: '低', delay: 1 },
  bff: { xss: ['ok', 'token 只在 BFF；瀏覽器只有 HttpOnly cookie'], csrf: ['warn', '面對瀏覽器的還是 cookie：SameSite + CSRF token'], revoke: ['ok', '砍 BFF 的 session，立即'], multi: ['ok', '後端服務只驗 BFF 帶來的 token 簽章'], cx: '中', delay: 0 },
  'oauth-oidc': { xss: ['warn', 'SPA 的 token 在記憶體：頁面被注入時偷得到；App 不受 XSS 影響'], csrf: ['ok', 'Bearer 不自動帶；授權流程本身靠 state / PKCE 防'], revoke: ['warn', 'refresh 立即撤銷；既有 access token 活到 exp'], multi: ['ok', 'JWKS 公鑰本地驗'], cx: '高', delay: 1 },
}
const PROP_LABEL = { xss: 'XSS 偷得到憑證？', csrf: 'CSRF 要防？', revoke: '能立即撤銷？', multi: '多服務驗證成本' }

/* 攻擊劇本：每種做法三步 + 結局 */
const PLAYS = {
  xss: {
    title: '頁面被注入 <script>（以 SPA 為對象）',
    'cookie-session': { steps: ['讀 document.cookie', '→ 空字串（HttpOnly）', '偷不到 cookie；但趁頁面開著可代發請求'], end: ['ok', '憑證沒外洩'] },
    'jwt-storage': { steps: ['讀 localStorage.token', '→ eyJhbGciOi…', 'fetch 到攻擊者伺服器，可用到 exp'], end: ['bad', 'token 被偷走'] },
    bff: { steps: ['讀 cookie / storage', '→ 都是空的', 'token 根本不在瀏覽器'], end: ['ok', '憑證沒外洩'] },
    'oauth-oidc': { steps: ['找記憶體裡的 token', '→ 從 SDK 物件或攔 fetch 拿到', '可用到 exp；refresh 若也在瀏覽器更糟'], end: ['warn', 'access token 被偷走'] },
  },
  csrf: {
    title: '惡意網站放一個自動送出的 <form> POST 到你的 API',
    'cookie-session': { steps: ['瀏覽器發 POST /orders/42/cancel', '→ 自動附上 sid cookie', 'SameSite=Lax 擋跨站 POST；沒設就要靠 CSRF token'], end: ['warn', '要防，靠 SameSite + token'] },
    'jwt-storage': { steps: ['瀏覽器發 POST', '→ 沒有 Authorization header', '401'], end: ['ok', '天生免疫'] },
    bff: { steps: ['瀏覽器發 POST 到 BFF', '→ 自動附上 cookie', '同 cookie session：SameSite + token'], end: ['warn', '要防，靠 SameSite + token'] },
    'oauth-oidc': { steps: ['瀏覽器發 POST', '→ 沒有 Bearer', '401'], end: ['ok', '天生免疫'] },
  },
  logout: {
    title: '使用者在手機上按「登出所有裝置」',
    'cookie-session': { steps: ['DEL session:user:42:*', '→ Redis 裡 3 個 session 全刪', '所有裝置的下一個請求就是 401'], end: ['ok', '立即'] },
    'jwt-storage': { steps: ['伺服器沒有狀態可刪', '→ 只能把 user 記進黑名單', '各服務不查黑名單，舊 token 就活到 exp'], end: ['bad', '等 exp'] },
    bff: { steps: ['砍 BFF 的 3 個 session', '→ 立即', 'BFF 手上的後端 token 沒人再用'], end: ['ok', '立即'] },
    'oauth-oidc': { steps: ['撤銷該使用者所有 refresh token family', '→ 換不到新的 access token', '既有 access token 活到 exp'], end: ['warn', 'access 等 exp'] },
  },
}
const EXPLAIN = {
  'cookie-session': ['瀏覽器把 cookie 當黑盒子：script 讀不到、但每個同站請求都自動帶上。前者擋 XSS 偷憑證，後者就是 CSRF 的來源，所以 SameSite 與 CSRF token 不是選配。', '撤銷靠伺服器端狀態，所以「登出所有裝置」是一句 DEL。代價是 6 個微服務每個請求都得查一次 Redis，或者在 gateway 查一次把身分塞進內部標頭。'],
  'jwt-storage': ['把 token 交給 JavaScript 保管，等於交給頁面上每一段 script——包含被注入的那段、第三方 SDK、被污染的 npm 套件。偷走之後不需要瀏覽器，攻擊者在自己機器上用到 exp。', '無狀態的另一面是收不回來。要滿足「1 分鐘內失效」，效期得設 1 分鐘（拉 Slider 看），或每個服務都查一次撤銷名單——那就不無狀態了。'],
  bff: ['SPA 面前放一個同站的 BFF，瀏覽器只拿到 HttpOnly cookie；BFF 用 session 換出後端的 token 再轉呼叫。瀏覽器端的安全性等同 cookie session，後端各服務卻只要驗簽章。', '多一個元件要部署、監控、擴展。App 不需要它：App 直接拿 token，存進 Keychain / Keystore。'],
  'oauth-oidc': ['所有客戶端統一向授權伺服器換 token：App 走授權碼 + PKCE，第三方註冊成 client、使用者同意 scope。這是唯一能給第三方用、又不交出密碼的做法。', 'SPA 端 token 仍在瀏覽器記憶體，被注入時偷得到；撤銷只能立刻撤 refresh，access 要等 exp。所以正式部署常是「授權伺服器 + SPA 走 BFF」兩者疊起來。'],
}

/* 憑證住在哪：每種做法的請求路徑（框＝元件，紅字＝憑證所在） */
const FLOWS = {
  'cookie-session': { nodes: ['客戶端', 'API 服務 ×6', 'Redis'], edges: ['Cookie: sid', 'GET session:sid'], hold: [0, 2], note: 'sid 只是鑰匙，身分在 Redis' },
  'jwt-storage': { nodes: ['客戶端', 'API 服務 ×6', '公鑰'], edges: ['Bearer <jwt>', '驗簽章'], hold: [0], note: 'JWT 整個在客戶端手上' },
  bff: { nodes: ['瀏覽器', 'BFF', 'API 服務 ×6'], edges: ['Cookie: sid', 'Bearer <token>'], hold: [1], note: 'token 只在 BFF' },
  'oauth-oidc': { nodes: ['客戶端', '授權伺服器', 'API 服務 ×6'], edges: ['code + PKCE → tokens', 'Bearer <access>'], hold: [0, 1], note: 'refresh 在客戶端，服務用 JWKS 驗' },
}
function Flow({ a, c }) {
  const f = FLOWS[a]
  const W = 420; const bw = 108; const gap = (W - 3 * bw) / 2
  const label0 = c === 'app' ? 'App' : c === 'third' ? '第三方' : f.nodes[0]
  return (
    <svg viewBox={`0 0 ${W} 88`} width="100%" aria-label="憑證在哪裡" className="as-flow">
      {f.nodes.map((n, i) => {
        const x = i * (bw + gap)
        const hot = f.hold.includes(i)
        return (
          <g key={n}>
            <rect x={x} y={14} width={bw} height={34} rx={4} className={`svg-node${hot ? ' on' : ''}`} />
            <text x={x + bw / 2} y={35} textAnchor="middle" className="svg-text">{i === 0 ? label0 : n}</text>
            {hot && <text x={x + bw / 2} y={62} textAnchor="middle" className="svg-mono" fill="var(--critical)">憑證在這</text>}
          </g>
        )
      })}
      {f.edges.map((e, i) => {
        const x1 = i * (bw + gap) + bw; const x2 = x1 + gap
        return (
          <g key={e}>
            <line x1={x1 + 3} y1={31} x2={x2 - 3} y2={31} className="svg-edge on svg-flow" />
            <text x={(x1 + x2) / 2} y={10} textAnchor="middle" className="svg-mono">{e}</text>
          </g>
        )
      })}
      <text x={W} y={84} textAnchor="end" className="svg-text small">{f.note}</text>
    </svg>
  )
}

export default function AuthSchemeScenarioLab() {
  const [sel, setSel] = useState({ c: 'spa', a: 'cookie-session' })
  const [ttl, setTtl] = useState(15)
  const [attack, setAttack] = useState(null)
  const [phase, setPhase] = useState(0)
  const [runId, setRunId] = useState(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!attack || phase >= 3) return
    const t = setTimeout(() => setPhase((p) => p + 1), reduced ? 120 : 600)
    return () => clearTimeout(t)
  }, [attack, phase, runId, reduced])
  const run = (k) => { setAttack(k); setPhase(0); setRunId((r) => r + 1) }

  const fit = FIT[sel.c][sel.a]
  const props = PROPS[sel.a]
  const client = CLIENTS.find((c) => c.id === sel.c)
  const approach = APPROACHES.find((a) => a.id === sel.a)
  const delayOf = (a) => PROPS[a].delay * ttl
  const play = attack ? PLAYS[attack] : null

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="三種客戶端 × 四種做法：點一格，再對它發動攻擊"
         blurb="矩陣裡每一格是一個組合。按下面三個按鈕，看四種做法在同一件事上各自發生什麼。所有時間為示意。">
      <LabControls>
        <button className="btn small" onClick={() => run('xss')}>模擬 XSS 注入</button>
        <button className="btn small" onClick={() => run('csrf')}>模擬 CSRF 表單</button>
        <button className="btn small" onClick={() => run('logout')}>按下「登出所有裝置」</button>
        <span className="spacer" />
        <Slider label="access token 效期" min={1} max={60} value={ttl} onChange={setTtl} format={(v) => `${v} 分鐘`} />
      </LabControls>
      <LabGrid>
        <div className="lab-stack">
          <LabStage label="客戶端 × 做法">
            <div className="as-matrix" role="grid">
              <div className="as-corner" />
              {APPROACHES.map((a) => <div key={a.id} className={`as-head${sel.a === a.id ? ' sel' : ''}`}>{a.name}</div>)}
              {CLIENTS.map((c) => (
                <React.Fragment key={c.id}>
                  <div className={`as-rowh${sel.c === c.id ? ' sel' : ''}`}><b>{c.name}</b><span>{c.sub}</span></div>
                  {APPROACHES.map((a) => {
                    const [l] = FIT[c.id][a.id]
                    const on = sel.c === c.id && sel.a === a.id
                    return (
                      <button key={a.id} type="button" className={`as-cell ${l}${on ? ' sel' : ''}`} aria-pressed={on}
                              onClick={() => setSel({ c: c.id, a: a.id })} aria-label={`${c.name} × ${a.name}：${LEVEL[l]}`}>
                        <i /><span>{LEVEL[l]}</span>
                      </button>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </LabStage>
          <div className="as-play">
            <h5>{play ? play.title : '還沒發動攻擊。按上面的按鈕，四種做法並排演出結果。'}</h5>
            <div className="as-play-grid">
              {APPROACHES.map((a) => {
                const p = play?.[a.id]
                const done = play && phase >= 3
                return (
                  <div key={a.id} className={`as-play-card${sel.a === a.id ? ' sel' : ''}${done ? ` ${p.end[0]}` : ''}`}>
                    <div className="h">{a.short}</div>
                    {p ? (
                      <>
                        <ol key={runId}>
                          {p.steps.map((s, i) => <li key={i} className={i < phase ? 'on' : ''}>{s}</li>)}
                        </ol>
                        {done && <Status ok={p.end[0] === 'ok'} warn={p.end[0] === 'warn'}>{attack === 'logout' && delayOf(a.id) > 0 ? `最多再活 ${ttl} 分鐘` : p.end[1]}</Status>}
                      </>
                    ) : <p className="muted">—</p>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="lab-stack">
          <div className="as-detail">
            <div className="as-detail-h">
              <span className="tag a">{client.name}</span><span className="muted">×</span><span className="tag b">{approach.name}</span>
              <Status ok={fit[0] === 'ok'} warn={fit[0] === 'warn'}>{LEVEL[fit[0]]}</Status>
            </div>
            <p className="as-fit">{fit[1]}</p>
            <Flow a={sel.a} c={sel.c} />
            <ul className="as-props">
              {Object.keys(PROP_LABEL).map((k) => (
                <li key={k}>
                  <span className="k">{PROP_LABEL[k]}</span>
                  <Status ok={props[k][0] === 'ok'} warn={props[k][0] === 'warn'}>{k === 'xss' ? (props[k][0] === 'ok' ? '偷不到' : props[k][0] === 'warn' ? '偷得到（記憶體）' : '偷得到') : k === 'csrf' ? (props[k][0] === 'ok' ? '不用' : '要防') : k === 'revoke' ? (props[k][0] === 'ok' ? '立即' : props[k][0] === 'warn' ? 'refresh 立即、access 等 exp' : '等 exp') : (props[k][0] === 'ok' ? '本地驗簽章' : '每請求查 Redis')}</Status>
                  <span className="t">{props[k][1]}</span>
                </li>
              ))}
              <li><span className="k">實作複雜度</span><span className="cx">{props.cx}</span><span className="t" /></li>
            </ul>
            <div className="as-delay">
              <span className="k">登出所有裝置後，舊憑證最多還能用</span>
              {APPROACHES.map((a) => {
                const d = delayOf(a.id)
                return <span key={a.id} className={`d ${d > 1 ? 'bad' : 'ok'}`}>{a.short} <b>{d === 0 ? '0 秒' : `${d} 分`}</b></span>
              })}
              <span className="muted">需求：≤ 1 分鐘。JWT / OAuth 要達標，效期得拉到 1，或各服務查 revoked_at。</span>
            </div>
          </div>
          <LabExplain title={approach.name}>{EXPLAIN[sel.a].map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會真的踩到">最常見的兩種事故：把 JWT 放 localStorage 然後被某個第三方 script 帶走；以及「登出後對方還能操作十幾分鐘」被客服當 bug 回報——那是 access token 效期，不是 bug。第三方需求一出現，前三種做法都得補上授權伺服器。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .as-matrix { display: grid; grid-template-columns: minmax(120px, 1.3fr) repeat(4, minmax(0, 1fr)); gap: 6px; }
        .as-head { font-size: 0.72rem; font-weight: 700; color: var(--ink-2); text-align: center; padding: 4px 2px; border-bottom: 2px solid transparent; }
        .as-head.sel { color: var(--lab-accent); border-color: var(--lab-accent); }
        .as-rowh { display: grid; align-content: center; gap: 2px; font-size: 0.8rem; padding: 4px 6px; border-left: 2px solid transparent; }
        .as-rowh span { font-size: 0.66rem; color: var(--ink-3); font-family: var(--mono); }
        .as-rowh.sel { border-color: var(--lab-accent); }
        .as-cell { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 52px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); color: var(--ink-2); font: inherit; font-size: 0.72rem; cursor: pointer; transition: transform 0.15s ease, border-color 0.2s ease, background 0.2s ease; }
        .as-cell i { width: 12px; height: 12px; border-radius: 50%; }
        .as-cell.ok i { background: var(--good); } .as-cell.warn i { background: var(--warning); } .as-cell.bad i { background: var(--critical); }
        .as-cell.ok { background: color-mix(in srgb, var(--good) 8%, var(--surface-1)); }
        .as-cell.bad { background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .as-cell:hover { transform: translateY(-1px); border-color: var(--ink-3); }
        .as-cell.sel { border-color: var(--lab-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--lab-accent) 35%, transparent); color: var(--ink-1); }
        .as-play h5 { font-family: var(--sans); font-size: 0.8rem; color: var(--ink-2); margin: 0 0 8px; }
        .as-play-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        @media (max-width: 640px) { .as-play-grid { grid-template-columns: 1fr 1fr; } .as-matrix { grid-template-columns: minmax(84px, 1fr) repeat(4, minmax(0, 1fr)); gap: 4px; } .as-rowh span { display: none; } }
        .as-play-card { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; display: grid; gap: 6px; align-content: start; transition: border-color 0.3s ease, background 0.3s ease; }
        .as-play-card.sel { border-color: var(--lab-accent); }
        .as-play-card.bad { background: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); border-color: var(--critical); }
        .as-play-card.warn { border-color: var(--serious); }
        .as-play-card.ok { border-color: color-mix(in srgb, var(--good) 50%, var(--hairline)); }
        .as-play-card .h { font-size: 0.74rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-2); }
        .as-play-card ol { list-style: none; display: grid; gap: 4px; margin: 0; padding: 0; }
        .as-play-card li { font-family: var(--mono); font-size: 0.68rem; line-height: 1.4; color: var(--ink-1); opacity: 0; transform: translateY(-3px); transition: opacity 0.3s ease, transform 0.3s ease; word-break: break-word; }
        .as-play-card li.on { opacity: 1; transform: none; }
        .as-play-card .status { justify-self: start; font-size: 0.7rem; padding: 2px 8px; }
        .as-detail { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 12px 14px; display: grid; gap: 10px; }
        .as-detail-h { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .as-detail-h .status { margin-left: auto; }
        .as-fit { font-size: 0.82rem; color: var(--ink-2); line-height: 1.5; }
        .as-flow { display: block; max-width: 100%; height: auto; }
        .as-flow .svg-mono { font-size: 9.5px; }
        .as-props { list-style: none; display: grid; gap: 8px; margin: 0; padding: 0; }
        .as-props li { display: grid; grid-template-columns: 118px auto; gap: 2px 10px; align-items: center; font-size: 0.78rem; }
        .as-props .k { color: var(--ink-3); font-weight: 600; }
        .as-props .t { grid-column: 2; font-size: 0.72rem; color: var(--ink-3); line-height: 1.45; }
        .as-props .cx { font-family: var(--mono); font-weight: 700; color: var(--ink-1); }
        .as-props .status { justify-self: start; font-size: 0.72rem; padding: 2px 8px; }
        .as-delay { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.74rem; border-top: 1px solid var(--hairline); padding-top: 10px; }
        .as-delay .k { width: 100%; color: var(--ink-3); font-weight: 600; }
        .as-delay .d b { font-family: var(--mono); }
        .as-delay .d.bad b { color: var(--critical); } .as-delay .d.ok b { color: var(--good); }
        .as-delay .muted { width: 100%; font-size: 0.7rem; }
      `}</style>
    </Lab>
  )
}
