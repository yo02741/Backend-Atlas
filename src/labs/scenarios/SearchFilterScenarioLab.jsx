import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, useWidth } from '../ui.jsx'

/* 搜尋情境模擬器：
   30 件商品的小資料集，同一個關鍵字在 ILIKE / PostgreSQL 全文檢索 / 外部搜尋引擎三種做法下命中誰、怎麼排、示意延遲多少。
   名稱與描述用「|」標出斷詞邊界，模擬 jieba 之類斷詞器的輸出；延遲曲線與同步延遲都是示意。 */

// [id, 名稱, 描述, 分類, 價格, 有貨, 上架天數]
const RAW = [
  [1, '藍牙|機械|鍵盤| K1', '75%|配列|、|三模|連接', '鍵盤', 2490, true, 12],
  [2, '無線|鍵盤|滑鼠|組', '2.4G|接收器|，|辦公室|靜音', '鍵盤', 990, true, 40],
  [3, '有線|電競|鍵盤| RGB', '紅軸|、|全鍵|無衝', '鍵盤', 1890, true, 90],
  [4, '藍牙|耳機| Air', '主動|降噪|，|續航| 30 |小時', '音訊', 3990, true, 5],
  [5, '鍵盤|藍牙|接收器', '讓|有線|鍵盤|變|藍牙', '配件', 390, true, 3],
  [6, '矮軸|藍牙|鍵盤| Slim', '超薄|，|支援| iPad', '鍵盤', 1690, false, 60],
  [7, '有線|鍵盤| K380', '辦公室|入門|款', '鍵盤', 590, true, 200],
  [8, '鍵盤|保護膜|（|通用|）', '矽膠|防塵', '配件', 120, true, 300],
  [9, '藍牙|滑鼠| M3', '靜音|，|可|切換|三台|裝置', '滑鼠', 890, true, 20],
  [10, '電競|滑鼠|（|有線|）', '16000 DPI|，|可調|配重', '滑鼠', 1290, true, 45],
  [11, '機械|鍵盤|鍵帽|組', 'PBT |二色|成型', '配件', 690, true, 15],
  [12, '藍牙|音箱| Boom', '防水| IPX7', '音訊', 1990, true, 70],
  [13, '27 吋| 4K |螢幕', 'IPS|，|Type-C| 65W', '螢幕', 8990, false, 30],
  [14, '螢幕|支架|雙臂', '承重| 9 kg', '配件', 1490, true, 110],
  [15, '藍牙| 5.3 |接收器| USB', '桌機|加|藍牙', '配件', 290, true, 8],
  [16, '無線|充電盤', '15W|，|支援|手機|與|耳機', '配件', 590, true, 25],
  [17, '鍵盤|手托|（|木質|）', '胡桃木', '配件', 450, true, 150],
  [18, '分離式|人體工學|鍵盤', '藍牙| + |有線|雙模', '鍵盤', 4990, false, 18],
  [19, '靜音|鍵盤|（|辦公|）', '剪刀腳|，|有線', '鍵盤', 790, true, 80],
  [20, '頸掛式|藍牙|耳機', '磁吸|，|續航| 20 |小時', '音訊', 1290, true, 33],
  [21, '藍芽|鍵盤| mini', '第三方|商家|上架|，|名稱|有|錯字', '鍵盤', 990, true, 2],
  [22, '滑鼠墊|（|加大|）', '900×400 mm', '配件', 350, true, 400],
  [23, 'USB-C Hub| 7 合 1', 'HDMI|、|讀卡', '配件', 1190, true, 66],
  [24, '數字|鍵盤|（|藍牙|）', '會計|用', '鍵盤', 690, true, 28],
  [25, '遊戲|手把|（|藍牙|）', '支援| PC / Switch', '配件', 1590, true, 50],
  [26, '電腦|喇叭| 2.0', '有線|，|木紋', '音訊', 990, true, 120],
  [27, '螢幕|掛燈', '非對稱|光', '配件', 1990, true, 9],
  [28, '筆電|支架|（|鋁合金|）', '六段|調整', '配件', 690, true, 130],
  [29, '鍵盤|清潔|組', '拔鍵器|＋|刷', '配件', 300, true, 220],
  [30, '客製|鍵盤|套件| 75%', '需|自行|組裝|，|不含|軸|與|鍵帽', '鍵盤', 3290, false, 7],
]
const RENAMED = '藍牙|鍵盤| K380'                       // Toggle：#7 剛被改名
const toks = (s) => s.split('|').map((t) => t.trim().toLowerCase()).filter((t) => t && !/^[\p{P}\s+×]+$/u.test(t))
const show = (s) => s.replace(/\|/g, '')
const SYN = { '藍芽': '藍牙', '鼠標': '滑鼠', '耳麥': '耳機' }   // 引擎的同義詞字典（示意）
const lev1 = (a, b) => {                                    // 編輯距離是否 ≤ 1（只給引擎用）
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, d = 0
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue } if (++d > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++ } }
  return d + (a.length - i) + (b.length - j) <= 1
}

function search(mode, terms, products, sort) {
  const hits = []
  for (const p of products) {
    let score = 0, ok = true
    for (const t of terms) {
      if (mode === 'like') { if (!(p.name.toLowerCase() + p.desc.toLowerCase()).includes(t)) { ok = false; break } continue }
      const inName = p.nt.includes(t), inDesc = p.dt.includes(t)
      if (inName || inDesc) { score += inName ? 1 : 0.4; continue }
      if (mode === 'engine') {
        const near = (tok) => SYN[t] === tok || SYN[tok] === t || (t.length >= 3 && lev1(t, tok))   // 同義詞雙向；錯字容忍只對 ≥ 3 字
        if (p.nt.some(near)) { score += 0.6; continue }
        if (p.dt.some(near)) { score += 0.25; continue }
      }
      ok = false; break
    }
    if (!ok) continue
    if (mode === 'fts') score = score / (1 + 0.05 * (p.nt.length + p.dt.length))            // ts_rank 對長文件降權（示意）
    if (mode === 'engine') score = score / (1 + 0.03 * (p.nt.length + p.dt.length)) + (p.stock ? 0.15 : 0)  // BM25 + 業務加權（有貨）
    hits.push({ p, score: mode === 'like' ? null : Math.round(score * 100) / 100 })
  }
  const key = sort === 'rel' && mode !== 'like' && terms.length ? (a, b) => b.score - a.score || a.p.days - b.p.days
    : sort === 'price' ? (a, b) => a.p.price - b.p.price : (a, b) => a.p.days - b.p.days
  return hits.sort(key)
}

const VOLS = [10000, 30000, 100000, 300000, 1000000]
const fmtN = (n) => n >= 10000 ? `${n / 10000} 萬` : String(n)
const latency = (mode, n, hitRatio) => mode === 'like' ? 0.5 + n * 0.00045
  : mode === 'fts' ? 3 + 2.5 * Math.log10(n / 1e4) + n * hitRatio * 0.0002
  : 2 + 0.5 * Math.log10(n / 1e4) + n * hitRatio * 0.00002

const MODES = [{ value: 'like', label: 'ILIKE' }, { value: 'fts', label: 'PostgreSQL 全文檢索' }, { value: 'engine', label: '搜尋引擎' }]
const CATS = ['全部', '鍵盤', '滑鼠', '音訊', '配件', '螢幕']
const STALE_S = 8                                           // 引擎同步延遲：真實 30 秒，這裡壓成 8 秒

export default function SearchFilterScenarioLab() {
  const [mode, setMode] = useState('like')
  const [q, setQ] = useState('藍牙 鍵盤')
  const [cat, setCat] = useState('全部')
  const [stockOnly, setStockOnly] = useState(false)
  const [sort, setSort] = useState('rel')
  const [vol, setVol] = useState(2)
  const [renamed, setRenamed] = useState(false)
  const [staleLeft, setStaleLeft] = useState(0)
  const rename = (v) => { setRenamed(v); setStaleLeft(v ? STALE_S : 0) }   // 改名後，引擎的索引要等同步才會更新
  useEffect(() => {                                         // 倒數
    if (staleLeft <= 0) return
    const id = setTimeout(() => setStaleLeft((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [staleLeft])
  const box = useRef(null)
  const narrow = useWidth(box, 700) < 520

  const products = useMemo(() => RAW.map(([id, name, desc, c, price, stock, days]) => {
    const n = id === 7 && renamed && !(mode === 'engine' && staleLeft > 0) ? RENAMED : name
    return { id, name: show(n), desc: show(desc), nt: toks(n), dt: toks(desc), cat: c, price, stock, days, changed: id === 7 && renamed }
  }), [renamed, mode, staleLeft])
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = products.filter((p) => (cat === '全部' || p.cat === cat) && (!stockOnly || p.stock))
  const hits = useMemo(() => search(mode, terms, filtered, sort), [mode, q, filtered, sort])
  const hitRatio = Math.max(0.02, hits.length / RAW.length)
  const n = VOLS[vol]
  const ms = latency(mode, n, hitRatio)
  const stale = mode === 'engine' && staleLeft > 0
  const relNA = sort === 'rel' && mode === 'like'
  const sql = mode === 'like'
    ? `SELECT * FROM products\nWHERE ${terms.map((t) => `(name || ' ' || description) ILIKE '%${t}%'`).join('\n  AND ') || 'TRUE'}${cat !== '全部' ? `\n  AND category = '${cat}'` : ''}${stockOnly ? '\n  AND in_stock' : ''}\nORDER BY ${sort === 'price' ? 'price' : 'created_at DESC'}  -- 沒有相關度可排\nLIMIT 24;`
    : mode === 'fts'
      ? `SELECT *, ts_rank(search, q) AS rank\nFROM products, to_tsquery('simple', '${terms.join(' & ') || ''}') q\nWHERE search @@ q${cat !== '全部' ? `\n  AND category = '${cat}'` : ''}${stockOnly ? '\n  AND in_stock' : ''}\nORDER BY ${sort === 'rel' ? 'rank DESC' : sort === 'price' ? 'price' : 'created_at DESC'}\nLIMIT 24;`
      : `POST /products/_search\n{ "q": "${q.trim()}",\n  "filter": [${[cat !== '全部' && `"category = ${cat}"`, stockOnly && '"in_stock = true"'].filter(Boolean).join(', ')}],\n  "sort": ["${sort === 'rel' ? '_score' : sort === 'price' ? 'price:asc' : 'created_at:desc'}"],\n  "typo_tolerance": true, "synonyms": {"藍芽": "藍牙"} }`

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="同一個關鍵字，三種搜尋做法命中誰、怎麼排、要多久"
         blurb="30 件商品的小資料集。打關鍵字、切做法、加篩選與排序；拉「資料量」看示意延遲怎麼長；開「剛改了一件商品」看引擎模式的同步延遲。">
      <LabControls>
        <Seg tinted label="做法" value={mode} onChange={setMode} options={MODES} />
        <label className="sf-field"><span>關鍵字</span><input className="sf-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例如：藍牙 鍵盤" aria-label="關鍵字" /></label>
        <Seg label="分類" value={cat} onChange={setCat} options={CATS.map((c) => ({ value: c, label: c }))} />
        <Toggle label="只看有貨" checked={stockOnly} onChange={setStockOnly} />
        <Seg label="排序" value={sort} onChange={setSort} options={[{ value: 'rel', label: '相關度' }, { value: 'price', label: '價格' }, { value: 'time', label: '上架時間' }]} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack" ref={box}>
          <pre className="sf-q">{sql}</pre>
          <p className="sf-tok">
            <span>查詞怎麼被看待：</span>
            {mode === 'like'
              ? terms.map((t) => <code key={t}>%{t}%</code>)
              : terms.map((t) => <code key={t} className={mode === 'engine' && SYN[t] ? 'syn' : ''}>{t}{mode === 'engine' && SYN[t] ? ` → ${SYN[t]}` : ''}</code>)}
            {!terms.length && <code>（空：只套篩選）</code>}
            <span className="muted">{mode === 'like' ? '子字串，每個都要出現' : mode === 'fts' ? '詞位交集（&），查詞也要過同一個斷詞器' : '詞位 + 同義詞 + 錯字容忍（≥ 3 字才啟用）'}</span>
          </p>
          <div className="sf-bar">
            <span>命中 <b>{hits.length}</b> / {filtered.length} 件</span>
            <span>延遲（示意，{fmtN(n)} 件）：<b className={ms > 200 ? 'bad' : ms > 50 ? 'warn' : 'ok'}>{ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms</b></span>
            {relNA && <Status warn>ILIKE 沒有相關度，改依上架時間</Status>}
            {stale && <Status warn>引擎索引尚未同步：{staleLeft} 秒後才看得到新名稱</Status>}
            {renamed && !stale && <Status ok>#7 的新名稱已在結果裡</Status>}
          </div>
          <div className="dtable-wrap sf-tablewrap">
            <table className="dtable sf-table">
              <thead><tr><th>#</th><th>名稱</th><th>分類</th><th>價格</th><th>庫存</th><th>{mode === 'like' ? '排序鍵' : '相關度'}</th></tr></thead>
              <tbody>
                {hits.map(({ p, score }) => (
                  <tr key={p.id} className={p.changed ? 'hit' : ''}>
                    <td>{p.id}</td>
                    <td className="name"><Hi text={p.name} terms={terms} mode={mode} />{p.changed && <span className="sf-new">改名</span>}{mode === 'engine' && p.id === 21 && terms.includes('藍牙') && <span className="sf-new syn">同義詞</span>}<span className="sf-desc">{p.desc}</span></td>
                    <td>{p.cat}</td><td>{p.price.toLocaleString()}</td>
                    <td className={p.stock ? '' : 'null'}>{p.stock ? '有' : '無'}</td>
                    <td>{score == null ? (sort === 'price' ? `$${p.price}` : `${p.days} 天前`) : score.toFixed(2)}</td>
                  </tr>
                ))}
                {!hits.length && <tr><td colSpan="6" className="null">沒有結果{mode !== 'engine' && terms.includes('藍芽') ? '：「藍芽」是錯字，ILIKE 與 FTS 都不會幫你改' : ''}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="sf-lat">
            <Slider label="資料量" min={0} max={4} value={vol} onChange={setVol} format={(v) => `${fmtN(VOLS[v])} 件`} />
            <Toggle label="剛改了一件商品的名稱（#7 有線鍵盤 → 藍牙鍵盤 K380）" checked={renamed} onChange={rename} />
          </div>
          <LabStage plain>
            <LatencyChart mode={mode} vol={vol} hitRatio={hitRatio} narrow={narrow} />
          </LabStage>
        </div>
        <div className="lab-stack">
          {mode === 'like' && (
            <LabExplain title="ILIKE：找得到，但排不了、也快不了">
              <p>子字串比對對中文很友善：「鍵盤藍牙接收器」「數字鍵盤（藍牙）」不用斷詞就命中。但命中的每一筆地位相同——一個配件排在真正的藍牙鍵盤前面，只因為它上架比較新。</p>
              <p>前置的 <code>%</code> 讓 B-tree 索引失效，每次搜尋都掃整張表：延遲曲線是一條直線，10 萬件幾十毫秒還能接受，100 萬件就破秒。<code>pg_trgm</code> 的 GIN 索引能把掃描壓下來，但排名問題依舊。</p>
            </LabExplain>
          )}
          {mode === 'fts' && (
            <LabExplain title="全文檢索：走索引、有排名，但中文要先斷詞">
              <p>資料寫入時先斷詞成 <code>tsvector</code>（這裡的「|」就是斷詞邊界），查詞也斷成 <code>tsquery</code>，用 GIN 索引找交集，<code>ts_rank</code> 依詞出現的欄位權重（名稱 A、描述 B）與文件長度排序。#18 只有描述提到藍牙，所以排在後面。</p>
              <p>PostgreSQL 內建的 parser 不會為中文斷詞：<code>to_tsvector('simple', '藍牙鍵盤')</code> 只有一個詞位，搜「鍵盤」找不到。要裝 zhparser / pg_jieba，或在應用層用 jieba 斷好、以空格接起來再寫入——這是額外的工作，不是勾個選項。錯字（#21 的「藍芽」）與拼音也不會處理。</p>
            </LabExplain>
          )}
          {mode === 'engine' && (
            <LabExplain title="搜尋引擎：什麼都有，代價是第二份資料">
              <p>斷詞、同義詞（藍芽 → 藍牙，所以 #21 出現了）、錯字容忍、拼音、分面統計、業務加權（有貨的加分）都是設定。注意錯字容忍預設對兩個字的詞不啟用（誤配太多），中文常見錯字多靠同義詞字典。</p>
              <p>資料要從 PostgreSQL 同步過去（outbox、CDC 或排程）。開右上的「剛改了一件商品」：#7 在 ILIKE 與 FTS 模式立刻搜得到新名稱，引擎模式要等索引同步——真實環境是秒到分鐘級，而且庫存、價格這些每分鐘變的欄位都會有同樣的落差。</p>
            </LabExplain>
          )}
          <Callout title="什麼時候會真的踩到">
            ILIKE 在資料十萬件、搜尋每秒幾十次時開始拖垮整個資料庫的 CPU；FTS 在產品要求「打錯也找得到」「拼音」「每個分類幾件」時開始一項一項補；引擎在使用者說「我剛改了庫存怎麼還搜得到」時開始解釋同步延遲。<b>先量現在的資料量與查詢頻率</b>，再決定要付哪一種代價。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .sf-field { display: inline-flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: var(--ink-3); font-weight: 600; letter-spacing: 0.04em; }
        .sf-input { font: inherit; font-size: 0.9rem; font-weight: 400; letter-spacing: 0; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-1); color: var(--ink-1); min-width: 180px; }
        .sf-input:focus { outline: 2px solid var(--lab-accent); outline-offset: 1px; }
        .sf-q { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 8px 12px; white-space: pre-wrap; margin: 0; line-height: 1.5; }
        .sf-tok { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 0.76rem; color: var(--ink-2); margin: 0; }
        .sf-tok code { font-family: var(--mono); font-size: 0.72rem; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--lab-accent); color: var(--ink-1); }
        .sf-tok code.syn { border-color: var(--c-violet); }
        .sf-tok .muted { font-size: 0.72rem; }
        .sf-bar { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font-size: 0.78rem; color: var(--ink-3); }
        .sf-bar b { font-family: var(--mono); color: var(--ink-1); font-variant-numeric: tabular-nums; }
        .sf-bar b.bad { color: var(--critical); } .sf-bar b.warn { color: var(--serious, var(--c-orange)); } .sf-bar b.ok { color: var(--good); }
        .sf-tablewrap { max-height: 300px; overflow: auto; }
        .sf-table td.name { white-space: normal; min-width: 180px; }
        .sf-table td.name mark { background: color-mix(in srgb, var(--lab-accent) 25%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
        .sf-desc { display: block; font-size: 0.68rem; color: var(--ink-3); font-family: var(--sans); }
        .sf-new { display: inline-block; margin-left: 6px; font-size: 0.62rem; font-weight: 700; padding: 0 6px; border-radius: 999px; border: 1px solid var(--good); color: var(--good); vertical-align: middle; font-family: var(--sans); }
        .sf-new.syn { border-color: var(--c-violet); color: var(--c-violet); }
        .sf-lat { display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; border-top: 1px solid var(--hairline); padding-top: 12px; }
        .sf-chart { width: 100%; max-width: 560px; }
        .sf-chart .grid { stroke: var(--hairline); }
        .sf-chart .lbl { font-family: var(--mono); font-size: 10px; fill: var(--ink-3); }
        .sf-chart .line { fill: none; stroke-width: 2; opacity: 0.45; }
        .sf-chart .line.cur { opacity: 1; stroke-width: 3; }
        .sf-chart .like { stroke: var(--c-orange); } .sf-chart .fts { stroke: var(--c-aqua); } .sf-chart .engine { stroke: var(--c-violet); }
        .sf-chart .dot.like { fill: var(--c-orange); } .sf-chart .dot.fts { fill: var(--c-aqua); } .sf-chart .dot.engine { fill: var(--c-violet); }
        .sf-chart .slo { stroke: var(--critical); stroke-dasharray: 4 3; }
        .sf-chart .slolbl { font-family: var(--sans); font-size: 10px; fill: var(--critical); }
        .sf-chart .leg { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-2); }
        .sf-chart.narrow .lbl { font-size: 15px; } .sf-chart.narrow .leg { font-size: 15px; } .sf-chart.narrow .slolbl { font-size: 14px; }
      `}</style>
    </Lab>
  )
}

/* 名稱裡把命中的詞標起來（ILIKE 標子字串；FTS / 引擎標整個詞位） */
function Hi({ text, terms, mode }) {
  if (!terms.length) return text
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => terms.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>)
}

/* 示意延遲曲線：x 資料量（對數）、y 毫秒（對數）；紅虛線是 p95 目標 200 ms。手機上放大字體、圖例改成三行 */
const LEGEND = [['like', '橘 ILIKE（線性）'], ['fts', '青 FTS（GIN + 排名成本）'], ['engine', '紫 引擎（幾乎不變，另有秒級同步延遲）']]
function LatencyChart({ mode, vol, hitRatio, narrow }) {
  const W = 560, H = narrow ? 210 : 170, L = narrow ? 60 : 44, R = 12, T = 14, B = narrow ? 36 : 30
  const x = (i) => L + (i / (VOLS.length - 1)) * (W - L - R)
  const y = (ms) => T + (1 - (Math.log10(Math.max(1, ms)) / 3)) * (H - T - B)
  const path = (m) => VOLS.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(latency(m, n, hitRatio)).toFixed(1)}`).join(' ')
  return (
    <svg className={`sf-chart${narrow ? ' narrow' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="三種做法的示意延遲隨資料量變化">
      {[1, 10, 100, 1000].map((ms) => <g key={ms}><line x1={L} x2={W - R} y1={y(ms)} y2={y(ms)} className="grid" /><text x={L - 6} y={y(ms) + 3.5} textAnchor="end" className="lbl">{ms}ms</text></g>)}
      {VOLS.map((n, i) => <text key={n} x={x(i)} y={H - 10} textAnchor="middle" className="lbl">{fmtN(n)}</text>)}
      <line x1={L} x2={W - R} y1={y(200)} y2={y(200)} className="slo" /><text x={W - R} y={y(200) - 4} textAnchor="end" className="slolbl">p95 目標 200 ms</text>
      {['like', 'fts', 'engine'].map((m) => <path key={m} d={path(m)} className={`line ${m}${m === mode ? ' cur' : ''}`} />)}
      {['like', 'fts', 'engine'].map((m) => <circle key={m} cx={x(vol)} cy={y(latency(m, VOLS[vol], hitRatio))} r={m === mode ? 5 : 3} className={`dot ${m}`} />)}
      {narrow
        ? LEGEND.map(([m, s], i) => <text key={m} x={L + 4} y={T + 14 + i * 18} className="leg">{s}</text>)
        : <text x={L + 4} y={T + 8} className="leg">{LEGEND.map(([, s]) => s).join(' · ')}</text>}
    </svg>
  )
}
