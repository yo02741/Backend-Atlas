import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, useReducedMotion, useTicker, useWidth } from '../ui.jsx'

/* 快取情境模擬器：
   ① 送 1,000 個請求：瀏覽器 → CDN → API → Redis → DB，每層擋掉多少、DB 收到幾個、多少人看到舊值
   ② 商品被更新：各層什麼時候才看到新值（TTL 倒數 vs 主動失效）
   所有數字都是示意：60 秒視窗、250 位使用者各 4 次請求、3 個 CDN 節點。 */

const USERS = 250, PER_USER = 4, WINDOW = 60, POPS = 3
const LAT = { browser: 0, cdn: 30, redis: 90, db: 160 }   // 示意 ms（API 在單一區域，使用者遍布各地）
const PRESETS = {
  http: { browser: true, cdn: true, redis: false },
  redis: { browser: false, cdn: false, redis: true },
  none: { browser: false, cdn: false, redis: false },
}

/* 離散事件模擬：每個請求依時間順序經過各層；資料每 every 秒改版一次 */
function simulate({ isPublic, browser, cdn, redis, ttl, every, purge }) {
  const reqs = []
  for (let u = 0; u < USERS; u++) for (let k = 0; k < PER_USER; k++) reqs.push({ u, t: k * 15 + (u * 15) / USERS })
  reqs.sort((a, b) => a.t - b.t)
  const updates = []
  if (every < WINDOW) for (let t = every; t < WINDOW; t += every) updates.push(t)
  const useCdn = cdn && isPublic
  const bcache = new Map(), ccache = new Map(), rcache = new Map()
  const hit = { browser: 0, cdn: 0, redis: 0, db: 0 }, stale = { browser: 0, cdn: 0, redis: 0 }
  let version = 0, ui = 0, latency = 0
  for (const r of reqs) {
    while (ui < updates.length && updates[ui] <= r.t) { version++; ui++; if (purge) { rcache.clear(); if (useCdn) ccache.clear() } }
    const fresh = (e) => e && e.exp > r.t
    if (browser) { const e = bcache.get(r.u); if (fresh(e)) { hit.browser++; if (e.v !== version) stale.browser++; latency += LAT.browser; continue } }
    if (useCdn) {
      const e = ccache.get(r.u % POPS)
      if (fresh(e)) { hit.cdn++; if (e.v !== version) stale.cdn++; latency += LAT.cdn; if (browser) bcache.set(r.u, { v: e.v, exp: r.t + ttl }); continue }
    }
    let v = version
    if (redis) {
      const key = isPublic ? 'product:42' : `cart:${r.u}`
      const e = rcache.get(key)
      if (fresh(e)) { hit.redis++; v = e.v; if (v !== version) stale.redis++; latency += LAT.redis }
      else { hit.db++; latency += LAT.db; rcache.set(key, { v, exp: r.t + ttl }) }
    } else { hit.db++; latency += LAT.db }
    if (useCdn) ccache.set(r.u % POPS, { v, exp: r.t + ttl })
    if (browser) bcache.set(r.u, { v, exp: r.t + ttl })
  }
  const total = reqs.length
  return { total, hit, stale, staleTotal: stale.browser + stale.cdn + stale.redis, updates: updates.length,
           latency: Math.round(latency / total), hitRate: Math.round(((total - hit.db) / total) * 1000) / 10 }
}

export default function CacheScenarioLab() {
  const [kind, setKind] = useState('public')
  const [browser, setBrowser] = useState(true)
  const [cdn, setCdn] = useState(true)
  const [redis, setRedis] = useState(false)
  const [purge, setPurge] = useState(true)
  const [ttl, setTtl] = useState(60)
  const [every, setEvery] = useState(60)
  const [prog, setProg] = useState(0)          // 0..1 動畫進度；0 = 尚未送
  const [ranKey, setRanKey] = useState(null)   // 按下「送」時的參數快照；參數一變結果就收起來
  const reduced = useReducedMotion()
  const raf = useRef(null)
  const isPublic = kind === 'public'
  const useCdn = cdn && isPublic
  const preset = Object.keys(PRESETS).find((k) => PRESETS[k].browser === browser && PRESETS[k].cdn === cdn && PRESETS[k].redis === redis) || 'custom'
  const applyPreset = (p) => { if (!PRESETS[p]) return; setBrowser(PRESETS[p].browser); setCdn(PRESETS[p].cdn); setRedis(PRESETS[p].redis) }
  const switchKind = (k) => { setKind(k); if (k === 'private') { setEvery(10); setTtl(30); applyPreset('redis') } else { setEvery(60); setTtl(60); applyPreset('http') } }

  const key = JSON.stringify([isPublic, browser, cdn, redis, ttl, every, purge])
  const res = useMemo(() => simulate({ isPublic, browser, cdn, redis, ttl, every, purge }), [isPublic, browser, cdn, redis, ttl, every, purge])
  const ran = ranKey === key
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const run = () => {
    cancelAnimationFrame(raf.current)
    setRanKey(key)
    if (reduced) { setProg(1); return }
    const t0 = performance.now()
    const step = (now) => { const p = Math.min(1, (now - t0) / 1600); setProg(p); if (p < 1) raf.current = requestAnimationFrame(step) }
    setProg(0); raf.current = requestAnimationFrame(step)
  }

  return (
    <Lab accent="blue" kicker="SCENARIO LAB" title="同一批請求，換一層快取，DB 收到的數量差一百倍"
         blurb="選資料種類與做法，送 1,000 個請求看每層擋掉多少；再按「商品被更新」看每層要多久才看到新值。全部示意。">
      <LabControls>
        <Seg label="資料種類" tinted value={kind} onChange={switchKind}
             options={[{ value: 'public', label: '公開商品頁' }, { value: 'private', label: '個人購物車' }]} />
        <Seg label="做法" value={preset} onChange={applyPreset}
             options={[{ value: 'http', label: 'HTTP 標頭' }, { value: 'redis', label: 'Redis' }, { value: 'none', label: '不快取' }, { value: 'custom', label: '自訂' }]} />
      </LabControls>
      <LabControls>
        <Toggle label="瀏覽器快取（max-age）" checked={browser} onChange={setBrowser} />
        <Toggle label={isPublic ? 'CDN（s-maxage）' : 'CDN（private：不可用）'} checked={useCdn} onChange={(v) => isPublic && setCdn(v)} />
        <Toggle label="Redis cache-aside" checked={redis} onChange={setRedis} />
        <Toggle label="更新時主動失效（DEL key / CDN purge）" checked={purge} onChange={setPurge} />
      </LabControls>
      <LabControls>
        <Slider label="TTL" min={5} max={120} step={5} value={ttl} onChange={setTtl} format={(v) => `${v} 秒`} />
        <Slider label="資料更新頻率" min={5} max={60} step={5} value={every} onChange={setEvery} format={(v) => v >= WINDOW ? '不更新' : `每 ${v} 秒`} />
        <span className="spacer" />
        <button type="button" className="btn small" onClick={run}>送 1,000 個請求</button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="請求路徑" caption="60 秒視窗、250 位使用者各 4 次請求、3 個 CDN 節點。灰色＝這層停用或不適用；紅字＝從這層拿到舊值的請求數。">
            <PathSvg res={res} prog={ran ? prog : 0} flags={{ browser, cdn: useCdn, redis, isPublic, ttl }} />
          </LabStage>
          <div className="cs-stats">
            <div><span>DB 請求</span><b>{ran ? Math.round(res.hit.db * prog).toLocaleString() : '—'}<small> / 1,000</small></b></div>
            <div><span>命中率</span><b>{ran ? `${(res.hitRate * prog).toFixed(1)}%` : '—'}</b></div>
            <div><span>看到舊值</span><b className={ran && res.staleTotal ? 'bad' : ''}>{ran ? Math.round(res.staleTotal * prog).toLocaleString() : '—'}<small> 個請求</small></b></div>
            <div><span>平均延遲（示意）</span><b>{ran ? `${res.latency} ms` : '—'}</b></div>
            <div><span>視窗內更新</span><b>{res.updates}<small> 次</small></b></div>
          </div>
          <UpdatePanel flags={{ browser, cdn: useCdn, redis, purge, ttl }} />
        </div>
        <div className="lab-stack">
          <LabExplain title={TITLES[preset] || '自訂組合'}>
            {explainFor({ isPublic, browser, cdn: useCdn, redis, purge, ttl, res, ran })}
          </LabExplain>
          <Callout title="什麼時候會真的踩到">
            商品改價後客服接到「我看到的還是舊價」——查下去是瀏覽器那份 max-age 還沒到，伺服器端怎麼清都沒用。反過來，購物車回應少了 <b>private</b>，CDN 把某人的購物車存起來回給別人，是資安事故。標頭決定的是「誰可以存」，TTL 決定「存多久」，主動失效只管得到自己控制的那幾層。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .cs-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
        .cs-stats > div { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 12px; display: grid; gap: 2px; }
        .cs-stats span { font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.04em; }
        .cs-stats b { font-family: var(--mono); font-size: 1.05rem; color: var(--ink-1); font-variant-numeric: tabular-nums; }
        .cs-stats b small { font-size: 0.7rem; color: var(--ink-3); font-weight: 400; }
        .cs-stats b.bad { color: var(--critical); }
        .cs-upd { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 12px 14px; display: grid; gap: 8px; }
        .cs-upd .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.8rem; color: var(--ink-2); }
        .cs-upd .head b { color: var(--ink-1); font-family: var(--mono); }
        .cs-row { display: grid; grid-template-columns: 72px 1fr 118px; gap: 10px; align-items: center; font-size: 0.8rem; }
        .cs-row .track { height: 14px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 3px; overflow: hidden; }
        .cs-row .fill { height: 100%; background: var(--critical); transition: width 0.1s linear; }
        .cs-row .fill.ok { background: var(--good); }
        .cs-row .st { font-family: var(--mono); font-size: 0.74rem; text-align: right; font-variant-numeric: tabular-nums; }
        .cs-row .st.old { color: var(--critical); } .cs-row .st.new { color: var(--good); } .cs-row .st.na { color: var(--ink-3); }
        .cs-svg .stale { fill: var(--critical); font-family: var(--mono); font-size: 11px; }
        .cs-svg .hits { fill: var(--good); font-family: var(--mono); font-size: 11px; }
        .cs-svg .off { opacity: 0.35; }
        .cs-svg .cnt { fill: var(--ink-1); font-family: var(--mono); font-size: 11.5px; font-weight: 700; }
        @media (prefers-reduced-motion: reduce) { .cs-row .fill { transition: none; } }
      `}</style>
    </Lab>
  )
}

const TITLES = { http: 'HTTP 標頭：請求根本不進 API', redis: 'Redis：DB 一個 key 只被打一次', none: '不快取：每個請求都是完整路徑' }
const NODES = [
  { id: 'browser', name: '瀏覽器' }, { id: 'cdn', name: 'CDN' }, { id: 'api', name: 'API' }, { id: 'redis', name: 'Redis' }, { id: 'db', name: 'DB' },
]

function PathSvg({ res, prog, flags }) {
  const ref = useRef(null)
  const w = useWidth(ref, 700)
  const vertical = w < 520
  const n = (v) => Math.round(v * prog).toLocaleString()
  // 進到每一層的請求數
  const into = [res.total, res.total - res.hit.browser, res.total - res.hit.browser - res.hit.cdn]
  into.push(into[2], res.hit.db)
  const sub = {
    browser: flags.browser ? `max-age=${flags.ttl}` : 'no-store',
    cdn: !flags.isPublic ? 'private：不存' : flags.cdn ? `s-maxage=${flags.ttl}` : '停用',
    api: 'cache-aside 邏輯在這', redis: flags.redis ? `TTL ${flags.ttl}s` : '停用', db: 'PostgreSQL',
  }
  const on = { browser: flags.browser, cdn: flags.cdn, api: true, redis: flags.redis, db: true }
  const NW = vertical ? 200 : 122, NH = 50
  const pos = (i) => vertical ? { x: 14, y: 8 + i * 74 } : { x: 6 + i * 160, y: 30 }
  const vb = vertical ? '0 0 340 372' : '0 0 770 130'
  return (
    <div ref={ref}>
      <svg className="cs-svg" viewBox={vb} width="100%" role="img" aria-label="瀏覽器到 DB 的請求路徑">
        {NODES.map((nd, i) => {
          const p = pos(i)
          const blocked = nd.id === 'browser' ? res.hit.browser : nd.id === 'cdn' ? res.hit.cdn : nd.id === 'redis' ? res.hit.redis : null
          const stale = res.stale[nd.id] || 0
          return (
            <g key={nd.id} className={on[nd.id] ? '' : 'off'}>
              <rect className={`svg-node${on[nd.id] && nd.id !== 'api' ? ' on' : ''}`} x={p.x} y={p.y} width={NW} height={NH} rx="6" />
              <text className="svg-text" x={p.x + 10} y={p.y + 20} fontWeight="700">{nd.name}</text>
              <text className="svg-text small" x={p.x + 10} y={p.y + 38}>{sub[nd.id]}</text>
              {vertical ? (
                <>
                  {blocked !== null && on[nd.id] && prog > 0 && <text className="hits" x={p.x + NW + 10} y={p.y + 20}>擋下 {n(blocked)}</text>}
                  {nd.id === 'db' && prog > 0 && <text className="cnt" x={p.x + NW + 10} y={p.y + 20}>收到 {n(res.hit.db)}</text>}
                  {stale > 0 && prog > 0 && <text className="stale" x={p.x + NW + 10} y={p.y + 38}>舊值 {n(stale)}</text>}
                </>
              ) : (
                <>
                  {blocked !== null && on[nd.id] && prog > 0 && <text className="hits" x={p.x + 4} y={p.y + NH + 16}>擋下 {n(blocked)}</text>}
                  {nd.id === 'db' && prog > 0 && <text className="cnt" x={p.x + 4} y={p.y + NH + 16}>收到 {n(res.hit.db)}</text>}
                  {stale > 0 && prog > 0 && <text className="stale" x={p.x + 4} y={p.y + NH + 32}>舊值 {n(stale)}</text>}
                </>
              )}
            </g>
          )
        })}
        {NODES.slice(0, -1).map((nd, i) => {
          const a = pos(i), b = pos(i + 1)
          const count = into[i + 1]
          const active = prog > 0 && prog < 1 && count > 0
          const x1 = vertical ? a.x + NW / 2 : a.x + NW, y1 = vertical ? a.y + NH : a.y + NH / 2
          const x2 = vertical ? b.x + NW / 2 : b.x, y2 = vertical ? b.y : b.y + NH / 2
          return (
            <g key={`e${i}`}>
              <line className={`svg-edge${active ? ' svg-flow' : ''}${count > 0 && prog > 0 ? ' on' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />
              <text className="cnt" x={vertical ? x1 + 10 : (x1 + x2) / 2} y={vertical ? (y1 + y2) / 2 + 4 : y1 - 8} textAnchor={vertical ? 'start' : 'middle'}>{prog > 0 ? n(count) : ''}</text>
            </g>
          )
        })}
        {prog > 0 && (
          <text className="cnt" x={vertical ? pos(0).x + NW + 10 : pos(0).x + 4} y={vertical ? pos(0).y + 20 : pos(0).y - 10}>{vertical ? `進來 ${n(res.total)}` : `進來 ${n(res.total)} 個請求`}</text>
        )}
      </svg>
    </div>
  )
}

/* ② 商品被更新：時間以 10 倍速跑（1 tick = 1 秒示意） */
function UpdatePanel({ flags }) {
  const [started, setStarted] = useState(false)
  const rows = [
    { id: 'db', name: 'DB', at: 0 },
    { id: 'redis', name: 'Redis', at: flags.redis ? (flags.purge ? 0 : flags.ttl) : null },
    { id: 'cdn', name: 'CDN', at: flags.cdn ? (flags.purge ? 0 : flags.ttl) : null },
    { id: 'browser', name: '瀏覽器', at: flags.browser ? flags.ttl : null },
  ]
  const maxAt = Math.max(0, ...rows.map((r) => r.at ?? 0))
  const [tick, resetTick] = useTicker(started && maxAt > 0, 100)
  const t = Math.min(tick, maxAt)
  useEffect(() => { setStarted(false); resetTick() }, [flags.redis, flags.cdn, flags.browser, flags.purge, flags.ttl]) // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { resetTick(); setStarted(true) }
  const done = started && t >= maxAt
  return (
    <div className="cs-upd">
      <div className="head">
        <button type="button" className="btn ghost small" onClick={start}>商品被更新</button>
        {started ? <span>更新後 <b>{t}</b> 秒（10 倍速）{done ? <Status ok>所有層都是新值</Status> : <Status warn>還有人拿到舊值</Status>}</span>
                 : <span>最壞情況：更新那一刻每一層都剛存了一份、TTL 剛開始倒數。</span>}
      </div>
      {rows.map((r) => {
        const na = r.at === null
        const seen = started && !na && t >= r.at
        const pct = na || !started ? 0 : r.at === 0 ? 100 : Math.min(100, (t / r.at) * 100)
        return (
          <div className="cs-row" key={r.id}>
            <span>{r.name}</span>
            <div className="track"><div className={`fill${seen ? ' ok' : ''}`} style={{ width: `${na ? 0 : started ? (seen ? 100 : pct) : 0}%` }} /></div>
            <span className={`st ${na ? 'na' : !started ? 'na' : seen ? 'new' : 'old'}`}>
              {na ? '不經過這層' : !started ? (r.at === 0 ? '立刻' : `${r.at} 秒後`) : seen ? (r.at === 0 ? '新值 · 立刻' : `新值 · 第 ${r.at} 秒`) : `舊值 · 還要 ${r.at - t} 秒`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function explainFor({ isPublic, browser, cdn, redis, purge, ttl, res, ran }) {
  const layers = [browser && '瀏覽器', cdn && 'CDN', redis && 'Redis'].filter(Boolean)
  const p = []
  if (!layers.length) {
    p.push(<p key="a">沒有任何一層擋在前面：1,000 個請求全部到 DB，每個都付完整的網路加查詢延遲。好處只有一個——永遠是最新值。商品頁每秒 2,000 次直接超過 DB 的能力，付款狀態這種不能舊的端點則正好該這樣做。</p>)
  } else {
    p.push(<p key="a">現在開著：{layers.join('、')}。同一位使用者 TTL 內的重複請求由瀏覽器擋下（不出門）；CDN 一個節點一份，各地區只回源一次；Redis 是 API 後面的共用快取，{isPublic ? '一個 key 一段 TTL 只打 DB 一次' : '每位使用者一個 key，第一次讀還是要到 DB'}。</p>)
    if (!isPublic && cdn === false) p.push(<p key="b">購物車是個人資料，回應標 <code>Cache-Control: private</code>，CDN 不能存；瀏覽器可以存自己的那份，但改完購物車就會看到舊車，所以實務上是 <code>no-store</code> 加 Redis。</p>)
    if (browser) p.push(<p key="c">瀏覽器那一份伺服器碰不到：改價後只能等 max-age（{ttl} 秒）到期，所以「可容忍多久舊值」直接決定 max-age 能設多長。CDN 與 Redis 則可以主動失效{purge ? '（目前有開）' : '（目前沒開，只能等 TTL）'}。</p>)
    else if (!purge) p.push(<p key="c">沒有主動失效，Redis{cdn ? '與 CDN ' : ''}只能等 TTL 到期，更新頻率越高、TTL 越長，看到舊值的請求越多。</p>)
    else p.push(<p key="c">寫入時 DEL key{cdn ? '並 purge CDN' : ''}，更新之後的第一個請求就會重建新值，舊值幾乎為零；代價是每次更新都多一次 DB 查詢。</p>)
  }
  if (ran) p.push(<p key="d">這一批：DB 收到 <b>{res.hit.db.toLocaleString()}</b> 個、命中率 <b>{res.hitRate}%</b>、拿到舊值 <b>{res.staleTotal.toLocaleString()}</b> 個。調 TTL 或更新頻率再送一次，比較兩個數字怎麼一起動。</p>)
  return p
}
