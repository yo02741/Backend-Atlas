import React from 'react'
import Markdown, { inline } from './Markdown.jsx'
import { useLocalChecks } from '../localStore.js'

/* 進階驗收（課的 body.challenge、情境的 challenge）：任務、交付物、驗收條件（勾選記在這個瀏覽器）、
   需求變化（twist，按了才展開）。格式見 docs/CONTRIBUTING-lessons.md 的「進階驗收」。 */
export default function Challenge({ challenge: c, storeKey, id = 'challenge' }) {
  const [checked, toggle] = useLocalChecks(storeKey, c.check.length)
  const n = checked.filter(Boolean).length
  const all = n === c.check.length
  return (
    <section className="challenge" aria-labelledby={id}>
      <header className="ex-head">
        <h3 className="ex-title" id={id}>進階驗收</h3>
        <div className="ex-status">
          <span className={all ? 'status ok' : 'pill'}>{all ? '✓ ' : ''}{n} / {c.check.length}</span>
        </div>
      </header>
      <Markdown text={c.task} className="challenge-task" />
      <p className="challenge-deliver"><b>交付</b><span>{inline(c.deliver)}</span></p>
      <ul className="checklist challenge-check" aria-label="驗收條件">
        {c.check.map((x, i) => (
          <li key={i}>
            <label>
              <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} />
              <span>{inline(x)}</span>
            </label>
          </li>
        ))}
      </ul>
      {c.twist && (
        <details className="challenge-twist">
          <summary>需求變化</summary>
          <Markdown text={c.twist} />
        </details>
      )}
    </section>
  )
}
