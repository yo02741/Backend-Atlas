import React from 'react'
import { TRACKS } from '../content/tracks.js'
import { domainsOf } from '../content/roadmap.js'

/* 列表頁上方的路線篩選：全部、前端、後端、AI。用連結切換，網址帶 ?track=，可以分享與上一頁。
   hrefFor(id) 回傳該選項的網址；'all' 是全部路線。只列出已有課的路線。 */
export default function TrackFilter({ value = 'all', hrefFor }) {
  const opts = [{ id: 'all', title: '全部' }, ...TRACKS.filter((t) => domainsOf(t.id).length > 0)]
  return (
    <div className="toolbar track-filter" role="group" aria-label="路線">
      {opts.map((t) => (
        <a key={t.id} href={hrefFor(t.id)} className={`chip${value === t.id ? ' on' : ''}`}
           aria-current={value === t.id ? 'true' : undefined}
           style={t.color ? { '--tint': `var(--c-${t.color})` } : undefined}>{t.title}</a>
      ))}
    </div>
  )
}

/* 'all' 或不認得的值 → 'all' */
export const normTrack = (t) => (TRACKS.some((x) => x.id === t) ? t : 'all')
export const withTrack = (base, track, extra = {}) => {
  const q = new URLSearchParams()
  if (track && track !== 'all') q.set('track', track)
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
  const s = q.toString()
  return `#/${base}${s ? `?${s}` : ''}`
}
