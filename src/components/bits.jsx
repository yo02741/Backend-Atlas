import React, { Suspense } from 'react'
import { LEVELS } from '../content/roadmap.js'
import { loadLab, LAB_META } from '../labs/index.js'
import { loadScenarioLab } from '../labs/scenarios/index.js'

export function Level({ level }) {
  return (
    <span className="pill" title={`難度：${LEVELS[level]}`}>
      <span className="level-dots" aria-hidden="true">
        {[1, 2, 3].map((i) => <i key={i} className={i <= level ? 'on' : ''} />)}
      </span>
      {LEVELS[level]}
    </span>
  )
}

export function DomainPill({ domain }) {
  return (
    <a href={`#/domain/${domain.id}`} className="pill tint" style={{ '--tint': `var(--c-${domain.color})` }}>
      {domain.title}
    </a>
  )
}

export function ProgressRing({ value, total, color }) {
  const r = 12, c = 2 * Math.PI * r
  const pct = total ? value / total : 0
  return (
    <svg className="progress-ring" viewBox="0 0 30 30" role="img" aria-label={`完成 ${value} / ${total}`}
         style={{ '--tint': color }}>
      <circle className="track" cx="15" cy="15" r={r} />
      <circle className="bar" cx="15" cy="15" r={r}
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
              transform="rotate(-90 15 15)" />
    </svg>
  )
}

/* 嵌入實驗室：懶載入 chunk，失敗時顯示訊息而非整頁炸掉 */
export function LabEmbed({ name, scenario = false }) {
  const Comp = scenario ? loadScenarioLab(name) : loadLab(name)
  if (!Comp) return <p className="status-msg">實驗室 {name} 尚未上線。</p>
  return (
    <ErrorBoundary name={name}>
      <Suspense fallback={<div className="lab" style={{ minHeight: 240 }}><p className="status-msg">載入實驗室…</p></div>}>
        <Comp />
      </Suspense>
    </ErrorBoundary>
  )
}

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (this.state.err) {
      return <div className="lab"><p className="status-msg">實驗室 {this.props.name} 載入失敗：{String(this.state.err.message || this.state.err)}</p></div>
    }
    return this.props.children
  }
}

/* 實驗室卡片的小圖示：每個 lab 一個極簡 SVG 草圖 */
export function LabIcon({ name, color }) {
  const s = { stroke: color, fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const f = { fill: color, stroke: 'none' }
  const fl = { fill: color, opacity: 0.25, stroke: 'none' }
  let body
  switch (name) {
    case 'SqlJoinLab': body = <><circle cx="40" cy="30" r="18" {...s} /><circle cx="60" cy="30" r="18" {...s} /><path d="M50 14.5a18 18 0 0 1 0 31a18 18 0 0 1 0-31z" {...fl} /></>; break
    case 'IndexLab': body = <><rect x="40" y="8" width="20" height="10" rx="2" {...s} /><rect x="16" y="28" width="20" height="10" rx="2" {...s} /><rect x="64" y="28" width="20" height="10" rx="2" {...s} /><path d="M45 18 26 28M55 18 74 28" {...s} /><rect x="6" y="46" width="14" height="8" rx="2" {...s} /><rect x="30" y="46" width="14" height="8" rx="2" {...fl} /><rect x="56" y="46" width="14" height="8" rx="2" {...s} /><rect x="78" y="46" width="14" height="8" rx="2" {...s} /></>; break
    case 'DocVsRelLab': body = <><rect x="10" y="12" width="34" height="36" rx="2" {...s} /><path d="M10 22h34M10 32h34M10 42h34M22 12v36" {...s} /><path d="M62 12c-4 0-6 2-6 6v6c0 3-2 5-4 6 2 1 4 3 4 6v6c0 4 2 6 6 6M80 12c4 0 6 2 6 6v6c0 3 2 5 4 6-2 1-4 3-4 6v6c0 4-2 6-6 6" {...s} /></>; break
    case 'CacheLab': body = <><rect x="6" y="20" width="22" height="20" rx="2" {...s} /><rect x="39" y="20" width="22" height="20" rx="2" {...fl} /><rect x="39" y="20" width="22" height="20" rx="2" {...s} /><rect x="72" y="20" width="22" height="20" rx="2" {...s} /><path d="M28 30h11M61 30h11" {...s} /></>; break
    case 'JwtLab': body = <><rect x="6" y="24" width="26" height="12" rx="2" {...f} /><rect x="36" y="24" width="34" height="12" rx="2" {...fl} /><rect x="36" y="24" width="34" height="12" rx="2" {...s} /><rect x="74" y="24" width="20" height="12" rx="2" {...s} /></>; break
    case 'OAuthLab': body = <><path d="M20 8v44M50 8v44M80 8v44" {...s} opacity="0.5" /><path d="M20 18h28M50 30h28M80 42H22" {...s} /><path d="M46 15l4 3-4 3M76 27l4 3-4 3M25 39l-4 3 4 3" {...s} /></>; break
    case 'AccessControlLab': body = <>{[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={26 + c * 18} y={8 + r * 16} width="14" height="12" rx="2" {...((r + c) % 2 ? fl : s)} />))}</>; break
    case 'SqlInjectionLab': body = <><rect x="10" y="18" width="80" height="24" rx="3" {...s} /><text x="22" y="36" fontSize="18" fontFamily="monospace" fill={color}>' OR 1=1</text></>; break
    case 'HashingLab': body = <><text x="8" y="36" fontSize="14" fontFamily="monospace" fill={color}>abc</text><path d="M38 30h14M48 26l4 4-4 4" {...s} /><text x="58" y="36" fontSize="14" fontFamily="monospace" fill={color} opacity="0.7">#9f2a</text></>; break
    case 'HttpLab': body = <><path d="M18 8v44M82 8v44" {...s} opacity="0.5" /><path d="M18 18h64M82 30H18M18 42h64" {...s} /><path d="M78 15l4 3-4 3M22 27l-4 3 4 3M78 39l4 3-4 3" {...s} /></>; break
    case 'DockerLab': body = <><rect x="20" y="44" width="60" height="9" rx="2" {...f} /><rect x="24" y="33" width="52" height="9" rx="2" {...fl} /><rect x="24" y="33" width="52" height="9" rx="2" {...s} /><rect x="30" y="22" width="40" height="9" rx="2" {...s} /><rect x="36" y="11" width="28" height="9" rx="2" {...s} /></>; break
    case 'ComposeLab': body = <><circle cx="50" cy="14" r="7" {...s} /><circle cx="24" cy="46" r="7" {...s} /><circle cx="50" cy="46" r="7" {...fl} /><circle cx="50" cy="46" r="7" {...s} /><circle cx="76" cy="46" r="7" {...s} /><path d="M46 20 28 40M50 21v18M54 20l18 20" {...s} /></>; break
    case 'NginxLab': body = <><rect x="8" y="24" width="20" height="12" rx="2" {...s} /><rect x="40" y="24" width="18" height="12" rx="2" {...f} /><rect x="74" y="8" width="18" height="10" rx="2" {...s} /><rect x="74" y="25" width="18" height="10" rx="2" {...s} /><rect x="74" y="42" width="18" height="10" rx="2" {...s} /><path d="M28 30h12M58 30l16-17M58 30h16M58 30l16 17" {...s} /></>; break
    case 'PipelineLab': body = <>{[12, 31, 50, 69, 88].map((x, i) => <circle key={x} cx={x} cy="30" r="6" {...(i < 3 ? f : s)} />)}<path d="M18 30h7M37 30h7M56 30h7M75 30h7" {...s} /></>; break
    case 'BigOLab': body = <><path d="M8 52h84M8 52V8" {...s} opacity="0.4" /><path d="M8 50Q50 48 92 46" {...s} /><path d="M8 50Q50 40 92 24" {...s} opacity="0.7" /><path d="M8 50C40 48 60 30 70 8" {...s} /></>; break
    case 'RateLimitLab': body = <><path d="M28 12h44l-6 40H34z" {...s} /><circle cx="42" cy="44" r="3" {...f} /><circle cx="52" cy="44" r="3" {...f} /><circle cx="62" cy="44" r="3" {...f} /><circle cx="47" cy="36" r="3" {...f} /><circle cx="57" cy="36" r="3" {...f} /><path d="M50 2v6M46 5l4 4 4-4" {...s} /></>; break
    case 'AsyncLab': body = <><rect x="8" y="10" width="36" height="8" rx="2" {...f} /><rect x="44" y="10" width="40" height="8" rx="2" {...fl} /><rect x="8" y="26" width="20" height="8" rx="2" {...f} /><rect x="28" y="26" width="44" height="8" rx="2" {...fl} /><rect x="8" y="42" width="28" height="8" rx="2" {...f} /><rect x="36" y="42" width="54" height="8" rx="2" {...fl} /></>; break
    case 'RestLab': body = <><rect x="34" y="6" width="32" height="12" rx="2" {...f} /><rect x="10" y="30" width="34" height="12" rx="2" {...s} /><rect x="56" y="30" width="34" height="12" rx="2" {...s} /><rect x="56" y="48" width="34" height="10" rx="2" {...s} /><path d="M46 18 30 30M54 18l16 12M73 42v6" {...s} /></>; break
    case 'UvLab': body = <><path d="M12 12h22l6 6h48v34H12z" {...s} /><path d="M24 30h14M24 40h28" {...s} /><rect x="70" y="30" width="16" height="12" rx="2" {...fl} /></>; break
    default: body = <circle cx="50" cy="30" r="14" {...s} />
  }
  return <svg viewBox="0 0 100 60" aria-hidden="true">{body}</svg>
}

export function labTitle(name) { return LAB_META[name]?.title || name }
