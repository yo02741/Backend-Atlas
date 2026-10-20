import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Stepper, usePlayer, Code, Callout, Status, Stats, Stat, Flow, Caption, fmtN } from '../ui.jsx'

/* 身分統一情境模擬器：選一種用戶端（桌機 CLI / 跳板機 CLI / 背景服務 / agent），看三種做法下
   它用什麼流程拿 token、token 壽命與範圍、存在哪裡、撤銷會波及誰；
   按「新增一個服務」逐步播放整合清單，比較三種做法的工作量與長效金鑰散落數。全部數字是示意 */

const MODES = [
  { value: 'diy', label: '各服務自己發金鑰' },
  { value: 'shared-idp', label: '共用 IdP 各自整合' },
  { value: 'gateway', label: '集中式身分閘道' },
]
const CLIENTS = [
  { value: 'cli', label: '桌機 CLI（有瀏覽器）' },
  { value: 'headless', label: '跳板機 CLI（無瀏覽器）' },
  { value: 'service', label: '背景服務' },
  { value: 'agent', label: 'agent' },
]
const B = 6   // 背景排程服務數

/* 每種用戶端在每種做法下的樣子：flow 流程、life 壽命、scope 範圍、store 存放、revoke 撤銷影響 */
const DETAIL = {
  cli: {
    diy: { flow: '到每個服務後台產生個人 API key', life: '多數永不過期', scope: '等同本人在該服務的全部權限', store: '~/.config 底下的明文設定檔', revoke: '要到每個服務後台各撤一次；用同一把 key 的腳本一起斷', tone: 'bad' },
    'shared-idp': { flow: '看服務：有的做了授權碼 + PKCE，有的只能產生個人 key', life: '各服務自訂', scope: '各服務自訂', store: 'CLI 自己決定，常見是設定檔', revoke: 'IdP 停用擋住新登入；服務自己發的 key 不受影響', tone: 'warn' },
    gateway: { flow: '授權碼 + PKCE，瀏覽器導回 127.0.0.1 的隨機 port', life: 'access 10 分；refresh 閒置 7 天、上限 30 天，每次換新', scope: 'aud 指定一個服務，scope 例如 reports.read', store: 'refresh token 存 OS keyring，access token 只在記憶體', revoke: '撤銷這個 refresh 家族：只影響這台筆電上的 CLI', tone: 'ok' },
  },
  headless: {
    diy: { flow: '把個人 key 貼進跳板機的環境變數', life: '多數永不過期', scope: '等同本人全部權限', store: '環境變數：每個子程序都繼承，還留在 shell history', revoke: '同桌機，另外要記得清掉跳板機上那一份', tone: 'bad' },
    'shared-idp': { flow: '多數服務只做了網頁登入，沒做 Device Code → 退回個人 key', life: '多數永不過期', scope: '等同本人全部權限', store: '環境變數或明文檔', revoke: '同桌機，IdP 停用擋不住這些 key', tone: 'bad' },
    gateway: { flow: 'Device Code：在手機或筆電瀏覽器輸入 user_code、通過 MFA', life: 'access 10 分；不發 refresh token，過期重新登入', scope: 'aud 指定一個服務，scope 最小', store: '只在記憶體；沒有 keyring 時不寫明文檔', revoke: '10 分鐘內自然失效，機器上沒有能再換新的東西', tone: 'ok' },
  },
  service: {
    diy: { flow: '後台產生的 API key，掛在某位工程師名下', life: '永不過期', scope: '那位工程師的全部權限', store: '部署設定裡的環境變數', revoke: '那位工程師離職就一起斷；或者沒人敢撤', tone: 'bad' },
    'shared-idp': { flow: 'Client Credentials 向 IdP 要 token；不接受 IdP token 的服務仍用 key', life: '依 IdP 設定', scope: '各目標服務各自定義', store: '伺服器的 secret 管理', revoke: '停用這個 client；用 key 的那幾個服務另外處理', tone: 'warn' },
    gateway: { flow: 'Client Credentials，用私鑰簽 JWT 證明身分（閘道只存公鑰）', life: 'access 10 分；不發 refresh token，隨時再要', scope: '最小：只有 reports.read', store: '伺服器 secret 管理裡的私鑰', revoke: '停用這個 client：只影響這個排程', tone: 'ok' },
  },
  agent: {
    diy: { flow: '把本人的 API key 交給 agent', life: '永不過期', scope: '和本人一樣大', store: 'agent 讀得到的設定檔或環境變數，可能被讀進 context', revoke: '撤 agent 的就是撤本人的：同一把 key', tone: 'bad' },
    'shared-idp': { flow: '沿用本人的 token 或 key，服務分不出是 agent', life: '看各服務', scope: '和本人一樣大', store: '和本人的 CLI 同一處', revoke: '沒辦法只撤 agent', tone: 'bad' },
    gateway: { flow: 'Device Code：本人在瀏覽器同意，agent 是獨立用戶端 eng-agent', life: 'access 10 分；自己一個 refresh 家族', scope: '比本人小：deploy.read、tickets.read', store: '本機存 OS keyring；容器裡注入短效 token，不放長效秘密', revoke: '撤銷 eng-agent 的家族：本人的 CLI 與網頁不受影響', tone: 'ok' },
  },
}

/* 新增一個服務時，每種做法要做的事（人天為示意） */
const WORK = {
  diy: [['帳號表、密碼雜湊（bcrypt / Argon2）、登入頁', 5], ['自己做 MFA，或者乾脆沒做', 4], ['API key：產生、只存雜湊、到期、撤銷後台', 4], ['離職清單加一行「記得來這裡停用」', 2]],
  'shared-idp': [['在 IdP 註冊 client，保管並輪替 client secret', 0.5], ['實作授權碼 + PKCE、session 與 refresh', 2.5], ['驗 token：JWKS、iss、aud、exp', 1], ['CLI 要用？再做 Device Code，常排不進時程，於是開放個人 key', 2]],
  gateway: [['在閘道登記資源：aud=新服務，定義 scope', 0.25], ['服務端加 JWT 驗證 middleware（JWKS、aud、scope）', 0.75], ['CLI、agent、排程不用改：向閘道要 aud=新服務 的 token', 0], ['使用紀錄自動出現在閘道的報表裡', 0]],
}
const days = (m) => WORK[m].reduce((a, w) => a + w[1], 0)

function metrics(mode, s, u) {
  if (mode === 'diy') return { keys: Math.round(u * s / 2) + B * 2, keysNote: '每人在半數服務各一把 + 排程的 key', off: s, offNote: `${s} 個後台各停用一次` }
  if (mode === 'shared-idp') return { keys: s + Math.round(u * s / 4) + B, keysNote: 'client secret + 沒做 CLI 流程的服務退回的個人 key', off: 1 + Math.ceil(s / 2), offNote: 'IdP 停用 + 發過個人 key 的服務' }
  return { keys: B, keysNote: '只剩排程服務的私鑰；使用者端沒有長效 key', off: 1, offNote: 'IdP 停用，下次 refresh 失敗' }
}

/* alice 名下的各種登入，加上一個排程服務：撤銷或離職時誰會斷。回傳 [tone, 說明]：ok 該斷的斷了、bad 不該斷的斷了或該斷的還活著 */
const SESS = [{ id: 'cli', label: '桌機 CLI' }, { id: 'headless', label: '跳板機 CLI' }, { id: 'agent', label: 'agent' }, { id: 'web', label: '網頁' }, { id: 'service', label: '排程服務' }]
const PERSONAL = ['cli', 'headless', 'agent']
function impact(mode, act, client, id) {
  if (act === 'revoke') {
    if (id === client) return ['ok', '已撤銷']
    if (mode === 'gateway' || client === 'service' || id === 'web' || id === 'service') return ['', '不受影響']
    return ['bad', '同一把 key，一起斷']
  }
  if (mode === 'gateway') return id === 'service' ? ['', '服務身分，不受影響'] : ['ok', '下次 refresh 失敗，10 分內失效']
  if (mode === 'diy') return id === 'service' ? ['warn', '掛她名下的 key：撤了排程就斷'] : ['bad', id === 'web' ? '服務自己的帳號，仍可登入' : 'key 仍有效']
  if (id === 'web') return ['ok', 'IdP 擋住新登入']
  if (id === 'service') return ['', '自己的 client，不受影響']
  return id === 'cli' ? ['warn', '有做 PKCE 的服務擋住，個人 key 仍有效'] : ['bad', id === 'agent' ? '沿用她的 key，仍有效' : 'key 仍有效']
}

/* 報表 API 收到的東西：閘道下是一張 JWT 的 payload，其他做法是一把 key */
const CLAIMS = {
  cli: { sub: 'u_alice', client_id: 'atlas-cli', scope: 'reports.read' },
  headless: { sub: 'u_alice', client_id: 'atlas-cli-headless', scope: 'reports.read' },
  service: { sub: 'svc:nightly-report', client_id: 'nightly-report', scope: 'reports.read' },
  agent: { sub: 'u_alice', client_id: 'eng-agent', scope: 'reports.read' },
}
function received(mode, client) {
  if (mode !== 'gateway') return { lang: 'http', title: '報表 API 收到的', src: `GET /reports/weekly HTTP/1.1
Host: reports.internal
X-API-Key: atl_live_Xb3kQ9vT…
# 服務只知道這把 key 屬於誰
# 分不出是本人、腳本還是 agent` }
  const c = CLAIMS[client]
  return { lang: 'json', title: '報表 API 收到的 JWT payload', src: `{
  "iss": "https://id.example.com",
  "aud": "https://reports.internal",
  "sub": "${c.sub}",
  "client_id": "${c.client_id}",
  "scope": "${c.scope}",
  "iat": 1792483200,
  "exp": 1792483800
}` }
}

const EXPLAIN = {
  diy: { title: '各服務自己發金鑰：同一件事做 N 遍', body: ['每個服務有自己的帳號表與 API key。CLI、跳板機、排程、agent 全部拿同一種東西：永不過期、等同本人權限、寫在明文檔或環境變數裡的 key。', '流程選擇根本不存在，所以四種用戶端的答案都一樣差。離職時要記得 N 個後台，而且沒有清單能確認全部停完。'] },
  'shared-idp': { title: '共用 IdP 各自整合：網頁好了，CLI 與 agent 沒有', body: ['密碼與 MFA 交給 IdP，網頁登入變一致；但每個服務都要自己實作流程與驗 token。多數服務只做了網頁，跳板機需要的 Device Code 沒人做，於是又開放個人 key。', 'IdP 停用帳號只擋得住新的登入，服務自己發的 key 與 session 照樣有效；agent 也只能沿用本人的權限。'] },
  gateway: { title: '集中式身分閘道：每種用戶端有對的流程，服務只驗 token', body: ['閘道接 IdP，統一提供 Device Code、授權碼 + PKCE、Client Credentials。token 的 aud 指定一個服務、10 分鐘到期、scope 最小；服務用 JWKS 自己驗，不碰密碼也不發 key。', '每次登入是一個 refresh 家族，可以只撤一台筆電或一個 agent。代價是閘道成為單點；JWT 發出去收不回，撤銷要等 access token 到期，高風險操作改用 introspection。'] },
}

export default function IdentityGatewayScenarioLab() {
  const [mode, setMode] = useState('diy')
  const [client, setClient] = useState('headless')
  const [s, setS] = useState(12)
  const [u, setU] = useState(40)
  const [adding, setAdding] = useState(false)
  const [act, setAct] = useState(null)
  const { step, setStep, playing, toggle } = usePlayer(4, 1300)
  const d = DETAIL[client][mode]
  const m = metrics(mode, s, u)
  const ex = EXPLAIN[mode]
  const rx = received(mode, client)
  const work = WORK[mode]
  const done = adding ? work.slice(0, step + 1).reduce((a, w) => a + w[1], 0) : 0
  const addService = () => { setS((v) => Math.min(40, v + 1)); setAdding(true); setStep(0); toggle() }

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="四種用戶端、三種做法：token 從哪來、放哪裡、撤了誰會斷"
         blurb="選一種用戶端看它該走哪個流程、token 壽命與範圍、存放位置與撤銷影響；按「新增一個服務」逐步看三種做法的整合工作量。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Seg label="用戶端" value={client} onChange={setClient} options={CLIENTS} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="這個用戶端拿 token 的方式">
            <ClientFlow mode={mode} client={client} />
            <dl key={`${mode}-${client}`} className={`ig-card ${d.tone}`}>
              <dt>流程</dt><dd>{d.flow}</dd>
              <dt>壽命</dt><dd>{d.life}</dd>
              <dt>範圍</dt><dd>{d.scope}</dd>
              <dt>存放</dt><dd>{d.store}</dd>
              <dt>撤銷影響</dt><dd>{d.revoke}</dd>
            </dl>
            <div className="ig-act">
              <button type="button" className={`btn small${act === 'revoke' ? '' : ' ghost'}`} onClick={() => setAct('revoke')}>撤銷這個用戶端的 token</button>
              <button type="button" className={`btn small${act === 'leave' ? '' : ' ghost'}`} onClick={() => setAct('leave')}>alice 離職（IdP 停用）</button>
            </div>
            {act && (
              <ul className="ig-sess" aria-label="alice 名下各登入的狀態">
                {SESS.map((x) => {
                  const [tone, text] = impact(mode, act, client, x.id)
                  return <li key={`${act}-${mode}-${client}-${x.id}`} className={`${tone}${x.id === client ? ' sel' : ''}`}><b>{x.label}</b><span>{text}</span></li>
                })}
              </ul>
            )}
            <div className="ig-status">
              {d.tone === 'ok' ? <Status ok>短效、有範圍、可單獨撤銷</Status> : d.tone === 'warn' ? <Status warn>看各服務怎麼做</Status> : <Status>長效、等同本人權限</Status>}
            </div>
          </LabStage>
          <LabControls>
            <Slider label="內部服務數" min={3} max={40} value={s} onChange={setS} format={(v) => `${v} 個`} />
            <Slider label="CLI / agent 使用者" min={10} max={100} step={5} value={u} onChange={setU} format={(v) => `${v} 人`} />
            <button type="button" className="btn small" onClick={addService}>新增一個服務</button>
          </LabControls>
          {adding && (
            <div className="ig-work">
              <div className="ig-work-h">
                <b>第 {s} 個服務要做的事</b>
                <span>{fmtN(done)} / {fmtN(days(mode))} 人天（示意）</span>
              </div>
              <ol>
                {work.map((w, i) => (
                  <li key={`${mode}-${i}`} className={i <= step ? 'on' : ''}>
                    <span>{w[0]}</span><em>{w[1] ? `${w[1]} 天` : '0'}</em>
                  </li>
                ))}
              </ol>
              <Stepper step={step} total={4} onStep={setStep} playing={playing} onPlay={toggle} />
            </div>
          )}
          <Stats min={130}>
            <Stat label="新增一個服務" value={fmtN(days(mode))} unit="人天" tone={days(mode) > 5 ? 'bad' : days(mode) > 1 ? 'warn' : 'ok'} note="示意" />
            <Stat label="長效金鑰散落" value={fmtN(m.keys)} unit="把" tone={m.keys > 50 ? 'bad' : m.keys > B ? 'warn' : 'ok'} note={m.keysNote} />
            <Stat label="一人離職要改" value={m.off} unit="處" tone={m.off > 3 ? 'bad' : m.off > 1 ? 'warn' : 'ok'} note={m.offNote} />
          </Stats>
          <div className="dtable-wrap">
            <table className="dtable ig-cmp">
              <caption>三種做法並排（{s} 個服務、{u} 位使用者、{B} 個排程；示意）</caption>
              <thead><tr><th>做法</th><th>新增服務</th><th>長效金鑰</th><th>離職要改</th></tr></thead>
              <tbody>
                {MODES.map((o) => {
                  const x = metrics(o.value, s, u)
                  return (
                    <tr key={o.value} className={`clickable${o.value === mode ? ' hit' : ''}`} onClick={() => setMode(o.value)}>
                      <td>{o.label}</td><td>{days(o.value)} 人天</td><td>{fmtN(x.keys)}</td><td>{x.off} 處</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Caption>假設每位使用者用到半數服務；共用 IdP 時約一半的服務沒做 CLI 流程而開放個人 key。閘道的 refresh token 會輪替、可按家族撤銷，不算長效金鑰。</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Code lang={rx.lang} title={rx.title} highlight={mode === 'gateway' ? [5] : [3]}>{rx.src}</Code>
          <LabExplain title="四種用戶端各配哪個流程">
            <p>有瀏覽器的桌機 CLI 用授權碼 + PKCE；沒有瀏覽器的跳板機、容器用 Device Code，登入在另一台裝置完成；沒有使用者的背景服務用 Client Credentials；agent 代表某人時也走 Device Code，但它是獨立的用戶端，scope 比本人小。</p>
            <p>「撤銷這個用戶端」看只撤一個登入時會不會波及別的；「alice 離職」看 IdP 停用之後哪些還活著。紅色是不該發生的結果：該斷的沒斷，或不該斷的被拖下水。</p>
            <p>切到「集中式身分閘道」再切換用戶端，看流程、存放與撤銷影響怎麼跟著變；其他兩種做法下，四種用戶端多半落到同一個答案：個人 key。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">有人在跳板機上需要跑 CLI、有排程要呼叫第三個內部 API、有人想讓 agent 代為操作，或資安問「某位離職同事還有哪些 key 有效」而沒人答得出來。內部服務超過三、四個，而且呼叫者不只是瀏覽器時，各自整合的成本就開始超過一個閘道。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .ig-card { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 12px 0 0; padding: 12px 14px; border: 1px solid var(--hairline); border-left: 3px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-size: 0.82rem; animation: ig-in 0.3s ease-out both; }
        .ig-card.ok { border-left-color: var(--good); }
        .ig-card.warn { border-left-color: var(--serious); }
        .ig-card.bad { border-left-color: var(--critical); }
        .ig-card dt { color: var(--ink-3); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; padding-top: 1px; }
        .ig-card dd { margin: 0; color: var(--ink-1); line-height: 1.5; min-width: 0; overflow-wrap: anywhere; }
        .ig-status { margin-top: 8px; }
        .ig-act { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .ig-sess { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 6px; }
        .ig-sess li { display: grid; gap: 2px; padding: 7px 9px; border: 1px solid var(--hairline); border-top: 3px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-size: 0.74rem; animation: ig-in 0.3s ease-out both; }
        .ig-sess li b { font-size: 0.78rem; color: var(--ink-1); }
        .ig-sess li span { color: var(--ink-2); line-height: 1.4; }
        .ig-sess li.sel { box-shadow: 0 0 0 1px var(--lab-accent); }
        .ig-sess li.ok { border-top-color: var(--good); }
        .ig-sess li.warn { border-top-color: var(--serious); }
        .ig-sess li.bad { border-top-color: var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .ig-work { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); }
        .ig-work-h { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; font-size: 0.82rem; }
        .ig-work-h span { font-family: var(--mono); color: var(--ink-2); }
        .ig-work ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; counter-reset: ig; }
        .ig-work li { counter-increment: ig; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: baseline; padding: 5px 8px 5px 30px; position: relative; border-radius: var(--radius); font-size: 0.78rem; color: var(--ink-3); opacity: 0.55; transition: opacity 0.3s ease, background 0.3s ease, color 0.3s ease; }
        .ig-work li::before { content: counter(ig); position: absolute; left: 8px; top: 5px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 0.66rem; font-weight: 700; background: var(--surface-2); border: 1px solid var(--hairline); }
        .ig-work li.on { opacity: 1; color: var(--ink-1); background: color-mix(in srgb, var(--lab-accent) 10%, transparent); }
        .ig-work li.on::before { background: var(--lab-accent); color: var(--page); border-color: var(--lab-accent); }
        .ig-work li em { font-style: normal; font-family: var(--mono); font-size: 0.74rem; color: var(--ink-2); white-space: nowrap; }
        .ig-cmp td:first-child { font-family: var(--sans); }
        @keyframes ig-in { from { opacity: 0.4; transform: translateY(2px); } to { opacity: 1; transform: none; } }
        @media (max-width: 560px) {
          .ig-card { grid-template-columns: 1fr; gap: 2px; }
          .ig-card dd { margin-bottom: 6px; }
        }
        @media (prefers-reduced-motion: reduce) { .ig-card, .ig-sess li { animation: none; } .ig-work li { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 這個用戶端一次呼叫的流向：誰登入、經過哪裡、服務收到什麼 */
function ClientFlow({ mode, client }) {
  const who = CLIENTS.find((c) => c.value === client).label
  const title = `${who} 呼叫報表 API（示意）`
  if (mode === 'diy') return (
    <Flow title={title} steps={[
      { label: who, value: client === 'service' ? 'X-API-Key（某工程師名下）' : 'X-API-Key（永不過期）', bad: true },
      { label: '報表 API', value: '查自己的 key 表' },
    ]} notes={['報表 API 自己管帳號、key 與稽核；其他 11 個服務各有一套']} />
  )
  if (mode === 'shared-idp') return (
    <Flow title={title} steps={client === 'service'
      ? [{ label: who, value: 'client_id + secret' }, { label: 'IdP', value: 'Client Credentials' }, { label: '報表 API', value: '自己寫的 token 驗證' }]
      : [{ label: who, value: client === 'cli' ? '報表有做 PKCE 才能登入' : '沒有對應流程', bad: client !== 'cli' }, { label: '報表 API', value: client === 'cli' ? '自己的登入流程 → IdP' : '退回個人 key', hot: true }]}
      notes={['每個服務各自實作流程與驗證，做到哪裡由各團隊決定']} />
  )
  const login = { cli: ['筆電瀏覽器', 'SSO + MFA，導回 127.0.0.1'], headless: ['手機瀏覽器', '輸入 user_code、SSO + MFA'], agent: ['本人的瀏覽器', '同意 eng-agent 的 scope'] }[client]
  const steps = [{ label: who, value: client === 'service' ? '私鑰簽 JWT 證明身分' : client === 'headless' || client === 'agent' ? '輪詢 device_code' : 'code_verifier' }]
  if (login) steps.push({ label: login[0], value: login[1] })
  steps.push({ label: '身分閘道', value: 'JWT · aud=報表 · 10 分', hot: true }, { label: '報表 API', value: 'JWKS 驗 aud、exp、scope' })
  return <Flow title={title} steps={steps} notes={['閘道後面接 IdP；報表 API 不碰密碼、不發 key，只驗閘道簽的 token']} />
}
