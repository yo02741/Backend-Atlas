import React from 'react'

/* 站的標誌：打勾加問號（AI 說都好了？）。和 public/favicon.svg 同一個圖形，顏色走 CSS token。 */
export default function BrandMark({ className = '', size }) {
  return (
    <svg className={className} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--brand-tile)" />
      <path d="M8 33.5l9.5 9.5L33 21.5" fill="none" stroke="var(--brand-check)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42.5 22.5a7.5 7.5 0 1 1 11 6.6c-2.2 1.2-3.5 2.7-3.5 5.2V36" fill="none" stroke="var(--brand-ask)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="50" cy="46.5" r="3.8" fill="var(--brand-ask)" />
    </svg>
  )
}
