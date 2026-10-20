import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer, Callout, Status, Stats, Stat, Flow, Caption, fmtN } from '../ui.jsx'

/* 縱深防禦情境模擬器：依公開事件報告改寫的五個抽象步驟，切換四道防線，按「重播事件」逐步看路徑停在哪裡、
   損害範圍（可觸及的租戶數、外洩的憑證種類）怎麼變。只畫抽象步驟，不描述任何手法。
   哪道防線擋哪一步依 key-scope-lifetime 與 agent-credential-isolation 兩課的推論表；所有數字都是示意 */

const LAYERS = [
  { id: 'app', label: '應用層修補與隔離', short: '應用層修補' },
  { id: 'net', label: '網路隔離', short: '網路隔離' },
  { id: 'scope', label: '金鑰範圍與期限', short: '金鑰範圍與期限' },
  { id: 'root', label: '最高權限不日常使用、憑證隔離', short: '最高權限隔離' },
]
const STEPS = [
  { label: '取得容器執行權', layer: 'app', how: '入口：租戶應用的授權檢查不足（依報告）' },
  { label: '讀到平台快取裡的舊式金鑰', layer: 'net', how: '從共享叢集的內網讀到路由快取（依報告）' },
  { label: '用高權限金鑰讀內部服務設定', layer: 'scope', how: '報告未說明這一步怎麼發生；此節點為示意' },
  { label: '取得雲端最高權限', layer: 'root', how: '取得雲端 root 金鑰（依報告）' },
  { label: '讀取正式資料庫', layer: null, how: '連進正式資料庫、讀走各服務的機密（依報告）' },
]
const PRESETS = {
  none: { app: false, net: false, scope: false, root: false },
  patch: { app: true, net: false, scope: false, root: false },
  network: { app: false, net: true, scope: false, root: false },
  scoped: { app: false, net: false, scope: true, root: false },
  depth: { app: true, net: true, scope: true, root: true },
}
const PRESET_OPTS = [
  { value: 'none', label: '沒有防線' }, { value: 'patch', label: '只修補' }, { value: 'network', label: '網路隔離' },
  { value: 'scoped', label: '金鑰範圍與期限' }, { value: 'depth', label: '縱深防禦' },
]
const CONDS = [
  { value: 'known', label: '已知漏洞（有修補版）', fails: [] },
  { value: 'zeroday', label: '0-day（來不及修）', fails: ['app'] },
  { value: 'misconf', label: '0-day ＋ 網路政策漏一條', fails: ['app', 'net'] },
]
const CACHE_SHARE = 0.25          // 示意：快取裡有舊式金鑰的租戶比例

/* 依防線與條件推算整條路徑：blockedAt = 第一個被擋的步驟（-1 = 一路到底）；dmg[i] = 通過第 i 步後的累積損害 */
function simulate(def, cond, tenants) {
  const fails = CONDS.find((c) => c.value === cond).fails
  const holds = (layer) => layer && def[layer] && !fails.includes(layer)
  const blockedAt = STEPS.findIndex((s) => holds(s.layer))
  const cacheTenants = Math.max(1, Math.round(tenants * CACHE_SHARE))
  const dmg = []
  let creds = []
  STEPS.forEach((s, i) => {
    let t = 1
    if (i === 0) creds = [def.scope ? '該租戶的短效憑證（會到期）' : '該租戶環境變數裡的長效機密']
    if (i === 1) { creds = [...creds, def.scope ? '路由用途的受限憑證（會到期）' : '舊式 API 金鑰（無範圍、無期限，含團隊管理員）']; t = def.scope ? 1 : cacheTenants }
    if (i === 2) { creds = [...creds, '內部服務設定裡的憑證']; t = cacheTenants }
    if (i === 3) { creds = [...creds, '雲端最高權限金鑰']; t = tenants }
    if (i === 4) { creds = [...creds, '正式資料庫的內容', ...(def.scope ? [] : ['各服務環境變數裡的第三方 API 金鑰與資料庫密碼'])]; t = tenants }
    dmg.push({ tenants: t, creds })
  })
  return { blockedAt, dmg, fails }
}

const EXPLAIN = {
  0: {
    title: '入口被擋：已知漏洞修補了',
    body: [
      '修補版已經釋出，租戶也升級了，攻擊在第一步就沒有立足點，損害為零。',
      '這道防線只對「已知且已修」的漏洞有效。把條件切到 0-day，看後面還有沒有東西接住。',
    ],
  },
  1: {
    title: '停在容器裡：租戶工作負載連不到平台內部',
    body: [
      '網路預設拒絕，租戶的容器連不到路由快取、控制面與其他租戶。依兩課的推論，這是最可能截斷這條路徑的位置。',
      '損害不是零：被打穿的容器自己的機密仍然外洩。打開「金鑰範圍與期限」，外洩的會變成會到期的短效憑證。',
    ],
  },
  2: {
    title: '讀到了，但拿到的東西用不了',
    body: [
      '快取裡只有路由用途、會到期的憑證（或只存驗證用的雜湊）；管理權限是短效 token 並限定來源，從租戶網路拿去用會被拒絕，稽核紀錄留下「從沒出現過的來源」這個高訊號告警。',
      '注意內網仍然可達：這次擋住靠的是金鑰本身的邊界，不是網路。',
    ],
  },
  3: {
    title: '停在平台內部：沒有可拿的最高權限',
    body: [
      '舊式金鑰與內部設定都已外洩，損害已經跨租戶。但雲端 root 沒有 access key，日常操作用受限角色的臨時憑證，正式資料庫與整個雲端帳號沒有失守。',
      '這道防線在最後面：擋下時傷害已經很大，它限制的是「最壞會多壞」。',
    ],
  },
  [-1]: {
    title: '一路到正式資料庫：每一步的憑證都沒有邊界',
    body: [
      '起點只是一個應用漏洞，這在任何平台都可能發生。讓它從一個容器擴大到雲端最高權限與正式資料庫的，是一路上拿到的憑證都沒有範圍、沒有期限、沒有隔離。',
      '試著只開一道防線，再把條件切到 0-day 或網路政策漏設，看單一防線失效時會怎樣。',
    ],
  },
}

export default function BreachPathScenarioLab() {
  const [def, setDef] = useState(PRESETS.none)
  const [cond, setCond] = useState('known')
  const [tenants, setTenants] = useState(800)
  const [started, setStarted] = useState(false)
  const { step, setStep, playing, toggle } = usePlayer(STEPS.length + 1, 1300)
  const preset = Object.keys(PRESETS).find((k) => LAYERS.every((l) => PRESETS[k][l.id] === def[l.id])) || ''
  const sim = useMemo(() => simulate(def, cond, tenants), [def, cond, tenants])
  const frame = started ? step : STEPS.length                      // 0 = 事件開始前；k = 嘗試第 k 步
  const stopAt = sim.blockedAt < 0 ? STEPS.length : sim.blockedAt  // 被擋步驟的索引
  const attempted = Math.min(frame, stopAt + 1)                     // 已經嘗試過的步驟數
  const passed = Math.min(frame, stopAt)                            // 已經突破的步驟數
  const cur = passed > 0 ? sim.dmg[passed - 1] : { tenants: 0, creds: [] }
  const done = frame >= Math.min(STEPS.length, stopAt + 1)
  const ex = EXPLAIN[done ? sim.blockedAt : -2] || null
  const failedNames = sim.fails.filter((f) => def[f]).map((f) => LAYERS.find((l) => l.id === f).short)

  useEffect(() => {                                                   // 路徑被擋下就停在那一步，不再空轉到最後
    if (playing && step >= stopAt + 1 && stopAt < STEPS.length) setStep(step)
  }, [playing, step, stopAt, setStep])

  const setLayer = (id, v) => setDef((d) => ({ ...d, [id]: v }))
  const flowTitle = !started ? '整條路徑的結果（示意）'
    : done ? `重播結束：${sim.blockedAt < 0 ? '一路到底' : `停在第 ${sim.blockedAt + 1} 步`}（示意）`
    : `重播：第 ${frame} / ${STEPS.length} 步（示意）`
  const backText = done && sim.blockedAt < 0 ? '沒有任何一道防線擋住，損害擴大到整個雲端帳號' : ''
  const stopNote = done && sim.blockedAt > 0
    && `✓ 路徑在「${STEPS[sim.blockedAt].label}」被「${LAYERS.find((l) => l.id === STEPS[sim.blockedAt].layer).label}」擋下`
  const replay = () => { setStarted(true); setStep(0); toggle() }

  const steps = STEPS.map((s, i) => {
    const layer = LAYERS.find((l) => l.id === s.layer)
    if (i >= attempted) return { label: s.label, value: started && i < stopAt + 1 ? '等待中' : '未到達' }
    if (i === stopAt) return { label: s.label, value: `✓ 擋下：${layer.short}`, hot: true }
    return { label: s.label, value: '✕ 已突破', bad: true }
  })

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="從一個容器到正式資料庫：同一條路徑，四道防線"
         blurb="依公開事件報告改寫成五個抽象步驟。開關防線、切換條件，按「重播事件」看攻擊停在哪一步、損害範圍有多大（示意）。">
      <LabControls>
        <Seg label="做法" tinted value={preset} onChange={(v) => setDef(PRESETS[v])} options={PRESET_OPTS} />
        <Seg label="條件" value={cond} onChange={setCond} options={CONDS.map(({ value, label }) => ({ value, label }))} />
      </LabControls>
      <LabControls>
        {LAYERS.map((l) => <Toggle key={l.id} label={l.label} checked={def[l.id]} onChange={(v) => setLayer(l.id, v)} />)}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack bp-col">
          <LabControls>
            <button type="button" className="btn small" onClick={replay}>{started ? '再重播一次' : '重播事件'}</button>
            <Stepper step={step} total={STEPS.length + 1}
                     onStep={(s) => { setStarted(true); setStep(s) }}
                     playing={playing} onPlay={() => { setStarted(true); toggle() }}
                     labels={['事件開始前', ...STEPS.map((s) => s.label)]} />
            <span className="spacer" />
            {done && (sim.blockedAt < 0 ? <Status>正式資料庫失守</Status>
              : sim.blockedAt === 0 ? <Status ok>入口就被擋下</Status>
              : <Status warn>停在第 {sim.blockedAt + 1} 步</Status>)}
          </LabControls>
          <LabStage plain label="攻擊路徑與防線">
            <Flow title={flowTitle} ariaLabel="攻擊路徑的五個抽象步驟" steps={steps}
                  back={backText}
                  notes={[stopNote, failedNames.length > 0 && `這次條件下失效的防線：${failedNames.join('、')}`]} />
            <div className="dtable-wrap bp-table">
              <table className="dtable">
                <caption>每一步對應的防線（推論，示意）</caption>
                <thead><tr><th>步驟</th><th>可能截斷的防線</th><th>這次</th></tr></thead>
                <tbody>
                  {STEPS.map((s, i) => {
                    const layer = LAYERS.find((l) => l.id === s.layer)
                    const on = layer && def[layer.id]
                    const failed = layer && sim.fails.includes(layer.id) && on
                    return (
                      <tr key={i} className={i < attempted ? (i === stopAt ? 'hit' : '') : 'dim'}>
                        <td>
                          <b>{i + 1}. {s.label}</b>
                          <div className="bp-how">{s.how}</div>
                          <div className="bp-how bp-m">防線：{layer ? `${layer.short}（${failed ? '失效' : on ? '開' : '關'}）` : '—'}</div>
                        </td>
                        <td>
                          {layer ? <>{layer.label}<div className="bp-how">{failed ? '已開啟，但這次條件下失效' : on ? '已開啟' : '未開啟'}</div></>
                            : <span className="muted">—（前面沒擋，這裡已無邊界）</span>}
                        </td>
                        <td>
                          {i >= attempted ? <span className="muted">未到達</span>
                            : i === stopAt ? <Status ok>擋下</Status> : <Status>突破</Status>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="bp-creds" aria-label="外洩的憑證種類">
              <span className="bp-creds-h">外洩的憑證與資料（示意）</span>
              {cur.creds.length === 0 ? <span className="bp-chip ok">目前沒有</span>
                : cur.creds.map((c) => (
                  <span key={c} className={`bp-chip${/最高權限|正式資料庫|團隊管理員/.test(c) ? ' bad' : ''}`}>{c}</span>
                ))}
            </div>
            <Caption>租戶數與「快取裡有舊式金鑰的租戶 = 1/4」都是示意假設；步驟 3 的節點是為了呈現路徑而畫的抽象步驟，報告未說明細節。</Caption>
          </LabStage>
          <Stats min={118}>
            <Stat label="可觸及租戶" value={`${fmtN(cur.tenants)} / ${fmtN(tenants)}`}
                  tone={cur.tenants > 1 ? 'bad' : cur.tenants === 1 ? 'warn' : 'ok'} note="示意" />
            <Stat label="外洩項目" value={cur.creds.length}
                  tone={cur.creds.length > 2 ? 'bad' : cur.creds.length ? 'warn' : 'ok'} />
            <Stat label="金鑰可用多久" value={cur.creds.length === 0 ? '—' : def.scope ? '到期為止' : '無期限'}
                  tone={cur.creds.length && !def.scope ? 'bad' : ''}
                  note={cur.creds.length === 0 ? '' : def.scope ? '短效 token，例：數小時內（示意）' : '舊式金鑰沒有到期日'} />
            <Stat label="稽核紀錄" value={def.scope ? '有' : '沒有'} tone={def.scope ? 'ok' : 'warn'}
                  note={def.scope ? '異常來源可告警' : '被用了也不知道'} />
            <Stat label="雲端帳號" value={passed >= 4 ? '失守' : '未失守'} tone={passed >= 4 ? 'bad' : 'ok'} />
          </Stats>
        </div>
        <div className="lab-stack bp-col">
          <LabControls>
            <Slider label="共享叢集上的租戶數（示意）" min={100} max={3000} step={100}
                    value={tenants} onChange={setTenants} format={(v) => `${fmtN(v)} 個`} />
          </LabControls>
          {ex ? (
            <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          ) : (
            <LabExplain title={frame === 0 ? '事件開始前' : `第 ${frame} 步：${STEPS[frame - 1].label}`}>
              <p>{frame === 0
                ? '共享叢集上，某個租戶的應用有授權檢查不足的漏洞。按播放或「下一步」，看攻擊每往前一步，能拿到的東西多了多少。'
                : STEPS[frame - 1].how + '。'}</p>
              <p>{frame === 0
                ? '路徑的每一步都標出「哪一道防線可能在這裡截斷」，依兩課的推論表。'
                : `目前可觸及 ${fmtN(cur.tenants)} 個租戶、外洩 ${cur.creds.length} 種憑證或資料（示意）。`}</p>
            </LabExplain>
          )}
          <Compare cond={cond} tenants={tenants} preset={preset} onPick={(v) => setDef(PRESETS[v])} />
          <LabExplain title="怎麼讀這條路徑">
            <p>每道防線各管一步：應用層修補管入口、網路隔離管「從內網讀到平台快取」、金鑰範圍與期限管「拿到的金鑰能做什麼、能用多久」、最高權限不日常使用管「最壞會多壞」。路徑停在第一道有效的防線。</p>
            <p>單一防線的價值要在它失效時看：切到「0-day ＋ 網路政策漏一條」，只開網路隔離時一路到底，縱深防禦則由後面的金鑰邊界接住。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">
            只要平台跑的是別人的程式碼——PaaS、CI runner、notebook 服務、agent 的工具執行環境——就要假設某個工作負載總有一天會被打穿。這時要問的是：它所在的網路連得到什麼、環境變數裡有什麼、平台元件之間用的金鑰有沒有範圍與期限、雲端最高權限是否存在於任何自動化碰得到的地方。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .bp-col { min-width: 0; grid-template-columns: minmax(0, 1fr); }
        .bp-col > * { min-width: 0; }
        .bp-table { margin-top: 12px; }
        .bp-table td { vertical-align: top; white-space: normal; }
        .bp-table td:last-child { white-space: nowrap; }
        .bp-compare td, .bp-compare th { white-space: nowrap; }
        .bp-bad { color: var(--critical); font-weight: 700; }
        .bp-m { display: none; }
        @media (max-width: 560px) {
          .bp-table th:nth-child(2), .bp-table td:nth-child(2) { display: none; }
          .bp-m { display: block; }
        }
        .bp-how { font-size: 0.72rem; color: var(--ink-3); margin-top: 2px; }
        .bp-creds { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .bp-creds-h { font-size: 0.72rem; color: var(--ink-3); margin-right: 4px; }
        .bp-chip { font-size: 0.74rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--serious); color: var(--ink-1);
                   background: color-mix(in srgb, var(--serious) 10%, var(--surface-1)); animation: bp-in 0.3s ease; max-width: 100%; }
        .bp-chip.bad { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 12%, var(--surface-1)); }
        .bp-chip.ok { border-color: var(--good); background: color-mix(in srgb, var(--good) 10%, var(--surface-1)); }
        @keyframes bp-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .bp-chip { animation: none; } }
      `}</style>
    </Lab>
  )
}

/* 並排比較：同一個條件、同一個租戶數下，五種做法各停在哪裡；點一列就套用那個做法 */
function Compare({ cond, tenants, preset, onPick }) {
  const rows = PRESET_OPTS.map((o) => {
    const r = simulate(PRESETS[o.value], cond, tenants)
    const passed = r.blockedAt < 0 ? STEPS.length : r.blockedAt
    const d = passed > 0 ? r.dmg[passed - 1] : { tenants: 0, creds: [] }
    return { ...o, at: r.blockedAt, d }
  })
  return (
    <div className="dtable-wrap">
      <table className="dtable bp-compare">
        <caption>同一條件下五種做法（示意，點一列套用）</caption>
        <thead><tr><th>做法</th><th>停在</th><th>租戶</th><th>憑證</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value} className={`clickable${r.value === preset ? ' hit' : ''}`} onClick={() => onPick(r.value)}>
              <td>{r.label}</td>
              <td>{r.at < 0 ? <span className="bp-bad">一路到底</span> : `第 ${r.at + 1} 步`}</td>
              <td className={r.d.tenants > 1 ? 'bp-bad' : ''}>{fmtN(r.d.tenants)}</td>
              <td>{r.d.creds.length} 種</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
