import React, { useId, useRef } from 'react'
import { useWidth } from '../labs/ui.jsx'

/* 學習路線的地鐵圖：站點蛇形排列，線段顏色跟隨起點站的領域色，
   完成的站填滿色、未完成空心。窄螢幕自動改成每列較少站。
   換列的彎道會經過列尾站的站名，所以用遮罩在每個站名底下把線挖掉（不靠底色描邊，漸層背景也適用）。 */
export default function MetroMap({ stations, isDone, label = '學習路線' }) {
  const ref = useRef(null)
  const maskId = `metro-gap-${useId().replace(/:/g, '')}`
  const width = useWidth(ref, 1000)
  const cols = width < 480 ? 2 : width < 760 ? 3 : width < 1000 ? 4 : 6
  const rows = Math.ceil(stations.length / cols)
  const cellW = 100 / cols
  const W = Math.max(width, 320)
  const rowH = 128
  const H = rows * rowH + 20

  const pts = stations.map((_, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const cc = r % 2 === 0 ? c : cols - 1 - c // 蛇形：奇數列反向
    return { x: (cc + 0.5) * cellW * (W / 100), y: r * rowH + 40, r, c: cc }
  })

  // 相鄰站連線：同列直線、換列走一個 U 形彎
  const segs = pts.slice(1).map((p, i) => {
    const a = pts[i]
    if (a.r === p.r) return { d: `M${a.x},${a.y} L${p.x},${p.y}`, i }
    const bend = 34
    const dir = a.r % 2 === 0 ? 1 : -1 // 往右的列從右端轉下去
    const ex = a.x + dir * bend
    return { d: `M${a.x},${a.y} C${ex},${a.y} ${ex},${p.y} ${p.x},${p.y}`, i }
  })

  // 每站的文字（站名一到兩行 + 領域名）與它佔的範圍，範圍給遮罩挖洞用
  const cellPx = cellW * (W / 100)
  const labels = stations.map((st, i) => {
    const p = pts[i]
    const lines = wrap(st.label || st.title, cellPx)
    const subY = p.y + 32 + lines.length * 16
    const w = Math.max(...lines.map((l) => textWidth(l) * 13.5), textWidth(st.domain.title) * 11.5) + 12
    return { lines, subY, gap: { x: p.x - w / 2, y: p.y + 18, w, h: subY - p.y - 18 + 6 } }
  })

  return (
    <div className="metro" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="list" aria-label={label}>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-60" y="-20" width={W + 120} height={H + 40}>
            <rect x="-60" y="-20" width={W + 120} height={H + 40} fill="#fff" />
            {labels.map((l, i) => <rect key={i} className="metro-gap" x={l.gap.x} y={l.gap.y} width={l.gap.w} height={l.gap.h} rx="6" fill="#000" />)}
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
        {segs.map((s) => (
          <path key={`base-${s.i}`} className="metro-line" d={s.d} />
        ))}
        {segs.map((s) => {
          const from = stations[s.i]
          const done = isDone(from.id) && isDone(stations[s.i + 1].id)
          return (
            <path key={`seg-${s.i}`} d={s.d} fill="none" strokeWidth="10" strokeLinecap="round"
                  stroke={`var(--c-${from.domain.color})`} opacity={done ? 0.95 : 0.3} />
          )
        })}
        </g>
        {stations.map((st, i) => {
          const p = pts[i]
          const color = `var(--c-${st.domain.color})`
          const done = isDone(st.id)
                    return (
            <a key={st.id} href={`#/skill/${st.id}`} className="metro-station" role="listitem"
               aria-label={`第 ${i + 1} 站：${st.title}${done ? '（已完成）' : ''}`}>
              <circle className="ring" cx={p.x} cy={p.y} r="13" stroke={color} fill={done ? color : undefined} />
              {done
                ? <path d={`M${p.x - 5},${p.y} l3.5,3.5 l7,-7`} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                : <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>{i + 1}</text>}
              {labels[i].lines.map((line, li) => (
                <text key={li} x={p.x} y={p.y + 32 + li * 16} textAnchor="middle">{line}</text>
              ))}
              <text x={p.x} y={labels[i].subY} textAnchor="middle" className="sub">{st.domain.title}</text>
            </a>
          )
        })}
      </svg>
    </div>
  )
}

/* 站名依格寬折成最多兩行：CJK 約 13.5px 一字、英數約一半寬；優先在空白或標點斷行，不把英文字切開；超過兩行截斷 */
const charW = (ch) => (/[\x00-\x7f]/.test(ch) ? 0.55 : 1)
const textWidth = (str) => [...str].reduce((n, ch) => n + charW(ch), 0)   // 以一個 CJK 字為 1

function wrap(t, cellPx) {
  const max = Math.max(6, (cellPx - 12) / 13.5)
  const w = charW
  const width = textWidth
  if (width(t) <= max) return [t]
  let cut = 0, acc = 0, lastBreak = -1
  for (const [i, ch] of [...t].entries()) {
    acc += w(ch)
    if (acc > max) break
    cut = i + 1
    if (/[\s、：，／]/.test(ch)) lastBreak = i + 1
  }
  if (lastBreak > 0 && /[\x00-\x7f]/.test(t[cut] || '') && /[\x00-\x7f]/.test(t[cut - 1] || '')) cut = lastBreak
  const a = t.slice(0, cut).trim()
  let rest = t.slice(cut).trim()
  if (width(rest) > max) { let n = 0, k = 0; for (const ch of rest) { if (n + w(ch) > max - 1) break; n += w(ch); k++ } rest = rest.slice(0, k) + '…' }
  return [a, rest]
}
