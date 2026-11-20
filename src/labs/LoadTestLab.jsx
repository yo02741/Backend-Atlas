import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, Stats, Stat, Flow, LineChart, Caption, useTicker, fmtN, fmtMs, Measure } from './ui.jsx'

/* ============================================================
   逐步加壓，找飽和點
   - 服務模型：請求 → 等 worker → 用 CPU → 等連線 → 查資料庫 → 回應（兩段各自先到先服務）
   - 每一級固定 N 個虛擬使用者，收到回應就立刻送下一個（closed-loop、沒有思考時間）
   - 每個請求的 CPU / 資料庫時間用固定種子的亂數加上離散，所以同一組設定每次結果都一樣
   - 排隊超過 QT 就放棄，算一次錯誤（排隊逾時）；延遲只統計成功的請求
   簡化：worker 等資料庫時不被佔住（非同步 I/O）；資料庫本身不會變慢。數字全部是示意
   ============================================================ */

const LEVELS = Array.from({ length: 21 }, (_, i) => (i === 0 ? 1 : i * 3))   // 併發級距：1、3、6 … 60
const TOP = LEVELS.length - 1
const WARM = 200, MEAS = 1500     // 每一級先跑 200 個暖身請求，再量 1,500 個
const QT = 500                    // 排隊逾時（ms），刻意設得很短，才能在這個併發範圍內看到
const SIG = 0.45                  // 服務時間的離散程度（對數常態的 σ）
const SLOW_X = 20, SLOW_EVERY = 100   // 慢查詢：每 100 個請求有 1 個慢 20 倍
const TABLE = [0, 2, 4, 5, 6, 8, 10, 14, 17, 20]   // 報表列出哪幾級（飽和點附近取密一點）
const METRICS = ['avg', 'p95', 'p99']
const M_LABEL = { avg: '平均', p95: 'p95', p99: 'p99' }
const M_COLOR = { avg: 'var(--c-blue)', p95: 'var(--lab-accent)', p99: 'var(--c-violet)' }

function rng(seed) {   // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const minIdx = (a) => { let k = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[k]) k = i; return k }

/* 跑一級：N 個虛擬使用者。每個使用者同一時間只有一個事件（到 worker 前 / 到連線池前），每次處理時間最早的那個 */
function runLevel(p, N, seed) {
  const rnd = rng(seed)
  const jit = () => Math.exp(SIG * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(6.283185307 * rnd()) - (SIG * SIG) / 2)   // 平均為 1
  const freeW = new Float64Array(p.W), freeP = new Float64Array(p.P)   // 每個 worker / 每條連線下次空出來的時間
  const at = new Float64Array(N), born = new Float64Array(N), stage = new Uint8Array(N), rid = new Int32Array(N)
  let issued = 0, resolved = 0, tA = 0, tB = 0, fail = 0, waitW = 0, waitP = 0, busyW = 0, busyP = 0
  const lat = []
  for (let v = 0; v < N; v++) rid[v] = issued++
  while (resolved < MEAS) {
    const v = minIdx(at), t = at[v], m = rid[v] >= WARM && rid[v] < WARM + MEAS   // m：這個請求在量測範圍內
    const pool = stage[v] === 1, free = pool ? freeP : freeW, k = minIdx(free), wait = Math.max(0, free[k] - t)
    let end, done = false
    if (wait > QT) {                       // 等太久：放棄，不佔用資源
      end = t + QT; done = true
      if (m) { fail++; resolved++; if (pool) waitP += QT; else waitW += QT }
    } else {
      const slow = pool && p.slow && rid[v] % SLOW_EVERY === SLOW_EVERY - 1
      const svc = pool ? p.db * (slow ? SLOW_X : jit()) : p.cpu * jit()
      end = t + wait + svc; free[k] = end
      if (m) { if (pool) { waitP += wait; busyP += svc } else { waitW += wait; busyW += svc } }
      if (pool) { done = true; if (m) { lat.push(end - born[v]); resolved++ } } else stage[v] = 1
    }
    at[v] = end
    if (done) {                            // 這個使用者立刻送下一個請求
      stage[v] = 0; born[v] = end; rid[v] = issued++
      if (rid[v] === WARM) tA = end
      if (rid[v] === WARM + MEAS - 1) tB = end
    }
  }
  lat.sort((a, b) => a - b)
  const n = lat.length, span = Math.max(1, tB - tA)
  const q = (pc) => (n ? lat[Math.min(n - 1, Math.round((n * pc) / 100))] : QT)
  return {
    N, x: (n / span) * 1000, avg: n ? lat.reduce((s, v) => s + v, 0) / n : QT, p95: q(95), p99: q(99), err: fail / MEAS,
    waitW: waitW / MEAS, waitP: waitP / MEAS, utilW: Math.min(1, busyW / (span * p.W)), utilP: Math.min(1, busyP / (span * p.P)),
  }
}

function model(p) {
  const rows = LEVELS.map((N, i) => runLevel(p, N, i + 1))
  const dbEff = p.db * (p.slow ? 1 + (SLOW_X - 1) / SLOW_EVERY : 1)     // 含慢查詢的平均佔用時間
  const capC = (p.W / p.cpu) * 1000, capP = (p.P / dbEff) * 1000        // 兩段各自的每秒上限
  const cap = Math.min(capC, capP), bn = capC <= capP ? 'cpu' : 'pool'
  const maxX = Math.max(...rows.map((r) => r.x))
  const flat = rows.map((r) => r.x).filter((x) => x >= 0.85 * maxX).sort((x, y) => x - y)
  const plateau = flat[flat.length >> 1]                                // 吞吐變平之後的水準（取中位數，不被單一級的抖動帶著走）；統計磚的「最大吞吐」用它
  const sat = rows.findIndex((r) => r.x >= 0.9 * Math.min(plateau, cap))   // 量到的飽和點：吞吐第一次達到那個水準的 90%
  const target = Math.round(((p.cpu + p.db) * 3) / 10) * 10             // 延遲目標：無負載平均的 3 倍
  const cross = Object.fromEntries(METRICS.map((k) => [k, rows.findIndex((r) => r[k] > target)]))
  return {
    rows, dbEff, capC, capP, cap, bn, maxX, plateau, sat, target, cross,
    nStar: (cap * (p.cpu + dbEff)) / 1000,     // 算式上的飽和併發：上限 × 每個請求在系統裡的時間
  }
}

const pct = (v) => `${Math.round(v * 100)}%`
const errPct = (v) => `${v > 0 && v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`
const nice = (v) => { const m = 10 ** Math.floor(Math.log10(v)) / 2; return Math.ceil(v / m) * m }

export default function LoadTestLab() {
  const [W, setW] = useState(8)
  const [P, setP] = useState(10)
  const [cpu, setCpu] = useState(40)
  const [db, setDb] = useState(120)
  const [slow, setSlow] = useState(false)
  const [metric, setMetric] = useState('p95')
  const [lv, setLv] = useState(TOP)
  const [playing, setPlaying] = useState(false)
  const [tick, resetTick] = useTicker(playing, 320)
  useEffect(() => { if (tick) setLv((l) => Math.min(TOP, l + 1)) }, [tick])
  useEffect(() => { if (lv >= TOP) setPlaying(false) }, [lv])
  const play = () => { if (playing) { setPlaying(false); return } setLv(0); resetTick(); setPlaying(true) }

  const m = useMemo(() => model({ W, P, cpu, db, slow }), [W, P, cpu, db, slow])
  const r = m.rows[lv]
  const cpuBn = m.bn === 'cpu'
  const qW = r.waitW > 0.15 * cpu, qP = r.waitP > 0.15 * m.dbEff          // 哪一段在排隊
  const phase = r.err > 0.005 ? 'timeout' : lv >= m.sat ? 'sat' : 'ok'
  const shown = metric === 'p99' ? METRICS : ['avg', 'p95']
  const latMax = nice(Math.max(m.target * 1.15, ...m.rows.flatMap((x) => shown.map((k) => x[k]))))
  const xTicks = [0, 5, 10, 15, 20]
  const scrub = (x) => { if (x !== null) { setPlaying(false); setLv(x) } }
  const crossTxt = (k) => {
    if (m.cross[k] < 0) return '到併發 60 都沒超過'
    return m.cross[k] === 0 ? '從併發 1 就超過' : `併發 ${LEVELS[m.cross[k]]} 超過`
  }
  const capTxt = (v) => fmtN(Math.round(v))

  const lines = [
    `CPU 上限 = ${W} 個 worker × 1000 ÷ ${cpu} ms = ${capTxt(m.capC)} req/s`,
    `連線池上限 = ${P} 條 × 1000 ÷ ${slow ? `${+m.dbEff.toFixed(1)} ms（99% × ${db} + 1% × ${db * SLOW_X}）` : `${db} ms`} = ${capTxt(m.capP)} req/s`,
    `兩者取小 = ${capTxt(m.cap)} req/s，瓶頸是${cpuBn ? ' CPU' : '連線池'}`,
    `飽和併發 ≈ 上限 × 每個請求的時間 = ${capTxt(m.cap)} × ${((cpu + m.dbEff) / 1000).toFixed(3)} s ≈ ${Math.round(m.nStar)}`,
  ]

  const EX = cpuBn
    ? ['CPU 先滿：請求在 worker 前面排隊', [
        `${W} 個 worker 一次各算一個請求，每個請求要 ${cpu} ms 的 CPU，所以每秒最多 ${capTxt(m.capC)} 個。併發加到這個量之後，吞吐不再增加，多出來的請求只是排在 worker 前面，延遲跟著併發一路變長。`,
        `連線池在最高那一級也只用到 ${pct(m.rows[TOP].utilP)}，把它加大不會有任何改善。要提高上限：找出最花 CPU 的那段程式並縮短它，或增加 worker，前提是機器還有空的核心；worker 比核心多只是換成在作業系統裡排隊。`,
      ]]
    : ['連線池先滿：CPU 算完了，卡在等連線', [
        `${P} 條連線、每個請求平均佔用 ${Math.round(m.dbEff)} ms，所以每秒最多 ${capTxt(m.capP)} 個。worker 在最高那一級也只忙到 ${pct(m.rows[TOP].utilW)}。只看 CPU 使用率，會以為系統還很有餘裕。`,
        '這時加 worker 沒有用。加大連線池有效，但資料庫能同時處理的連線有限，而且每個服務副本各有一個池，數量會相加；縮短每個請求佔用連線的時間（補索引、減少查詢次數、用完就還）通常更根本。',
      ]]
  const slowTxt = `慢查詢打開後，1% 的請求佔用連線 ${fmtMs(db * SLOW_X)}。低併發時平均只多了約 ${Math.round(m.dbEff - db)} ms、p95 幾乎不動，p99 卻直接跳到 ${fmtMs(m.rows[0].p99)}：平均把那 1% 攤掉了，p95 只管最快的 95%。慢查詢還佔著連線不放，連線池的上限因此降到 ${capTxt(m.capP)} req/s。`

  return (
    <Lab accent="orange" className="lt" kicker="PERF LAB" title="逐步加壓：找出飽和點，再看卡在哪個資源"
         blurb="併發從 1 逐級加到 60：吞吐在哪裡變平、延遲從哪裡開始爬、平均和 p95 / p99 差多少、哪一段在排隊。">
      <LabControls>
        <Slider label="worker 數" min={1} max={16} value={W} onChange={setW} format={(v) => `${v} 個`} />
        <Slider label="連線池大小" min={2} max={30} value={P} onChange={setP} format={(v) => `${v} 條`} />
        <Slider label="每請求 CPU 時間" min={5} max={100} step={5} value={cpu} onChange={setCpu} format={(v) => `${v} ms`} />
        <Slider label="每請求佔用連線" min={10} max={300} step={10} value={db} onChange={setDb} format={(v) => `${v} ms`} />
      </LabControls>
      <LabControls>
        <Seg label="看哪個指標" tinted value={metric} onChange={setMetric} options={METRICS.map((k) => ({ value: k, label: M_LABEL[k] }))} />
        <Toggle label="有一條慢查詢（1% 的請求慢 20 倍）" checked={slow} onChange={setSlow} />
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={play}>{playing ? '❚❚ 暫停' : '▶ 開始加壓'}</button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="吞吐與延遲對併發" caption={`圖上的直立線 = 量到的飽和點。延遲只算成功的請求，排隊超過 ${QT} ms 的算錯誤。`}>
            <div className="lt-charts">
              <LineChart title={`吞吐 req/s${lv >= m.sat ? ` · 飽和點 ≈ 併發 ${LEVELS[m.sat]}` : ''}`} height={150} left={40} xMax={TOP} upto={lv} xTicks={xTicks}
                         yMax={nice(Math.max(m.cap, m.maxX) * 1.12)} fmtX={(i) => LEVELS[i]} fmtY={(v) => fmtN(Math.round(v))}
                         thresholds={[{ v: m.cap, label: `算式上限 ${capTxt(m.cap)}` }]} mark={lv >= m.sat ? m.sat : null}
                         onScrub={scrub}
                         series={[{ key: 'x', label: '吞吐', color: 'var(--c-aqua)', values: m.rows.map((x) => x.x) }]}
                         ariaLabel={`吞吐對併發：併發 ${r.N} 時每秒 ${Math.round(r.x)} 個請求`} />
              <LineChart title="延遲" height={150} left={44} xMax={TOP} upto={lv} xTicks={xTicks} yMax={latMax}
                         fmtX={(i) => LEVELS[i]} fmtY={fmtMs} thresholds={[{ v: m.target, label: `目標 ${m.target} ms` }]} mark={lv >= m.sat ? m.sat : null}
                         onScrub={scrub}
                         series={shown.map((k) => ({ key: k, label: M_LABEL[k], color: M_COLOR[k], values: m.rows.map((x) => x[k]) }))}
                         ariaLabel={`延遲對併發：併發 ${r.N} 時平均 ${fmtMs(r.avg)}、p95 ${fmtMs(r.p95)}、p99 ${fmtMs(r.p99)}`} />
            </div>
            <div className="lt-play">
              <Slider label="目前級距" min={0} max={TOP} value={lv} onChange={(v) => { setPlaying(false); setLv(v) }} format={(v) => `併發 ${LEVELS[v]}`} />
              {phase === 'timeout' ? <Status>排隊逾時 {errPct(r.err)}</Status> : phase === 'sat' ? <Status warn>已飽和：加併發只是加排隊</Status> : <Status ok>還沒飽和</Status>}
            </div>
            <Flow title={`併發 ${r.N} 時，請求走到哪一段在等（示意）`} ariaLabel={`併發 ${r.N} 的請求流向`}
                  steps={[
                    { label: '請求', value: `同時 ${r.N} 個`, hot: true },
                    { label: `worker × ${W}`, value: `忙 ${pct(r.utilW)}，等 ${fmtMs(r.waitW)}`, bad: qW },
                    { label: `連線池 × ${P}`, value: `佔 ${pct(r.utilP)}，等 ${fmtMs(r.waitP)}`, bad: qP },
                    { label: '資料庫', value: slow ? `${db} ms，1% 是 ${fmtMs(db * SLOW_X)}` : `每次 ${db} ms` },
                  ]}
                  back={r.err > 0 ? `排隊超過 ${QT} ms 放棄：${errPct(r.err)} 的請求失敗` : null}
                  notes={[qW && qP ? '兩段都在排隊：worker 和連線池的上限很接近' : qW ? '紅框：請求排在 worker 前面，連線池還有空' : qP ? '紅框：請求算完 CPU 後排在連線池前面，worker 還有空' : '沒有哪一段在排隊：每個請求幾乎一到就拿到 worker 和連線']} />
          </LabStage>
          <Stats min={116}>
            <Stat label="最大吞吐" value={<Measure kind="set" value={fmtN(Math.round(m.plateau))} unit="req/s" />} note={`算式上限 ${capTxt(m.cap)}`} />
            <Stat label="飽和點" value={<Measure kind="set" value={`併發 ${LEVELS[m.sat]}`} />} note={`算式 ≈ ${Math.round(m.nStar)}`} />
            <Stat label="瓶頸資源" value={cpuBn ? 'CPU' : '連線池'} tone="warn" note={`最高級：worker ${pct(m.rows[TOP].utilW)} · 連線 ${pct(m.rows[TOP].utilP)}`} />
            <Stat label="目前級距錯誤率" value={errPct(r.err)} tone={r.err > 0.005 ? 'bad' : 'ok'} note={`併發 ${r.N} · 排隊逾時`} />
            <Stat label={`目前級距 ${M_LABEL[metric]}`} value={<Measure kind="set" value={fmtMs(r[metric])} />} tone={r[metric] > m.target ? 'bad' : ''} note={`目標 ${m.target} ms`} />
          </Stats>
          <div className="lt-cross" aria-label="各指標超過目標的併發">
            <span className="h">超過延遲目標 {m.target} ms 的併發</span>
            {METRICS.map((k) => <span key={k} className={`c${k === metric ? ' on' : ''}`}><b>{M_LABEL[k]}</b>{crossTxt(k)}</span>)}
          </div>
          <div className="lt-math" aria-label="上限的算式">
            {lines.map((l, i) => <div key={i}><span className="k">{i + 1}</span><span>{l}</span></div>)}
          </div>
          <div className="dtable-wrap">
            <table className="dtable lt-tbl">
              <caption>各級距的結果（示意）</caption>
              <thead><tr><th>併發</th><th>吞吐</th><th>平均</th><th>p95</th><th>p99</th><th>錯誤率</th></tr></thead>
              <tbody>
                {TABLE.map((i) => {
                  const x = m.rows[i]
                  return (
                    <tr key={i} className={`clickable${i === lv ? ' hit' : ''}`} onClick={() => { setPlaying(false); setLv(i) }}>
                      <td>{x.N}{i === m.sat ? ' ←飽和' : ''}</td>
                      <td>{fmtN(Math.round(x.x))}</td>
                      {METRICS.map((k) => <td key={k} className={x[k] > m.target ? 'over' : ''}>{fmtMs(x[k])}</td>)}
                      <td className={x.err > 0.005 ? 'over' : ''}>{errPct(x.err)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <LabExplain title={EX[0]}>
            {EX[1].map((t, i) => <p key={i}>{t}</p>)}
            {slow && <p>{slowTxt}</p>}
          </LabExplain>
          <LabExplain title="怎麼讀這兩張圖">
            <p>飽和點之前，吞吐跟著併發等比例上升、延遲幾乎不動；過了飽和點，吞吐變平，延遲隨併發直線上升：多送進來的請求沒有被更快處理，只是等更久。</p>
            <p>p95 一直在平均上方，所以同一個延遲目標，p95 比平均更早超標；只盯平均會晚一步發現。打開慢查詢、切到 p99，差距最明顯。</p>
            <p>延遲曲線在最右邊變平不是好轉：等超過 {QT} ms 的請求被丟掉、沒算進延遲，要和錯誤率一起看。</p>
          </LabExplain>
          <Callout title="什麼時候會踩到">
            活動開跑或排程在整點同時啟動，併發短時間內衝過飽和點；資料庫變慢，每個請求佔用連線的時間拉長，連線池的上限跟著往下掉；多開服務副本，每個副本各帶一個連線池，加起來超過資料庫的連線上限。上線前逐級加壓，記下飽和點與瓶頸資源，告警門檻訂在飽和點之前。
          </Callout>
        </div>
      </LabGrid>
      <Caption>示意數字：依上面的簡化模型推算，不是量測值。模型假設 worker 等資料庫時不被佔住（非同步 I/O）、資料庫本身不會被壓慢；同步 worker 在等待期間也被佔住，worker 數要另外估。</Caption>

      <style>{`
        .lt-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
        .lt-play { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 12px; }
        .lt-play .slider { flex: 1 1 200px; max-width: 340px; }
        .lt-cross { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: 0.8rem; color: var(--ink-2); }
        .lt-cross .h { font-weight: 700; color: var(--ink-1); margin-right: 4px; }
        .lt-cross .c { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 3px 9px; font-variant-numeric: tabular-nums; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
        .lt-cross .c b { font-family: var(--mono); color: var(--ink-1); margin-right: 6px; }
        .lt-cross .c.on { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .lt-math { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); display: grid; gap: 4px; border-left: 3px solid var(--lab-accent); padding-left: 10px; }
        .lt-math div { display: flex; gap: 8px; align-items: baseline; }
        .lt-math div > span:last-child { min-width: 0; overflow-wrap: anywhere; }
        .lt-math .k { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--surface-2); color: var(--ink-3); font-size: 0.64rem; display: inline-flex; align-items: center; justify-content: center; }
        .lt-tbl td.over { color: var(--critical); font-weight: 600; }
        .lt-tbl td { font-variant-numeric: tabular-nums; }
        @media (prefers-reduced-motion: reduce) { .lt-cross .c { transition: none; } }
      `}</style>
    </Lab>
  )
}
