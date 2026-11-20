import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Status, Stats, Stat, Caption, useTicker, fmtMs, Measure } from '../ui.jsx'

/* 渲染方式情境模擬器：同一支手機打開「門診時刻表」或「我的掛號」，四種做法的載入時間線。
   時間線是示意的模型：頻寬約 1.5 KB/ms、API 在伺服器端 150 ms、伺服器渲染 80 ms、JS 每 KB（gzip）執行約 1 ms。
   數字只用來比較先後與量級，不是量測值。另外示範停診公告多久出現、爬蟲拿到什麼 HTML。 */

const MODES = [
  { value: 'csr', label: 'CSR' },
  { value: 'ssr', label: 'SSR' },
  { value: 'ssg', label: 'SSG' },
  { value: 'hybrid', label: '依頁面選' },
]
const PAGES = [{ value: 'schedule', label: '門診時刻表（公開）' }, { value: 'me', label: '我的掛號（登入後）' }]
const BW = 1.5, API = 150, RENDER = 80, INTERNAL = 10, EXEC = 1.0, SHELL_KB = 2, HTML_KB = 40
const SERVER = { csr: '送靜態檔', ssr: `每次渲染（約 ${API + RENDER + INTERNAL} ms）`, ssg: '送靜態檔', cache: '多半讀快取', shell: '送靜態殼' }

/* 實際生效的模式：依頁面選時，時刻表是 SSR + 快取，我的掛號是 CSR */
const effOf = (mode, page) => (mode === 'hybrid' ? (page === 'schedule' ? 'cache' : 'csr') : mode === 'ssg' && page === 'me' ? 'shell' : mode)

function timeline(eff, rtt, js) {
  const bars = []
  const add = (label, start, dur, cls) => { bars.push({ label, start, end: start + dur, cls }); return start + dur }
  const dl = (kb) => kb / BW
  let html, shown, content, tti
  if (eff === 'csr' || eff === 'shell') {
    html = add(eff === 'shell' ? '下載靜態殼 HTML' : '下載空白 HTML', 0, rtt + dl(SHELL_KB), 'net')
    const j = add('下載 JS', html, rtt + dl(js), 'net')
    const e = add('執行 JS、掛載', j, js * EXEC, 'cpu')
    const a = add('瀏覽器呼叫 API', e, rtt + API, 'api')
    content = add('畫出內容', a, 16, 'cpu')
    shown = eff === 'shell' ? html : e
    tti = content
  } else {
    const server = eff === 'ssr' ? INTERNAL + API + RENDER : 5     // SSG 與快取命中：直接送現成的 HTML
    const s = add(eff === 'ssg' ? 'CDN 回應' : eff === 'cache' ? '伺服器讀快取' : '伺服器呼叫 API 並渲染', 0, rtt / 2 + server, eff === 'ssr' ? 'srv' : 'net')
    html = add('下載有內容的 HTML', s, rtt / 2 + dl(HTML_KB), 'net')
    const j = add('下載 JS', html, rtt + dl(js), 'net')
    tti = add('hydration', j, js * EXEC, 'cpu')
    shown = content = html
  }
  return { bars, shown, content, tti, end: Math.max(...bars.map((b) => b.end)) }
}

const HTML_SNIP = {
  empty: `<title>示範醫院</title>
<meta property="og:title" content="示範醫院">
<body>
  <div id="app"></div>
  <script type="module" src="/assets/index-3f9a.js"></script>`,
  schedule: `<title>門診時刻表｜示範醫院</title>
<meta property="og:title" content="門診時刻表">
<body>
  <div id="__nuxt"><h1>門診時刻表</h1>
    <table>… 王○明 醫師 週一上午 …</table>`,
  me: `<title>我的掛號｜示範醫院</title>
<body>
  <div id="__nuxt"><h1>我的掛號</h1>
    <p>陳○華，您有 2 筆掛號</p>   ← 個資在 HTML 裡`,
}
const EXPLAIN = {
  csr: { title: 'CSR：HTML 是空的，內容等 JS 與 API', body: ['手機先拿到只有 <div id="app"> 的 HTML，下載、執行完 JS 才開始呼叫 API，內容最後才出現。把 JS 大小往右拉，「看到內容」整段往後推。', '爬蟲與 LINE 的連結預覽多半不執行 JavaScript，拿到的是每一頁都一樣的 index.html。登入後的頁面這些都不重要，所以 CSR 在那裡最合適。'] },
  ssr: { title: 'SSR：HTML 一到就有內容，但要等 hydration 才能按', body: ['伺服器先呼叫 API、渲染好 HTML，手機一收到就畫得出內容；接著下載 JS 做 hydration，「看到內容」到「可以操作」之間，點按鈕沒有反應。', '每個請求都要伺服器渲染一次。我的掛號用 SSR 時 HTML 裡就有個資，回應只能 Cache-Control: private，CDN 幫不上忙。'] },
  ssg: { title: 'SSG：建置時就產生好的 HTML，最快，但內容會舊', body: ['HTML 是建置時產生的靜態檔，CDN 直接回應，沒有伺服器渲染的等待。', '按「發布停診公告」：時刻表要重新建置、部署才看得到。我的掛號是個人資料，無法預先產生，只能先送殼，再像 CSR 一樣在瀏覽器裡抓。'] },
  hybrid: { title: '依頁面選：公開頁有 HTML，登入後走 CSR', body: ['時刻表走 SSR 加 5 分鐘快取：多數請求直接拿快取的 HTML，伺服器約 5 分鐘才渲染一次，停診公告在快取到期後出現。', '我的掛號 ssr: false，伺服器只送殼，個資只在瀏覽器裡用 API 抓，不會進任何共用快取。代價是仍要一個 Node 伺服器。'] },
}

export default function RenderingChoiceScenarioLab() {
  const [mode, setMode] = useState('csr')
  const [page, setPage] = useState('schedule')
  const [rtt, setRtt] = useState(150)
  const [js, setJs] = useState(300)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 40)
  const [notice, setNotice] = useState(false)
  const [rebuilt, setRebuilt] = useState(false)
  const [aged, setAged] = useState(false)
  useEffect(() => { setRebuilt(false); setAged(false) }, [notice, mode])
  useEffect(() => { resetTick(); setRunning(false) }, [mode, page, rtt, js])   // eslint-disable-line react-hooks/exhaustive-deps

  const eff = effOf(mode, page)
  const all = useMemo(() => MODES.map((m) => ({ ...m, tl: timeline(effOf(m.value, page), rtt, js) })), [page, rtt, js])
  const tl = all.find((x) => x.value === mode).tl
  const scale = Math.max(...all.map((x) => x.tl.end))
  const t = running || tick > 0 ? Math.min(tl.end, (tick / 60) * scale) : tl.end
  useEffect(() => { if (running && t >= tl.end) setRunning(false) }, [running, t, tl.end])
  const load = () => { resetTick(); setRunning(true) }

  const stage = t < tl.shown ? 'blank' : t < tl.content ? 'shell' : t < tl.tti ? 'locked' : 'ready'
  const crawlerHasContent = page === 'schedule' && eff !== 'csr'
  const fresh = !notice || page !== 'schedule' ? null : eff === 'csr' || eff === 'ssr' ? true : eff === 'ssg' ? rebuilt : aged
  const ex = EXPLAIN[mode]
  const snip = page === 'me' ? (eff === 'ssr' ? HTML_SNIP.me : HTML_SNIP.empty) : crawlerHasContent ? HTML_SNIP.schedule : HTML_SNIP.empty

  return (
    <Lab accent="magenta" kicker="SCENARIO LAB" title="同一支手機，四種渲染方式的載入時間線"
         blurb="什麼時候看得到內容、什麼時候按得動、爬蟲拿到什麼、停診公告多久出現。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Seg label="頁面" value={page} onChange={setPage} options={PAGES} />
      </LabControls>
      <LabControls>
        <Slider label="網路來回（RTT）" min={50} max={400} step={10} value={rtt} onChange={setRtt} format={(v) => `${v} ms`} />
        <Slider label="JS bundle（gzip）" min={50} max={800} step={50} value={js} onChange={setJs} format={(v) => `${v} KB`} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={load} disabled={running}>載入頁面</button>
            {page === 'schedule' && <button type="button" className="btn ghost small" onClick={() => setNotice((x) => !x)} aria-pressed={notice}>{notice ? '撤回停診公告' : '發布停診公告'}</button>}
            {fresh === false && eff === 'ssg' && <button type="button" className="btn ghost small" onClick={() => setRebuilt(true)}>重新建置並部署</button>}
            {fresh === false && eff === 'cache' && <button type="button" className="btn ghost small" onClick={() => setAged(true)}>快轉 5 分鐘</button>}
            <span className="spacer" />
            <span className="rc-clock">t = {fmtMs(t)}</span>
          </LabControls>
          <div className="rc-top">
            <div className={`rc-phone ${stage}`} role="img" aria-label={`手機畫面：${{ blank: '白畫面', shell: '只有骨架', locked: '有內容，還不能操作', ready: '可以操作' }[stage]}`}>
              <div className="rc-bar">{page === 'schedule' ? '門診時刻表' : '我的掛號'}</div>
              {stage === 'blank' && <div className="rc-blank">白畫面</div>}
              {stage === 'shell' && <div className="rc-sk"><i /><i /><i /></div>}
              {(stage === 'locked' || stage === 'ready') && (page === 'schedule' ? (
                <ul className="rc-list">
                  {fresh && <li className="notice">王○明 醫師 週一上午停診</li>}
                  <li>王○明 醫師 · 週一上午</li><li>林○婷 醫師 · 週一下午</li><li>張○傑 醫師 · 週二上午</li>
                </ul>
              ) : (
                <ul className="rc-list"><li>11/24 家醫科 · 12 號</li><li>12/02 眼科 · 5 號</li></ul>
              ))}
              <div className={`rc-state ${stage}`}>{{ blank: '白畫面', shell: '骨架', locked: '看得到，還不能按', ready: '可以操作' }[stage]}</div>
            </div>
            <div className="rc-wf" aria-label="載入時間線">
              {tl.bars.map((b, i) => {
                const end = Math.min(b.end, t)
                const w = Math.max(0, end - b.start)
                return (
                  <div className="rc-row" key={i}>
                    <span className="rc-l">{b.label}</span>
                    <div className="rc-track">
                      {w > 0 && <i className={b.cls} style={{ left: `${(b.start / scale) * 100}%`, width: `${Math.max(0.6, (w / scale) * 100)}%` }} />}
                    </div>
                  </div>
                )
              })}
              <div className="rc-row rc-axis"><span className="rc-l" /><div className="rc-track plain">
                <b style={{ left: `${(tl.content / scale) * 100}%` }} className="c" title="看到內容" />
                <b style={{ left: `${(tl.tti / scale) * 100}%` }} className="r" title="可以操作" />
              </div></div>
              <div className="rc-legend"><span><i className="net" />網路</span><span><i className="srv" />伺服器渲染</span><span><i className="api" />API</span><span><i className="cpu" />手機 CPU</span><span><b className="c" />看到內容</span><span><b className="r" />可以操作</span></div>
            </div>
          </div>
          <div className="dtable-wrap">
            <table className="dtable rc-cmp">
              <caption>同一頁、同一組網路條件，四種做法並排（示意）</caption>
              <thead><tr><th scope="col">做法</th><th scope="col">看到內容</th><th scope="col">可以操作</th><th scope="col">伺服器</th></tr></thead>
              <tbody>{all.map((x) => (
                <tr key={x.value} className={x.value === mode ? 'hit' : ''}><td>{x.label}</td><td>{fmtMs(x.tl.content)}</td><td>{fmtMs(x.tl.tti)}</td><td>{SERVER[effOf(x.value, page)]}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="rc-snip">
            <p className="rc-h">{page === 'me' ? '伺服器回應的 HTML' : '爬蟲與連結預覽拿到的 HTML'}</p>
            <pre>{snip}</pre>
          </div>
          <Caption>頻寬、API、渲染與 JS 執行時間都是示意的模型，只用來比較先後與量級</Caption>
        </div>
        <div className="lab-stack">
          <Stats min={120}>
            <Stat label="看到內容" value={<Measure kind="set" value={fmtMs(tl.content)} />} tone={tl.content > 1500 ? 'bad' : tl.content > 800 ? 'warn' : 'ok'} />
            <Stat label="可以操作" value={<Measure kind="set" value={fmtMs(tl.tti)} />} note={tl.tti > tl.content ? `內容出現後再等 ${fmtMs(tl.tti - tl.content)}` : '內容出現就能按'} tone={tl.tti - tl.content > 300 ? 'warn' : ''} />
            <Stat label="爬蟲拿到內容" value={page === 'me' ? '不適用' : crawlerHasContent ? '有' : '沒有'} tone={page === 'me' ? '' : crawlerHasContent ? 'ok' : 'bad'} />
            {page === 'schedule'
              ? <Stat label="停診公告" value={!notice ? '尚未發布' : fresh ? '已出現' : '還是舊版'} tone={!notice ? '' : fresh ? 'ok' : 'bad'} note={eff === 'ssg' ? '重新建置後才出現' : eff === 'cache' ? '快取到期後出現' : '下一個請求就出現'} />
              : <Stat label="HTML 含個資" value={eff === 'ssr' ? '是' : '否'} tone={eff === 'ssr' ? 'warn' : 'ok'} note={eff === 'ssr' ? 'Cache-Control: private' : '個資只經過 API'} />}
          </Stats>
          {page === 'me' && eff === 'ssr' && <Status warn>這份 HTML 不能讓 CDN 快取</Status>}
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會踩到">行銷要求「分享出去要有標題和圖」、或手機首屏太慢的時候，才發現 SPA 的 HTML 是空的。反方向也常見：整站改成 SSR 之後，登入後的頁面也被伺服器渲染，個資 HTML 差點被 CDN 快取。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .rc-clock { font-family: var(--mono); font-size: 0.8rem; color: var(--ink-2); font-variant-numeric: tabular-nums; }
        .rc-top { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 16px; align-items: start; }
        @media (max-width: 560px) { .rc-top { grid-template-columns: minmax(0, 1fr); } .rc-phone { max-width: 220px; justify-self: center; } }
        .rc-phone { position: relative; width: 100%; min-height: 230px; border: var(--bw) solid var(--line); border-radius: 18px; box-shadow: 4px 4px 0 var(--shade); background: var(--surface-1); padding: 10px 10px 34px; overflow: hidden; }
        .rc-phone.blank { background: var(--page); }
        .rc-bar { font-size: 0.72rem; font-weight: 700; color: var(--ink-2); border-bottom: 1px solid var(--hairline); padding-bottom: 6px; margin-bottom: 8px; }
        .rc-blank { display: grid; place-items: center; height: 140px; font-size: 0.74rem; color: var(--ink-3); }
        .rc-sk { display: grid; gap: 8px; }
        .rc-sk i { display: block; height: 14px; border-radius: 4px; background: var(--surface-2); animation: rc-pulse 1.1s ease-in-out infinite; }
        .rc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 0.74rem; color: var(--ink-1); animation: rc-in 0.25s ease-out both; }
        .rc-list li { padding: 5px 6px; border: 1px solid var(--hairline); border-radius: 6px; }
        .rc-list li.notice { border: 1.5px solid var(--line); background: var(--st-red); color: var(--on-sticker); font-weight: 700; }
        .rc-phone.locked .rc-list { opacity: 0.85; }
        .rc-state { position: absolute; left: 8px; right: 8px; bottom: 8px; text-align: center; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 999px; border: 1.5px solid var(--line); color: var(--on-sticker); background: var(--surface-2); }
        .rc-state.blank, .rc-state.shell { color: var(--ink-2); }
        .rc-state.locked { background: var(--st-yellow); }
        .rc-state.ready { background: var(--st-mint); }
        .rc-wf { display: grid; gap: 5px; min-width: 0; }
        .rc-row { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 8px; align-items: center; font-size: 0.74rem; color: var(--ink-2); }
        @media (max-width: 560px) { .rc-row { grid-template-columns: 6.8rem minmax(0, 1fr); } }
        .rc-track { position: relative; height: 16px; background: var(--surface-2); border-radius: 3px; border: 1px solid var(--hairline); }
        .rc-track.plain { background: none; border: 0; height: 12px; }
        .rc-track i { position: absolute; top: 2px; bottom: 2px; border-radius: 2px; border: 1px solid var(--line); }
        .rc-wf i.net, .rc-legend i.net { background: var(--st-blue); }
        .rc-wf i.srv, .rc-legend i.srv { background: var(--st-violet); }
        .rc-wf i.api, .rc-legend i.api { background: var(--st-yellow); }
        .rc-wf i.cpu, .rc-legend i.cpu { background: var(--st-red); }
        .rc-track b { position: absolute; top: -2px; width: 3px; height: 14px; margin-left: -1px; border-radius: 1px; }
        .rc-wf b.c { background: var(--c-aqua); } .rc-wf b.r { background: var(--c-magenta); }
        .rc-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.7rem; color: var(--ink-3); margin-top: 4px; }
        .rc-legend i, .rc-legend b { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
        .rc-legend i { border: 1px solid var(--line); }
        .rc-cmp td { font-variant-numeric: tabular-nums; }
        table.rc-cmp td:nth-child(2), table.rc-cmp td:nth-child(3) { white-space: nowrap !important; }
        .rc-h { font-size: 0.74rem; letter-spacing: 0.06em; color: var(--ink-2); font-weight: 700; margin: 0 0 6px; }
        .rc-snip pre { margin: 0; padding: 10px 12px; font-family: var(--mono); font-size: 0.74rem; line-height: 1.55; color: var(--ink-1); background: var(--surface-2); border: 1px solid var(--hairline); border-radius: var(--radius); white-space: pre-wrap; overflow-wrap: anywhere; }
        @keyframes rc-pulse { 50% { opacity: 0.45; } }
        @keyframes rc-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .rc-sk i, .rc-list { animation: none; } }
      `}</style>
    </Lab>
  )
}
