import React from 'react'

/* 極簡 Markdown：段落、- 清單、`code`、**粗體**。題目說明與提示用。 */
function inline(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
    if (p.startsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    return <React.Fragment key={i}>{p}</React.Fragment>
  })
}

export default function Md({ text, className = '' }) {
  const blocks = String(text || '').split(/\n\s*\n/)
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*-\s/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*-\s/, ''))}</li>)}</ul>
        }
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>
      })}
    </div>
  )
}
