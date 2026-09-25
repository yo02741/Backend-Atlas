import React, { useRef } from 'react'
import { useWidth } from '../labs/ui.jsx'

/* 學習路線的地鐵圖：站點蛇形排列，線段顏色跟隨起點站的領域色，
   完成的站填滿色、未完成空心。窄螢幕自動改成每列較少站。 */
export default function MetroMap({ stations, isDone }) {
  const ref = useRef(null)
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

  return (
    <div className="metro" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="list" aria-label="建議學習路線">
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
              {wrap(st.title, cellW * (W / 100)).map((line, li) => (
                <text key={li} x={p.x} y={p.y + 32 + li * 16} textAnchor="middle">{line}</text>
              ))}
              <text x={p.x} y={p.y + 32 + wrap(st.title, cellW * (W / 100)).length * 16} textAnchor="middle" className="sub">{st.domain.title}</text>
            </a>
          )
        })}
      </svg>
    </div>
  )
}

/* 站名依格寬折成最多兩行（CJK 約 13px 一字），超過就截斷 */
function wrap(t, cellPx) {
  const per = Math.max(6, Math.floor((cellPx - 12) / 13.5))
  if (t.length <= per) return [t]
  const a = t.slice(0, per)
  const rest = t.slice(per)
  return [a, rest.length > per ? rest.slice(0, per - 1) + '…' : rest]
}
