import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Status, Stats, Stat, Caption, fmtN } from '../ui.jsx'

/* 大表格情境模擬器：同一份假的看診紀錄，三種呈現方式真的畫在瀏覽器裡。
   前端分頁只畫一頁、虛擬捲動只畫視窗內的列、伺服器分頁每個動作等一次（示意）延遲。
   「排序與篩選」的毫秒數是這台電腦實際量到的；下載量用這份假資料的 JSON 長度估計（未壓縮）；網路延遲是示意值。 */

const MODES = [
  { value: 'client', label: '前端分頁' },
  { value: 'virtual', label: '虛擬捲動' },
  { value: 'server', label: '伺服器分頁' },
]
const PAGE = 50, ROW_H = 30, VIEW_H = 300, OVERSCAN = 4, LATENCY = 350
const DOCS = ['王醫師', '陳醫師', '林醫師', '張醫師', '李醫師', '吳醫師']
const SUR = ['王', '陳', '林', '張', '李', '黃', '吳', '劉']
const GIV = ['明', '華', '婷', '安', '傑', '芳', '宏', '萱']
const STATUS = ['已看診', '已看診', '已看診', '未報到', '已取消']

function makeRows(n) {
  let s = 20261119
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out = new Array(n)
  const t0 = Date.UTC(2026, 0, 1)
  for (let i = 0; i < n; i++) {
    const date = new Date(t0 + Math.floor(rnd() * 365) * 86400000).toISOString().slice(0, 10)
    out[i] = { id: i + 1, date, doc: DOCS[Math.floor(rnd() * DOCS.length)], name: `${SUR[Math.floor(rnd() * 8)]}○${GIV[Math.floor(rnd() * 8)]}`,
      chart: String(10000000 + Math.floor(rnd() * 89999999)), status: STATUS[Math.floor(rnd() * STATUS.length)] }
  }
  return out
}
const bytes = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${Math.round(b)} bytes`)

const EXPLAIN = {
  client: { title: '前端分頁：資料全在手上，DOM 只有一頁', body: ['全部紀錄一次下載，排序、篩選、換頁都在瀏覽器做，點「依日期排序」幾乎立刻完成（「排序與篩選」的毫秒數是這台電腦量到的）。', '代價在第一次載入：下載量與解析時間隨筆數線性成長，把筆數拉到 10 萬看看。Ctrl+F 與螢幕閱讀器只看得到這一頁的 50 列。'] },
  virtual: { title: '虛擬捲動：一條捲軸，DOM 只有看得到的列', body: ['上下各一段空白撐出完整的捲軸，只畫視窗內的十來列，加上前後各 4 列緩衝；捲到哪裡，DOM 列數都差不多。', '畫面外的列不在 DOM 裡：按「Ctrl+F 找第 … 列的病歷號」看結果，螢幕閱讀器的瀏覽模式也一樣。表格要帶 aria-rowcount，每列帶 aria-rowindex。全選一次選了上萬筆，畫面上卻只看得到十來列。'] },
  server: { title: '伺服器分頁：只下載一頁，每個動作等一次來回', body: ['第一次載入只有 50 列，筆數拉到 10 萬也一樣。排序、篩選、換頁都送到 API，回來之前顯示 loading，連點時要取消舊請求。', '全選先選這一頁；擴大到「全部符合條件」時，批次 API 收到的是篩選條件，不是幾千個 id。'] },
}

export default function BigTableScenarioLab() {
  const [mode, setMode] = useState('client')
  const [n, setN] = useState(10000)
  const [desc, setDesc] = useState(true)
  const [noShow, setNoShow] = useState(false)
  const [page, setPage] = useState(0)
  const [top, setTop] = useState(0)
  const [sel, setSel] = useState(() => new Set())
  const [allMatching, setAllMatching] = useState(false)
  const [find, setFind] = useState(null)
  const [batch, setBatch] = useState(null)
  const [served, setServed] = useState({ rows: [], offset: 0 })
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const [domRows, setDomRows] = useState(0)

  const all = useMemo(() => makeRows(n), [n])
  const perRow = useMemo(() => new TextEncoder().encode(JSON.stringify(all.slice(0, 200))).length / Math.min(200, all.length), [all])
  const view = useMemo(() => {                       // 篩選 + 排序全部資料，量實際花多久
    const t0 = performance.now()
    const rows = (noShow ? all.filter((r) => r.status === '未報到') : all.slice())
      .sort((a, b) => (a.date === b.date ? a.id - b.id : (a.date < b.date) === desc ? 1 : -1))
    return { rows, ms: performance.now() - t0 }
  }, [all, desc, noShow])
  const total = view.rows.length
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const p = Math.min(page, pages - 1)

  const reset = () => { setPage(0); setSel(new Set()); setAllMatching(false); setFind(null); setBatch(null); if (boxRef.current) boxRef.current.scrollTop = 0; setTop(0) }
  useEffect(reset, [mode, n, desc, noShow])

  // 伺服器分頁：每次條件或頁碼改變，等一次示意延遲才換上新的一頁
  const key = `${n}|${desc}|${noShow}|${p}`
  useEffect(() => {
    if (mode !== 'server') return
    setLoading(true)
    const t = setTimeout(() => { setServed({ rows: view.rows.slice(p * PAGE, p * PAGE + PAGE), offset: p * PAGE }); setLoading(false) }, LATENCY)
    return () => clearTimeout(t)
  }, [mode, key, view, p])

  let shown, offset = 0, padTop = 0, padBottom = 0
  if (mode === 'virtual') {
    const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
    const end = Math.min(total, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN)
    shown = view.rows.slice(start, end); offset = start
    padTop = start * ROW_H; padBottom = (total - end) * ROW_H
  } else if (mode === 'client') { shown = view.rows.slice(p * PAGE, p * PAGE + PAGE); offset = p * PAGE }
  else { shown = served.rows; offset = served.offset }
  useEffect(() => { setDomRows(boxRef.current ? boxRef.current.querySelectorAll('tbody tr[data-r]').length : 0) })

  const target = view.rows[Math.floor(total * 0.84)]
  const doFind = () => {
    const hit = !!target && !!boxRef.current && boxRef.current.textContent.includes(target.chart)
    setFind({ chart: target?.chart, idx: Math.floor(total * 0.84), hit })
  }
  const pageIds = shown.map((r) => r.id)
  const headChecked = mode === 'virtual' ? total > 0 && sel.size === total : pageIds.length > 0 && pageIds.every((id) => sel.has(id))
  const headPartial = !headChecked && sel.size > 0
  const toggleHead = (on) => {
    setAllMatching(false); setBatch(null)
    if (mode === 'virtual') setSel(on ? new Set(view.rows.map((r) => r.id)) : new Set())
    else setSel(on ? new Set(pageIds) : new Set())
  }
  const toggleRow = (id) => setSel((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x })
  const selCount = allMatching ? total : sel.size
  const sendBatch = () => setBatch(allMatching ? { kind: 'filter', text: noShow ? '{ "filter": { "status": "no-show" } }' : '{ "filter": {} }', size: noShow ? 36 : 14 }
    : { kind: 'ids', text: `{ "ids": [${[...sel].slice(0, 3).join(', ')}${sel.size > 3 ? `, …共 ${fmtN(sel.size)} 個` : ''}] }`, size: sel.size * 7 + 12 })
  const ex = EXPLAIN[mode]
  const download = mode === 'server' ? perRow * PAGE : perRow * n

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="同一份看診紀錄，三種畫法"
         blurb="切換做法與筆數，看下載量、DOM 裡的列、排序要等多久，以及全選到底選了誰。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label="紀錄筆數" min={1000} max={100000} step={1000} value={n} onChange={setN} format={(v) => `${fmtN(v)} 筆`} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={() => setDesc((d) => !d)}>依日期排序：{desc ? '新 → 舊' : '舊 → 新'}</button>
            <button type="button" className={`btn small ${noShow ? '' : 'ghost'}`} onClick={() => setNoShow((x) => !x)} aria-pressed={noShow}>只看未報到</button>
            <button type="button" className="btn ghost small" onClick={doFind}>Ctrl+F 找第 {fmtN(Math.floor(total * 0.84) + 1)} 列的病歷號</button>
            <span className="spacer" />
            {mode === 'server' && (loading ? <Status warn>載入中（示意 {LATENCY} ms）</Status> : <Status ok>第 {p + 1} 頁已載入</Status>)}
          </LabControls>
          {find && <p className={`bt-find ${find.hit ? 'ok' : 'bad'}`} role="status">{find.hit ? `找到病歷號 ${find.chart}：這一列在 DOM 裡。` : `找不到病歷號 ${find.chart}：第 ${fmtN(find.idx + 1)} 列${mode === 'virtual' ? '不在視窗內，所以不在 DOM 裡' : '在別頁'}，瀏覽器的搜尋與螢幕閱讀器的瀏覽模式都看不到它。`}</p>}
          {!allMatching && headChecked && mode !== 'virtual' && total > pageIds.length && (
            <p className="bt-banner" role="status">已選這一頁 {pageIds.length} 筆。<button type="button" className="bt-link" onClick={() => { setAllMatching(true); setBatch(null) }}>選取全部 {fmtN(total)} 筆符合條件的紀錄</button></p>
          )}
          {allMatching && <p className="bt-banner" role="status">已選全部 {fmtN(total)} 筆。<button type="button" className="bt-link" onClick={() => toggleHead(false)}>清除選取</button></p>}
          {mode === 'virtual' && headChecked && <p className="bt-banner warn" role="status">已選 {fmtN(total)} 筆，畫面上只看得到 {Math.round(VIEW_H / ROW_H)} 列左右。</p>}
          <div className={`bt-box ${loading && mode === 'server' ? 'busy' : ''}`} ref={boxRef} style={{ height: VIEW_H }} tabIndex={0} role="region" aria-label="看診紀錄"
               onScroll={mode === 'virtual' ? (e) => setTop(e.currentTarget.scrollTop) : undefined}>
            <table className="bt-table" aria-rowcount={total + 1} aria-busy={mode === 'server' && loading}>
              <thead>
                <tr aria-rowindex={1}>
                  <th scope="col"><input type="checkbox" aria-label={mode === 'virtual' ? '全選' : '全選這一頁'} checked={headChecked} ref={(el) => { if (el) el.indeterminate = headPartial }} onChange={(e) => toggleHead(e.target.checked)} /></th>
                  <th scope="col">#</th><th scope="col" aria-sort={desc ? 'descending' : 'ascending'}>日期</th><th scope="col">醫師</th><th scope="col">病人</th><th scope="col">病歷號</th><th scope="col">狀態</th>
                </tr>
              </thead>
              <tbody>
                {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={7} className="bt-pad" /></tr>}
                {shown.map((r, i) => (
                  <tr key={r.id} data-r aria-rowindex={offset + i + 2} className={sel.has(r.id) || allMatching ? 'on' : ''}>
                    <td><input type="checkbox" aria-label={`選取 ${r.name}`} checked={allMatching || sel.has(r.id)} onChange={() => { setAllMatching(false); toggleRow(r.id) }} /></td>
                    <td className="n">{fmtN(offset + i + 1)}</td><td>{r.date}</td><td>{r.doc}</td><td>{r.name}</td><td className="n">{r.chart}</td>
                    <td><span className={`bt-st ${r.status === '未報到' ? 'warn' : r.status === '已取消' ? 'off' : ''}`}>{r.status}</span></td>
                  </tr>
                ))}
                {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={7} className="bt-pad" /></tr>}
              </tbody>
            </table>
          </div>
          <LabControls>
            {mode !== 'virtual' ? (<>
              <button type="button" className="btn ghost small" onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0}>← 上一頁</button>
              <span className="bt-pg">第 {p + 1} / {fmtN(pages)} 頁</span>
              <button type="button" className="btn ghost small" onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1}>下一頁 →</button>
              <button type="button" className="btn ghost small" onClick={() => setPage(pages - 1)} disabled={p >= pages - 1}>最後一頁</button>
            </>) : <span className="bt-pg">捲軸高度 {fmtN(total * ROW_H)} px，畫出的列從第 {fmtN(offset + 1)} 列開始</span>}
            <span className="spacer" />
            <button type="button" className="btn small" onClick={sendBatch} disabled={selCount === 0}>寄提醒給已選的 {fmtN(selCount)} 筆</button>
          </LabControls>
          {batch && <p className="bt-req"><b>POST /visits/remind</b> <code>{batch.text}</code> <span>約 {bytes(batch.size)}</span></p>}
        </div>
        <div className="lab-stack">
          <Stats min={118}>
            <Stat label="第一次下載（估計）" value={bytes(download)} tone={download > 5e6 ? 'bad' : download > 1e6 ? 'warn' : 'ok'} note={mode === 'server' ? '只有一頁' : `${fmtN(n)} 筆 JSON，未壓縮`} />
            <Stat label="DOM 裡的資料列" value={fmtN(domRows)} note={`共 ${fmtN(total)} 列`} />
            <Stat label="排序與篩選" value={mode === 'server' ? `${LATENCY} ms` : `${view.ms.toFixed(1)} ms`} note={mode === 'server' ? '一次來回（示意）' : '這台電腦實測'} tone={mode === 'server' ? 'warn' : 'ok'} />
            <Stat label="已選" value={fmtN(selCount)} unit="筆" note={allMatching ? '全部符合條件' : mode === 'virtual' && headChecked ? '含畫面外的列' : sel.size ? '這一頁勾的' : ''} />
          </Stats>
          <Caption>這份假資料每列約 {Math.round(perRow)} bytes（UTF-8）；gzip 後傳輸量小很多，解析與記憶體成本不變</Caption>
          <LabExplain title={ex.title}>{ex.body.map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <Callout title="什麼時候會踩到">資料從幾百筆長到幾萬筆的時候：當初一次載入的表格開始卡，第一次打開要等好幾秒。另一種是「全選」後批次取消，結果只取消了這一頁，或取消了使用者沒看到的上萬筆。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .bt-box { overflow: auto; border: var(--bw) solid var(--line); border-radius: 10px; background: var(--surface-1); box-shadow: 4px 4px 0 var(--shade); transition: opacity 0.2s ease; }
        .bt-box:focus-visible { outline: 2px solid var(--ink-1); outline-offset: 3px; }
        .bt-box.busy { opacity: 0.55; }
        .bt-table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 540px; font-size: 0.78rem; table-layout: fixed; }
        .bt-table th { position: sticky; top: 0; z-index: 1; height: ${ROW_H}px; padding: 0 8px; text-align: left; font-size: 0.7rem; letter-spacing: 0.04em; color: var(--ink-2); background: var(--surface-2); border-bottom: 1.5px solid var(--line); white-space: nowrap; }
        .bt-table th:first-child, .bt-table td:first-child { width: 34px; text-align: center; }
        .bt-table th:nth-child(2) { width: 62px; }
        .bt-table td { height: ${ROW_H}px; padding: 0 8px; border-bottom: 1px solid var(--hairline); color: var(--ink-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bt-table td.n { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--ink-2); }
        .bt-table td.bt-pad { padding: 0; border: 0; height: auto; }
        .bt-table tr.on td { background: color-mix(in srgb, var(--lab-accent) 14%, var(--surface-1)); }
        .bt-st { font-size: 0.7rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--st-mint); color: var(--on-sticker); }
        .bt-st.warn { background: var(--st-yellow); }
        .bt-st.off { background: var(--surface-2); color: var(--ink-3); border-color: var(--hairline); }
        .bt-pg { font-size: 0.8rem; color: var(--ink-2); font-variant-numeric: tabular-nums; }
        .bt-banner { margin: 0; padding: 6px 12px; border: 1.5px solid var(--line); border-radius: 8px; background: var(--st-blue); color: var(--on-sticker); font-size: 0.82rem; }
        .bt-banner.warn { background: var(--st-yellow); }
        .bt-link { font: inherit; font-weight: 700; color: var(--on-sticker); background: none; border: 0; padding: 0 0 0 6px; text-decoration: underline; cursor: pointer; }
        .bt-link:focus-visible { outline: 2px solid var(--on-sticker); outline-offset: 2px; }
        .bt-find { margin: 0; font-size: 0.82rem; padding: 6px 12px; border-radius: 8px; border: 1.5px solid var(--line); color: var(--on-sticker); }
        .bt-find.ok { background: var(--st-mint); }
        .bt-find.bad { background: var(--st-red); }
        .bt-req { margin: 0; font-size: 0.78rem; color: var(--ink-2); display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
        .bt-req code { font-family: var(--mono); background: var(--surface-2); padding: 2px 8px; border-radius: 4px; color: var(--ink-1); overflow-wrap: anywhere; }
        @media (prefers-reduced-motion: reduce) { .bt-box { transition: none; } }
      `}</style>
    </Lab>
  )
}
