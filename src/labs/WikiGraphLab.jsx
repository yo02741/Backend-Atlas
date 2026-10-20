import React, { useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Callout, Status, useWidth } from './ui.jsx'

/* ============================================================
   wikilink → 知識圖譜：7 頁可編輯的 markdown，[[頁面]] 就是一條有向邊
   - 即時解析 [[目標]] 與 [[目標|顯示文字]]，畫成固定橢圓排列的有向圖（不會亂跳）
   - 點節點：出連結（藍）與反向連結（橘）；孤兒頁、斷鏈（虛線節點）即時 lint
   - 找路徑：沿著連結方向 BFS，最短路徑在圖上高亮
   ============================================================ */

const NAMES = ['交易', '隔離等級', 'MVCC', 'VACUUM', 'WAL', '死結', '鎖']
const DEFAULT = {
  交易: '# 交易\n一組操作要嘛全部生效、要嘛全部不生效（ACID）。\n多個交易同時執行時彼此看得到什麼，由 [[隔離等級]] 決定。\nPostgreSQL 用 [[MVCC]] 讓讀不擋寫；要互斥修改同一列時靠 [[鎖]]。',
  隔離等級: '# 隔離等級\nSQL 標準定義四級：Read Uncommitted、Read Committed、Repeatable Read、Serializable。\n等級越高，允許的異常現象越少，但衝突與重試越多。\nPostgreSQL 預設 Read Committed，實作建立在 [[MVCC|多版本快照]] 上。',
  MVCC: '# MVCC\nUPDATE 會寫出新版本的列，舊版本留給還在讀它的 [[交易]]。\n讀不擋寫、寫不擋讀。\n代價：沒人需要的舊版本（dead tuple）要靠 [[VACUUM]] 回收。',
  VACUUM: '# VACUUM\n回收 [[MVCC]] 留下的 dead tuple，讓空間可以重用；autovacuum 會自動執行。\n長時間沒結束的 [[交易]] 會讓舊版本無法回收，表越長越大。',
  WAL: '# WAL\nWrite-Ahead Log：先把變更寫進日誌，再改資料頁；當機後重播日誌復原。\n預設設定下，[[交易]] commit 要等 WAL 寫到磁碟才回報成功。',
  死結: '# 死結\nA 等 B 的鎖、B 等 A 的鎖，誰都不會放手。\nPostgreSQL 會偵測到並中止其中一個交易，讓它收到錯誤。\n預防：所有程式依相同順序取 [[鎖]]。',
  鎖: '# 鎖\n兩個交易改同一列時，後到的要等前一個 commit 或 rollback。\nSELECT … FOR UPDATE 會明確鎖住讀到的列。\n互相等待成環就是 [[死結]]；理論背景見 [[兩階段鎖定]]。',
}
const LINK = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g

function parse(pages) {
  const links = []
  for (const src of NAMES) {
    for (const m of pages[src].matchAll(LINK)) {
      const target = m[1].trim()
      if (!target || target === src) continue
      const t = pages[src]
      links.push({ src, target, label: (m[2] || m[1]).trim(), ok: NAMES.includes(target),
                   ctx: [t.slice(Math.max(0, m.index - 14), m.index).replace(/^.*\n/s, ''), t.slice(m.index + m[0].length, m.index + m[0].length + 14).replace(/\n.*$/s, '')] })
    }
  }
  const seen = new Set()
  const edges = links.filter((l) => { const k = `${l.src}>${l.target}`; if (seen.has(k)) return false; seen.add(k); return true })
  const broken = [...new Set(links.filter((l) => !l.ok).map((l) => l.target))]
  const orphans = NAMES.filter((n) => !edges.some((e) => e.target === n))
  return { links, edges, broken, orphans }
}

function bfs(edges, from, to) {
  const prev = new Map([[from, null]])
  const q = [from]
  while (q.length) {
    const cur = q.shift()
    if (cur === to) break
    for (const e of edges) if (e.src === cur && e.ok && !prev.has(e.target)) { prev.set(e.target, cur); q.push(e.target) }
  }
  if (!prev.has(to)) return null
  const path = []
  for (let n = to; n !== null; n = prev.get(n)) path.unshift(n)
  return path
}

const textW = (s, fs) => [...s].reduce((t, ch) => t + (/[一-鿿]/.test(ch) ? fs : fs * 0.62), 0)

export default function WikiGraphLab() {
  const [pages, setPages] = useState(DEFAULT)
  const [page, setPage] = useState('鎖')
  const [sel, setSel] = useState('鎖')
  const [from, setFrom] = useState('隔離等級')
  const [to, setTo] = useState('死結')
  const [showPath, setShowPath] = useState(true)
  const g = useMemo(() => parse(pages), [pages])
  const path = useMemo(() => (from === to ? [from] : bfs(g.edges, from, to)), [g, from, to])
  const edited = NAMES.some((n) => pages[n] !== DEFAULT[n])
  const pick = (n) => { setSel(n); if (NAMES.includes(n)) setPage(n) }

  const outs = g.links.filter((l) => l.src === sel)
  const ins = g.links.filter((l) => l.target === sel)
  const mine = g.links.filter((l) => l.src === page)
  const explain = pickExplain(g, sel, ins, outs, showPath ? path : undefined, from, to)

  return (
    <Lab accent="violet" kicker="KNOWLEDGE GRAPH LAB" title="wikilink 長成知識圖譜"
         blurb="左邊是 7 頁互相連結的 markdown 筆記，右邊即時把每個 [[頁面]] 畫成一條有向邊。改內容看圖跟著變；點節點看誰連出去、誰連進來；孤兒頁與斷鏈即時列出；選兩頁找最短路徑。">
      <LabControls>
        <Seg label="編輯頁面" tinted value={page} onChange={pick} options={NAMES.map((n) => ({ value: n, label: n }))} />
        <span className="spacer" />
        {edited && <button type="button" className="btn ghost small" onClick={() => setPages(DEFAULT)}>還原預設內容</button>}
      </LabControls>

      <div className="wg-grid">
        <div className="wg-editor wg-ed">
          <label className="wg-file" htmlFor="wg-ta"><span className="tag">{page}.md</span><span className="muted">用 [[頁面]] 或 [[頁面|顯示文字]] 連結</span></label>
          <textarea id="wg-ta" value={pages[page]} spellCheck={false} rows={9}
                    onChange={(e) => { const v = e.target.value; setPages((p) => ({ ...p, [page]: v })) }} />
          <div className="wg-chips">
            <span className="muted">這頁連出去：</span>
            {mine.length ? mine.map((l, i) => (
              <button type="button" key={i} className={`wg-chip${l.ok ? '' : ' bad'}`} onClick={() => pick(l.target)}
                      title={l.ok ? '點一下在圖上選取' : '這頁不存在'}>{l.label !== l.target ? `${l.label} → ` : ''}{l.target}{l.ok ? '' : '（不存在）'}</button>
            )) : <span className="muted">（沒有連結）</span>}
          </div>
        </div>

        <div className="lab-stack wg-gr">
          <div className="wg-path">
            <span className="seg-label">找路徑</span>
            <select aria-label="起點" value={from} onChange={(e) => setFrom(e.target.value)}>{NAMES.map((n) => <option key={n}>{n}</option>)}</select>
            <span className="muted">→</span>
            <select aria-label="終點" value={to} onChange={(e) => setTo(e.target.value)}>{NAMES.map((n) => <option key={n}>{n}</option>)}</select>
            <Toggle label="在圖上顯示" checked={showPath} onChange={setShowPath} />
          </div>
          <LabStage label="wikilink 有向圖" caption="箭頭 = 連結方向。藍 = 選取頁連出去，橘 = 連到選取頁（反向連結），紫 = 最短路徑；虛線節點 = 不存在的頁面。點節點切換選取。">
            <Graph g={g} sel={sel} onPick={pick} path={showPath ? path : null} />
          </LabStage>
        </div>
        <div className="wg-panel wg-bl">
          <h5>反向連結：誰提到「{sel}」 <b>{ins.length}</b></h5>
          {ins.length ? <ul>{ins.map((l, i) => <li key={i} className="wg-in"><b className="wg-from">{l.src}</b><span className="muted">…{l.ctx[0]}</span><mark>{l.label}</mark><span className="muted">{l.ctx[1]}…</span></li>)}</ul>
            : <p className="muted">沒有任何頁面連到這裡。</p>}
          <h5>「{sel}」連出去 <b>{outs.length}</b></h5>
          {outs.length ? <p className="wg-list">{outs.map((l, i) => <span key={i} className={`tag${l.ok ? '' : ' wg-bad'}`}>{l.target}</span>)}</p>
            : <p className="muted">{NAMES.includes(sel) ? '這頁沒有連到任何頁面。' : '這頁不存在，沒有內容可以連出去。'}</p>}
        </div>
      </div>

      <LabGrid>
        <div className="lab-stack">
          <div className="wg-panel">
            <h5>lint 報告</h5>
            <p className="wg-lint"><Status ok={!g.orphans.length} warn={g.orphans.length > 0}>孤兒頁 {g.orphans.length}</Status>
              {g.orphans.map((n) => <button type="button" key={n} className="wg-chip" onClick={() => pick(n)}>{n}</button>)}</p>
            <p className="wg-lint"><Status ok={!g.broken.length}>斷鏈 {g.links.filter((l) => !l.ok).length}</Status>
              {g.links.filter((l) => !l.ok).map((l, i) => <button type="button" key={i} className="wg-chip bad" onClick={() => pick(l.target)}>{l.src} → [[{l.target}]]</button>)}</p>
            <p className="wg-lint"><span className="seg-label">最短路徑</span>
              {path ? <span className="wg-route">{path.join(' → ')}<span className="muted">（{path.length - 1} 步）</span></span>
                : <span className="wg-route bad">從「{from}」沿連結走不到「{to}」</span>}</p>
          </div>
          <LabExplain title={explain.title}>
            {explain.text.map((p, i) => <p key={i}>{p}</p>)}
          </LabExplain>
        </div>
        <div className="lab-stack">
          <LabExplain title="wikilink 就是圖的邊">
            <p>每寫一個 <code>[[頁面]]</code> 就多一條從這頁指向那頁的有向邊；<code>[[頁面|顯示文字]]</code> 只改顯示文字，邊還是指向同一頁。不需要另外維護圖，圖是從文字裡「長」出來的。</p>
            <p>Obsidian 的 graph view 與 backlinks 面板就是這個概念：反向連結讓「誰提到我」一目瞭然；點一下不存在的連結，Obsidian 會幫你建立那一頁。讓 LLM 持續整理的 wiki 也會定期 lint：孤兒頁要補連結或併入別頁，斷鏈要建頁或改連結。</p>
          </LabExplain>
          <Callout title="實際用在哪裡">
            個人或團隊的筆記庫（Obsidian、Logseq 這類工具）、交給 LLM 維護的知識庫、內部技術文件。定期跑一次孤兒頁與斷鏈檢查，比等到有人找不到東西再修便宜得多。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .wg-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); grid-template-areas: "ed gr" "bl gr"; grid-template-rows: auto 1fr; gap: 14px 18px; align-items: start; margin-bottom: 18px; }
        .wg-ed { grid-area: ed; } .wg-gr { grid-area: gr; } .wg-bl { grid-area: bl; }
        @media (max-width: 760px) { .wg-grid { grid-template-columns: minmax(0, 1fr); grid-template-areas: "ed" "gr" "bl"; } }
        .wg-editor { display: grid; gap: 8px; }
        .wg-file { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.74rem; }
        .wg-editor textarea { width: 100%; min-height: 230px; resize: vertical; font-family: var(--mono); font-size: 0.8rem; line-height: 1.7; color: var(--ink-1); background: var(--page); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 10px 12px; }
        .wg-editor textarea:focus { outline: 2px solid color-mix(in srgb, var(--lab-accent) 60%, transparent); outline-offset: 1px; }
        .wg-chips, .wg-lint, .wg-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.78rem; }
        .wg-chip { font-family: var(--sans); font-size: 0.76rem; padding: 2px 9px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--c-blue) 55%, transparent); background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
        .wg-chip.bad { border-style: dashed; border-color: var(--critical); color: var(--critical); }
        .tag.wg-bad { border-style: dashed; border-color: var(--critical); color: var(--critical); }
        .wg-path { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; }
        .wg-path select { font: inherit; font-size: 0.82rem; color: var(--ink-1); background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 6px; }
        .wg-svg { width: 100%; }
        .wg-svg .e { fill: none; stroke: var(--ink-3); stroke-opacity: 0.55; stroke-width: 1.4; transition: stroke 0.2s ease, stroke-opacity 0.2s ease, stroke-width 0.2s ease; }
        .wg-svg .h { fill: var(--ink-3); fill-opacity: 0.7; transition: fill 0.2s ease, fill-opacity 0.2s ease; }
        .wg-svg .broken .e { stroke-dasharray: 4 4; }
        .wg-svg .out .e { stroke: var(--c-blue); stroke-opacity: 1; stroke-width: 2.2; } .wg-svg .out .h { fill: var(--c-blue); fill-opacity: 1; }
        .wg-svg .in .e { stroke: var(--c-orange); stroke-opacity: 1; stroke-width: 2.2; } .wg-svg .in .h { fill: var(--c-orange); fill-opacity: 1; }
        .wg-svg .path .e { stroke: var(--lab-accent); stroke-opacity: 1; stroke-width: 3.4; } .wg-svg .path .h { fill: var(--lab-accent); fill-opacity: 1; }
        .wg-svg .faint .e { stroke-opacity: 0.18; } .wg-svg .faint .h { fill-opacity: 0.2; }
        .wg-svg .n { cursor: pointer; outline: none; }
        .wg-svg .n rect { fill: var(--surface-1); stroke: var(--ink-3); stroke-width: 1.3; transition: stroke 0.2s ease, fill 0.2s ease, stroke-width 0.2s ease; }
        .wg-svg .n text { font-family: var(--sans); fill: var(--ink-1); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
        .wg-svg .n.ghost rect { stroke: var(--critical); stroke-dasharray: 4 3; fill: var(--page); }
        .wg-svg .n.ghost text { fill: var(--critical); }
        .wg-svg .n.orphan rect { stroke: var(--serious); stroke-width: 2; }
        .wg-svg .n.nb-out rect { stroke: var(--c-blue); stroke-width: 2; }
        .wg-svg .n.nb-in rect { stroke: var(--c-orange); stroke-width: 2; }
        .wg-svg .n.onpath rect { stroke: var(--lab-accent); stroke-width: 2.6; }
        .wg-svg .n.sel rect { fill: var(--lab-accent); stroke: var(--lab-accent); }
        .wg-svg .n.sel text:not(.note) { fill: var(--surface-1); font-weight: 700; }
        .wg-svg .n:focus-visible rect { outline: none; stroke: var(--ink-1); stroke-width: 2.5; }
        .wg-svg .note { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .wg-svg .note.warn { fill: var(--serious); font-weight: 700; }
        .wg-svg .band { fill: none; stroke: var(--hairline); stroke-dasharray: 3 4; }
        .wg-panel { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); padding: 12px 14px; display: grid; gap: 8px; align-content: start; font-size: 0.82rem; color: var(--ink-2); }
        .wg-panel h5 { font-size: 0.78rem; color: var(--ink-1); letter-spacing: 0.02em; }
        .wg-panel h5 b { font-family: var(--mono); color: var(--lab-accent); margin-left: 4px; }
        .wg-panel ul { list-style: none; display: grid; gap: 4px; }
        .wg-in { line-height: 1.6; animation: wg-in 0.3s ease-out both; }
        .wg-in mark { background: color-mix(in srgb, var(--c-orange) 22%, transparent); color: var(--ink-1); border-radius: 2px; padding: 0 2px; }
        .wg-from { color: var(--ink-1); margin-right: 6px; }
        .wg-route { font-family: var(--mono); color: var(--ink-1); } .wg-route.bad { color: var(--critical); font-family: var(--sans); }
        @keyframes wg-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .wg-in { animation: none; } .wg-svg .e, .wg-svg .h, .wg-svg .n rect { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 圖：存在的頁面排在固定橢圓上（順序不變 → 位置不跳）；斷鏈目標排在底部「不存在的頁面」帶 */
function Graph({ g, sel, onPick, path }) {
  const ref = useRef(null)
  const w = Math.max(280, useWidth(ref, 560))
  const narrow = w < 460
  const fs = narrow ? 11 : 12.5, nh = narrow ? 24 : 28
  const ringH = narrow ? w * 1.0 : Math.min(360, w * 0.66)
  const bandH = g.broken.length ? 64 : 0
  const h = ringH + bandH + 4
  const size = (n) => ({ hw: textW(n, fs) / 2 + 10, hh: nh / 2 })
  const maxHw = Math.max(...NAMES.map((n) => size(n).hw))
  const rx = w / 2 - maxHw - 4, ry = ringH / 2 - nh / 2 - 14
  const pos = {}
  NAMES.forEach((n, i) => { const a = -Math.PI / 2 + (i / NAMES.length) * Math.PI * 2; pos[n] = { x: w / 2 + rx * Math.cos(a), y: ringH / 2 + ry * Math.sin(a) } })
  g.broken.forEach((n, i) => { pos[n] = { x: (w * (i + 1)) / (g.broken.length + 1), y: ringH + bandH / 2 + 4 } })

  const onPath = new Set(path || [])
  const pathEdge = (e) => path && path.some((n, i) => n === e.src && path[i + 1] === e.target)
  const outN = new Set(g.edges.filter((e) => e.src === sel).map((e) => e.target))
  const inN = new Set(g.edges.filter((e) => e.target === sel).map((e) => e.src))
  const all = [...NAMES, ...g.broken]

  return (
    <div ref={ref}>
      <svg className="wg-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${NAMES.length} 頁、${g.edges.length} 條連結的有向圖，選取「${sel}」`}>
        {bandH > 0 && <><rect className="band" x={2} y={ringH + 2} width={w - 4} height={bandH - 2} rx={6} /><text className="note" x={8} y={ringH + 15}>不存在的頁面（斷鏈）</text></>}
        {g.edges.map((e) => {
          const A = pos[e.src], B = pos[e.target]
          const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1
          const c = { x: (A.x + B.x) / 2 - (dy / len) * 18, y: (A.y + B.y) / 2 + (dx / len) * 18 }
          const s = clip(A, c, size(e.src)), t = clip(B, c, size(e.target), 3)
          const ux = t.x - c.x, uy = t.y - c.y, ul = Math.hypot(ux, uy) || 1
          const ax = ux / ul, ay = uy / ul
          const head = `${t.x},${t.y} ${t.x - ax * 9 - ay * 4.5},${t.y - ay * 9 + ax * 4.5} ${t.x - ax * 9 + ay * 4.5},${t.y - ay * 9 - ax * 4.5}`
          const cls = pathEdge(e) ? 'path' : e.src === sel ? 'out' : e.target === sel ? 'in' : 'faint'
          return (
            <g key={`${e.src}>${e.target}`} className={`${cls}${e.ok ? '' : ' broken'}`}>
              <path className="e" d={`M${s.x.toFixed(1)} ${s.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${(t.x - ax * 6).toFixed(1)} ${(t.y - ay * 6).toFixed(1)}`} />
              <polygon className="h" points={head} />
            </g>
          )
        })}
        {all.map((n) => {
          const { hw, hh } = size(n), p = pos[n]
          const ghost = !NAMES.includes(n), orphan = g.orphans.includes(n)
          const cls = ['n', ghost && 'ghost', orphan && 'orphan', outN.has(n) && 'nb-out', inN.has(n) && 'nb-in', onPath.has(n) && 'onpath', n === sel && 'sel'].filter(Boolean).join(' ')
          return (
            <g key={n} className={cls} role="button" tabIndex={0} aria-label={`選取 ${n}`} onClick={() => onPick(n)}
               onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(n) } }}>
              <rect x={p.x - hw} y={p.y - hh} width={hw * 2} height={hh * 2} rx={hh} />
              <text x={p.x} y={p.y} style={{ fontSize: fs }}>{n}</text>
              {orphan && <text className="note warn" x={p.x} y={p.y + hh + 11} textAnchor="middle">孤兒頁</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* 從節點中心 p 朝 toward 方向，找出與節點外框（加 pad）的交點 */
function clip(p, toward, { hw, hh }, pad = 1) {
  const dx = toward.x - p.x, dy = toward.y - p.y
  const t = Math.min((hw + pad) / Math.abs(dx || 1e-6), (hh + pad) / Math.abs(dy || 1e-6))
  return { x: p.x + dx * Math.min(t, 1), y: p.y + dy * Math.min(t, 1) }
}

function pickExplain(g, sel, ins, outs, path, from, to) {
  const tail = path === undefined ? [] : path
    ? [`最短路徑「${path.join(' → ')}」是沿著連結方向做 BFS 找到的：先看起點直接連到的頁，再看那些頁連到的頁，第一次碰到終點時走過的就是最少步數。`]
    : [`從「${from}」沿著連結方向走不到「${to}」。連結是有方向的：A 連到 B，不代表能從 B 走回 A；沒有任何頁連進來的孤兒頁，從別處永遠走不到。`]
  if (!NAMES.includes(sel)) return {
    title: `斷鏈：「${sel}」這頁不存在`,
    text: [`${ins.map((l) => l.src).join('、')} 連到了「${sel}」，但沒有這一頁——讀者點下去是空的。`, '修法有兩種：真的需要這個主題就建立頁面；只是寫錯名字或主題已併入別頁，就改連結指向現有的頁。', ...tail],
  }
  if (g.orphans.includes(sel)) return {
    title: `孤兒頁：沒有人連到「${sel}」`,
    text: [`「${sel}」連出去 ${outs.length} 條，但反向連結是 0：除非直接搜尋，否則從任何一頁都逛不到它。`, '在相關的頁面（例如「交易」提到 commit 的地方）加上連結，它就會被接進圖裡。試著在左邊編輯看看。', ...tail],
  }
  return {
    title: `「${sel}」：連出去 ${outs.length}、被連進來 ${ins.length}`,
    text: [`藍色是「${sel}」頁面裡寫的連結；橘色是別的頁面寫了 [[${sel}]]——這些反向連結不需要「${sel}」自己記錄，是從全部頁面反查出來的。`, ...tail],
  }
}
