import React, { useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, useWidth } from './ui.jsx'

/* ============================================================
   Big-O：五條成長曲線 + 游標 n + 對數刻度
   - 拖 slider 或在圖上滑動：垂直游標跟著走，小表列出每條曲線在該 n 的次數
   - 選一條曲線：其他變淡，說明區給出後端的具體例子
   - 第二舞台：N+1 問題——查詢次數 1+n vs 2
   ============================================================ */

const lg = (n) => Math.max(1, Math.ceil(Math.log2(n)))
/* 顏色固定順序（不隨選取重排）：blue → orange → aqua → yellow → magenta */
const CURVES = [
  { key: 'c1', label: 'O(1)', color: 'var(--c-blue)', f: () => 1, ex: 'hash 查表、Redis GET' },
  { key: 'logn', label: 'O(log n)', color: 'var(--c-orange)', f: (n) => lg(n), ex: 'B-tree 索引查詢' },
  { key: 'n', label: 'O(n)', color: 'var(--c-aqua)', f: (n) => n, ex: '全表掃描、list 過濾' },
  { key: 'nlogn', label: 'O(n log n)', color: 'var(--c-yellow)', f: (n) => n * lg(n), ex: '排序、沒索引的 ORDER BY' },
  { key: 'n2', label: 'O(n²)', color: 'var(--c-magenta)', f: (n) => n * n, ex: '巢狀迴圈、N+1 查詢' },
]

const EXPLAIN = {
  all: {
    title: 'Big-O 說的是「成長率」，不是秒數',
    text: ['橫軸是資料量 n，縱軸是操作次數。五條線在 n 很小時擠在一起——這時候常數項（一次網路往返、一次磁碟讀取）比曲線形狀重要得多。', 'n 一路拉到 100，O(n²) 已經是 10,000 次，把其他線全部壓成地板；打開「對數刻度」才看得清楚下面四條線彼此差多少。', '選一條曲線，看它在後端具體長什麼樣子。'],
  },
  c1: {
    title: 'O(1)：不管 n 多大，都是一步',
    text: ['依 key 從 dict / hash map 取值、Redis 的 GET / SET、依主鍵從已載入的 map 找物件——成本不隨資料量改變。', '但 O(1) 不等於「快」：一次 Redis GET 仍是一次網路往返（通常 0.1–1 ms），比記憶體裡的 dict 慢上千倍。它只保證「不會因為資料變多而變慢」。'],
  },
  logn: {
    title: 'O(log n)：每走一步就砍掉一大半',
    text: ['PostgreSQL / MySQL 的索引是 B-tree：從根節點往下，每一層都把候選範圍縮小數百倍，一百萬列大約 3–4 層就找到。binary search 同理。', '這就是「加索引」有效的數學理由：WHERE user_id = ? 有索引是 O(log n)，沒索引是 O(n) 的全表掃描。n 翻十倍，前者幾乎沒感覺，後者慢十倍。'],
  },
  n: {
    title: 'O(n)：資料翻倍、時間翻倍',
    text: ['全表掃描（EXPLAIN 裡的 Seq Scan）、`[x for x in items if …]`、沒索引欄位的 WHERE、把整張表撈進程式再過濾——都是把每一筆看過一遍。', '小表完全無感（一千列掃完不到 1 ms），所以問題總是在上線半年、資料長到百萬列後才冒出來。看到 Seq Scan 出現在熱路徑，就是這條線。'],
  },
  nlogn: {
    title: 'O(n log n)：排序的底線',
    text: ['比較式排序最好就是 O(n log n)：Python 的 sorted()、merge sort、資料庫沒索引時的 ORDER BY。', '資料庫排序若超過記憶體額度（PostgreSQL 的 work_mem）會落到磁碟做 external sort，常數瞬間變大。若 ORDER BY 的欄位有索引，可以直接沿索引順序讀，退回 O(n) 甚至配合 LIMIT 更少。'],
  },
  n2: {
    title: 'O(n²)：巢狀迴圈，n 翻十倍慢一百倍',
    text: ['對每筆資料再把全部資料掃一次：兩層 for 找重複、兩邊都沒索引的 nested loop join。100 筆 = 10,000 次，10,000 筆 = 一億次。', '後端最常見的變形是「迴圈裡打 query」：n 筆資料就打 n 次查詢，而每次查詢在資料庫裡又可能是一次 O(m) 掃描——外層在程式、內層藏在資料庫，加起來就是巢狀迴圈。下面的 N+1 舞台就是這件事。'],
  },
}

const CODE = `# N+1：先撈 n 篇文章，再「每篇」查一次作者 → 1 + n 次查詢
posts = db.query("SELECT * FROM posts ORDER BY id LIMIT %s", n)
for p in posts:
    p.author = db.query("SELECT * FROM users WHERE id = %s", p.author_id)

# 2 次：先撈文章，再用 IN (...) 一次撈齊所有作者
posts = db.query("SELECT * FROM posts ORDER BY id LIMIT %s", n)
ids = {p.author_id for p in posts}
users = {u.id: u for u in db.query("SELECT * FROM users WHERE id IN %s", tuple(ids))}
for p in posts:
    p.author = users[p.author_id]     # 記憶體裡的 dict：O(1)`

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>') }
const fmt = (v) => v.toLocaleString('en-US')

export default function BigOLab() {
  const [n, setN] = useState(40)
  const [logY, setLogY] = useState(false)
  const [sel, setSel] = useState('all')
  const [hover, setHover] = useState(null)
  const [posts, setPosts] = useState(20)
  const active = hover ?? (sel === 'all' ? null : sel)
  const e = EXPLAIN[active ?? 'all']

  return (
    <Lab accent="magenta" kicker="ALGO LAB" title="Big-O：n 變大時，誰先撐不住"
         blurb="拖動 n 看五條成長曲線在同一個資料量下各要做幾次操作；把 y 軸切成對數刻度，被 O(n²) 壓扁的線才會現形。選一條曲線，看它在後端具體長什麼樣子。">
      <LabControls>
        <Slider label="資料量 n" min={1} max={100} value={n} onChange={setN} />
        <Toggle label="y 軸對數刻度" checked={logY} onChange={setLogY} />
        <Seg label="對應到後端" value={sel} onChange={setSel}
             options={[{ value: 'all', label: '全部' }, ...CURVES.map((c) => ({ value: c.key, label: c.label, title: c.ex }))]} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="五條成長曲線的折線圖" caption={logY ? '對數刻度：每往上一格 ×10，被壓扁的四條線終於分得開' : '線性刻度：O(n²) 把其他四條壓在地板上'}>
            <Chart n={n} logY={logY} active={active} onN={setN} onHover={setHover} onPick={setSel} />
            <div className="bigo-legend" role="list">
              {CURVES.map((c) => (
                <button key={c.key} type="button" role="listitem"
                        className={`bigo-key${active && active !== c.key ? ' dim' : ''}`}
                        onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
                        onClick={() => setSel(sel === c.key ? 'all' : c.key)}>
                  <i style={{ background: c.color }} />{c.label}
                </button>
              ))}
            </div>
          </LabStage>
          <div className="dtable-wrap">
            <table className="dtable bigo-table">
              <caption>n = <b>{n}</b> 時，各曲線的操作次數</caption>
              <thead><tr><th>曲線</th><th className="num">操作次數</th><th>後端裡長這樣</th></tr></thead>
              <tbody>
                {CURVES.map((c) => (
                  <tr key={c.key} className={`clickable${active === c.key ? ' hit' : active ? ' dim' : ''}`}
                      onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
                      onClick={() => setSel(sel === c.key ? 'all' : c.key)}>
                    <td><i className="bigo-dot" style={{ background: c.color }} />{c.label}</td>
                    <td className="num">{fmt(c.f(n))}</td>
                    <td className="ex">{c.ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <LabExplain title={e.title}>
            {e.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <LabExplain title="讀 Big-O 的三個原則">
            <p><strong>它是成長率，不是秒數。</strong>O(n) 的記憶體過濾可能比 O(1) 的 Redis 往返快一千倍；Big-O 回答的是「資料變十倍，會慢幾倍」。</p>
            <p><strong>小 n 時常數說了算。</strong>五條線左端幾乎重疊；資料少的時候先把 code 寫對、寫清楚，別為了 O(log n) 提早複雜化。</p>
            <p><strong>後端的陷阱是 I/O 次數，不是 CPU。</strong>一次資料庫往返抵得上幾十萬次 CPU 運算，所以「打了幾次 query、讀了幾次磁碟」才是真正該數的 n。</p>
          </LabExplain>
        </div>
      </LabGrid>

      <p className="bigo-sub">第二舞台：N+1 問題——同一件事，查詢次數差幾倍</p>
      <LabControls>
        <Slider label="文章數 n" min={1} max={50} value={posts} onChange={setPosts} />
      </LabControls>
      <LabGrid variant="even">
        <div className="lab-stack">
          <LabStage label="N+1 與批次查詢的次數比較" caption="長條長度 = 查詢次數；每次查詢都是一次網路往返（示意以 1 ms 計）">
            <NPlusOne n={posts} />
          </LabStage>
          <Callout title="工作上什麼時候用">
            看到 <b>迴圈裡有 <code>await db.query</code></b>（或 ORM 在迴圈裡碰關聯屬性）就要警覺：那是 O(n) 次網路往返。先用<b>索引</b>把單次查詢壓到 O(log n)，再用 <b>JOIN / WHERE id IN (...) / ORM 的 prefetch</b> 把 n 次往返併成 1–2 次。
          </Callout>
        </div>
        <Code lang="python" title="同一個需求的兩種寫法" highlight={[4]}>{CODE}</Code>
      </LabGrid>

      <style>{`
        .bigo-chart { width: 100%; touch-action: pan-y; cursor: crosshair; }
        .bigo-chart .grid { stroke: var(--hairline); stroke-width: 1; }
        .bigo-chart .axis { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-3); }
        .bigo-chart .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; transition: opacity 0.25s ease; }
        .bigo-chart .line.dim, .bigo-chart .end.dim { opacity: 0.22; }
        .bigo-chart .end text { font-family: var(--sans); font-size: 12px; fill: var(--ink-1); }
        .bigo-chart .end .leader { stroke-width: 1; fill: none; }
        .bigo-chart .end { transition: opacity 0.25s ease; }
        .bigo-chart .cursor { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 3 3; }
        .bigo-chart .cursor-label { font-family: var(--mono); font-size: 11px; fill: var(--ink-1); }
        .bigo-chart .pt { stroke: var(--page); stroke-width: 2; transition: opacity 0.25s ease; }
        .bigo-chart .pt.dim { opacity: 0.22; }
        .bigo-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; justify-content: center; }
        .bigo-key { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; cursor: pointer; font: inherit; font-size: 0.78rem; color: var(--ink-2); padding: 2px 4px; transition: opacity 0.2s ease; }
        .bigo-key.dim { opacity: 0.4; }
        .bigo-key i { width: 16px; height: 2px; border-radius: 1px; }
        .bigo-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: 0; }
        .bigo-table caption b { color: var(--ink-1); font-family: var(--mono); }
        .bigo-table td.num, .bigo-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
        .bigo-table td.ex { font-family: var(--sans); color: var(--ink-2); }
        .bigo-sub { margin: 22px 0 4px; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-2); }
        .bigo-bars { width: 100%; }
        .bigo-bars .lbl { font-family: var(--sans); font-size: 12px; fill: var(--ink-1); }
        .bigo-bars .sub { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-3); }
        .bigo-bars .val { font-family: var(--mono); font-size: 12px; fill: var(--ink-1); font-weight: 600; }
        .bigo-bars .bar { transition: d 0.25s ease; }
      `}</style>
    </Lab>
  )
}

/* 折線圖：固定定義域 n ∈ [1, 100]，y 上限 10,000（= 100²）。窄螢幕縮小 viewBox，文字才不會跟著縮到看不見 */
function Chart({ n, logY, active, onN, onHover, onPick }) {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const narrow = useWidth(wrapRef, 600) < 480
  const W = narrow ? 420 : 640, H = 300, L = 44, R = narrow ? 82 : 92, T = 28, B = 34
  const PW = W - L - R, PH = H - T - B
  const x = (v) => L + ((v - 1) / 99) * PW
  const y = (v) => T + PH - (logY ? Math.log10(Math.max(1, v)) / 4 : v / 10000) * PH
  const yTicks = logY ? [1, 10, 100, 1000, 10000] : [0, 2500, 5000, 7500, 10000]
  const tickLabel = (v) => (v >= 1000 ? `${v / 1000}k` : String(v))

  const paths = useMemo(() => CURVES.map((c) => {
    const pts = []
    for (let i = 1; i <= 100; i++) pts.push(`${x(i).toFixed(1)},${y(c.f(i)).toFixed(1)}`)
    return { key: c.key, d: 'M' + pts.join(' L') }
  }), [logY, W]) // eslint-disable-line react-hooks/exhaustive-deps

  /* 右端標籤：值靠得太近時往上下推開（先往下排、碰底再往上頂回來），用 leader 線接回曲線末端 */
  const ends = useMemo(() => {
    const es = CURVES.map((c) => ({ ...c, ey: y(c.f(100)) })).sort((a, b) => a.ey - b.ey)
    const GAP = 14
    let prev = -Infinity
    for (const e of es) { e.ly = Math.max(e.ey, prev + GAP); prev = e.ly }
    let next = T + PH
    for (let i = es.length - 1; i >= 0; i--) { es[i].ly = Math.min(es[i].ly, next); next = es[i].ly - GAP }
    return es
  }, [logY, W]) // eslint-disable-line react-hooks/exhaustive-deps

  const move = (ev) => {
    const r = svgRef.current.getBoundingClientRect()
    const vx = ((ev.clientX - r.left) / r.width) * W
    onN(Math.max(1, Math.min(100, Math.round(((vx - L) / PW) * 99 + 1))))
  }
  const cx = x(n)
  const dimOf = (k) => (active && active !== k ? ' dim' : '')

  return (
    <div ref={wrapRef}>
    <svg ref={svgRef} className="bigo-chart" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`成長曲線圖，目前 n = ${n}`}
         onPointerMove={(ev) => { if (ev.buttons || ev.pointerType === 'mouse') move(ev) }}
         onPointerDown={move}>
      {yTicks.map((v) => (
        <g key={v}>
          <line className="grid" x1={L} x2={L + PW} y1={y(v)} y2={y(v)} />
          <text className="axis" x={L - 8} y={y(v) + 3.5} textAnchor="end">{tickLabel(v)}</text>
        </g>
      ))}
      {[1, 25, 50, 75, 100].map((v) => (
        <text key={v} className="axis" x={x(v)} y={T + PH + 16} textAnchor="middle">{v}</text>
      ))}
      <text className="axis" x={L + PW} y={T + PH + 30} textAnchor="end">n（資料量）</text>
      <text className="axis" x={L - 8} y={12} textAnchor="end">次數</text>

      {CURVES.map((c, i) => (
        <path key={c.key} d={paths[i].d} className={`line${dimOf(c.key)}`} stroke={c.color}
              onMouseEnter={() => onHover(c.key)} onMouseLeave={() => onHover(null)} onClick={() => onPick(c.key)} />
      ))}
      {ends.map((e) => (
        <g key={e.key} className={`end${dimOf(e.key)}`}>
          <path className="leader" stroke={e.color} d={`M${L + PW} ${e.ey} L${L + PW + 8} ${e.ly}`} />
          <text x={L + PW + 12} y={e.ly + 4}>{e.label}</text>
        </g>
      ))}

      <line className="cursor" x1={cx} x2={cx} y1={T} y2={T + PH} />
      <text className="cursor-label" x={cx} y={T - 6} textAnchor={n > 85 ? 'end' : n < 12 ? 'start' : 'middle'}>n = {n}</text>
      {CURVES.map((c) => (
        <circle key={c.key} className={`pt${dimOf(c.key)}`} cx={cx} cy={y(c.f(n))} r="4" fill={c.color} />
      ))}
    </svg>
    </div>
  )
}

/* N+1：兩條橫條，長度 = 查詢次數（≤ 24px 粗、資料端 4px 圓角、起點方角） */
function NPlusOne({ n }) {
  const wrapRef = useRef(null)
  const narrow = useWidth(wrapRef, 600) < 480
  const rows = [
    { label: '迴圈裡打 query（N+1）', count: 1 + n, color: 'var(--c-aqua)', note: `1 + ${n} 次往返 ≈ ${1 + n} ms` },
    { label: 'JOIN / WHERE id IN (...)', count: 2, color: 'var(--c-blue)', note: '2 次往返 ≈ 2 ms' },
  ]
  const W = narrow ? 400 : 640, X0 = narrow ? 4 : 220, H = 18, max = 51
  const MAXW = W - X0 - 60, ROW = narrow ? 66 : 46
  const bar = (w, yy) => `M${X0} ${yy} h${Math.max(0, w - 4)} a4 4 0 0 1 4 4 v${H - 8} a4 4 0 0 1 -4 4 H${X0} Z`
  return (
    <div ref={wrapRef}>
      <svg className="bigo-bars" viewBox={`0 0 ${W} ${14 + 2 * ROW}`} role="img" aria-label={`N+1 需要 ${1 + n} 次查詢，批次寫法 2 次`}>
        {rows.map((r, i) => {
          const yy = (narrow ? 26 : 14) + i * ROW
          const w = (r.count / max) * MAXW
          return (
            <g key={r.label}>
              <text className="lbl" x={4} y={narrow ? yy - 8 : yy + 13}>{r.label}</text>
              <path className="bar" d={bar(w, yy)} fill={r.color} />
              <text className="val" x={X0 + w + 8} y={yy + 13}>{r.count} 次</text>
              <text className="sub" x={narrow ? X0 : 4} y={yy + (narrow ? 32 : 30)}>{r.note}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
