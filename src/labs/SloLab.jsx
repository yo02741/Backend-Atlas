import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Status, Stats, Stat, LineChart, Caption, useTicker, useWidth, fmtN } from './ui.jsx'

/* ============================================================
   SLO 與錯誤預算：30 天窗、可用率 SLO
   - 預算 = 總請求 × (1 − SLO)；換算成全面中斷分鐘 = 43,200 × (1 − SLO)
   - 燒率 = 實際錯誤率 ÷ 允許錯誤率；> 1 代表照這速度會在窗內燒完
   - 假設流量全天平均（真實流量有尖峰，事故落在尖峰燒得更多）
   ============================================================ */

const DAYS = 30, MIN_PER_DAY = 1440, WINDOW_MIN = DAYS * MIN_PER_DAY   // 43,200 分鐘
const SLOS = [0.99, 0.995, 0.999, 0.9995, 0.9999]
const TRAFFIC = [10000, 50000, 100000, 500000, 1000000, 5000000, 10000000]
const EVENTS = {
  none: { label: '無事故', rate: 0 },
  outage: { label: '第 5 天全面中斷 30 分', day: 5, min: 30, rate: 1 },
  steady: { label: '持續 1% 錯誤率', rate: 0.01, spread: true },
  deploy: { label: '第 12 天部署出錯 2 小時 10%', day: 12, min: 120, rate: 0.1 },
}

const pct = (v) => `${+(v * 100).toFixed(3)}%`
const sloLabel = (s) => `${+(s * 100).toFixed(2)}%`
const num = (v) => (v >= 100 ? fmtN(Math.round(v)) : +v.toFixed(2) + '')
function dur(min) {
  if (min < 60) return `${num(min)} 分鐘`
  if (min < MIN_PER_DAY) return `${+(min / 60).toFixed(1)} 小時`
  return `${+(min / MIN_PER_DAY).toFixed(1)} 天`
}

function model(slo, daily, evKey) {
  const ev = EVENTS[evKey]
  const allowed = 1 - slo
  const budget = daily * DAYS * allowed
  const perDay = Array.from({ length: DAYS + 1 }, (_, d) => {
    if (d === 0 || !ev.rate) return 0
    if (ev.spread) return daily * ev.rate
    return d === ev.day ? (daily / MIN_PER_DAY) * ev.min * ev.rate : 0
  })
  const cum = []
  perDay.reduce((acc, f, d) => (cum[d] = acc + f), 0)
  const remain = cum.map((c) => Math.max(0, 100 * (1 - c / budget)))
  let exhaust = null
  for (let d = 1; d <= DAYS; d++) {
    if (cum[d] >= budget * (1 - 1e-9)) { exhaust = ev.spread ? d - 1 + (budget - cum[d - 1]) / perDay[d] : d; break }
  }
  const burn = ev.rate / allowed
  const totalUsed = cum[DAYS] / budget
  const eqMin = (cum[DAYS] / daily) * MIN_PER_DAY           // 換算成全面中斷的分鐘數
  return { ev, allowed, budget, perDay, cum, remain, exhaust, burn, totalUsed, eqMin, budgetMin: WINDOW_MIN * allowed }
}

export default function SloLab() {
  const [slo, setSlo] = useState(0.999)
  const [ti, setTi] = useState(4)
  const [evKey, setEvKey] = useState('outage')
  const [day, setDay] = useState(DAYS)
  const [playing, setPlaying] = useState(false)
  const [tick, resetTick] = useTicker(playing, 180)
  useEffect(() => { if (tick) setDay((d) => Math.min(DAYS, d + 1)) }, [tick])
  useEffect(() => { if (day >= DAYS) setPlaying(false) }, [day])
  const play = () => { if (playing) { setPlaying(false); return } if (day >= DAYS) setDay(0); resetTick(); setPlaying(true) }

  const box = useRef(null)
  const cw = Math.max(300, Math.min(640, useWidth(box, 560) - 20))   // 圖寬跟容器走，字級維持約 1:1
  const daily = TRAFFIC[ti]
  const m = model(slo, daily, evKey)
  const usedNow = m.cum[day] / m.budget
  const over = m.totalUsed > 1 + 1e-9
  const exhaustTxt = m.exhaust === null ? '窗內燒不完' : m.ev.spread ? `第 ${+m.exhaust.toFixed(1)} 天` : `第 ${m.exhaust} 天（事故當下）`

  const lines = [
    `30 天 × 1,440 分 = ${fmtN(WINDOW_MIN)} 分 × (1 − ${sloLabel(slo)}) = ${num(m.budgetMin)} 分鐘全面中斷`,
    `允許失敗 = ${fmtN(daily)} × 30 天 × ${pct(m.allowed)} = ${fmtN(Math.round(m.budget))} 個請求`,
    evKey === 'none' ? '這 30 天沒有失敗：預算原封不動'
      : evKey === 'steady' ? `每天失敗 ${fmtN(daily)} × 1% = ${fmtN(Math.round(daily * 0.01))}，30 天 = ${fmtN(Math.round(m.cum[DAYS]))}（≈ ${num(m.eqMin)} 分鐘全面中斷）`
      : `${m.ev.min} 分 × ${m.ev.rate * 100}% 錯誤 = ${num(m.eqMin)} 分鐘全面中斷當量 = ${fmtN(Math.round(m.cum[DAYS]))} 個失敗請求`,
    evKey === 'none' ? '燒率 = 0' : `燒率 = 實際錯誤率 ${pct(m.ev.rate)} ÷ 允許錯誤率 ${pct(m.allowed)} = ${num(m.burn)}×`,
  ]

  const EX = {
    none: ['沒有事故：預算全留著', [
      '預算沒用到不是「賺到」，而是可以花的額度：可以更積極地部署、做有風險的遷移或實驗。',
      '但 SLO 達標的前提是 SLI 量對了——主機活著、CPU 正常，不代表使用者的請求成功。',
    ]],
    outage: ['一次全面中斷：瞬間燒掉一大塊', [
      `30 分鐘全面中斷，燒率 ${num(m.burn)}×：照這個速度 ${dur(WINDOW_MIN / m.burn)}就能燒完整份預算。` +
        (over
          ? `${sloLabel(slo)} 的預算只有 ${num(m.budgetMin)} 分鐘，一次就超支 ${Math.round((m.totalUsed - 1) * 100)}%。`
          : `${sloLabel(slo)} 有 ${num(m.budgetMin)} 分鐘，用掉 ${Math.round(m.totalUsed * 100)}%。`),
      '燒得這麼快的事件要立刻叫人處理；目標是先止血（回滾、切備援），原因留到事後檢討。',
    ]],
    steady: ['持續小錯誤：慢慢燒，但一直在燒', [
      `1% 錯誤率對 ${sloLabel(slo)} 的燒率是 ${num(m.burn)}×。` +
        (m.burn > 1 + 1e-9 ? `大於 1：會在${exhaustTxt}燒完，比窗長 30 天早。`
          : m.burn > 1 - 1e-9 ? '剛好等於 1：第 30 天剛好燒完——這就是「燒率 1」的意思。'
          : '小於 1：窗內燒不完。'),
      '這種錯誤不會讓主機掛掉，只看 CPU 或存活檢查完全看不到；要靠「成功請求比例」這類 SLI 才抓得到。',
    ]],
    deploy: ['部署出錯：只有部分請求失敗', [
      `2 小時、10% 錯誤 = ${num(m.eqMin)} 分鐘全面中斷當量，燒率 ${num(m.burn)}×。` +
        (over ? '這個 SLO 下已經超支。' : `用掉 ${Math.round(m.totalUsed * 100)}% 預算。`),
      '偵測得越快、回滾越快，燒掉的越少：同樣 10% 錯誤，若 15 分鐘內回滾，只燒八分之一。漸進式發布（canary）讓錯誤只打到一小部分流量，燒得更少。',
    ]],
  }[evKey]

  /* 第 day 天想上新功能：依剩餘預算給出預算政策的結論 */
  const remainNow = 1 - usedNow
  const decision = remainNow <= 1e-9
    ? { tone: 'bad', head: '凍結功能上線', text: '預算已燒完：只放行可靠性修正與安全修補，工程時間優先修造成燒預算的問題。' }
    : remainNow < 0.25
      ? { tone: 'warn', head: '謹慎上線', text: `只剩 ${Math.round(remainNow * 100)}%：高風險變更延後，上線要能快速回滾，並盯緊燒率。` }
      : { tone: 'ok', head: '照常上線', text: `還剩 ${Math.round(remainNow * 100)}%：照常部署；預算是拿來承擔變更風險的額度。` }

  return (
    <Lab accent="orange" kicker="SRE LAB" title="SLO 與錯誤預算：允許多少失敗、多快會燒完"
         blurb="選 SLO 目標與事件，看 30 天的錯誤預算換算成多少失敗請求、多少分鐘的全面中斷，剩餘預算怎麼隨天數下降；燒率大於 1 就會在窗內燒完。">
      <LabControls>
        <Seg label="SLO" tinted value={slo} onChange={setSlo} options={SLOS.map((s) => ({ value: s, label: sloLabel(s) }))} />
        <span className="slo-win">統計窗 30 天（{fmtN(WINDOW_MIN)} 分鐘）</span>
        <Slider label="每日請求量" min={0} max={TRAFFIC.length - 1} value={ti} onChange={setTi} format={(i) => fmtN(TRAFFIC[i])} />
      </LabControls>
      <LabControls>
        <Seg label="事件" value={evKey} onChange={(v) => { setEvKey(v); setPlaying(false); setDay(DAYS) }}
             options={Object.entries(EVENTS).map(([k, e]) => ({ value: k, label: e.label }))} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="剩餘錯誤預算" caption="滑過圖表可看任一天；虛線 = 燒率剛好 1（第 30 天剛好燒完）">
            <div ref={box}>
            <LineChart width={cw} height={Math.round(cw * (cw < 420 ? 0.6 : 0.42))} title={`剩餘錯誤預算（%）· 第 ${day} 天剩 ${Math.round(m.remain[day])}%`} xMax={DAYS} yMax={100} upto={day}
                       xTicks={[0, 5, 10, 15, 20, 25, 30]} fmtX={(d) => `${d}`} fmtY={(v) => `${Math.round(v)}%`}
                       mark={m.exhaust !== null && m.exhaust <= day ? Math.min(DAYS, Math.ceil(m.exhaust)) : null}
                       onScrub={(x) => { if (x !== null) { setPlaying(false); setDay(x) } }}
                       series={[
                         { key: 'remain', label: '剩餘預算', color: 'var(--lab-accent)', values: m.remain },
                         { key: 'ref', label: '燒率 1', color: 'var(--c-slate)', values: Array.from({ length: DAYS + 1 }, (_, d) => 100 - (100 * d) / DAYS) },
                       ]}
                       ariaLabel={`剩餘錯誤預算隨天數變化，第 ${day} 天剩 ${Math.round(m.remain[day])}%`} />
            </div>
            <div className="slo-play">
              <button type="button" className="btn ghost small" onClick={play}>{playing ? '❚❚ 暫停' : day >= DAYS ? '▶ 從第 0 天播放' : '▶ 繼續播放'}</button>
              <Slider label="看第幾天" min={0} max={DAYS} value={day} onChange={(v) => { setPlaying(false); setDay(v) }} format={(v) => `第 ${v} 天`} />
              {usedNow > 1 + 1e-9 ? <Status>已超支 {Math.round((usedNow - 1) * 100)}%</Status> : usedNow > 0.5 ? <Status warn>已用 {Math.round(usedNow * 100)}%</Status> : <Status ok>已用 {Math.round(usedNow * 100)}%</Status>}
            </div>
          </LabStage>
          <div className={`slo-decide ${decision.tone}`}>
            <span className="h">第 {day} 天想上新功能？<small className="muted">（示例政策，門檻由團隊自訂）</small></span>
            {decision.tone === 'bad' ? <Status>{decision.head}</Status> : decision.tone === 'warn' ? <Status warn>{decision.head}</Status> : <Status ok>{decision.head}</Status>}
            <span className="t">{decision.text}</span>
          </div>
          <Stats min={140}>
            <Stat label="30 天錯誤預算" value={fmtN(Math.round(m.budget))} unit="個失敗" note={`= ${num(m.budgetMin)} 分鐘全面中斷`} />
            <Stat label="事件期間燒率" value={evKey === 'none' ? '0' : `${num(m.burn)}×`} tone={m.burn > 1 ? 'bad' : m.burn > 0 ? 'warn' : 'ok'}
                  note={m.burn ? `照這速度 ${dur(WINDOW_MIN / m.burn)}燒完` : '沒有在燒'} />
            <Stat label="30 天共用掉" value={`${Math.round(m.totalUsed * 100)}%`} tone={over ? 'bad' : m.totalUsed > 0.5 ? 'warn' : ''} note={`≈ ${num(m.eqMin)} 分鐘全面中斷`} />
            <Stat label="預算燒完" value={exhaustTxt} tone={m.exhaust !== null ? 'bad' : 'ok'} />
          </Stats>
          <div className="slo-math" aria-label="算式">
            {lines.map((l, i) => <div key={i}><span className="k">{i + 1}</span><span>{l}</span></div>)}
          </div>
          <div className="dtable-wrap">
            <table className="dtable">
              <caption>每多一個 9：30 天允許的全面中斷時間（每日 {fmtN(daily)} 個請求）</caption>
              <thead><tr><th>SLO</th><th>允許錯誤率</th><th>全面中斷</th><th>允許失敗請求</th></tr></thead>
              <tbody>
                {SLOS.map((s) => (
                  <tr key={s} className={`clickable${s === slo ? ' hit' : ''}`} onClick={() => setSlo(s)}>
                    <td>{sloLabel(s)}</td><td>{pct(1 - s)}</td><td>{dur(WINDOW_MIN * (1 - s))}</td><td>{fmtN(Math.round(daily * DAYS * (1 - s)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <LabExplain title={EX[0]}>{EX[1].map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <LabExplain title="預算燒完時怎麼辦">
            <p>錯誤預算 = 1 − SLO，是「可以失敗的額度」。還有預算就照常部署；<strong>燒完了就凍結功能上線</strong>（安全修補與可靠性修正除外），工程時間優先拿去修可靠性，直到預算回來。</p>
            <p>誰決定凍結、凍結多久、例外怎麼核准，要在事故前寫成預算政策並取得共識，不在事故當下吵。</p>
            <p>告警看燒率而不是單次錯誤：燒得快的要立刻叫人，燒得慢的開工單在上班時間處理；常見做法是同時看一長一短兩個時間窗，避免短暫抖動誤報。具體門檻依服務與預算政策決定。</p>
          </LabExplain>
          <LabExplain title="SLI 要量使用者感受到的事">
            <p>好的 SLI 是「成功回應的請求比例」「多少比例的請求在 500 ms 內完成」這類從使用者角度量的比例；主機活著、CPU 正常，不代表請求成功。</p>
            <p>SLO 是內部目標，SLA 是對外承諾（違反有賠償）；SLO 通常訂得比 SLA 嚴，留緩衝。每多一個 9，允許的停機時間少十倍，成本卻大幅增加。</p>
          </LabExplain>
          <Callout title="實際用在哪裡">
            和產品、維運一起為關鍵功能（登入、下單、查詢）訂 SLI 與 SLO，寫好預算政策；發版前看剩餘預算決定要不要上；事故檢討時用「燒掉多少預算」衡量影響，比「掛了多久」更貼近使用者感受。
          </Callout>
        </div>
      </LabGrid>
      <Caption>假設流量全天平均分布；真實流量有尖峰，同樣長度的事故落在尖峰會燒掉更多預算。</Caption>

      <style>{`
        .slo-win { font-size: 0.78rem; color: var(--ink-3); font-weight: 600; letter-spacing: 0.04em; }
        .slo-play { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 12px; }
        .slo-decide { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; border: 1px solid var(--hairline); border-left: 3px solid var(--good); border-radius: var(--radius); background: var(--surface-1); padding: 8px 12px; font-size: 0.84rem; color: var(--ink-2); transition: border-color 0.3s ease; }
        .slo-decide.warn { border-left-color: var(--serious); }
        .slo-decide.bad { border-left-color: var(--critical); }
        .slo-decide .h { font-weight: 700; color: var(--ink-1); }
        .slo-decide .h small { font-weight: 400; color: var(--ink-3); font-size: 0.74rem; margin-left: 4px; }
        .slo-decide .t { flex: 1 1 240px; min-width: 0; }
        @media (prefers-reduced-motion: reduce) { .slo-decide { transition: none; } }
        .slo-math { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); display: grid; gap: 4px; border-left: 3px solid var(--lab-accent); padding-left: 10px; }
        .slo-math div { display: flex; gap: 8px; align-items: baseline; }
        .slo-math div > span:last-child { min-width: 0; overflow-wrap: anywhere; }
        .slo-math .k { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--surface-2); color: var(--ink-3); font-size: 0.64rem; display: inline-flex; align-items: center; justify-content: center; }
      `}</style>
    </Lab>
  )
}
