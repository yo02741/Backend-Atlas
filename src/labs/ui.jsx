import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

/* ============================================================
   互動實驗室共用元件
   - 全部無外部依賴；顏色只透過 CSS token；動畫尊重 prefers-reduced-motion。
   - 每個 lab 的骨架：
       <Lab accent="violet" kicker="SQL LAB" title="…" blurb="…">
         <LabControls>…</LabControls>
         <LabGrid>
           <LabStage>…svg / 表格…</LabStage>
           <LabExplain title="…">…</LabExplain>
         </LabGrid>
       </Lab>
   ============================================================ */

const ACCENTS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red']

export function Lab({ accent = 'blue', kicker, title, blurb, aside, children, className = '' }) {
  const color = ACCENTS.includes(accent) ? `var(--c-${accent})` : accent
  return (
    <section className={`lab ${className}`} style={{ '--lab-accent': color }}>
      <header className="lab-head">
        <div>
          {kicker && <p className="lab-kicker">{kicker}</p>}
          {title && <h3 className="lab-title">{title}</h3>}
          {blurb && <p className="lab-blurb">{blurb}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function LabControls({ children }) {
  return <div className="lab-controls">{children}</div>
}

export function LabStage({ children, caption, plain = false, label, style }) {
  return (
    <div>
      <div className={`lab-stage${plain ? ' plain' : ''}`} aria-label={label} style={style}>{children}</div>
      {caption && <p className="lab-caption">{caption}</p>}
    </div>
  )
}

export function LabExplain({ title, children }) {
  return (
    <div className="lab-explain">
      {title && <h4>{title}</h4>}
      {children}
    </div>
  )
}

export function LabGrid({ children, variant = '' }) {
  return <div className={`lab-grid ${variant}`}>{children}</div>
}

/* 分段選擇（單選）：options = [{ value, label }] */
export function Seg({ label, options, value, onChange, tinted = false, mono = false }) {
  const id = useId()
  return (
    <div className="seg" role="radiogroup" aria-labelledby={label ? id : undefined}>
      {label && <span className="seg-label" id={id}>{label}</span>}
      <div className={`seg-group${tinted ? ' tinted' : ''}${mono ? ' mono' : ''}`}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio"
                  aria-checked={o.value === value}
                  title={o.title}
                  onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}

export function Slider({ label, min, max, step = 1, value, onChange, format }) {
  const id = useId()
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

/* 步進器：step 從 0 到 total-1；配合 usePlayer 使用 */
export function Stepper({ step, total, onStep, playing, onPlay, labels }) {
  const atEnd = step >= total - 1
  return (
    <div className="stepper" role="group" aria-label="步驟控制">
      <button type="button" onClick={() => onStep(0)} disabled={step === 0} title="重來" aria-label="重來">↺</button>
      <button type="button" onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0} aria-label="上一步">←</button>
      {onPlay && (
        <button type="button" className="primary" onClick={onPlay} aria-label={playing ? '暫停' : '自動播放'}>
          {playing ? '❚❚' : (atEnd ? '↺ 再播' : '▶ 播放')}
        </button>
      )}
      <button type="button" onClick={() => onStep(Math.min(total - 1, step + 1))} disabled={atEnd} aria-label="下一步">→</button>
      <span className="step-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i === step ? 'on' : i < step ? 'past' : ''} />
        ))}
      </span>
      <span className="count">{step + 1} / {total}</span>
      {labels?.[step] && <span className="seg-label">{labels[step]}</span>}
    </div>
  )
}

/* 自動播放：回傳 { step, setStep, playing, toggle } */
export function usePlayer(total, interval = 1400) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!playing) return
    if (step >= total - 1) { setPlaying(false); return }
    const t = setTimeout(() => setStep((s) => Math.min(total - 1, s + 1)), reduced ? 600 : interval)
    return () => clearTimeout(t)
  }, [playing, step, total, interval, reduced])
  const toggle = useCallback(() => {
    if (step >= total - 1 && !playing) { setStep(0); setPlaying(true); return }
    setPlaying((p) => !p)
  }, [step, total, playing])
  const go = useCallback((s) => { setPlaying(false); setStep(s) }, [])
  return { step, setStep: go, playing, toggle }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/* ---- 程式碼區塊：極簡 tokenizer（keyword / 字串 / 數字 / 註解） ---- */
const KW = {
  sql: /\b(SELECT|FROM|WHERE|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|JOIN|ON|AND|OR|NOT|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|REFERENCES|BEGIN|COMMIT|ROLLBACK|EXPLAIN|ANALYZE|UNIQUE|COUNT|SUM|AVG|DISTINCT|CASE|WHEN|THEN|ELSE|END|WITH|USING|TRANSACTION|ISOLATION|LEVEL|READ|COMMITTED|REPEATABLE|SERIALIZABLE|FOR|EXISTS|IN|LIKE|BETWEEN|TRUE|FALSE|RETURNING)\b/gi,
  python: /\b(def|return|if|elif|else|for|while|in|not|and|or|import|from|as|class|async|await|with|try|except|finally|raise|lambda|None|True|False|yield|pass|global|is|del)\b/g,
  yaml: /^(\s*[\w.-]+)(?=:)/gm,
  bash: /\b(docker|compose|uv|pip|git|curl|npm|run|build|up|down|exec|ps|logs|add|sync|init|push|pull|FROM|RUN|COPY|WORKDIR|CMD|ENV|EXPOSE|ENTRYPOINT|ARG)\b/g,
  nginx: /\b(server|location|listen|server_name|proxy_pass|upstream|root|index|proxy_set_header|return|ssl_certificate|ssl_certificate_key|add_header|limit_req|limit_req_zone|try_files|http|events|worker_processes)\b/g,
  js: /\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|new|class|this|null|undefined|true|false|throw|try|catch)\b/g,
  http: /^(GET|POST|PUT|PATCH|DELETE|HTTP\/[\d.]+)\b|^[A-Za-z-]+(?=:)/gm,
  json: /"[^"]*"(?=\s*:)/g,
}
const STR = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
const NUM = /\b\d+(?:\.\d+)?\b/g
const CM = { sql: /--.*$/gm, python: /#.*$/gm, yaml: /#.*$/gm, bash: /#.*$/gm, nginx: /#.*$/gm, js: /\/\/.*$/gm, http: null, json: null }

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

/* 回傳每行的 HTML 字串。先切出註解/字串再標 keyword，避免字串內被誤標。 */
export function highlightLine(line, lang) {
  const kw = KW[lang]
  const cm = CM[lang]
  const parts = []
  let rest = line
  // 註解優先（整行尾）
  let comment = ''
  if (cm) {
    const m = cm.exec(rest); cm.lastIndex = 0
    if (m && !insideString(rest, m.index)) { comment = rest.slice(m.index); rest = rest.slice(0, m.index) }
  }
  // 字串
  let last = 0
  rest.replace(STR, (s, _g, idx) => {
    parts.push(plain(rest.slice(last, idx), kw, lang))
    parts.push(`<span class="tk-str">${esc(s)}</span>`)
    last = idx + s.length
    return s
  })
  parts.push(plain(rest.slice(last), kw, lang))
  if (comment) parts.push(`<span class="tk-cm">${esc(comment)}</span>`)
  return parts.join('') || ' '
}
function insideString(s, idx) {
  const before = s.slice(0, idx)
  return ((before.match(/"/g) || []).length % 2 === 1) || ((before.match(/'/g) || []).length % 2 === 1)
}
function plain(s, kw, lang) {
  if (!s) return ''
  let out = esc(s)
  if (kw) {
    const cls = lang === 'yaml' || lang === 'json' || (lang === 'http' && !/^(GET|POST|PUT|PATCH|DELETE|HTTP)/.test(s)) ? 'tk-key' : 'tk-kw'
    out = out.replace(kw, (m) => `<span class="${cls}">${m}</span>`)
  }
  out = out.replace(NUM, (m) => `<span class="tk-num">${m}</span>`)
  return out
}

/* highlight: 要強調的行號（1-based）陣列；dim: 其他行是否變淡 */
export function Code({ lang = 'sql', title, children, highlight = [], dim = false, marks = [] }) {
  const src = typeof children === 'string' ? children : String(children ?? '')
  const lines = useMemo(() => src.replace(/^\n/, '').replace(/\n$/, '').split('\n'), [src])
  const hl = new Set(highlight)
  return (
    <div className="code">
      {(title || lang) && (
        <div className="code-head"><span>{title || lang}</span><span>{lang}</span></div>
      )}
      <pre>
        {lines.map((line, i) => {
          const n = i + 1
          let html = highlightLine(line, lang)
          for (const m of marks) {
            if (m.line === n && m.text) {
              html = html.replace(esc(m.text), `<mark class="${m.ok ? 'ok' : ''}">${esc(m.text)}</mark>`)
            }
          }
          return (
            <span key={n} data-n={n}
                  className={`ln${hl.has(n) ? ' hl' : ''}${dim && hl.size && !hl.has(n) ? ' dim' : ''}`}
                  dangerouslySetInnerHTML={{ __html: html }} />
          )
        })}
      </pre>
    </div>
  )
}

export function Callout({ tone = '', title, children }) {
  return (
    <div className={`callout ${tone}`}>
      {title && <span className="callout-title">{title}</span>}
      {children}
    </div>
  )
}

export function Status({ ok, warn, children }) {
  const cls = ok ? 'ok' : warn ? 'warn' : 'bad'
  const icon = ok ? '✓' : warn ? '!' : '✕'
  return <span className={`status ${cls}`}><span aria-hidden="true">{icon}</span>{children}</span>
}

/* 量測容器寬度（讓 SVG 依可用寬度排版） */
export function useWidth(ref, fallback = 600) {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/* 簡易 tick 動畫：每 interval 毫秒 +1，用於連續流動的動畫 */
export function useTicker(running, interval = 1000) {
  const [tick, setTick] = useState(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick((t) => t + 1), reduced ? interval * 2 : interval)
    return () => clearInterval(id)
  }, [running, interval, reduced])
  return [tick, () => setTick(0)]
}

export function useLatest(value) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/* ============================================================
   情境 lab 共用元件：統計磚、流向列、折線圖、說明列、數字格式。
   目的：18 個情境模擬器不再各自實作同一批小元件；樣式在 lab.css 的「情境 lab 共用」段。
   ============================================================ */

/* 統計數字磚格：<Stats min={130}><Stat label="賣出 / 庫存" value="1000 / 100" tone="bad" note="> 上限 100" /></Stats>
   tone: '' | 'bad'（critical）| 'warn'（serious）| 'ok'（good）。value 可以是任何 node。 */
export function Stats({ children, min = 120, className = '' }) {
  return <div className={`lab-stats${className ? ' ' + className : ''}`} style={{ '--min': `${min}px` }}>{children}</div>
}
export function Stat({ label, value, unit, note, tone = '' }) {
  return (
    <div className={`lab-stat${tone ? ' ' + tone : ''}`}>
      <span className="l">{label}</span>
      <b className="v">{value}{unit && <small> {unit}</small>}</b>
      {note && <span className="n">{note}</span>}
    </div>
  )
}

/* 流向列：一排節點加箭頭（HTML flex，手機自動換行）。
   steps: [{ label, value, hot, bad }]；back：往回走的那條（逾時 / 503 …），notes：底下的小字說明 */
export function Flow({ title, steps, back, notes = [], ariaLabel }) {
  return (
    <div className="lab-flow" aria-label={ariaLabel || title}>
      {title && <div className="lab-flow-title">{title}</div>}
      <div className="lab-flow-row">
        {steps.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="lab-flow-arrow" aria-hidden="true">→</span>}
            <div className={`lab-flow-box${b.hot ? ' hot' : ''}${b.bad ? ' bad' : ''}`}>
              <div className="l">{b.label}</div>
              {b.value !== undefined && <div className="s">{b.value}</div>}
            </div>
          </React.Fragment>
        ))}
      </div>
      {back && <div className="lab-flow-back">↩ {back}</div>}
      {notes.filter(Boolean).map((n, i) => <div key={i} className="lab-flow-note">{n}</div>)}
    </div>
  )
}

/* 單一 y 軸折線圖：線 2px、hairline 格線。
   series: [{ key, label, color: 'var(--c-blue)', values: [...] }]；x 軸是 0..xMax 的索引，畫到 upto 為止（動畫用）；
   thresholds: [{ v, label }] 畫虛線；mark 畫一條直立標線；onScrub(x|null) 游標移過去回報位置。 */
export function LineChart({ title, series, xMax, yMax, upto = xMax, xTicks, fmtY = (v) => v, fmtX = (v) => `${v}`, thresholds = [], mark = null, onScrub, width = 320, height = 128, left = 38, ariaLabel }) {
  const W = width, H = height, L = left, R = 8, T = 10, B = 18
  const x = (i) => L + (i / xMax) * (W - L - R)
  const y = (v) => T + (1 - Math.min(v, yMax) / yMax) * (H - T - B)
  const path = (vals) => vals.slice(0, upto + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const ticks = xTicks || [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(xMax * f))
  const onMove = onScrub ? (e) => {
    const b = e.currentTarget.getBoundingClientRect()
    const xv = ((e.clientX - b.left) / b.width) * W
    onScrub(Math.max(0, Math.min(xMax, Math.round(((xv - L) / (W - L - R)) * xMax))))
  } : undefined
  return (
    <div className="lab-chart">
      {(title || series.length > 1) && (
        <div className="lab-chart-head">
          <span>{title}</span>
          {series.length > 1 && <span className="lab-legend">{series.map((s) => <i key={s.key} style={{ '--c': s.color }}>{s.label}</i>)}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel || title} onPointerMove={onMove} onPointerLeave={onScrub ? () => onScrub(null) : undefined} className={onScrub ? 'scrub' : ''}>
        {mark !== null && <line x1={x(mark)} x2={x(mark)} y1={T} y2={H - B} className="mark" />}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(yMax * f)} y2={y(yMax * f)} className="grid" />
            <text x={L - 4} y={y(yMax * f) + 3.5} textAnchor="end" className="svg-text small">{fmtY(yMax * f)}</text>
          </g>
        ))}
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 4} textAnchor="middle" className="svg-text small">{fmtX(i)}</text>)}
        {thresholds.filter((th) => th.v <= yMax).map((th) => (
          <g key={th.label}>
            <line x1={L} x2={W - R} y1={y(th.v)} y2={y(th.v)} className="thr" />
            <text x={W - R} y={y(th.v) - 3} textAnchor="end" className="svg-text small">{th.label}</text>
          </g>
        ))}
        {series.map((s) => <path key={s.key} d={path(s.values)} className="line" style={{ stroke: s.color }} />)}
        {upto < xMax && <line x1={x(upto)} x2={x(upto)} y1={T} y2={H - B} className="head" />}
      </svg>
    </div>
  )
}

/* 圖下方的一行說明（示意數字的註記放這裡） */
export function Caption({ children }) {
  return <p className="lab-caption">{children}</p>
}

/* 數字格式：千分位、k 縮寫、毫秒 */
export const fmtN = (n) => Number(n).toLocaleString('en-US')
export const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(n))
export const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`)
