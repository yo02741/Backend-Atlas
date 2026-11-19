import React from 'react'

/* 站的標誌：貼紙底上一個紅色打勾（AI said all good.）。和 public/favicon.svg 同一個圖形，顏色走 CSS token。 */
export default function BrandMark({ className = '', size }) {
  const d = 'M15 31l9.5 9.5L45 19'
  return (
    <svg className={className} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect x="7" y="7" width="54" height="54" rx="12" fill="var(--brand-line)" />
      <rect x="3" y="3" width="54" height="54" rx="12" fill="var(--brand-tile)" stroke="var(--brand-line)" strokeWidth="4" />
      <path d={d} fill="none" stroke="var(--brand-line)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--brand-check)" strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
