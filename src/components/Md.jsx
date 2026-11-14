import React from 'react'

/* 極簡 Markdown：段落、- 清單、1. 編號清單、表格、``` 程式碼區塊、`code`、**粗體**。題目說明與提示用。 */
function inline(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
    if (p.startsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    return <React.Fragment key={i}>{p}</React.Fragment>
  })
}

/* 先把 ``` 區塊切出來（裡面可以有空行），其餘文字再依空行分段 */
function toBlocks(text) {
  const out = []
  String(text || '').split(/(```[^\n]*\n[\s\S]*?\n```)/g).forEach((chunk) => {
    const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(chunk)
    if (m) out.push({ code: m[1] })
    else chunk.split(/\n\s*\n/).forEach((b) => { if (b.trim()) out.push({ lines: b.replace(/^\n+|\n+$/g, '').split('\n') }) })
  })
  return out
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export default function Md({ text, className = '' }) {
  return (
    <div className={`md ${className}`}>
      {toBlocks(text).map((b, i) => {
        if (b.code != null) return <pre key={i} className="md-pre"><code>{b.code}</code></pre>
        const { lines } = b
        if (lines.every((l) => /^\s*-\s/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*-\s/, ''))}</li>)}</ul>
        }
        if (lines.length >= 2 && lines.every((l) => /^\s*\d+\.\s/.test(l))) {
          return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+\.\s/, ''))}</li>)}</ol>
        }
        if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1])) {
          const [head, , ...rows] = lines
          return (
            <table key={i} className="md-table">
              <thead><tr>{cells(head).map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
              <tbody>{rows.map((r, j) => <tr key={j}>{cells(r).map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
            </table>
          )
        }
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>
      })}
    </div>
  )
}
