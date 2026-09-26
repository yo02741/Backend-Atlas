import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, useTicker, Stats, Stat, Caption, fmtN } from '../ui.jsx'

/* 限流情境模擬器：三種流量來源 × 三種端點 × 四種做法，跑 60 秒看誰被擋、誰漏網
   固定視窗、每分鐘計數，數字全部示意。 */

const SOURCES = [
  { id: 'office', name: '辦公室 NAT', sub: '200 人 · 1 個 IP · 每人 3 次/分', ips: 1, rpm: 600 },
  { id: 'normal', name: '一般使用者', sub: '300 人 · 300 個 IP · 每人 2 次/分', ips: 300, rpm: 600 },
  { id: 'attacker', name: '攻擊者', sub: '50 個 IP 輪流 · 1,500 次/分', ips: 50, rpm: 1500 },
]
/* 每種端點下，各來源有幾個帳號 / key（null＝匿名，只能用 IP）與方案 */
const ENDPOINTS = {
  login: { name: '登入', accounts: { office: 200, normal: 300, attacker: 1 }, plan: null, note: '攻擊者換 IP 撞同一個帳號' },
  search: { name: '公開搜尋', accounts: { office: null, normal: null, attacker: null }, plan: null, note: '沒有登入，只有 IP 可用' },
  paid: { name: '付費 API', accounts: { office: 1, normal: 300, attacker: 1 }, plan: { office: 'enterprise', normal: 'free', attacker: 'free' }, note: '企業客戶整間公司共用一把 key' },
}
const PLAN_MULT = { free: 1, pro: 10, enterprise: 50 }
const USES_NGINX = { 'ip-nginx': true, 'user-app': false, tiered: false, layered: true }
const USES_APP = { 'ip-nginx': false, 'user-app': true, tiered: true, layered: true }

/* 固定視窗：到第 t 秒為止，每個 key 最多放行 limit 個；同來源的 key 平均分攤 */
function simulate(approach, ep, ipLimit, userLimit, allow, t) {
  const E = ENDPOINTS[ep]
  const byKey = (input, keys, limit) => keys * Math.min(input / keys, limit)
  return SOURCES.map((s) => {
    const total = (s.rpm * t) / 60
    const acc = E.accounts[s.id]
    const plan = E.plan?.[s.id]
    const tierLimit = userLimit * (plan ? PLAN_MULT[plan] : 1)
    const skip = allow && s.id === 'office' && USES_NGINX[approach]      // 白名單：辦公室 IP 不進 nginx 的計數
    const nginx = (input) => (skip ? input : byKey(input, s.ips, ipLimit))
    const ipKey = { kind: skip ? 'IP（白名單）' : 'IP', keys: s.ips, limit: skip ? '不計' : ipLimit }
    let allowed, toApp, key
    if (approach === 'ip-nginx') { allowed = nginx(total); toApp = allowed; key = ipKey }
    else if (approach === 'user-app') { toApp = total; allowed = acc ? byKey(total, acc, userLimit) : byKey(total, s.ips, ipLimit); key = acc ? { kind: '帳號 / key', keys: acc, limit: userLimit } : { kind: 'IP（匿名退化）', keys: s.ips, limit: ipLimit } }
    else if (approach === 'tiered') { toApp = total; allowed = acc ? byKey(total, acc, tierLimit) : byKey(total, s.ips, ipLimit); key = acc ? { kind: plan ? `key（${plan}）` : '帳號（無方案）', keys: acc, limit: tierLimit } : { kind: 'IP（匿名退化）', keys: s.ips, limit: ipLimit } }
    else { const a1 = nginx(total); toApp = a1; allowed = acc ? byKey(a1, acc, userLimit) : a1; key = { kind: `${ipKey.kind} → ${acc ? '帳號' : 'IP'}`, keys: acc || s.ips, limit: `${ipKey.limit} → ${acc ? userLimit : ipLimit}` } }
    return { ...s, acc, plan, key, total: Math.round(total), allowed: Math.round(allowed), blocked: Math.round(total - allowed), toApp: Math.round(toApp) }
  })
}

const TITLES = { 'ip-nginx': 'nginx 每 IP：便宜，但 key 是 IP', 'user-app': '應用層每帳號：key 對了，成本在 API', tiered: '依方案分級：額度是產品規格', layered: '兩層：nginx 吸暴衝，應用層精準擋' }
const HEADERS = {
  'ip-nginx': `HTTP/1.1 429 Too Many Requests
Server: nginx
# 預設沒有 Retry-After 或剩餘額度；要自己 add_header`,
  'user-app': `HTTP/1.1 429 Too Many Requests
Retry-After: 37
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1760000060`,
  tiered: `HTTP/1.1 429 Too Many Requests
Retry-After: 37
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Policy: enterprise;w=60`,
  layered: `HTTP/1.1 429 Too Many Requests
Retry-After: 37
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
# nginx 擋的那一層也要 add_header，兩層標頭才一致`,
}
const ALLOW_NGINX = `# 白名單：辦公室 NAT 的 IP 不進每 IP 計數（key 為空字串 = 不計）
geo $rl_key {
    default         $binary_remote_addr;
    203.0.113.10    "";
}
limit_req_zone $rl_key zone=per_ip:10m rate=1r/s;`

export default function RatelimitStrategyScenarioLab() {
  const [approach, setApproach] = useState('ip-nginx')
  const [ep, setEp] = useState('login')
  const [ipLimit, setIpLimit] = useState(60)
  const [userLimit, setUserLimit] = useState(20)
  const [allow, setAllow] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 50)
  const t = Math.min(tick, 60)
  useEffect(() => { if (running && tick >= 60) setRunning(false) }, [running, tick])
  useEffect(() => { setRunning(false); resetTick() }, [approach, ep, ipLimit, userLimit, allow]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = () => { resetTick(); setRunning(true) }

  const rows = useMemo(() => simulate(approach, ep, ipLimit, userLimit, allow, t), [approach, ep, ipLimit, userLimit, allow, t])
  const final = useMemo(() => simulate(approach, ep, ipLimit, userLimit, allow, 60), [approach, ep, ipLimit, userLimit, allow])
  const by = (list, id) => list.find((r) => r.id === id)
  const hurt = by(rows, 'office').blocked + by(rows, 'normal').blocked
  const leak = by(rows, 'attacker').allowed
  const toApp = rows.reduce((a, r) => a + r.toApp, 0)
  const grand = final.reduce((a, r) => a + r.total, 0)
  const started = t > 0
  const E = ENDPOINTS[ep]
  const nginxOn = USES_NGINX[approach]
  const keyLabel = (s) => (s.acc ? (E.plan ? `key ×${s.acc}${s.plan ? `（${s.plan}）` : ''}` : `帳號 ×${s.acc}`) : `匿名 → IP ×${s.ips}`)

  return (
    <Lab accent="orange" kicker="SCENARIO LAB" title="同一分鐘的流量，換 key 換位置，誤傷與漏網對調"
         blurb="三種來源同時打同一個端點。切做法、選端點、調上限，跑 60 秒看辦公室被擋幾次（誤傷）、攻擊者過了幾次（漏網）、多少請求進到應用層。示意數字。">
      <LabControls>
        <Seg label="做法" tinted value={approach} onChange={setApproach} options={[
          { value: 'ip-nginx', label: 'nginx 每 IP' }, { value: 'user-app', label: '應用層每帳號' }, { value: 'tiered', label: '依方案分級' }, { value: 'layered', label: '兩層' },
        ]} />
        <Seg label="端點" value={ep} onChange={setEp} options={Object.entries(ENDPOINTS).map(([v, e]) => ({ value: v, label: e.name }))} />
      </LabControls>
      <LabControls>
        <Slider label="每 IP 上限（nginx / 匿名）" min={10} max={1000} step={10} value={ipLimit} onChange={setIpLimit} format={(v) => `${v} 次/分`} />
        <Slider label="每帳號上限（應用層）" min={5} max={500} step={5} value={userLimit} onChange={setUserLimit} format={(v) => `${v} 次/分`} />
        {nginxOn && <Toggle label="辦公室 NAT IP 加進 nginx 白名單" checked={allow} onChange={setAllow} />}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={run} disabled={running}>{running ? `第 ${t} 秒…` : started ? '再跑 60 秒' : '跑 60 秒'}</button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="流量與限流層" caption={`端點「${E.name}」：${E.note}。綠＝放行、紅＝429；灰框＝這個做法沒用到的那一層。`}>
            <FlowSvg approach={approach} rows={rows} ipLimit={ipLimit} userLimit={userLimit} allow={allow} plan={!!E.plan} keyLabel={keyLabel} started={started} />
          </LabStage>
          <Stats min={150}>
            <Stat label="誤傷（辦公室 + 一般使用者被擋）" value={started ? fmtN(hurt) : '—'} tone={started && hurt ? 'bad' : ''} />
            <Stat label="漏網（攻擊者放行）" value={started ? fmtN(leak) : '—'} tone={started && leak > userLimit ? 'bad' : ''} />
            <Stat label="進到應用層" value={started ? fmtN(toApp) : '—'} unit={`/ ${fmtN(grand)}`} />
            {!started || t < 60
              ? <Stat label="結果" value={<span className="muted">{!started ? '按「跑 60 秒」' : `第 ${t} 秒`}</span>} />
              : <div className="lab-stat"><span className="l">結果</span>{/* Status 徽章直接放磚裡（Stat 的 value 會包進 mono 的 .v） */}
                  {hurt === 0 && leak <= userLimit ? <Status ok>沒誤傷、擋住攻擊</Status> : hurt === 0 ? <Status warn>漏網 {fmtN(leak)}</Status> : leak <= userLimit ? <Status warn>誤傷 {fmtN(hurt)}</Status> : <Status>誤傷又漏網</Status>}
                </div>}
          </Stats>
          {started && (
            <div className="dtable-wrap">
              <table className="dtable">
                <caption>計數桶明細（第 60 秒的結果）</caption>
                <thead><tr><th>來源</th><th>key</th><th>key 數</th><th>每 key 次/分</th><th>每 key 上限</th><th>放行</th><th>429</th></tr></thead>
                <tbody>
                  {final.map((r) => (
                    <tr key={r.id} className={r.blocked ? 'hit' : ''}>
                      <td>{r.name}</td><td>{r.key.kind}</td><td>{r.key.keys}</td><td>{Math.round(r.rpm / r.key.keys)}</td><td>{r.key.limit}</td>
                      <td>{fmtN(r.allowed)}</td><td className={r.blocked ? 'rls-bad' : ''}>{fmtN(r.blocked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Caption>每 key 次/分 = 來源總量 ÷ key 數；放行 = key 數 × min(每 key 次/分, 每 key 上限)。固定視窗、示意。</Caption>
            </div>
          )}
          <HintPanel ep={ep} ipLimit={ipLimit} userLimit={userLimit} nginxOn={nginxOn} appOn={USES_APP[approach]} />
          <Code lang="http" title="被擋時的回應（示意）">{HEADERS[approach]}</Code>
          {nginxOn && allow && <Code lang="nginx" title="nginx 白名單">{ALLOW_NGINX}</Code>}
        </div>
        <div className="lab-stack">
          <LabExplain title={TITLES[approach]}>{explainFor(approach, ep, final, ipLimit, userLimit, allow)}</LabExplain>
          <Callout title="什麼時候會真的踩到">
            上線第一週企業客戶反映「下午三點整間公司都被 429」——他們 200 人從同一個 NAT 出來，每 IP 上限是照「一個人」設的。反過來，登入端點只做每 IP 限速，撞庫的人換 50 個 IP 就等於沒有限流。先問這個端點的請求「能用什麼當 key」，再決定放哪一層。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .dtable td.rls-bad { color: var(--critical); }
        .rls-hint { border-left: 3px solid var(--hairline); padding: 4px 12px; display: grid; gap: 4px; font-size: 0.78rem; color: var(--ink-2); }
        .rls-hint b { font-family: var(--mono); color: var(--ink-1); font-weight: 600; }
        .rls-hint .bad { color: var(--critical); } .rls-hint .ok { color: var(--good); }
        .rls-svg .bar-ok { fill: var(--good); } .rls-svg .bar-bad { fill: var(--critical); }
        .rls-svg .bar-bg { fill: var(--surface-2); stroke: var(--hairline); }
        .rls-svg .n { font-family: var(--mono); font-size: 11px; fill: var(--ink-1); font-variant-numeric: tabular-nums; }
        .rls-svg .n.ok { fill: var(--good); } .rls-svg .n.bad { fill: var(--critical); }
        .rls-svg .layer { fill: var(--surface-1); stroke: var(--lab-accent); stroke-width: 1.5; }
        .rls-svg .layer.off { stroke: var(--hairline); stroke-dasharray: 4 3; }
        .rls-svg .layer-t { font-family: var(--sans); font-size: 11.5px; fill: var(--ink-1); font-weight: 700; }
        .rls-svg .layer-s { font-family: var(--mono); font-size: 10px; fill: var(--ink-3); }
        .rls-svg .off-t { fill: var(--ink-3); font-weight: 400; }
        .rls-svg rect.bar-ok, .rls-svg rect.bar-bad { transition: width 0.05s linear; }
        @media (prefers-reduced-motion: reduce) { .rls-svg rect.bar-ok, .rls-svg rect.bar-bad { transition: none; } }
        @media (max-width: 640px) { .rls-hint { font-size: 0.74rem; } }
      `}</style>
    </Lab>
  )
}

function FlowSvg({ approach, rows, ipLimit, userLimit, allow, plan, keyLabel, started }) {
  const W = 640, MAX = 1500, BX = 170, BW = 330, ROW = 54, TOP = 92
  const nginxOn = USES_NGINX[approach], appOn = USES_APP[approach]
  const appSub = approach === 'tiered' ? (plan ? `依方案 ×1 / ×10 / ×50 · 基準 ${userLimit}` : `沒有方案 → 每帳號 ≤ ${userLimit}`) : `每帳號 ≤ ${userLimit} 次/分（Redis 計數）`
  const nginxSub = `limit_req rate ≈ ${ipLimit} 次/分${allow ? ' · 辦公室 IP 白名單' : '（burst 略）'}`
  return (
    <svg className="rls-svg" viewBox={`0 0 ${W} ${TOP + rows.length * ROW + 4}`} width="100%" role="img" aria-label="三種流量來源經過 nginx 與應用層限流">
      <g>
        <rect className={`layer${nginxOn ? '' : ' off'}`} x={10} y={8} width={300} height={52} rx="6" />
        <text className={`layer-t${nginxOn ? '' : ' off-t'}`} x={22} y={28}>nginx · 每 IP 粗限</text>
        <text className="layer-s" x={22} y={46}>{nginxOn ? nginxSub : '這個做法沒用到'}</text>
        <rect className={`layer${appOn ? '' : ' off'}`} x={330} y={8} width={300} height={52} rx="6" />
        <text className={`layer-t${appOn ? '' : ' off-t'}`} x={342} y={28}>API + Redis · 每帳號 / key 細限</text>
        <text className="layer-s" x={342} y={46}>{appOn ? appSub : '請求到這裡已經被 nginx 決定了'}</text>
        <line className="svg-edge" x1={310} y1={34} x2={330} y2={34} />
        <polygon points="330,34 323,30 323,38" style={{ fill: 'var(--ink-3)' }} />
      </g>
      {rows.map((r, i) => {
        const y = TOP + i * ROW
        const okW = (r.allowed / MAX) * BW, badW = (r.blocked / MAX) * BW
        return (
          <g key={r.id}>
            <text className="svg-text" x={10} y={y + 14} fontWeight="700">{r.name}</text>
            <text className="svg-text small" x={10} y={y + 29}>{r.sub}</text>
            <text className="layer-s" x={10} y={y + 43}>{keyLabel(r)}</text>
            <rect className="bar-bg" x={BX} y={y + 8} width={BW} height={22} rx="3" />
            <rect className="bar-ok" x={BX} y={y + 8} width={Math.max(0, okW)} height={22} rx="3" />
            <rect className="bar-bad" x={BX + okW} y={y + 8} width={Math.max(0, badW)} height={22} />
            <text className="n ok" x={BX + BW + 10} y={y + 15}>{started ? `放行 ${fmtN(r.allowed)}` : ''}</text>
            <text className={`n${r.blocked > 0 ? ' bad' : ''}`} x={BX + BW + 10} y={y + 30}>{started ? `429 ${fmtN(r.blocked)}` : ''}</text>
            <text className="svg-text small" x={BX} y={y + 44}>{started ? `到應用層 ${fmtN(r.toApp)} / ${fmtN(r.total)}` : '尚未送出'}</text>
          </g>
        )
      })}
    </svg>
  )
}

/* 上限怎麼定：從流量數字反推每個 slider 的臨界點
   （辦公室 1 個 IP 600 次 → 每 IP 上限的下限；攻擊者每 IP 30 次 → 每 IP 擋不到；同帳號 1,500 → 每帳號才擋得到） */
function HintPanel({ ep, ipLimit, userLimit, nginxOn, appOn }) {
  const anon = ep === 'search'
  const officeIp = ipLimit < 600
  const attackerIp = ipLimit >= 30
  return (
    <div className="rls-hint">
      <span>辦公室：<b>600 次/分</b> 全從 1 個 IP 出來 → 每 IP 上限 {nginxOn || anon ? <b className={officeIp ? 'bad' : 'ok'}>{ipLimit}{officeIp ? ' < 600，必然誤傷' : ' ≥ 600，不誤傷'}</b> : <b>不適用（key 是帳號）</b>}</span>
      <span>攻擊者：每 IP <b>30 次/分</b> → 每 IP 上限 {nginxOn || anon ? <b className={attackerIp ? 'bad' : 'ok'}>{ipLimit}{attackerIp ? ' ≥ 30，全部放行' : ' < 30，才擋得到'}</b> : <b>不適用</b>}；同一帳號 <b>1,500 次/分</b> → {anon ? <b>匿名，沒有帳號可算</b> : appOn ? <b className="ok">每帳號上限 {userLimit}，只放 {userLimit}</b> : <b className="bad">這一層沒開，擋不到</b>}</span>
      <span>一般使用者：每 IP 2 次、每帳號 2 次 → 任何合理上限都不會被擋，是量測誤傷的基準線</span>
    </div>
  )
}

function explainFor(approach, ep, final, ipLimit, userLimit, allow) {
  const o = final.find((r) => r.id === 'office'), a = final.find((r) => r.id === 'attacker')
  const p = []
  if (approach === 'ip-nginx') {
    p.push(<p key="a">key 是來源 IP。辦公室 600 次全從同一個 IP 出來，{allow ? '目前在白名單裡不計數，全放；' : `上限 ${ipLimit} 就放 ${o.allowed} 擋 ${o.blocked}；`}攻擊者 50 個 IP 各 30 次，{a.blocked ? `每個都超過上限 ${ipLimit}，只放 ${fmtN(a.allowed)}。` : `每個都在上限 ${ipLimit} 內，${fmtN(a.allowed)} 次全部放行。`}把每 IP 上限拉到 600 以上辦公室才不會被誤傷，但那時攻擊者更是暢行無阻。</p>)
    p.push(<p key="b">好處是超量請求在 nginx 就結束，API 一個都不用處理。{ep === 'search' ? '公開搜尋沒有帳號，這已經是能做到最好的：擋得住少數 IP 狂抓，擋不住分散的爬蟲。' : '對登入與付費 API，IP 根本不是對的 key。'}{allow ? '白名單只救得了事先知道的那幾個 IP，救不了下一個從 NAT 出來的客戶。' : ''}</p>)
  } else if (approach === 'user-app') {
    p.push(<p key="a">{ep === 'search' ? '公開搜尋沒有帳號，應用層只能退回用 IP 當 key：結果和 nginx 每 IP 一樣，但每個請求都先進到 API、查一次 Redis 才被擋，白付成本。' : `key 是帳號 / API key。攻擊者不管換多少 IP，打同一個帳號就是同一個計數：上限 ${userLimit} 就只放 ${a.allowed} 次。辦公室 200 人各自算，每人 3 次遠低於上限，一個都不誤傷。`}</p>)
    if (ep === 'paid') p.push(<p key="b">但企業客戶整間公司共用一把 key，600 次撞上 flat 的每 key 上限 {userLimit}，放 {o.allowed} 擋 {o.blocked}：付最多錢的客戶被擋最兇。額度得依方案分級。</p>)
    else p.push(<p key="b">代價：2,700 個請求全部進到應用層，攻擊者的 1,500 次每次都要查 Redis 才知道要擋。攻擊量再大十倍，API 先被打掛。</p>)
  } else if (approach === 'tiered') {
    p.push(<p key="a">{ep === 'paid' ? `同樣以 API key 計數，但上限查方案：free ×1、pro ×10、enterprise ×50（基準 ${userLimit}）。企業客戶那把 key 的上限是 ${userLimit * 50}，600 次全放；攻擊者拿的是 free key，上限 ${userLimit}，只放 ${a.allowed}。` : `這個端點沒有方案可查（${ep === 'login' ? '登入前不知道是誰' : '匿名'}），分級退化成${ep === 'login' ? '每帳號 flat 上限' : '每 IP'}，和上一個做法一樣。`}</p>)
    p.push(<p key="b">額度是產品規格：回應標頭直接告訴客戶端方案上限與何時重置。方案要快取在 Redis 或放進 token 裡，不然每個請求多一次 DB 查詢。攻擊流量的成本仍由 API 吸收。</p>)
  } else {
    p.push(<p key="a">先過 nginx 每 IP（{allow ? `${ipLimit}，辦公室 IP 白名單` : ipLimit}），再過應用層每帳號（{userLimit}）。攻擊者 50 個 IP 各 30 次{a.toApp < a.total ? `在第一層先被擋掉 ${fmtN(a.total - a.toApp)}` : '過得了第一層'}，到第二層撞同一個帳號，只放 {a.allowed}。{o.blocked > 0 ? `但辦公室的 600 次在第一層就被擋掉 ${o.blocked}：nginx 的每 IP 上限必須高於 NAT 後的合法流量，把它拉到 600 以上、或把辦公室 IP 加進白名單，再跑一次。` : `辦公室 600 次${allow ? '不進第一層的計數' : '在第一層內'}，第二層各自計數，零誤傷。`}</p>)
    p.push(<p key="b">nginx 那層的意義是吸收最極端的暴衝（單一 IP 每秒上千次的掃描器），讓應用層只處理「合理範圍內」的請求再精準判斷。{ep === 'login' ? '登入端點兩層都要：每 IP 擋帳號枚舉、每帳號擋撞庫。' : ep === 'search' ? '公開搜尋沒有帳號，第二層無事可做，只剩 nginx 那層在算。' : '付費 API 的第二層應該換成依方案分級。'}</p>)
  }
  return p
}
