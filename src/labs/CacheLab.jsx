import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Toggle, Slider, Code, Callout, Status, useReducedMotion } from './ui.jsx'

/* ============================================================
   Cache-aside：Redis 擋在 PostgreSQL 前面，但所有邏輯都在 API 裡
   - GET：第一次 miss（走一趟 DB 再回寫），之後 hit；key 真的有 TTL 倒數
   - UPDATE：有沒有 invalidate，決定下一次 GET 拿到新資料還是 stale
   ============================================================ */

const NAMES = ['Alice', 'Alicia', 'Alison', 'Alina']
const KEY = 'user:1'
const DB_MS = 40, CACHE_MS = 1

/* 每個流程的階段：edge = 亮哪條線，dir = 方向（to 離開 API / back 回到 API），hl = python 高亮行 */
const PHASES = {
  miss: [
    { edge: 'redis', dir: 'to', hl: [2, 3], text: `API → Redis：GET ${KEY}` },
    { edge: 'redis', dir: 'back', hl: [3, 4], text: 'Redis → API：(nil)，快取沒有這個 key（miss）' },
    { edge: 'db', dir: 'to', hl: [6, 7, 8], text: 'API → PostgreSQL：SELECT * FROM users WHERE id = 1' },
    { edge: 'db', dir: 'back', hl: [6, 7, 8], text: `PostgreSQL → API：一列資料（${DB_MS} ms）` },
    { edge: 'redis', dir: 'to', hl: [9, 10], text: `API → Redis：SETEX ${KEY} <TTL> {…}，回寫並設定壽命` },
    { edge: null, hl: [11], text: `回應 client：共 ${CACHE_MS + DB_MS} ms（miss）` },
  ],
  hit: [
    { edge: 'redis', dir: 'to', hl: [2, 3], text: `API → Redis：GET ${KEY}` },
    { edge: 'redis', dir: 'back', hl: [4, 5], text: `Redis → API：直接回傳 JSON（${CACHE_MS} ms）` },
    { edge: null, hl: [5], text: `回應 client：${CACHE_MS} ms（hit，完全沒碰 DB）` },
  ],
  update: [
    { edge: 'db', dir: 'to', hl: [14, 15, 16], text: 'API → PostgreSQL：UPDATE users SET name = … WHERE id = 1' },
    { edge: 'redis', dir: 'to', hl: [17, 18], text: `API → Redis：DEL ${KEY}（讓快取失效）`, inv: true },
    { edge: null, hl: [17], text: 'Redis 沒被通知：DB 改了，快取裡的舊值還活著', inv: false },
    { edge: null, hl: [], text: '回應 client：更新完成' },
  ],
}
const phasesFor = (kind, inv) => PHASES[kind].filter((p) => p.inv === undefined || p.inv === inv)

const CODE = `def get_user(user_id):
    key = f"user:{user_id}"
    cached = redis.get(key)   # 1. 問快取
    if cached is not None:    # hit ~1 ms
        return json.loads(cached)
    row = db.query_one(    # miss ~40 ms
        "SELECT * FROM users"
        " WHERE id = %s", user_id)
    redis.setex(key, TTL,     # 2. 回寫+TTL
                json.dumps(row))
    return row

def update_user(user_id, name):
    db.execute(
        "UPDATE users SET name = %s"
        " WHERE id = %s", name, user_id)
    if INVALIDATE:        # 3. 失效快取
        redis.delete(f"user:{user_id}")`

export default function CacheLab() {
  const [ttl, setTtl] = useState(8)
  const [invalidate, setInvalidate] = useState(true)
  const [db, setDb] = useState({ name: NAMES[0], version: 0 })
  const [cache, setCache] = useState(null)      // { name, version, expiresAt, ttl }
  const [now, setNow] = useState(() => Date.now())
  const [flow, setFlow] = useState(null)        // { kind, step }
  const [stats, setStats] = useState({ hits: 0, misses: 0 })
  const [log, setLog] = useState([])
  const [lastKind, setLastKind] = useState(null)
  const reduced = useReducedMotion()
  const seq = useRef(0)
  const ref = useRef({})
  ref.current = { db, cache, ttl, invalidate }

  const pushLog = (entry) => setLog((l) => [{ id: ++seq.current, ...entry }, ...l].slice(0, 6))

  /* 流程推進：每個階段停一下，進入下一階段時套用副作用（回寫 / 刪 key / 記錄） */
  useEffect(() => {
    if (!flow) return
    const phases = phasesFor(flow.kind, flow.inv)
    const id = setTimeout(() => {
      const { db, cache, ttl } = ref.current
      const next = flow.step + 1
      if (next >= phases.length) {
        if (flow.kind === 'miss') { setStats((s) => ({ ...s, misses: s.misses + 1 })); pushLog({ kind: 'miss', ms: CACHE_MS + DB_MS }) }
        if (flow.kind === 'hit') { setStats((s) => ({ ...s, hits: s.hits + 1 })); pushLog({ kind: 'hit', ms: CACHE_MS, stale: !!cache && cache.version !== db.version, name: cache?.name }) }
        if (flow.kind === 'update') pushLog({ kind: 'update', name: db.name, inv: flow.inv })
        setFlow(null)
        return
      }
      if (flow.kind === 'miss' && next === 4) setCache({ name: db.name, version: db.version, expiresAt: Date.now() + ttl * 1000, ttl })
      if (flow.kind === 'update' && next === 1 && flow.inv) setCache(null)
      setFlow({ ...flow, step: next })
    }, reduced ? 150 : 560)
    return () => clearTimeout(id)
  }, [flow, reduced])

  /* TTL 倒數：真的用 interval，時間到 key 消失 */
  useEffect(() => {
    if (!cache) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= cache.expiresAt) { setCache(null); pushLog({ kind: 'expire' }) }
    }, 100)
    return () => clearInterval(id)
  }, [cache])

  const busy = !!flow
  const get = () => { const kind = cache ? 'hit' : 'miss'; setLastKind(kind); setFlow({ kind, step: 0, inv: invalidate }) }
  const update = () => {
    setDb((d) => ({ name: NAMES[(d.version + 1) % NAMES.length], version: d.version + 1 }))
    setLastKind('update'); setFlow({ kind: 'update', step: 0, inv: invalidate })
  }
  const resetAll = () => { setFlow(null); setCache(null); setDb({ name: NAMES[0], version: 0 }); setStats({ hits: 0, misses: 0 }); setLog([]); setLastKind(null) }

  const phase = flow ? phasesFor(flow.kind, flow.inv)[flow.step] : null
  const stale = !!cache && cache.version !== db.version
  const total = stats.hits + stats.misses
  const rate = total ? Math.round((stats.hits / total) * 100) : null
  const explain = pickExplain({ flow, lastKind, stale, invalidate, cache, total, rate })

  return (
    <Lab accent="violet" kicker="DATABASE LAB" title="Cache-aside：Redis 擋在資料庫前面"
         blurb="按 GET 看第一次 miss 怎麼多跑一趟資料庫、之後 hit 怎麼 1 ms 回頭；key 有真實倒數的 TTL。按 UPDATE 改資料，再切換「寫入時使快取失效」，看沒失效的快取怎麼交出舊資料。">
      <LabControls>
        <Slider label="TTL" min={3} max={15} value={ttl} onChange={setTtl} format={(v) => `${v} 秒`} />
        <Toggle label="寫入時使快取失效（invalidate）" checked={invalidate} onChange={setInvalidate} />
        <span className="spacer" />
        <button type="button" className="btn small" onClick={get} disabled={busy}>GET /users/1</button>
        <button type="button" className="btn ghost small" onClick={update} disabled={busy}>UPDATE user 1 的名字</button>
        {total > 0 && <button type="button" className="btn ghost small" onClick={resetAll} disabled={busy}>重設</button>}
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="API、Redis、PostgreSQL 三節點與請求流向" caption="TTL 滑桿只影響之後回寫的 key。倒數條走完 key 就從 Redis 消失，下一次 GET 又是 miss。">
            <Diagram phase={phase} cache={cache} db={db} now={now} stale={stale} />
            <p className={`cache-phase${phase ? ' on' : ''}`}>
              {phase ? phase.text : total === 0 ? '還沒有任何請求。按「GET /users/1」發出第一個。' : '閒置中。再按一次 GET，或改資料看快取怎麼反應。'}
            </p>
          </LabStage>
          <div className="cache-stats">
            <span className="pill">hit <b>{stats.hits}</b></span>
            <span className="pill">miss <b>{stats.misses}</b></span>
            <span className="pill">命中率 <b>{rate === null ? '–' : `${rate}%`}</b></span>
            <span className="pill">DB 目前 name = <b>"{db.name}"</b></span>
          </div>
          {log.length > 0 && (
            <ol className="cache-log" aria-label="請求記錄">
              {log.map((e) => <li key={e.id} className="cache-log-in"><LogLine e={e} /></li>)}
            </ol>
          )}
          <LabExplain title="TTL、失效，與為什麼一致性很難">
            <p><strong>TTL</strong> 是保底：就算程式漏了 DEL，舊值最多活到過期。<strong>Invalidate</strong> 是即時：寫入後立刻刪 key（刪、不是改，避免兩個寫入交錯時留下錯的版本）。實務上兩個一起用。</p>
            <p>但 DB 和 Redis 是兩個系統，中間沒有交易：先改 DB 再 DEL 之間有空窗、DEL 可能失敗、一個 read miss 讀到舊列的同時另一個 write 剛改完並 DEL，miss 回寫又把舊值放回去。這些窗口只能縮短，不能消滅。</p>
            <p><strong>Cache stampede</strong>：熱門 key 到期的那一瞬間，成千上百個請求同時 miss、同時打 DB。常見解法：同一個 key 只讓一個請求去載入（鎖 / singleflight）、快到期時提早刷新、TTL 加隨機抖動避免一起到期。</p>
          </LabExplain>
        </div>

        <div className="lab-stack">
          <Code lang="python" title="cache-aside（示意）" highlight={phase?.hl ?? []} dim>{CODE}</Code>
          <LabExplain title={explain.title}>
            {explain.text.map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(p) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            <b>讀多寫少、可以容忍幾秒舊資料、流量集中在少數熱點</b>——首頁、商品頁、使用者 profile、系統設定——cache-aside 幾乎穩賺。
            不適合：每次查詢都不一樣（命中率低，白繳記憶體）、需要強一致的東西（餘額、庫存扣減），那些要回到 DB 的交易去做。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .cache-svg { width: 100%; }
        .cache-svg .edge { stroke: var(--hairline); stroke-width: 2; fill: none; transition: stroke 0.25s ease; }
        .cache-svg .edge.on { stroke: var(--lab-accent); stroke-width: 3; stroke-dasharray: 7 6; animation: cache-flow 0.7s linear infinite; }
        .cache-svg .edge.on.back { animation-direction: reverse; }
        @keyframes cache-flow { to { stroke-dashoffset: -26; } }
        .cache-svg .title { font-family: var(--sans); font-size: 13px; font-weight: 700; fill: var(--ink-1); text-anchor: middle; }
        .cache-svg .sub { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-3); text-anchor: middle; }
        .cache-svg .keycard { fill: var(--page); stroke: var(--hairline); stroke-dasharray: 4 3; transition: stroke 0.25s ease; }
        .cache-svg .keycard.has { stroke: var(--lab-accent); stroke-dasharray: none; }
        .cache-svg .kv { font-family: var(--mono); font-size: 10px; fill: var(--ink-1); }
        .cache-svg .kv.muted { fill: var(--ink-3); }
        .cache-svg .ttl-bg { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 0.5; }
        .cache-svg .ttl { fill: var(--lab-accent); }
        .cache-svg .ttl.low { fill: var(--serious); }
        .cache-svg .stale { font-family: var(--mono); font-size: 9.5px; font-weight: 700; fill: var(--critical); text-anchor: end; }
        .cache-phase { margin-top: 10px; text-align: center; font-size: 0.8rem; color: var(--ink-3); min-height: 1.5em; transition: color 0.2s ease; }
        .cache-phase.on { color: var(--ink-1); font-weight: 600; }
        .cache-stats { display: flex; flex-wrap: wrap; gap: 8px; }
        .cache-stats b { font-family: var(--mono); color: var(--ink-1); font-weight: 600; }
        .cache-log { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); }
        .cache-log li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); }
        .cache-log li:first-child { border-color: color-mix(in srgb, var(--lab-accent) 50%, var(--hairline)); }
        .cache-log .n { color: var(--ink-3); }
        .cache-log .ms { margin-left: auto; color: var(--ink-1); font-variant-numeric: tabular-nums; }
        .cache-log .status { font-size: 0.68rem; padding: 1px 8px; }
        .cache-log-in { animation: cache-in 0.3s ease-out both; }
        @keyframes cache-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .cache-svg .edge.on, .cache-log-in { animation: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

function LogLine({ e }) {
  if (e.kind === 'expire') return <><span className="n">#{e.id}</span> TTL 到期 · {KEY} 從 Redis 消失 <Status warn>expired</Status></>
  if (e.kind === 'update') return <><span className="n">#{e.id}</span> UPDATE name → "{e.name}" {e.inv ? <Status ok>DEL {KEY}</Status> : <Status warn>快取未失效</Status>}</>
  return (
    <>
      <span className="n">#{e.id}</span> GET /users/1
      {e.kind === 'hit' ? <Status ok>hit</Status> : <Status warn>miss</Status>}
      {e.stale && <Status>stale："{e.name}"</Status>}
      <span className="ms">{e.ms} ms</span>
    </>
  )
}

function pickExplain({ flow, lastKind, stale, invalidate, cache, total, rate }) {
  const kind = flow?.kind ?? lastKind
  if (!kind) return {
    title: 'Cache-aside：快取擋在前面，但由 API 自己管',
    text: [
      '讀：先問 Redis，沒有（miss）才去 PostgreSQL，拿到後**回寫** Redis 並設 TTL。寫：直接改 DB，然後把快取的 key **刪掉**。Redis 完全不知道 DB 的存在，所有「什麼時候查、什麼時候寫回、什麼時候刪」都是應用程式的責任——這就是 aside（旁路）的意思。',
      '對照右邊的 pseudo code：`get_user` 是讀路徑，`update_user` 是寫路徑。按 GET 開始。',
    ],
  }
  if (kind === 'miss') return {
    title: 'Miss：多跑一趟 DB，順手把答案留下',
    text: [
      `Redis 裡沒有 ${KEY}，API 只好去 PostgreSQL 查（示意 ${DB_MS} ms），拿到後用 SETEX 回寫、附上 TTL。這次請求共 ${CACHE_MS + DB_MS} ms，比沒有快取還多了 1 ms——第一個人替後面所有人付了這筆錢。`,
      '回寫之後 key 開始倒數。TTL 越長命中率越高，但資料被改掉時，舊值也活得越久。',
    ],
  }
  if (kind === 'hit') return stale ? {
    title: 'Hit，但是舊的：這就是 stale read',
    text: [
      `Redis 有 ${KEY}，API 1 ms 就回了，完全沒碰 DB——所以它也不知道 DB 的 name 已經改掉。使用者看到的是舊名字，會持續到 TTL 到期為止。`,
      '這不是 bug，是 cache-aside 沒有搭配失效時的預期行為。開啟「寫入時使快取失效」再試一次 UPDATE。',
    ],
  } : {
    title: 'Hit：1 ms 回頭，DB 完全沒感覺',
    text: [
      `Redis 是記憶體裡的 hash 查找，${CACHE_MS} ms 等級；PostgreSQL 要走連線、planner、磁碟頁，示意 ${DB_MS} ms。差 40 倍還只是保守估計，真實系統 DB 查詢常是幾十到幾百毫秒。`,
      `目前命中率 ${rate}%（${total} 次請求）。熱點資料的命中率會趨近 100%，DB 只在 TTL 到期時被打一次。`,
    ],
  }
  return invalidate ? {
    title: '寫入後刪 key，而不是更新 key',
    text: [
      'DB 改完，API 接著 DEL 快取。為什麼是刪不是改？如果兩個更新交錯執行，「改快取」可能讓後到的舊值蓋掉新值；刪掉則讓下一次讀自己去 DB 拿最新的，簡單且安全。',
      '代價：下一次 GET 必定 miss（多一趟 DB）。這是可接受的，因為寫入本來就比讀少。',
    ],
  } : {
    title: '沒有失效：快取不知道 DB 改了',
    text: [
      cache
        ? `DB 的 name 已經改了，但 ${KEY} 還在 Redis 裡、還在倒數。下一次 GET 會是 hit，拿到的卻是舊值——直到 TTL 到期。`
        : `DB 的 name 改了。此刻 Redis 剛好沒有 ${KEY}，所以下一次 GET 會 miss 並載入新值——但這只是運氣，換個時機就會拿到舊資料。`,
      '這是 cache-aside 最常見的線上事故來源：改了資料，畫面卻沒變。',
    ],
  }
}

/* 三節點 SVG：API 左、Redis 中（含 key 卡片與 TTL 條）、PostgreSQL 右；API→DB 走下方弧線 */
function Diagram({ phase, cache, db, now, stale }) {
  const edge = phase?.edge ?? null
  const dir = phase?.dir ?? 'to'
  const remain = cache ? Math.max(0, cache.expiresAt - now) / 1000 : 0
  const frac = cache ? Math.min(1, remain / cache.ttl) : 0
  const cls = (name) => `edge${edge === name ? ' on' : ''}${edge === name && dir === 'back' ? ' back' : ''}`
  return (
    <svg className="cache-svg" viewBox="0 0 480 186" role="img"
         aria-label={`API、Redis、PostgreSQL；${cache ? `快取有 ${KEY}，剩 ${remain.toFixed(1)} 秒` : '快取是空的'}`}>
      <path d="M 72 88 C 72 176, 408 176, 408 88" className={cls('db')} />
      <line x1="128" y1="58" x2="178" y2="58" className={cls('redis')} />
      <text x="240" y="166" className="sub">API ↔ PostgreSQL（只在 miss 與寫入時走）</text>

      <rect x="16" y="30" width="112" height="58" rx="6" className={`svg-node${edge ? ' on' : ''}`} />
      <text x="72" y="55" className="title">API</text>
      <text x="72" y="73" className="sub">應用程式</text>

      <rect x="178" y="12" width="124" height="106" rx="6" className={`svg-node${edge === 'redis' ? ' on' : ''}`} />
      <text x="240" y="32" className="title">Redis</text>
      <rect x="186" y="42" width="108" height="66" rx="4" className={`keycard${cache ? ' has' : ''}`} />
      {cache ? (
        <>
          <text x="193" y="58" className="kv">{KEY}</text>
          {stale && <text x="287" y="58" className="stale">stale</text>}
          <text x="193" y="74" className="kv muted">{`{name:"${cache.name}"}`}</text>
          <rect x="193" y="84" width="94" height="6" rx="3" className="ttl-bg" />
          <rect x="193" y="84" width={94 * frac} height="6" rx="3" className={`ttl${frac < 0.25 ? ' low' : ''}`} />
          <text x="193" y="103" className="kv muted">TTL 剩 {remain.toFixed(1)} s</text>
        </>
      ) : (
        <text x="240" y="79" className="sub">（沒有 {KEY}）</text>
      )}

      <rect x="352" y="30" width="112" height="58" rx="6" className={`svg-node${edge === 'db' ? ' on' : ''}`} />
      <text x="408" y="55" className="title">PostgreSQL</text>
      <text x="408" y="73" className="sub">{`name = "${db.name}"`}</text>
    </svg>
  )
}
