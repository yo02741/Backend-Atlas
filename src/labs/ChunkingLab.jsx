import React, { useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, Stats, Stat, useWidth } from './ui.jsx'

/* ============================================================
   RAG 切段與檢索：一份虛構的門診掛號規範
   - 依「段落大小 / 重疊 / 對齊句子」把文件切段，色塊直接畫在原文上（重疊處兩層顏色疊加）
   - 字元 bigram 詞頻向量 + cosine 相似度，對問題排序，top-k 高亮
   - 檢查「回答需要的句子」有沒有完整落在取回的段落裡
   ============================================================ */

const DOC = `門診掛號作業規範（虛構範例，僅供教學）
一、適用範圍
本規範適用於本院各科門診之掛號、取消、退費及報到作業，各項時間以本院系統時間為準。
二、掛號方式
本院提供現場、電話語音及網路三種掛號方式。網路與電話語音掛號自看診日前三十日起開放，至看診前一日 21:00 截止。現場掛號於各診次開始前一小時起受理，額滿為止。每位病人同一診次限掛一號。
三、初診與證件
初診病人須持健保卡及身分證明文件辦理病歷建檔。未滿十八歲者，須由法定代理人陪同並出示其身分證明。未攜帶健保卡者先以自費計價，於規定期限內補驗後依規定辦理。
四、取消與變更
病人如需變更看診日期，應先取消原掛號再重新預約。取消掛號須於看診前一日 17:00 前完成，可透過網路、電話語音或親至掛號櫃台辦理。逾時取消者，該次掛號費不予退還。連續兩次預約未到且未取消者，暫停網路掛號三十日。
五、退費規則
依規定完成取消、已繳費但未看診者，可於三個月內持收據至批價櫃台申請退費。因醫師停診而無法看診者，掛號費全額退還，不受前項期限限制。退費一律退回原付款方式，信用卡退款入帳時間依發卡機構作業而定。
六、代掛號規定
家屬或照顧者可代為掛號，須提供病人姓名、出生年月日及身分證號。代辦取消或退費者，須出示代辦人身分證明及病人健保卡。代掛號產生的未到紀錄，計入病人本人名下。
七、報到與過號
病人應於看診時段開始後三十分鐘內至診間報到。過號者由護理人員安排於下一位之後看診，診次結束前仍未報到者視為未到。行動不便或年長病人可向服務台申請優先協助。`

const QUESTIONS = [
  { value: 'cancel', label: '當天取消', q: '看診當天才取消可以退費嗎？', answer: '不行：取消要在前一日 17:00 前，逾時取消掛號費不退。',
    need: ['取消掛號須於看診前一日 17:00 前完成，可透過網路、電話語音或親至掛號櫃台辦理。', '逾時取消者，該次掛號費不予退還。'] },
  { value: 'proxy', label: '代掛號', q: '幫家人代掛號要提供什麼資料？', answer: '病人姓名、出生年月日及身分證號。',
    need: ['家屬或照顧者可代為掛號，須提供病人姓名、出生年月日及身分證號。'] },
  { value: 'stop', label: '醫師停診', q: '醫師停診的話掛號費怎麼處理？', answer: '全額退還，不受三個月期限限制。',
    need: ['因醫師停診而無法看診者，掛號費全額退還，不受前項期限限制。'] },
  { value: 'web', label: '網路截止', q: '網路掛號最晚什麼時候截止？', answer: '看診前一日 21:00。',
    need: ['網路與電話語音掛號自看診日前三十日起開放，至看診前一日 21:00 截止。'] },
]
const COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'slate', 'teal', 'brown'].map((c) => `var(--c-${c})`)
const N = DOC.length

/* 詞：中文取相鄰兩字（bigram），英數字整串當一個詞；標點與空白丟掉 */
function terms(s) {
  const out = new Map()
  const add = (t) => out.set(t, (out.get(t) || 0) + 1)
  for (const m of s.toLowerCase().matchAll(/[一-鿿]+|[a-z0-9:]+/g)) {
    const r = m[0]
    if (!/[一-鿿]/.test(r[0]) || r.length === 1) { add(r); continue }
    for (let i = 0; i < r.length - 1; i++) add(r.slice(i, i + 2))
  }
  return out
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k) }
  for (const v of b.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/* 固定字元數：每段 size 字，下一段往前退 overlap% 開始 */
function chunkFixed(size, overlap) {
  const step = Math.max(1, Math.round(size * (1 - overlap / 100)))
  const cs = []
  for (let s = 0; s < N; s += step) { cs.push([s, Math.min(N, s + size)]); if (s + size >= N) break }
  return cs
}
/* 對齊句子：以「。」與換行為單位往段落裡塞，塞不下就換段；重疊＝把上一段結尾幾句帶過來 */
function chunkSentences(size, overlap) {
  const u = []
  let s = 0
  for (let i = 0; i < N; i++) if (DOC[i] === '。' || DOC[i] === '\n') { u.push([s, i + 1]); s = i + 1 }
  if (s < N) u.push([s, N])
  const cs = [], ov = (size * overlap) / 100
  let i = 0
  while (i < u.length) {
    let j = i
    while (j + 1 < u.length && u[j + 1][1] - u[i][0] <= size) j++
    cs.push([u[i][0], u[j][1]])
    if (j >= u.length - 1) break
    let k = j + 1
    while (k - 1 > i && u[j][1] - u[k - 1][0] <= ov) k--
    i = k
  }
  return cs
}
/* 每段放在哪一條泳道（重疊的段落不能同一條） */
function lanes(cs) {
  const ends = []
  return cs.map(([a, b]) => {
    let l = ends.findIndex((e) => e <= a)
    if (l < 0) { l = ends.length; ends.push(0) }
    ends[l] = b
    return l
  })
}

function analyze(size, overlap, sentAlign, qi, k) {
  const Q = QUESTIONS.find((q) => q.value === qi)
  const cs = sentAlign ? chunkSentences(size, overlap) : chunkFixed(size, overlap)
  const qv = terms(Q.q)
  const chunks = cs.map(([a, b], i) => {
    const tv = terms(DOC.slice(a, b))
    const hits = [...qv.keys()].filter((t) => tv.has(t)).map((t) => [t, tv.get(t)]).sort((x, y) => y[1] - x[1])
    return { i, a, b, score: cosine(qv, tv), hits, color: COLORS[i % COLORS.length] }
  })
  const ranked = [...chunks].sort((x, y) => y.score - x.score || x.i - y.i)
  ranked.forEach((c, r) => { c.rank = r + 1 })
  const top = new Set(ranked.slice(0, k).map((c) => c.i))
  const need = Q.need.map((text) => {
    const st = DOC.indexOf(text), en = st + text.length
    const inTop = chunks.filter((c) => top.has(c.i))
    let cov = 0
    for (let p = st; p < en; p++) if (inTop.some((c) => p >= c.a && p < c.b)) cov++
    const whole = inTop.some((c) => c.a <= st && c.b >= en)
    const holders = chunks.filter((c) => c.a < en && c.b > st)
    const best = Math.min(...holders.map((c) => c.rank))
    const splitAll = !chunks.some((c) => c.a <= st && c.b >= en)
    const state = whole ? 'whole' : cov === text.length ? 'pieces' : cov > 0 ? 'part' : 'none'
    return { text, st, en, state, best, splitAll, cov }
  })
  const okN = need.filter((s) => s.state === 'whole' || s.state === 'pieces').length
  const anyN = need.filter((s) => s.state !== 'none').length
  const status = okN === need.length ? 'all' : anyN > 0 ? 'some' : 'none'
  const ctx = chunks.filter((c) => top.has(c.i)).reduce((t, c) => t + (c.b - c.a), 0)
  const needLen = need.reduce((t, s) => t + s.text.length, 0)
  const got = need.reduce((t, s) => t + s.cov, 0)
  const stored = chunks.reduce((t, c) => t + (c.b - c.a), 0)
  return { Q, chunks, ranked, top, need, status, ctx, needLen, got, stored, lanes: lanes(cs) }
}

export default function ChunkingLab() {
  const [size, setSize] = useState(100)
  const [overlap, setOverlap] = useState(0)
  const [sentAlign, setSentAlign] = useState(false)
  const [qi, setQi] = useState('cancel')
  const [k, setK] = useState(1)
  const [focus, setFocus] = useState(null)
  const r = useMemo(() => analyze(size, overlap, sentAlign, qi, k), [size, overlap, sentAlign, qi, k])
  const focusChunk = r.chunks[focus] ?? r.ranked[0]
  const explain = pickExplain(r, size, overlap, k, sentAlign)
  const statusLabel = r.status === 'all' ? '全部取回' : r.status === 'some' ? (r.need.length > 1 ? '只取回一半' : '只取回片段') : '都沒取回'
  const shown = r.ranked.slice(0, Math.max(k, 5))

  return (
    <Lab accent="var(--c-teal)" kicker="RAG LAB" title="切段與檢索：答案被切到哪裡去了"
         blurb="把一份門診掛號規範切成段落，用字元 bigram 的詞頻向量算每段和問題的 cosine 相似度，取前 k 段交給 LLM。拉段落大小與重疊，看「回答需要的句子」是被完整取回、被切成兩半，還是輸給了不相干的段落。">
      <LabControls>
        <Slider label="段落大小" min={60} max={400} step={10} value={size} onChange={setSize} format={(v) => `${v} 字`} />
        <Slider label="重疊" min={0} max={50} step={5} value={overlap} onChange={setOverlap} format={(v) => `${v}%`} />
        <Toggle label="切在句子邊界" checked={sentAlign} onChange={setSentAlign} />
        <Seg label="問題" tinted value={qi} onChange={(v) => { setQi(v); setFocus(null) }} options={QUESTIONS.map((q) => ({ value: q.value, label: q.label, title: q.q }))} />
        <Seg label="top-k" mono value={k} onChange={setK} options={[1, 2, 3].map((v) => ({ value: v, label: String(v) }))} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="文件切段色塊與檢索結果" caption="每段一個顏色，重疊的字被兩段同時涵蓋、顏色疊在一起；粗框色塊＝被取回的 top-k。底線＝回答需要的句子。">
            <div className="ck-q">
              <span className="ck-q-label">問題</span>
              <b>{r.Q.q}</b>
              <Status ok={r.status === 'all'} warn={r.status === 'some'}>{statusLabel}</Status>
            </div>
            <Strip r={r} focus={focus} onFocus={setFocus} />
            <DocView r={r} focus={focus} />
          </LabStage>
          <Stats min={118}>
            <Stat label="段落數" value={r.chunks.length} note={`索引存了 ${(r.stored / N).toFixed(2)}× 原文`} tone={r.stored / N > 1.6 ? 'warn' : ''} />
            <Stat label="取回的字數" value={r.ctx} unit="字" note={`需要的只有 ${r.needLen} 字`} />
            <Stat label="答案佔取回內容" value={`${Math.round((r.got / Math.max(1, r.ctx)) * 100)}%`} tone={r.status === 'all' ? 'ok' : 'bad'} note={r.status === 'all' ? '答案都在裡面' : '答案不完整'} />
          </Stats>
          <div className="dtable-wrap">
            <table className="dtable ck-rank">
              <caption>相似度排名（滑過或點一列，在上方亮出那一段）</caption>
              <thead><tr><th>#</th><th>段落</th><th>cosine</th><th>開頭</th><th>答案句</th></tr></thead>
              <tbody>
                {shown.map((c) => {
                  const has = r.need.filter((s) => c.a < s.en && c.b > s.st)
                  return (
                    <tr key={`${size}-${overlap}-${sentAlign}-${c.i}`} className={`clickable${r.top.has(c.i) ? ' hit' : ''}`}
                        onMouseEnter={() => setFocus(c.i)} onMouseLeave={() => setFocus(null)} onClick={() => setFocus(c.i)}>
                      <td>{c.rank}</td>
                      <td><i className="ck-dot" style={{ background: c.color }} />#{c.i + 1}</td>
                      <td><span className="ck-bar"><i style={{ width: `${(c.score / Math.max(0.001, r.ranked[0].score)) * 100}%` }} /></span>{c.score.toFixed(3)}</td>
                      <td className="ck-prev">{DOC.slice(c.a, c.a + 14).replace(/\n/g, ' ')}…</td>
                      <td>{has.length ? has.map((s) => <span key={s.st} className="tag">{r.need.length > 1 ? '①②'[r.need.indexOf(s)] : ''}{c.a <= s.st && c.b >= s.en ? '完整' : '片段'}</span>) : <span className="muted">–</span>}</td>
                    </tr>
                  )
                })}
                {r.ranked.length > shown.length && <tr><td colSpan={5} className="muted">…其餘 {r.ranked.length - shown.length} 段分數更低</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="ck-hits">
            段落 #{focusChunk.i + 1} 和問題共有的詞：{focusChunk.hits.length ? focusChunk.hits.map(([t, n]) => <code key={t}>{t}×{n}</code>) : <span className="muted">（沒有）</span>}
          </p>
        </div>

        <div className="lab-stack">
          <div className="ck-need">
            <h4>回答需要的句子</h4>
            {r.need.map((s, i) => (
              <div key={i} className={`ck-need-row ${s.state}`}>
                <Status ok={s.state === 'whole' || s.state === 'pieces'} warn={s.state === 'part'}>{STATE_LABEL[s.state]}</Status>
                <span>{r.need.length > 1 ? '①②'[i] : ''}「{s.text}」<small className="muted">含這句的段落最高排第 {s.best} 名{s.splitAll ? '；沒有任何一段完整包含它' : ''}</small></span>
              </div>
            ))}
            <p className="ck-answer"><span className="muted">正確答案：</span>{r.Q.answer}</p>
          </div>
          <LabExplain title={explain.title}>
            {explain.text.map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(p) }} />)}
          </LabExplain>
          <LabExplain title="真實系統不一樣的地方，和一樣的地方">
            <p>真實系統用 <strong>embedding 模型</strong>把段落轉成向量，能抓到同義改寫（「退費」和「退還」很接近），這裡的 bigram 只認得字面重疊。但切段的問題完全一樣：答案被切斷、被長段落稀釋，embedding 也救不回來。</p>
            <p><strong>LLM Wiki</strong> 這類做法換個方向：先讓 LLM 把原始文件整理成一頁頁主題頁面（例如一頁「取消與退費」把兩條規則寫在一起），查詢時讀整理好的頁面，試圖從源頭避開切碎的問題；代價是整理要花成本，整理錯了也要有人回頭對照原文。</p>
          </LabExplain>
          <Callout title="實際用在哪裡">
            內規與 FAQ 問答、客服知識庫、內部文件搜尋——只要是「先檢索、再讓 LLM 回答」都要先切段。段落大小與重疊<b>沒有通用最佳值</b>：準備一組真實問題與「應該取回哪幾段」的答案，量 recall@k 再調。這裡以字元計，實際系統多半以 token 計。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .ck-q { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-bottom: 10px; font-size: 0.9rem; }
        .ck-q b { color: var(--ink-1); }
        .ck-q-label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-3); }
        .ck-strip { width: 100%; margin-bottom: 12px; }
        .ck-strip rect.ck-chunk { stroke: var(--surface-1); stroke-width: 1; cursor: pointer; transition: fill-opacity 0.25s ease, x 0.25s ease, width 0.25s ease; }
        .ck-strip rect.ck-chunk.top { stroke: var(--ink-1); stroke-width: 1.5; }
        .ck-strip rect.ck-need { fill: var(--ink-1); }
        .ck-strip .ck-lbl { font-family: var(--mono); font-size: 10px; fill: var(--ink-1); pointer-events: none; }
        .ck-doc { font-size: 0.84rem; line-height: 2; color: var(--ink-2); white-space: pre-wrap; word-break: break-all; }
        .ck-doc span { border-radius: 2px; transition: background-color 0.25s ease, opacity 0.25s ease; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        .ck-doc span.top { color: var(--ink-1); }
        .ck-doc span.need { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: var(--ink-1); }
        .ck-doc span.faded { opacity: 0.35; }
        .ck-doc sup { font-family: var(--mono); font-size: 0.62rem; color: var(--ink-3); margin: 0 1px; vertical-align: super; }
        .ck-doc sup.top { color: var(--ink-1); font-weight: 700; }
        .ck-rank td.ck-prev { font-family: var(--sans); color: var(--ink-2); }
        .ck-rank .tag { margin-right: 3px; }
        .ck-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
        .ck-bar { display: inline-block; width: 46px; height: 6px; margin-right: 6px; border-radius: 3px; background: var(--surface-2); vertical-align: 1px; overflow: hidden; }
        .ck-bar i { display: block; height: 100%; background: var(--lab-accent); transition: width 0.3s ease; }
        .ck-hits { font-size: 0.8rem; color: var(--ink-2); display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
        .ck-hits code { font-family: var(--mono); font-size: 0.76rem; background: var(--surface-2); padding: 1px 6px; border-radius: 3px; color: var(--ink-1); }
        .ck-need { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); padding: 12px 14px; display: grid; gap: 10px; }
        .ck-need h4 { font-family: var(--serif); font-size: 1rem; color: var(--ink-1); }
        .ck-need-row { display: grid; gap: 4px; font-size: 0.84rem; color: var(--ink-1); line-height: 1.6; }
        .ck-need-row .status { justify-self: start; font-size: 0.74rem; }
        .ck-need-row small { display: block; font-size: 0.74rem; }
        .ck-answer { font-size: 0.82rem; color: var(--ink-1); border-top: 1px dashed var(--hairline); padding-top: 8px; }
        @media (prefers-reduced-motion: reduce) { .ck-strip rect.ck-chunk, .ck-doc span, .ck-bar i { transition: none; } }
      `}</style>
    </Lab>
  )
}

const STATE_LABEL = { whole: '完整取回', pieces: '取回（但被切成兩段）', part: '只取回片段', none: '沒取回' }

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

/* 上方的段落地圖：x 軸是字元位置，每段一個色塊；上面一排黑條是答案句的位置 */
function Strip({ r, focus, onFocus }) {
  const ref = useRef(null)
  const w = Math.max(240, useWidth(ref, 600))
  const nl = Math.max(...r.lanes) + 1
  const L = 4, R = 4, x = (p) => L + (p / N) * (w - L - R)
  const laneY = (l) => 14 + l * 22
  const h = laneY(nl) + 16
  return (
    <div ref={ref}>
      <svg className="ck-strip" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`文件被切成 ${r.chunks.length} 段，取回其中 ${r.top.size} 段`}>
        {r.need.map((s) => <rect key={s.st} className="ck-need" x={x(s.st)} y={2} width={Math.max(2, x(s.en) - x(s.st))} height={6} rx={2} />)}
        {r.chunks.map((c) => {
          const on = r.top.has(c.i)
          const op = focus === null ? (on ? 0.85 : 0.3) : focus === c.i ? 0.95 : 0.15
          const cw = x(c.b) - x(c.a)
          return (
            <g key={c.i} onMouseEnter={() => onFocus(c.i)} onMouseLeave={() => onFocus(null)}>
              <rect className={`ck-chunk${on ? ' top' : ''}`} x={x(c.a)} y={laneY(r.lanes[c.i])} width={Math.max(1, cw)} height={18} rx={3}
                    style={{ fill: c.color, fillOpacity: op }} />
              {cw > 24 && <text className="ck-lbl" x={x(c.a) + 4} y={laneY(r.lanes[c.i]) + 13}>{on && cw > 56 ? `#${c.i + 1}·${c.rank}名` : `#${c.i + 1}`}</text>}
            </g>
          )
        })}
        {[0, 200, 400, 600].map((p) => <text key={p} className="svg-text small" x={x(p)} y={h - 2} textAnchor={p ? 'middle' : 'start'}>{p}</text>)}
      </svg>
    </div>
  )
}

/* 原文：在所有段落起訖與答案句起訖處切開，每一小片疊上涵蓋它的段落顏色 */
function DocView({ r, focus }) {
  const cuts = new Set([0, N])
  for (const c of r.chunks) { cuts.add(c.a); cuts.add(c.b) }
  for (const s of r.need) { cuts.add(s.st); cuts.add(s.en) }
  const pts = [...cuts].sort((a, b) => a - b)
  const starts = new Map(r.chunks.map((c) => [c.a, c]))
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const cover = r.chunks.filter((c) => c.a <= a && c.b >= b)
    const on = cover.some((c) => r.top.has(c.i))
    const need = r.need.some((s) => s.st <= a && s.en >= b)
    const faded = focus !== null && !cover.some((c) => c.i === focus)
    const layers = cover.map((c) => {
      const pct = focus === c.i ? 45 : r.top.has(c.i) ? 34 : 13
      const mix = `color-mix(in srgb, ${c.color} ${pct}%, transparent)`
      return `linear-gradient(${mix}, ${mix})`
    })
    const sc = starts.get(a)
    if (sc) out.push(<sup key={`m${sc.i}`} className={r.top.has(sc.i) ? 'top' : ''}>#{sc.i + 1}</sup>)
    out.push(<span key={a} className={`${on ? 'top' : ''}${need ? ' need' : ''}${faded ? ' faded' : ''}`} style={{ backgroundImage: layers.join(', ') || 'none' }}>{DOC.slice(a, b)}</span>)
  }
  return <div className="ck-doc">{out}</div>
}

function pickExplain(r, size, overlap, k, sentAlign) {
  const lost = r.need.filter((s) => s.state === 'none' || s.state === 'part')
  const cut = r.need.some((s) => s.splitAll)
  const share = Math.round((r.got / Math.max(1, r.ctx)) * 100)
  if (r.status === 'all' && size >= 260) return {
    title: '取回了，但答案被稀釋在長段落裡',
    text: [
      `每段 ${size} 字，整份文件只切成 ${r.chunks.length} 段，答案句當然在裡面——可是取回的 ${r.ctx} 字裡，真正有用的只佔 ${share}%。`,
      '段落越長，向量裡混進越多不相干的詞，相似度分數會被拉平：各段分數越來越接近，排名越容易被「剛好字面重疊比較多」的段落搶走。LLM 也得在一大堆無關內容裡找答案。',
    ],
  }
  if (r.status === 'all') return {
    title: overlap > 0 && cut === false && r.need.length > 1 ? '兩句都在同一段裡：重疊在幫忙' : '答案完整取回',
    text: [
      `每段 ${size} 字${overlap ? `、重疊 ${overlap}%` : ''}，取前 ${k} 段共 ${r.ctx} 字，回答需要的句子都在裡面，答案約佔 ${share}%。`,
      overlap > 0
        ? '重疊讓相鄰段落共用邊界附近的字：只要句子不比重疊寬度長，就算剛好跨在邊界上，也會完整出現在其中一段。代價是索引變大（這裡存了 ' + (r.stored / N).toFixed(2) + ' 倍原文），取回的內容也會有重複的字。'
        : '把重疊調成 0、段落調小，看同一個問題怎麼開始失敗：句子被切在邊界上，兩半各自的分數都不夠高。',
    ],
  }
  if (r.status === 'some') return {
    title: cut ? '答案被切開了' : '另一半輸給了別的段落',
    text: [
      cut
        ? `每段 ${size} 字${sentAlign ? '（對齊句子）' : ''}，沒有任何一段完整包含「${lost[0]?.text.slice(0, 12)}…」——它被切在兩段的邊界上，兩半各自和問題的重疊都變少。`
        : `需要的句子都有段落完整包含，但含「${lost[0]?.text.slice(0, 12)}…」的段落最高只排第 ${lost[0]?.best} 名，top-${k} 拿不到。`,
      r.need.length > 1
        ? '這題的答案跨兩句：「前一日 17:00 前取消」是規則，「逾時不退」是後果。只拿到其中一句，LLM 要嘛回答不完整，要嘛照常識亂補。'
        : '只拿到半句，LLM 看到的是斷掉的條文，很可能答錯或拒答。',
      overlap === 0 ? '試試加一點重疊、或把 top-k 調大；也可以打開「切在句子邊界」。' : '試試把段落調大一點，讓相關的句子落在同一段。',
    ],
  }
  return {
    title: '取回的是錯的段落',
    text: [
      `前 ${k} 段裡完全沒有答案句。排第一的是段落 #${r.ranked[0].i + 1}，它和問題共有的詞是 ${r.ranked[0].hits.slice(0, 4).map(([t]) => `「${t}」`).join('') || '（無）'}——字面像，但講的是別的事。`,
      size >= 260
        ? '段落太長時，答案所在的那段混進了太多無關內容，分數反而輸給另一段。'
        : r.need.some((s) => s.splitAll)
          ? '段落太短時，答案句被切碎，每一小段和問題的重疊都很少；其他段落只要多出現幾次「掛號」「退費」就能贏。'
          : `答案句其實完整地待在某一段裡，但那段最高只排第 ${Math.min(...r.need.map((s) => s.best))} 名，top-${k} 拿不到——別的段落字面上和問題更像。`,
      '詞頻相似度看的是字面重疊，不懂「當天」和「前一日 17:00 前」之間的關係——這也是真實系統改用 embedding 的原因之一。',
    ],
  }
}
