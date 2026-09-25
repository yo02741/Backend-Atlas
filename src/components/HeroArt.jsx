import React from 'react'

/* 首頁主視覺：一個「看得見」的後端系統——客戶端 → nginx → API → DB / Redis，
   請求沿線流動。純 SVG、色彩全走 token，reduced-motion 時停止流動。 */
export default function HeroArt() {
  return (
    <svg className="hero-svg" viewBox="0 0 520 360" role="img" aria-label="後端系統示意：客戶端經 nginx 到 API，再到資料庫與快取">
      <defs>
        <marker id="ha-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)" />
        </marker>
      </defs>
      {/* 連線 */}
      <g className="ha-edges" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" markerEnd="url(#ha-arrow)">
        <path d="M96 180 H150" />
        <path d="M230 180 H286" />
        <path d="M366 168 C400 168 400 92 430 92" />
        <path d="M366 192 C400 192 400 268 430 268" />
      </g>
      {/* 流動的請求 */}
      <g className="ha-flow" fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 10">
        <path d="M96 180 H150" stroke="var(--c-aqua)" />
        <path d="M230 180 H286" stroke="var(--c-aqua)" />
        <path d="M366 168 C400 168 400 92 430 92" stroke="var(--c-violet)" />
        <path d="M366 192 C400 192 400 268 430 268" stroke="var(--c-violet)" />
      </g>
      {/* 節點 */}
      <Node x={20} y={150} w={76} h={60} label="瀏覽器" sub="fetch()" color="var(--c-blue)" />
      <Node x={150} y={150} w={80} h={60} label="nginx" sub=":443 · TLS" color="var(--c-yellow)" />
      <Node x={286} y={150} w={80} h={60} label="API" sub="FastAPI" color="var(--c-aqua)" />
      <Cyl x={430} y={62} label="PostgreSQL" color="var(--c-violet)" />
      <Node x={430} y={238} w={76} h={60} label="Redis" sub="cache" color="var(--c-red)" />
      {/* JWT 小標籤 */}
      <g transform="translate(232 108)">
        <rect width="118" height="22" rx="11" fill="var(--surface-1)" stroke="var(--hairline)" />
        <rect x="8" y="8" width="28" height="6" rx="3" fill="var(--c-red)" />
        <rect x="40" y="8" width="42" height="6" rx="3" fill="var(--c-violet)" />
        <rect x="86" y="8" width="24" height="6" rx="3" fill="var(--c-aqua)" />
      </g>
      <text x="291" y="100" fontSize="10" fill="var(--ink-3)" fontFamily="var(--mono)" textAnchor="middle">Authorization: Bearer</text>
      {/* 底部 SQL */}
      <g transform="translate(150 260)">
        <rect width="216" height="58" rx="4" fill="var(--surface-1)" stroke="var(--hairline)" />
        <text x="12" y="22" fontSize="11" fontFamily="var(--mono)" fill="var(--ink-2)">SELECT u.name, o.item</text>
        <text x="12" y="38" fontSize="11" fontFamily="var(--mono)" fill="var(--ink-2)">FROM users u</text>
        <text x="12" y="52" fontSize="11" fontFamily="var(--mono)" fill="var(--c-violet)" fontWeight="700">LEFT JOIN orders o ON …</text>
      </g>
      <style>{`
        .ha-flow path { animation: ha-dash 1.6s linear infinite; }
        @keyframes ha-dash { to { stroke-dashoffset: -32; } }
        @media (prefers-reduced-motion: reduce) { .ha-flow path { animation: none; } }
      `}</style>
    </svg>
  )
}

function Node({ x, y, w, h, label, sub, color }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="6" fill="var(--surface-1)" stroke="var(--hairline)" />
      <rect width={w} height="4" rx="2" fill={color} />
      <text x={w / 2} y="30" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--ink-1)" fontFamily="var(--sans)">{label}</text>
      {sub && <text x={w / 2} y="47" textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--mono)">{sub}</text>}
    </g>
  )
}

function Cyl({ x, y, label, color }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 10 v40 a38 10 0 0 0 76 0 v-40" fill="var(--surface-1)" stroke="var(--hairline)" />
      <ellipse cx="38" cy="10" rx="38" ry="10" fill="var(--surface-1)" stroke={color} strokeWidth="2" />
      <text x="38" y="42" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink-1)" fontFamily="var(--sans)">{label}</text>
    </g>
  )
}
