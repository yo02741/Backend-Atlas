import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Toggle, Slider, Code, Callout, useReducedMotion } from './ui.jsx'

/* ============================================================
   索引為什麼快：同一個 WHERE id = X，左邊 heap 一格格比、右邊 B-tree 一層層走
   - 列數 8–64 由滑桿控制；點任一格或按「換目標」改變要找的 id
   - 關掉「有索引」只剩全表掃描
   ============================================================ */

const LEAF = 4   // 葉節點最多放 4 個 key
const FAN = 4    // 內部節點最多 4 個子節點
const TREE_STEP = 3   // 索引每走一層花 3 個 tick（heap 每格 1 tick）

/* heap 的實體順序：把 1..n 用固定種子打亂（資料表本身沒有排序） */
function heapOrder(n) {
  const a = Array.from({ length: n }, (_, i) => i + 1)
  let s = 20240917
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/* 平均切塊：17 個切 4 個一組 → [4,4,3,3,3]，節點至少半滿 */
function chunk(arr, size) {
  const groups = Math.max(1, Math.ceil(arr.length / size))
  const base = Math.floor(arr.length / groups), extra = arr.length % groups
  const out = []; let i = 0
  for (let g = 0; g < groups; g++) { const len = base + (g < extra ? 1 : 0); out.push(arr.slice(i, i + len)); i += len }
  return out
}

/* 由排序後的 key 自底向上建 B+tree：levels[0] = root，最後一層是葉節點 */
function buildTree(sorted) {
  let level = chunk(sorted, LEAF).map((keys) => ({ keys, lo: keys[0], hi: keys[keys.length - 1], children: null }))
  const levels = [level]
  while (level.length > 1) {
    level = chunk(level, FAN).map((children) => ({
      keys: children.slice(1).map((c) => c.lo),   // 分隔 key = 每個子節點（第一個除外）的最小 key
      lo: children[0].lo, hi: children[children.length - 1].hi, children,
    }))
    levels.unshift(level)
  }
  return levels
}

function findPath(levels, target) {
  const path = []
  let node = levels[0][0]
  while (node) {
    path.push(node)
    if (!node.children) break
    let idx = 0
    while (idx < node.keys.length && target >= node.keys[idx]) idx++
    node = node.children[idx]
  }
  return path
}

export default function IndexLab() {
  const [n, setN] = useState(32)
  const [target, setTarget] = useState(23)
  const [indexed, setIndexed] = useState(true)
  const [t, setT] = useState(0)          // 動畫時鐘（tick）
  const [running, setRunning] = useState(false)
  const reduced = useReducedMotion()

  const heap = useMemo(() => heapOrder(n), [n])
  const levels = useMemo(() => buildTree(Array.from({ length: n }, (_, i) => i + 1)), [n])
  const h = levels.length
  const path = useMemo(() => findPath(levels, target), [levels, target])
  const heapPos = heap.indexOf(target)

  const endTick = Math.max(n, (h + 1) * TREE_STEP)
  const dt = n <= 16 ? 90 : n <= 32 ? 60 : 40

  useEffect(() => {
    if (!running) return
    if (t >= endTick) { setRunning(false); return }
    const id = setTimeout(() => setT((x) => x + 1), dt)
    return () => clearTimeout(id)
  }, [running, t, endTick, dt])

  const reset = () => { setRunning(false); setT(0) }
  const run = () => { setT(0); if (reduced) setT(endTick); else setRunning(true) }
  const changeN = (v) => { reset(); setN(v); if (target > v) setTarget(v) }
  const pick = (id) => { reset(); setTarget(id) }
  const randomTarget = () => { let id = target; while (id === target) id = 1 + Math.floor(Math.random() * n); pick(id) }

  const scanned = Math.min(t, n)
  const lit = indexed ? Math.min(h, Math.floor(t / TREE_STEP)) : 0
  const pinned = indexed && t >= (h + 1) * TREE_STEP
  const done = t >= endTick
  const started = t > 0
  const leaf = path[path.length - 1]

  const explain = pickExplain({ started, done, indexed, n, h, lit })

  const sql = indexed
    ? `EXPLAIN SELECT * FROM users
  WHERE id = ${target};

Index Scan using users_pkey on users
  (cost=0.15..8.17 rows=1 width=72)  -- 示意
  Index Cond: (id = ${target})`
    : `EXPLAIN SELECT * FROM users
  WHERE id = ${target};

Seq Scan on users
  (cost=0.00..${(n * 0.35).toFixed(2)} rows=1 width=72)  -- 示意
  Filter: (id = ${target})
  Rows Removed by Filter: ${n - 1}`

  return (
    <Lab accent="violet" kicker="DATABASE LAB" title="索引為什麼快：循序掃描 vs B-tree"
         blurb="同一句 WHERE id = X，左邊的資料表只能一格一格比，右邊的 B-tree 一層層縮小範圍。拉大列數看兩邊的工作量怎麼拉開；關掉索引看資料庫只剩什麼選擇。">
      <LabControls>
        <Slider label="資料列數" min={8} max={64} step={4} value={n} onChange={changeN} format={(v) => `${v} 列`} />
        <Toggle label="這個欄位有索引" checked={indexed} onChange={(v) => { reset(); setIndexed(v) }} />
        <button type="button" className="btn ghost small" onClick={randomTarget}>換目標</button>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={run} disabled={running}>
          {running ? '執行中…' : `▶ 執行 WHERE id = ${target}`}
        </button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
        <LabStage label="循序掃描與索引掃描同步動畫" caption="點任一格可以換目標 id。heap 的格子順序是刻意打亂的：資料表本身沒有排序。">
          <div className="idx-stage">
            <div>
              <div className="idx-head">
                <span><span className="tag">heap</span>　users 資料表</span>
                <span className={`idx-count${done ? ' done' : ''}`}>
                  {started ? `比較 ${scanned} / ${n} 次` : `${n} 列`}
                </span>
              </div>
              <div className="idx-heap" role="list">
                {heap.map((id, i) => {
                  const cls = ['idx-cell',
                    i < scanned ? 'scanned' : '', i === scanned - 1 && running ? 'cur' : '',
                    id === target ? 'target' : '', id === target && i < scanned ? 'hit' : '',
                    id === target && pinned ? 'pin' : ''].join(' ')
                  return (
                    <button key={id} type="button" role="listitem" className={cls} onClick={() => pick(id)}
                            title={`第 ${i + 1} 格：id = ${id}`}>{id}</button>
                  )
                })}
              </div>
              <p className="idx-note">
                {!started && '每格是一列。Seq Scan 從第 1 格比到最後一格。'}
                {started && !done && `正在比第 ${scanned} 格${heapPos < scanned ? '（已經看到了，但不能停：不知道後面還有沒有）' : ''}`}
                {done && `Seq Scan 比較 ${n} 次，目標在第 ${heapPos + 1} 格。`}
              </p>
            </div>

            <div className={indexed ? '' : 'idx-off'}>
              <div className="idx-head">
                <span><span className="tag">b-tree</span>　users_pkey 索引</span>
                <span className={`idx-count${pinned ? ' done' : ''}`}>
                  {!indexed ? '（沒有索引）' : started ? `走訪 ${lit} / ${h} 層` : `${h} 層`}
                </span>
              </div>
              <Tree levels={levels} path={path} lit={lit} />
              {indexed && lit >= h ? (
                <div className="idx-leaf">
                  <span className="tag">leaf</span>
                  {leaf.keys.map((k) => <span key={k} className={`idx-key${k === target ? ' on' : ''}`}>{k}</span>)}
                  <span className={`idx-tid${pinned ? ' on' : ''}`}>→ TID：heap 第 {heapPos + 1} 格</span>
                </div>
              ) : (
                <p className="idx-note">
                  {!indexed ? '沒有索引，資料庫不知道 id 在哪，只能全表掃。' : 'root 到 leaf 每層只讀一個節點；leaf 帶著指向 heap 列的指標（TID）。'}
                </p>
              )}
            </div>
          </div>
        </LabStage>
        <LabExplain title="什麼時候索引幫不上忙">
          <ul className="idx-list">
            <li><strong>低選擇性</strong>：<code>WHERE status = 'active'</code> 命中 90% 的列，走索引再逐筆回表比直接掃還慢，planner 會自己選 Seq Scan。</li>
            <li><strong>對欄位套函數</strong>：<code>WHERE lower(email) = …</code> 不會用到 <code>email</code> 的索引，除非建 expression index。</li>
            <li><strong>前置萬用字元</strong>：<code>LIKE '%abc'</code> 沒有固定前綴，B-tree 排不上用場；<code>LIKE 'abc%'</code> 可以。</li>
            <li><strong>寫入成本</strong>：每次 INSERT / UPDATE / DELETE 都要同步維護每一個索引，索引越多寫入越慢、空間越大。</li>
          </ul>
        </LabExplain>
        </div>

        <div className="lab-stack">
          <Code lang="sql" title="EXPLAIN 輸出（示意）" highlight={[4]}>{sql}</Code>
          <LabExplain title={explain.title}>
            {explain.text.map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(p) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            慢查詢先 <code>EXPLAIN ANALYZE</code> 看它在走 Seq Scan 還是 Index Scan，別用猜的。
            出現在 <b>WHERE、JOIN ON、ORDER BY</b> 的欄位是加索引的第一候選。
            複合索引 <code>(a, b)</code> 遵守<b>最左前綴</b>：查 <code>a</code> 或 <code>a AND b</code> 都能用，只查 <code>b</code> 用不到。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .idx-stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
        @media (max-width: 640px) { .idx-stage { grid-template-columns: 1fr; } }
        .idx-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-2); margin-bottom: 8px; }
        .idx-count { font-family: var(--mono); font-weight: 500; letter-spacing: 0; color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .idx-count.done { color: var(--lab-accent); font-weight: 700; }
        .idx-heap { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 4px; }
        .idx-cell { aspect-ratio: 1; min-width: 0; padding: 0; font-family: var(--mono); font-size: 10.5px; border-radius: 3px; cursor: pointer;
          border: 1px solid var(--hairline); background: var(--surface-1); color: var(--ink-2);
          transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease; }
        .idx-cell:hover { border-color: var(--ink-3); }
        .idx-cell.target { border-color: var(--lab-accent); border-style: dashed; color: var(--ink-1); font-weight: 700; }
        .idx-cell.scanned { background: color-mix(in srgb, var(--ink-3) 22%, var(--surface-1)); color: var(--ink-3); }
        .idx-cell.cur { background: color-mix(in srgb, var(--lab-accent) 30%, var(--surface-1)); color: var(--ink-1); transform: scale(1.12); }
        .idx-cell.hit { background: var(--lab-accent); color: var(--page); border-style: solid; }
        .idx-cell.pin { box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-aqua) 70%, transparent); }
        .idx-note { font-size: 0.76rem; color: var(--ink-3); margin-top: 8px; line-height: 1.5; min-height: 2.6em; }
        .idx-off { opacity: 0.4; }
        .idx-tree { width: 100%; }
        .idx-tree .node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.2; transition: stroke 0.25s ease, fill 0.25s ease; }
        .idx-tree .node.on { stroke: var(--lab-accent); stroke-width: 2; fill: color-mix(in srgb, var(--lab-accent) 14%, var(--surface-1)); }
        .idx-tree .edge { stroke: var(--hairline); stroke-width: 1.2; transition: stroke 0.25s ease; }
        .idx-tree .edge.on { stroke: var(--lab-accent); stroke-width: 2.2; }
        .idx-tree .key { font-family: var(--mono); font-size: 9px; fill: var(--ink-2); text-anchor: middle; }
        .idx-tree .key.on { fill: var(--ink-1); font-weight: 700; }
        .idx-tree .sep { stroke: var(--hairline); }
        .idx-tree .lvl { font-family: var(--sans); font-size: 8.5px; fill: var(--ink-3); }
        .idx-leaf { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 8px; font-size: 0.76rem; color: var(--ink-3); animation: idx-in 0.3s ease-out both; }
        .idx-key { font-family: var(--mono); font-size: 0.74rem; padding: 2px 7px; border: 1px solid var(--hairline); border-radius: 3px; color: var(--ink-2); background: var(--surface-1); }
        .idx-key.on { background: var(--lab-accent); border-color: var(--lab-accent); color: var(--page); font-weight: 700; }
        .idx-tid { opacity: 0.35; transition: opacity 0.25s ease; font-family: var(--mono); }
        .idx-tid.on { opacity: 1; color: var(--c-aqua); font-weight: 700; }
        .idx-list { padding-left: 1.2em; margin: 0; }
        .idx-list li { margin-bottom: 6px; }
        @keyframes idx-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .idx-leaf { animation: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

function pickExplain({ started, done, indexed, n, h, lit }) {
  if (!indexed) return {
    title: '沒索引 = 只能全表掃',
    text: [
      `資料表（heap）的列是照寫入時的位置擺的，沒有順序。資料庫不知道 id = X 在哪一格，也不知道 id 是否唯一，只能從第 1 格比到第 ${n} 格：${n} 次比較，一次都省不掉。`,
      '表小的時候感覺不到（順序讀磁碟很便宜，planner 甚至會刻意選 Seq Scan）；但每次查詢的成本都跟表的大小成正比，表長到百萬列時同一句 SQL 就慢一百萬倍。',
    ],
  }
  if (!started) return {
    title: '同一個查詢，兩條路',
    text: [
      '索引是資料表之外另一份**排好序、分層**的資料結構：內部節點只放「分隔 key」告訴你該往哪個子節點走，葉節點放實際的 key 和指向 heap 列的指標（TID）。',
      `每往下一層，候選範圍就縮小成 1/${FAN}，所以 ${n} 列只要 ${h} 層。按「執行」看兩邊同時跑。`,
    ],
  }
  if (!done) return {
    title: '看兩邊的速度差',
    text: [
      `左邊每個 tick 比一格；右邊每 ${TREE_STEP} 個 tick 下一層，目前在第 ${lit} 層。索引一到葉節點就拿到 TID，直接跳去 heap 取那一列（回表）。`,
      '注意左邊即使已經經過目標，還是得比到最後一格：沒有索引（也就沒有唯一約束）時，資料庫無法確定後面沒有第二筆。',
    ],
  }
  return {
    title: `${n} 次 vs ${h} 層：這就是 O(n) 和 O(log n)`,
    text: [
      `Seq Scan 比較了 ${n} 次；Index Scan 只讀 ${h} 個節點再回表 1 次。資料多 ${FAN} 倍，B-tree 只多 1 層——這是 log 的意思。`,
      '真實的 PostgreSQL 一個節點就是一個 8KB 的頁，能放幾百個 key，fan-out 是幾百而不是 4，所以上億列的表也只要 3–4 層。代價是每次寫入都要順手維護這棵樹。',
    ],
  }
}

/* B+tree 圖：葉節點顯示範圍，內部節點顯示分隔 key；path 上且已走到的層亮起 */
function Tree({ levels, path, lit }) {
  const h = levels.length
  const leaves = levels[h - 1]
  const W = 360, margin = 6, rowH = 46, top = 16, KW = 20
  const slotW = (W - margin * 2) / leaves.length
  const leafW = Math.min(60, slotW - 3)
  const pos = new Map()
  leaves.forEach((leaf, i) => pos.set(leaf, margin + (i + 0.5) * slotW))
  for (let l = h - 2; l >= 0; l--) for (const node of levels[l]) {
    const xs = node.children.map((c) => pos.get(c))
    pos.set(node, xs.reduce((a, b) => a + b, 0) / xs.length)
  }
  const H = top + (h - 1) * rowH + 30
  const onNode = (l, node) => lit > l && path[l] === node

  return (
    <svg className="idx-tree" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`B-tree 共 ${h} 層，已走到第 ${lit} 層`}>
      {levels.slice(0, -1).map((level, l) => level.map((node) => node.children.map((c, ci) => (
        <line key={`${l}-${pos.get(node)}-${ci}`}
              x1={pos.get(node)} y1={top + l * rowH + 22} x2={pos.get(c)} y2={top + (l + 1) * rowH}
              className={`edge${onNode(l + 1, c) ? ' on' : ''}`} />
      ))))}
      {levels.map((level, l) => (
        <g key={l}>
          <text x={2} y={top + l * rowH - 4} className="lvl">{l === h - 1 ? 'leaf' : l === 0 ? 'root' : `L${l}`}</text>
          {level.map((node, ni) => {
            const x = pos.get(node), y = top + l * rowH
            const on = onNode(l, node)
            if (!node.children) {
              const label = slotW >= 42 ? `${node.lo}–${node.hi}` : `${node.lo}`
              return (
                <g key={ni}>
                  <rect x={x - leafW / 2} y={y} width={leafW} height={20} rx={3} className={`node${on ? ' on' : ''}`} />
                  <text x={x} y={y + 13.5} className={`key${on ? ' on' : ''}`}>{label}</text>
                </g>
              )
            }
            const w = node.keys.length * KW + 6
            return (
              <g key={ni}>
                <rect x={x - w / 2} y={y} width={w} height={22} rx={3} className={`node${on ? ' on' : ''}`} />
                {node.keys.map((k, ki) => (
                  <g key={k}>
                    {ki > 0 && <line x1={x - w / 2 + 3 + ki * KW} y1={y + 4} x2={x - w / 2 + 3 + ki * KW} y2={y + 18} className="sep" />}
                    <text x={x - w / 2 + 3 + (ki + 0.5) * KW} y={y + 14.5} className={`key${on ? ' on' : ''}`}>{k}</text>
                  </g>
                ))}
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}
