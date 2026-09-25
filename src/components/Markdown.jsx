import React from 'react'
import { Code } from '../labs/ui.jsx'

/* 夠用的 Markdown 渲染器（課綱文件用）：標題、段落、清單（兩層）、表格、
   程式碼區塊、引用、分隔線、粗體、行內碼、連結。不處理 HTML。 */

const LANG_MAP = { dockerfile: 'bash', toml: 'yaml', shell: 'bash', sh: 'bash', text: '', txt: '', javascript: 'js', typescript: 'js', ts: 'js' }

function slug(text) {
  return text.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
}

export function inline(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((p, i) => {
    if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
    if (p.startsWith('**')) return <strong key={i}>{inline(p.slice(2, -2))}</strong>
    const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p)
    if (m) return <a key={i} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>
    return <React.Fragment key={i}>{p}</React.Fragment>
  })
}

export function parse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  const push = (b) => blocks.push(b)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    // fenced code
    const fence = /^```\s*(\S*)/.exec(line)
    if (fence) {
      const lang = fence[1].toLowerCase()
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      push({ type: 'code', lang: LANG_MAP[lang] ?? lang, text: buf.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { push({ type: 'h', level: h[1].length, text: h[2].trim() }); i++; continue }
    if (/^---+\s*$/.test(line)) { push({ type: 'hr' }); i++; continue }
    if (/^>/.test(line)) {
      const buf = []
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      push({ type: 'quote', lines: buf })
      continue
    }
    if (/^\|/.test(line)) {
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++])
      const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const header = cells(rows[0])
      const body = rows.slice(1).filter((r) => !/^\|\s*:?-+/.test(r)).map(cells)
      push({ type: 'table', header, body })
      continue
    }
    if (/^\s*(-|\*|\d+\.)\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*(-|\*|\d+\.)\s+/.test(lines[i])) {
        const m = /^(\s*)(-|\*|\d+\.)\s+(.*)$/.exec(lines[i])
        const depth = Math.floor(m[1].length / 2)
        items.push({ depth, ordered: /\d/.test(m[2]), text: m[3] })
        i++
        // 接續行（縮排、非清單）併入前一項
        while (i < lines.length && lines[i].trim() && !/^\s*(-|\*|\d+\.)\s+/.test(lines[i]) && /^\s{2,}/.test(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim(); i++
        }
      }
      push({ type: 'list', items })
      continue
    }
    // paragraph
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|---|>|\||\s*(-|\*|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++])
    push({ type: 'p', text: buf.join(' ') })
  }
  return blocks
}

function List({ items }) {
  // 兩層巢狀：depth 0 為主項，depth ≥ 1 掛在前一個主項下
  const out = []
  for (const it of items) {
    if (it.depth === 0 || out.length === 0) out.push({ ...it, children: [] })
    else out[out.length - 1].children.push(it)
  }
  const Tag = out[0]?.ordered ? 'ol' : 'ul'
  return (
    <Tag>
      {out.map((it, i) => (
        <li key={i}>
          {inline(it.text)}
          {it.children.length > 0 && (
            <ul>{it.children.map((c, j) => <li key={j}>{inline(c.text)}</li>)}</ul>
          )}
        </li>
      ))}
    </Tag>
  )
}

export default function Markdown({ text, className = '' }) {
  const blocks = React.useMemo(() => parse(text), [text])
  return (
    <div className={`mdoc ${className}`}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h': { const Tag = `h${Math.min(6, b.level)}`; return <Tag key={i} id={slug(b.text)}>{inline(b.text)}</Tag> }
          case 'hr': return <hr key={i} />
          case 'quote': return <blockquote key={i}>{b.lines.map((l, j) => <p key={j}>{inline(l)}</p>)}</blockquote>
          case 'code': return <Code key={i} lang={b.lang || 'text'} title="">{b.text}</Code>
          case 'table': return (
            <div key={i} className="dtable-wrap">
              <table className="md-table">
                <thead><tr>{b.header.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                <tbody>{b.body.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )
          case 'list': return <List key={i} items={b.items} />
          default: return <p key={i}>{inline(b.text)}</p>
        }
      })}
    </div>
  )
}

/* 從標題產生目錄（## 與 ###） */
export function toc(md) {
  return parse(md).filter((b) => b.type === 'h' && b.level >= 2 && b.level <= 3).map((b) => ({ level: b.level, text: b.text, id: slug(b.text) }))
}
