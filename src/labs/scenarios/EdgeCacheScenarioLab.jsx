import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, useReducedMotion, useWidth, Stats, Stat, Caption } from '../ui.jsx'

/* 快取到期情境模擬器（純前端、所有數字示意）：
   ① 60 秒時間軸：每秒 10,000 次讀、N 個熱門 key 同時在 t=0 填入。切做法看到期瞬間打到原站的 QPS 尖峰
   ② 單一 key 的狀態機：fresh → 到期/stale → 載入/背景更新 → fresh，跟著播放頭走 */

const RPS = 10000            // 每秒讀取
const T_END = 62             // 時間軸 0..61 秒（原站慢 2 秒時 t=60 到期會拖到 61）
const Y_MAX = 10000
const MODES = [
  { value: 'ttl', label: '單純 TTL' },
  { value: 'swr', label: 'Stale-while-revalidate' },
  { value: 'singleflight', label: 'Singleflight（鎖）' },
  { value: 'jitter', label: 'TTL 抖動 + 提前更新' },
]
const MODE_NAME = Object.fromEntries(MODES.map((m) => [m.value, m.label]))
const STATES = {
  ttl: ['fresh：快取命中', '到期：miss', '所有請求去原站、全部等', '回填 → fresh'],
  swr: ['fresh：快取命中', 'stale：照樣回舊值', '背景 revalidate（1 個請求）', '回填 → fresh'],
  singleflight: ['fresh：快取命中', '到期：搶鎖', '1 個去原站，其他等鎖', '回填、放鎖 → fresh'],
  jitter: ['fresh：快取命中', '快到期（剩 < 20%）', '提前背景更新（1 個請求）', '換新值、新 TTL → fresh'],
}
const fmt = (n) => Math.round(n).toLocaleString()

/* 固定種子的偽隨機，讓抖動結果可重現 */
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/* 每個 key 在 t=0 填入；到期（或抖動模式的提前更新）時依做法決定：多少請求打原站、多少在等、多少拿到舊值 */
function simulate(mode, ttl, keys, slow) {
  const L = slow ? 2 : 1                 // 原站回應秒數
  const r = RPS / keys                   // 每個 key 每秒讀取
  const bins = new Array(T_END).fill(0), waiting = new Array(T_END).fill(0), stale = new Array(T_END).fill(0)
  const rand = rng(7)
  let key0 = []
  for (let k = 0; k < keys; k++) {
    let t = 0
    const windows = []
    for (;;) {
      t += mode === 'jitter' ? ttl * (0.8 + 0.2 * rand()) : ttl
      if (t >= T_END) break
      const b = Math.floor(t)
      windows.push(b)
      for (let s = 0; s < L && b + s < T_END; s++) {
        if (mode === 'ttl') { bins[b + s] += r; waiting[b + s] += r }
        else if (mode === 'singleflight') { if (s === 0) bins[b] += 1; waiting[b + s] += r }
        else if (mode === 'swr') { if (s === 0) bins[b] += 1; stale[b + s] += r }
        else if (s === 0) bins[b] += 1
      }
    }
    if (k === 0) key0 = windows
  }
  const peak = Math.max(...bins)
  const sum = (a) => a.reduce((x, y) => x + y, 0)
  return { bins, peak, peakAt: bins.indexOf(peak), total: sum(bins), waitTotal: sum(waiting), staleTotal: sum(stale), key0, L, r }
}

export default function EdgeCacheScenarioLab() {
  const [mode, setMode] = useState('ttl')
  const [ttl, setTtl] = useState(20)
  const [keys, setKeys] = useState(100)
  const [slow, setSlow] = useState(false)
  const [t, setT] = useState(T_END - 1)        // 播放頭（0.5 秒一格）；一開始停在最後，圖是完整的
  const [playing, setPlaying] = useState(false)
  const reduced = useReducedMotion()

  const sim = useMemo(() => simulate(mode, ttl, keys, slow), [mode, ttl, keys, slow])
  const all = useMemo(() => MODES.map((m) => ({ mode: m.value, ...simulate(m.value, ttl, keys, slow) })), [ttl, keys, slow])

  useEffect(() => {
    if (!playing) return
    if (reduced) { setT(T_END - 1); setPlaying(false); return }
    const id = setInterval(() => setT((x) => {
      if (x >= T_END - 1) { setPlaying(false); return x }
      return x + 0.5
    }), 45)
    return () => clearInterval(id)
  }, [playing, reduced])
  const expire = () => { setT(0); setPlaying(true) }

  /* key #0 在播放頭時刻的狀態 */
  const state = useMemo(() => {
    if (t >= T_END - 1) return 0                 // 播放結束 / 尚未播放：停在 fresh
    const w = sim.key0.find((b) => t >= b && t < b + sim.L + 1)
    if (w === undefined) return 0
    if (t >= w + sim.L) return 3
    return t - w < 0.5 ? 1 : 2
  }, [sim, t])
  const inWin = state === 1 || state === 2
  const perKey = {
    hit: inWin && mode !== 'jitter' ? 0 : sim.r,
    origin: inWin ? (mode === 'ttl' ? sim.r : state === 1 ? 1 : 0) : 0,
    wait: inWin && (mode === 'ttl' || mode === 'singleflight') ? sim.r : 0,
    stale: inWin && mode === 'swr' ? sim.r : 0,
  }
  const dbDown = sim.peak > 500

  return (
    <Lab accent="orange" kicker="SCENARIO LAB" title="快取到期那一秒，原站看到什麼"
         blurb={`每秒 ${fmt(RPS)} 次讀、${keys} 個熱門 key 在 t=0 同時填入快取。按「快取到期」看 60 秒內原站的每秒請求數；切做法比較尖峰。所有數字為示意。`}>
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
      </LabControls>
      <LabControls>
        <Slider label="TTL" min={10} max={60} step={5} value={ttl} onChange={setTtl} format={(v) => `${v} 秒`} />
        <Slider label="熱門 key 數" min={1} max={500} value={keys} onChange={setKeys} format={(v) => `${v} 個`} />
        <Toggle label="原站回應變慢（2 秒）" checked={slow} onChange={setSlow} />
        <span className="spacer" />
        <button type="button" className="btn small" onClick={expire} disabled={playing}>{playing ? `播放中… t=${Math.floor(t)}s` : '▶ 快取到期'}</button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="原站每秒請求數時間軸" caption={`原站回應 ${sim.L} 秒；TTL ${ttl} 秒，60 秒內到期 ${Math.floor(61 / ttl)} 輪。DB 撐得住的上限約每秒 500（示意）。`}>
            <QpsChart bins={sim.bins} upto={t} playing={playing} peak={sim.peak} peakAt={sim.peakAt} />
          </LabStage>
          <Stats min={140} className="ec-stats">
            <Stat label="尖峰（原站每秒）" value={fmt(sim.peak)} tone={dbDown ? 'bad' : 'ok'} note={dbDown ? <Status>DB 撐不住</Status> : <Status ok>DB 撐得住</Status>} />
            <Stat label="60 秒內打到原站" value={fmt(sim.total)} />
            <Stat label="等原站回來的請求" value={fmt(sim.waitTotal)} tone={sim.waitTotal ? 'warn' : ''} />
            <Stat label="拿到舊值的請求" value={fmt(sim.staleTotal)} tone={sim.staleTotal ? 'warn' : ''} />
          </Stats>
          <div className="dtable-wrap">
            <table className="dtable ec-table">
              <caption>同一組參數、四種做法並排（60 秒）</caption>
              <thead><tr><th>做法</th><th>尖峰 /s</th><th>打到原站</th><th>等待</th><th>回舊值</th></tr></thead>
              <tbody>
                {all.map((s) => (
                  <tr key={s.mode} className={`clickable${s.mode === mode ? ' hit' : ''}`} onClick={() => setMode(s.mode)}>
                    <td>{MODE_NAME[s.mode]}</td><td className={s.peak > 500 ? 'ec-bad' : ''}>{fmt(s.peak)}</td><td>{fmt(s.total)}</td><td>{fmt(s.waitTotal)}</td><td>{fmt(s.staleTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LabStage label="單一 key 的狀態機" plain>
            <StateMachine labels={STATES[mode]} current={state} />
            <Caption><span className="ec-key">key #1 在 t={Math.floor(t)}s 這一秒：<b>{fmt(perKey.hit)}</b> 命中 · <b className={perKey.origin > 1 ? 'bad' : ''}>{fmt(perKey.origin)}</b> 打原站 · <b className={perKey.wait ? 'warn' : ''}>{fmt(perKey.wait)}</b> 等待 · <b className={perKey.stale ? 'warn' : ''}>{fmt(perKey.stale)}</b> 回舊值</span></Caption>
          </LabStage>
        </div>

        <div className="lab-stack">
          {mode === 'ttl' && (
            <LabExplain title="空窗期：到期到回填之間，每個請求都是 miss">
              <p>t={ttl}s 那一秒 key 消失，接下來 {sim.L} 秒內到達的 {fmt(RPS * sim.L)} 個請求全部 miss、全部去查 DB、全部在等。DB 能處理的只有幾百個，其餘排在連線池外面。</p>
              <p>開「原站回應變慢」：空窗從 1 秒變 2 秒，打到原站與等待的請求都翻倍。真實世界更糟——DB 被打到變慢，空窗又拉長，正回饋直到掛掉。</p>
              <p>把 key 數拉到 1：尖峰還是 {fmt(RPS)}。這是擊穿（stampede），跟幾個 key 無關，只跟這個 key 有多熱有關。</p>
            </LabExplain>
          )}
          {mode === 'swr' && (
            <LabExplain title="回舊值，讓背景那一個請求去更新">
              <p>到期後的請求照樣拿到快取裡的舊值，只有第一個發現「過期了」的請求派一個背景更新。原站每個 key 每輪只收到 1 次：{keys} 個 key 就是 {keys} 次，而不是 {fmt(RPS)}。</p>
              <p>代價是「等原站回來的請求」歸零、「拿到舊值的請求」變成 {fmt(RPS * sim.L)}：那 {sim.L} 秒裡使用者看到的是上一版資料。首頁可以，餘額不行。</p>
              <p>注意尖峰仍等於 key 數——{keys} 個 key 同一秒各更新一次，這是雪崩的殘影，要靠抖動攤平。</p>
            </LabExplain>
          )}
          {mode === 'singleflight' && (
            <LabExplain title="同一個 key 同時只放一個請求出去">
              <p>到期瞬間大家搶 <code>SET lock:key NX PX 3000</code>，搶到的那一個去查 DB 再回填，其餘的等鎖釋放後重新讀快取。原站每個 key 每輪只收 1 次，和 swr 一樣。</p>
              <p>差別在等待：其他 {fmt(sim.r * sim.L)} 個請求要等原站那一趟（{sim.L} 秒）。開「原站回應變慢」看等待數翻倍——這是用延遲換新鮮度。</p>
              <p>它對從沒載入過的冷 key 也有效，swr 沒有舊值可回時就得靠它。鎖要設過期時間，持鎖者掛掉才不會全部卡死。</p>
            </LabExplain>
          )}
          {mode === 'jitter' && (
            <LabExplain title="不要讓它們同一秒到期，也不要真的到期">
              <p>每個 key 的 TTL 乘上 0.8–1.0 的隨機數，{keys} 個 key 的更新時間攤開到 {Math.round(ttl * 0.2)} 秒左右的區間裡，尖峰從 {keys} 掉到每秒幾個。</p>
              <p>更新在到期前由背景完成（提前更新），快取裡永遠是未過期的值：沒有人等、沒有人拿到過期資料。</p>
              <p>把 key 數拉到 1：這個做法對單一 key 的效果只剩「提前更新」那一次請求——抖動解決的是雪崩，不是擊穿。實務上四種做法會疊著用：抖動 + swr 或 singleflight。</p>
            </LabExplain>
          )}
          <Callout title="什麼時候會真的踩到">部署或重啟後快取是空的、排程同一秒灌進幾百個 key、Redis 故障切換後全部 miss、活動開跑首頁瞬間十倍流量。平常 TTL 到期沒事，是因為流量還沒大到讓 1 秒的空窗塞爆 DB。</Callout>
        </div>
      </LabGrid>

      <style>{`
        .ec-chart { width: 100%; }
        .ec-chart .grid { stroke: var(--hairline); stroke-width: 1; }
        .ec-chart .axis { stroke: var(--ink-3); stroke-width: 1; }
        .ec-chart .line { fill: none; stroke: var(--lab-accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
        .ec-chart .area { fill: color-mix(in srgb, var(--lab-accent) 14%, transparent); }
        .ec-chart .limit { stroke: var(--critical); stroke-width: 1; stroke-dasharray: 3 4; }
        .ec-chart .head { stroke: var(--ink-1); stroke-width: 1; }
        .ec-chart .hover { stroke: var(--ink-3); stroke-width: 1; }
        .ec-chart .dot { fill: var(--lab-accent); stroke: var(--page); stroke-width: 2; }
        .ec-chart .peak { font-family: var(--mono); font-size: 11px; font-weight: 700; fill: var(--ink-1); }
        .ec-stats .status { padding: 1px 8px; font-size: 0.68rem; }
        .ec-table td.ec-bad { color: var(--critical); font-weight: 700; }
        .ec-sm { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr) auto); gap: 6px; align-items: center; }
        @media (max-width: 640px) { .ec-sm { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; } }
        .ec-sm .node { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 10px; border: 1.5px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-size: 0.76rem; line-height: 1.35; color: var(--ink-2); transition: border-color 0.2s ease, background 0.2s ease; }
        .ec-sm .node.on { border-color: var(--lab-accent); border-width: 2px; background: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); color: var(--ink-1); font-weight: 700; }
        .ec-sm .node .n { font-family: var(--mono); font-size: 0.68rem; color: var(--ink-3); border: 1px solid var(--hairline); border-radius: 999px; width: 18px; height: 18px; display: inline-grid; place-items: center; flex: none; }
        .ec-sm .arr { color: var(--ink-3); font-size: 0.9rem; }
        .ec-key b { font-family: var(--mono); color: var(--ink-1); }
        .ec-key b.bad { color: var(--critical); }
        .ec-key b.warn { color: var(--serious); }
      `}</style>
    </Lab>
  )
}

/* 時間軸：單一 y 軸（0–10,000 /s）、2px 線、hairline 格線；播放頭之後不畫；滑過看該秒數值 */
function QpsChart({ bins, upto, playing, peak, peakAt }) {
  const [hover, setHover] = useState(null)
  const ref = useRef(null)
  const W = Math.max(320, Math.round(useWidth(ref, 640))), H = 230, L = 56, R = 16, T = 26, B = 30
  const x = (t) => L + (t / (T_END - 1)) * (W - L - R)
  const y = (v) => T + (1 - Math.min(v, Y_MAX) / Y_MAX) * (H - T - B)
  const yv = (v) => (v > 0 ? Math.min(y(v), y(0) - 3) : y(0))     // 非零值至少 3px 高，1 /s 也看得見
  const last = Math.min(Math.floor(upto), T_END - 1)
  const pts = []
  for (let i = 0; i <= last; i++) pts.push(`${x(i).toFixed(1)},${yv(bins[i]).toFixed(1)}`)
  const line = pts.length ? `M${pts.join(' L')}` : ''
  const area = pts.length ? `${line} L${x(last).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  const onMove = (e) => {
    const svg = e.currentTarget, rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const t = Math.round(((px - L) / (W - L - R)) * (T_END - 1))
    setHover(t >= 0 && t < T_END ? t : null)
  }
  const showPeak = peak > 0 && peakAt <= last
  // 「DB 上限」標籤放在附近 8 秒內沒有尖峰的位置：右 → 中 → 左
  const near = (t0) => Math.max(...bins.slice(Math.max(0, t0 - 8), Math.min(T_END, t0 + 8)))
  const limitT = [58, 30, 4].map((t0) => [t0, near(t0)]).sort((a, b) => a[1] - b[1])[0][0]
  return (
    <div ref={ref}>
    <svg className="ec-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`原站每秒請求數，尖峰 ${fmt(peak)}`}
         onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {[0, 2500, 5000, 7500, 10000].map((v) => (
        <g key={v}>
          <line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="svg-mono" style={{ fontSize: 10.5, fill: 'var(--ink-3)' }}>{fmt(v)}</text>
        </g>
      ))}
      <line className="limit" x1={L} x2={W - R} y1={y(500)} y2={y(500)} />
      <text x={x(limitT)} y={y(500) - 4} textAnchor={limitT > 50 ? 'end' : limitT < 10 ? 'start' : 'middle'} className="svg-text small">DB 上限 ≈ 500 /s（示意）</text>
      <line className="axis" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      {[0, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className="svg-mono" style={{ fontSize: 10.5, fill: 'var(--ink-3)' }}>{t}s</text>
      ))}
      <text x={L} y={14} className="svg-text small">原站每秒請求數</text>
      {area && <path className="area" d={area} />}
      {line && <path className="line" d={line} />}
      {showPeak && (
        <g>
          <circle className="dot" cx={x(peakAt)} cy={yv(peak)} r="4" />
          <text className="peak" x={Math.min(x(peakAt) + 8, W - R - 90)} y={Math.max(yv(peak) - 8, T + 10)}>尖峰 {fmt(peak)} /s · t={peakAt}s</text>
        </g>
      )}
      {playing && <line className="head" x1={x(upto)} x2={x(upto)} y1={T} y2={y(0)} />}
      {hover !== null && hover <= last && (
        <g>
          <line className="hover" x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} />
          <text x={x(hover) < W / 2 ? x(hover) + 6 : x(hover) - 6} y={T + 12} textAnchor={x(hover) < W / 2 ? 'start' : 'end'} className="svg-mono">t={hover}s · {fmt(bins[hover])} /s</text>
        </g>
      )}
    </svg>
    </div>
  )
}

/* 四個狀態一列（手機 2×2），最後一個回到第一個 */
function StateMachine({ labels, current }) {
  return (
    <div className="ec-sm" role="img" aria-label={`key 目前狀態：${labels[current]}`}>
      {labels.map((lb, i) => (
        <React.Fragment key={i}>
          <div className={`node${i === current ? ' on' : ''}`}><span className="n">{i + 1}</span>{lb}</div>
          <span className="arr" aria-hidden="true">{i < labels.length - 1 ? '→' : '↺'}</span>
        </React.Fragment>
      ))}
    </div>
  )
}
