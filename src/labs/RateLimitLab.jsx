import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, useTicker, useLabVisible } from './ui.jsx'

/* ============================================================
   Rate limiting：token bucket（真的用 setInterval 補 token）
   與 fixed window（示範邊界暴衝）
   - 每個請求拿走一個 token；沒 token 就 429
   - 固定視窗：邊界前後各塞滿 → 短時間 2N
   ============================================================ */

const PY_BUCKET = `class TokenBucket:
    def __init__(self, capacity, rate):      # rate：每秒補幾個
        self.capacity, self.rate = capacity, rate
        self.tokens, self.last = capacity, time.monotonic()

    def allow(self):
        now = time.monotonic()               # 不用背景 timer：
        elapsed = now - self.last            # 用「距上次多久」一次補齊
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True                      # 200
        return False                         # 429 + Retry-After`

const NGINX = `# 每個 client IP 一個桶：平均 5 r/s，額外容忍 10 個暴衝
limit_req_zone $binary_remote_addr zone=api:10m rate=5r/s;

server {
    location /api/ {
        limit_req zone=api burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://app;
    }
}`

const PY_WINDOW = `def allow(user_id, limit=10, window=10):
    bucket = int(time.time()) // window      # 現在是第幾個 10 秒
    key = f"rl:{user_id}:{bucket}"
    n = redis.incr(key)                      # 原子遞增，多台 app 共用
    if n == 1:
        redis.expire(key, window)            # 視窗過了自動消失
    return n <= limit                        # 超過就回 429`

const fmtT = (ms) => `${(ms / 1000).toFixed(1)}s`

export default function RateLimitLab() {
  const [mode, setMode] = useState('bucket')
  const [capacity, setCapacity] = useState(10)
  const [rate, setRate] = useState(2)
  const [auto, setAuto] = useState(false)
  const [rps, setRps] = useState(4)
  const [codeTab, setCodeTab] = useState('python')

  /* token 數以 ref 為準（interval 與按鈕都直接改它），state 只是給畫面用的鏡像 */
  const tokRef = useRef(capacity)
  const [tokens, setTokens] = useState(capacity)
  const capRef = useRef(capacity); capRef.current = capacity
  const rateRef = useRef(rate); rateRef.current = rate
  const seq = useRef(1)
  const t0 = useRef(Date.now())
  const [log, setLog] = useState([])
  const [stats, setStats] = useState({ ok: 0, bad: 0 })
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    tokRef.current = Math.min(tokRef.current, capacity); setTokens(tokRef.current)
  }, [capacity])

  const visible = useLabVisible()   // 捲出畫面或切走分頁時，補 token 與自動送都暫停
  useEffect(() => {
    if (mode !== 'bucket' || !visible) return
    const id = setInterval(() => {
      tokRef.current = Math.min(capRef.current, tokRef.current + rateRef.current / 10)
      setTokens(tokRef.current)
    }, 100)
    return () => clearInterval(id)
  }, [mode, visible])

  const send = useCallback((k) => {
    const now = Date.now() - t0.current
    const entries = []
    for (let i = 0; i < k; i++) {
      const ok = tokRef.current >= 1
      if (ok) tokRef.current -= 1
      entries.push({ id: seq.current++, t: now, ok })
    }
    setTokens(tokRef.current)
    setLog((l) => [...entries.slice().reverse(), ...l].slice(0, 12))
    const good = entries.filter((e) => e.ok).length
    setStats((s) => ({ ok: s.ok + good, bad: s.bad + (k - good) }))
    setFlash({ id: entries[k - 1].id, ok: good, bad: k - good })
  }, [])

  useEffect(() => {
    if (!auto || mode !== 'bucket' || !visible) return
    const id = setInterval(() => send(1), 1000 / rps)
    return () => clearInterval(id)
  }, [auto, rps, mode, send, visible])

  const reset = () => { tokRef.current = capacity; setTokens(capacity); setLog([]); setStats({ ok: 0, bad: 0 }); setFlash(null); setAuto(false) }

  /* 固定視窗示範：tick 每 120ms 進一個請求，前 N 個塞在視窗 1 末尾、後 N 個塞在視窗 2 開頭 */
  const [burst, setBurst] = useState(false)
  const [tick, resetTick] = useTicker(burst && mode === 'window', 120)
  const shown = Math.min(tick, 2 * capacity)
  const startBurst = () => { resetTick(); setBurst(true) }

  const hlBucket = flash ? (flash.bad ? [13] : [11, 12]) : []
  const isBucket = mode === 'bucket'

  return (
    <Lab accent="magenta" className="rl-lab" kicker="ALGO LAB" title="Rate limiting：token bucket 怎麼擋住暴衝"
         blurb="桶子裡的 token 每秒慢慢補、每個請求拿走一個；桶空了就回 429。自己按幾下、開自動送，看拒絕什麼時候發生。切到固定視窗，看最簡單的作法為什麼會在邊界漏一倍。">
      <LabControls>
        <Seg label="演算法" tinted value={mode} onChange={setMode}
             options={[{ value: 'bucket', label: 'Token bucket' }, { value: 'window', label: '固定視窗（fixed window）' }]} />
        <Slider label={isBucket ? '桶容量 capacity' : '每視窗上限 N'} min={5} max={20} value={capacity} onChange={setCapacity} />
        {isBucket && <Slider label="補充速率" min={1} max={5} value={rate} onChange={setRate} format={(v) => `${v} token/s`} />}
        {isBucket && <Toggle label="自動送" checked={auto} onChange={setAuto} />}
        {isBucket && auto && <Slider label="每秒請求數" min={1} max={10} value={rps} onChange={setRps} format={(v) => `${v} req/s`} />}
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          {isBucket ? (
            <LabStage label="token bucket 動畫" caption={`長期平均最多 ${rate} req/s；閒置後最多一次放行 ${capacity} 個`}>
              <div className="rl-stage">
                <div>
                  <BucketSvg capacity={capacity} tokens={tokens} rate={rate} flash={flash} />
                  <div className="rl-actions">
                    <button type="button" className="btn ghost small" onClick={() => send(1)}>送 1 個請求</button>
                    <button type="button" className="btn ghost small" onClick={() => send(10)}>暴衝送 10 個</button>
                    <button type="button" className="btn ghost small" onClick={reset}>重置</button>
                  </div>
                </div>
                <div className="rl-log">
                  <div className="rl-stats">
                    <span><b>{stats.ok}</b> accepted</span>
                    <span><b className="bad">{stats.bad}</b> rejected</span>
                  </div>
                  <ul>
                    {log.length === 0 && <li className="muted">（還沒有請求）</li>}
                    {log.map((e) => (
                      <li key={e.id} className="rl-in">
                        <span className="t">{fmtT(e.t)}</span>
                        {e.ok ? <Status ok>200</Status> : <Status>429</Status>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </LabStage>
          ) : (
            <LabStage label="固定視窗時間軸" caption={`每 10 秒一格、每格上限 ${capacity}；邊界前後各塞滿 → 4 秒內 ${2 * capacity} 個全部通過`}>
              <WindowSvg limit={capacity} shown={shown} />
              <div className="rl-actions">
                <button type="button" className="btn ghost small" onClick={startBurst}>示範邊界暴衝</button>
                <button type="button" className="btn ghost small" onClick={() => { setBurst(false); resetTick() }}>清除</button>
              </div>
            </LabStage>
          )}

          {isBucket ? (
            <LabExplain title="Token bucket：容量管暴衝，速率管平均">
              <p>水龍頭每秒補 <code>rate</code> 個 token，桶子最多裝 <code>capacity</code> 個，滿了就溢出丟掉。每個請求進來拿走一個；<strong>桶空了就拒絕</strong>（HTTP 429 Too Many Requests）。</p>
              <p>所以它同時管兩件事：閒置很久之後最多也只能一口氣放行 capacity 個（暴衝有上限），而長期平均永遠不會超過 rate。試試把「每秒請求數」調到比補充速率高，過幾秒桶就見底，429 開始出現。</p>
              <p>實作不需要背景 timer：每次請求進來時用「距上次多久 × rate」一次補齊即可（右邊程式碼第 7–9 行）；多台 app 共用時把 tokens 與 last 存在 Redis，用 Lua script 讓讀改寫是原子的。</p>
            </LabExplain>
          ) : (
            <LabExplain title="Fixed window：最簡單，但邊界會漏一倍">
              <p>每個 key 一個計數器，每 10 秒歸零——Redis 一個 <code>INCR</code> 加一個 <code>EXPIRE</code> 就做完，因此非常常見。</p>
              <p>問題在邊界：視窗 1 的最後 2 秒塞滿 N 個，視窗 2 的最前 2 秒再塞滿 N 個，兩邊各自都「沒超過上限」，但實際上 <strong>4 秒內通過了 2N 個</strong>，是名義速率的好幾倍。</p>
              <p>修法：sliding window log（記每筆時間戳，準但吃記憶體）、sliding window counter（用前一視窗的加權近似），或直接用 token bucket。</p>
            </LabExplain>
          )}

          <LabExplain title="設計限流時要決定的四件事">
            <p><strong>為什麼限：</strong>擋濫用（暴力嘗試、爬蟲）、保公平（一個大戶不該拖垮所有人）、控成本（每個請求都是 CPU、DB、第三方 API 的錢）。</p>
            <p><strong>放在哪：</strong>最外層 nginx / API gateway 擋掉大部分（最省），應用層 middleware + Redis 做需要業務知識的限制（依 user、依方案），兩層可以並存。</p>
            <p><strong>回什麼：</strong>429，加 <code>Retry-After</code>（幾秒後再試）；平常的回應帶 <code>X-RateLimit-Limit</code> / <code>X-RateLimit-Remaining</code>，讓客戶端能自己減速。</p>
            <p><strong>用什麼當 key：</strong>登入後用 user id（NAT 後多人共用一個 IP 才不會誤傷）；未登入只能用 IP（在 proxy 後要讀 <code>X-Forwarded-For</code>，且只信任自家 proxy 填的值）。敏感端點兩者都限。</p>
          </LabExplain>
        </div>

        <div className="lab-stack">
          {isBucket ? (
            <>
              <Seg mono value={codeTab} onChange={setCodeTab} options={[{ value: 'python', label: 'python' }, { value: 'nginx', label: 'nginx' }]} />
              {codeTab === 'python'
                ? <Code lang="python" title="token bucket 核心" highlight={hlBucket}>{PY_BUCKET}</Code>
                : <Code lang="nginx" title="nginx limit_req" highlight={[2, 6]}>{NGINX}</Code>}
              {codeTab === 'nginx' && (
                <p className="rl-note">nginx 的 <code>limit_req</code> 文件稱為 leaky bucket；加上 <code>burst</code> + <code>nodelay</code> 後對呼叫端的效果和 token bucket 一樣：可瞬間放行 burst 個、長期平均 rate。</p>
              )}
            </>
          ) : (
            <Code lang="python" title="fixed window（Redis INCR + EXPIRE）" highlight={[4, 6]}>{PY_WINDOW}</Code>
          )}
          <Callout title="工作上什麼時候用">
            <b>登入、註冊、簡訊 / OTP 發送、密碼重設、昂貴的搜尋或匯出</b>——這些端點上線第一天就要限流，不然等到被刷簡訊帳單或撞庫時就太晚了。先用 nginx 一行擋 IP，再在應用層依 user 做第二層。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .rl-stage { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 16px; align-items: start; }
        @media (max-width: 560px) { .rl-stage { grid-template-columns: 1fr; } }
        .rl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; justify-content: center; }
        .rl-log ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
        .rl-log li { display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; }
        .rl-log li .t { font-family: var(--mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .rl-log .status { padding: 1px 8px; font-size: 0.7rem; }
        .rl-log li.rl-in { animation: rl-in 0.25s ease-out both; }
        .rl-log li.muted { color: var(--ink-3); font-size: 0.78rem; }
        @keyframes rl-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .rl-stats { display: flex; gap: 14px; font-size: 0.78rem; color: var(--ink-3); border-bottom: 1px solid var(--hairline); padding-bottom: 6px; }
        .rl-stats b { font-family: var(--mono); color: var(--good); font-size: 0.95rem; }
        .rl-stats b.bad { color: var(--critical); }
        .rl-note { font-size: 0.8rem; color: var(--ink-3); line-height: 1.6; }
        .rl-note code { font-family: var(--mono); font-size: 0.9em; }
        .rl-bucket { width: 100%; max-width: 360px; margin: 0 auto; }
        .rl-bucket .wall { fill: color-mix(in srgb, var(--ink-1) 4%, transparent); stroke: var(--ink-3); stroke-width: 2; stroke-linejoin: round; }
        .rl-bucket .tok { fill: var(--lab-accent); transition: opacity 0.15s ease; }
        .rl-bucket .pipe { fill: none; stroke: var(--ink-3); stroke-width: 3; stroke-linecap: round; }
        .rl-bucket .drip { fill: var(--lab-accent); animation: rl-drip linear infinite; }
        @keyframes rl-drip { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(46px); opacity: 0; } }
        .rl-bucket .flash-ok { fill: var(--good); font-family: var(--mono); font-size: 13px; font-weight: 700; }
        .rl-bucket .flash-bad { fill: var(--critical); font-family: var(--mono); font-size: 13px; font-weight: 700; }
        .rl-bucket .req { stroke: var(--ink-3); stroke-width: 1.5; fill: none; }
        .rl-win { width: 100%; }
        .rl-win .box { fill: var(--surface-1); stroke: var(--hairline); }
        .rl-win .box.full { stroke: var(--serious); }
        .rl-win .dot { fill: var(--lab-accent); }
        .rl-win .cnt { font-family: var(--mono); font-size: 11px; fill: var(--ink-1); }
        .rl-win .brace { stroke: var(--critical); stroke-width: 1.5; fill: none; }
        .rl-win .warn { fill: var(--critical); font-family: var(--sans); font-size: 11.5px; font-weight: 600; }
        @media (prefers-reduced-motion: reduce) { .rl-bucket .drip, .rl-log li.rl-in { animation: none; } }
      `}</style>
    </Lab>
  )
}

/* 桶子：token 排成 5 欄，從底部往上疊；最上面那顆的透明度 = 補到一半的小數 */
function BucketSvg({ capacity, tokens, rate, flash }) {
  const COLS = 5, CELL = 34, R = 11
  const full = Math.floor(tokens), frac = tokens - full
  const originX = 180 - (COLS * CELL) / 2 + CELL / 2, baseY = 216
  const pos = (i) => ({ cx: originX + (i % COLS) * CELL, cy: baseY - Math.floor(i / COLS) * CELL })
  return (
    <svg className="rl-bucket" viewBox="0 0 360 250" role="img" aria-label={`桶內 ${tokens.toFixed(1)} / ${capacity} 個 token`}>
      <path className="pipe" d="M180 6 v18" />
      <circle className="drip" cx="180" cy="26" r="5" style={{ animationDuration: `${(1 / rate).toFixed(2)}s` }} />
      <text x="192" y="18" className="svg-text small">+{rate} / s</text>
      <path className="wall" d="M78 66 L282 66 L266 236 L94 236 Z" />
      {Array.from({ length: capacity }, (_, i) => {
        const p = pos(i)
        const on = i < full
        const half = i === full && frac > 0.05
        return (on || half) ? <circle key={i} className="tok" {...p} r={R} style={{ opacity: on ? 1 : frac }} /> : (
          <circle key={i} {...p} r={R} fill="none" stroke="var(--hairline)" strokeDasharray="2 3" />
        )
      })}
      <text x="180" y="248" textAnchor="middle" className="svg-mono">{tokens.toFixed(1)} / {capacity} tokens</text>
      {/* 請求進來的方向與結果 */}
      <path className="req" d="M330 150 h-40" markerEnd="none" />
      <path className="req" d="M298 144 l-8 6 l8 6" />
      <text x="334" y="139" className="svg-text small">請求</text>
      {flash && (
        <g key={flash.id} className="svg-pop">
          {flash.ok > 0 && <text x="326" y="176" textAnchor="middle" className="flash-ok">{flash.ok > 1 ? `${flash.ok}× ` : ''}200</text>}
          {flash.bad > 0 && <text x="326" y={flash.ok > 0 ? 194 : 176} textAnchor="middle" className="flash-bad">{flash.bad > 1 ? `${flash.bad}× ` : ''}429</text>}
        </g>
      )}
    </svg>
  )
}

/* 固定視窗時間軸：3 格 × 10 秒；示範請求塞在 8–10s 與 10–12s */
function WindowSvg({ limit, shown }) {
  const X0 = 30, XW = 580, SEC = XW / 30, TOP = 40, BOT = 130
  const x = (t) => X0 + t * SEC
  const inW1 = Math.min(shown, limit), inW2 = Math.max(0, shown - limit)
  const dots = []
  const place = (count, t0, key) => {
    for (let i = 0; i < count; i++) {
      const col = i % 5, row = Math.floor(i / 5)
      dots.push({ key: `${key}-${i}`, cx: x(t0) + 4 + col * 7.5, cy: BOT - 6 - row * 8 })
    }
  }
  place(inW1, 8, 'a'); place(inW2, 10, 'b')
  const done = shown >= 2 * limit
  return (
    <svg className="rl-win" viewBox="0 0 640 165" role="img" aria-label={`固定視窗示範，已送出 ${shown} 個請求`}>
      {[0, 1, 2].map((w) => {
        const cnt = w === 0 ? inW1 : w === 1 ? inW2 : 0
        return (
          <g key={w}>
            <rect x={x(w * 10)} y={TOP} width={SEC * 10} height={BOT - TOP} className={`box${cnt >= limit ? ' full' : ''}`} />
            <text x={x(w * 10) + 8} y={TOP + 16} className="svg-text small">視窗 {w + 1}（{w * 10}–{w * 10 + 10}s）</text>
            <text x={x(w * 10 + 10) - 8} y={TOP + 16} textAnchor="end" className="cnt">{cnt} / {limit}</text>
          </g>
        )
      })}
      {[0, 10, 20, 30].map((t) => (
        <text key={t} x={x(t)} y={BOT + 16} textAnchor="middle" className="svg-mono">{t}s</text>
      ))}
      {dots.map((d) => <circle key={d.key} className="dot svg-pop" cx={d.cx} cy={d.cy} r="3" />)}
      {shown > 0 && (
        <g>
          <path className="brace" d={`M${x(8)} ${TOP - 8} v-6 h${SEC * 4} v6`} />
          <text x={x(10)} y={TOP - 20} textAnchor="middle" className="warn">
            {done ? `這 4 秒通過了 ${2 * limit} 個（名義上限每 10 秒 ${limit} 個）` : `8s → 12s：已通過 ${shown} 個…`}
          </text>
        </g>
      )}
      {shown === 0 && <text x="320" y={TOP - 18} textAnchor="middle" className="svg-text small">按「示範邊界暴衝」：兩個視窗各塞滿 {limit} 個，沒有任何一個被擋</text>}
    </svg>
  )
}
