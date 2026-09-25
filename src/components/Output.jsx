import React, { useEffect, useState } from 'react'
import { cellText } from '../runtime/sql.js'
import { onPyStatus, pyStatus } from '../runtime/py.js'
import { onSqlStatus, sqlStatus } from '../runtime/sql.js'

/* 執行結果的共用呈現：主控台輸出、SQL 結果表、EXPLAIN 計畫樹、測試結果、執行環境狀態 */

export function ConsoleOut({ output, error, empty = '（沒有輸出）' }) {
  return (
    <div className="out-block">
      {output ? <pre className="out-pre">{output}</pre> : !error && <p className="out-empty">{empty}</p>}
      {error && <pre className="out-pre out-err">{error}</pre>}
    </div>
  )
}

export function ResultTable({ result, caption, highlightRows, maxRows = 200 }) {
  if (!result) return null
  const { fields, rows, affectedRows } = result
  if (!fields.length) {
    return <p className="out-empty">{caption ? `${caption}：` : ''}執行完成{affectedRows ? `，影響 ${affectedRows} 列` : ''}。</p>
  }
  return (
    <div className="dtable-wrap">
      <table className="dtable out-table">
        {caption && <caption>{caption} <span className="muted">· {rows.length} 列</span></caption>}
        <thead><tr>{fields.map((f, i) => <th key={i}>{f}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, maxRows).map((r, i) => (
            <tr key={i} className={highlightRows?.has(i) ? 'row-bad' : ''}>
              {r.map((v, j) => { const t = cellText(v); return <td key={j} className={t === null ? 'null' : ''}>{t === null ? 'NULL' : t}</td> })}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={fields.length} className="muted">（0 列）</td></tr>}
          {rows.length > maxRows && <tr><td colSpan={fields.length} className="muted">…還有 {rows.length - maxRows} 列未顯示</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/* EXPLAIN (FORMAT JSON) 的計畫樹：每個節點一張卡，子節點縮排 */
export function PlanTree({ plan }) {
  if (!plan) return null
  return <ul className="plan-tree"><PlanNode node={plan} depth={0} /></ul>
}
function PlanNode({ node, depth }) {
  const kind = node['Node Type'] || '?'
  const isScan = /Seq Scan/.test(kind)
  const isIndex = /Index/.test(kind)
  const rel = node['Relation Name'] ? ` on ${node['Relation Name']}` : ''
  const idx = node['Index Name'] ? ` using ${node['Index Name']}` : ''
  const cost = node['Total Cost'] !== undefined ? `cost ${Number(node['Startup Cost']).toFixed(2)}..${Number(node['Total Cost']).toFixed(2)}` : ''
  const rows = node['Plan Rows'] !== undefined ? `rows ${node['Plan Rows']}` : ''
  const filter = node['Filter'] || node['Index Cond'] || node['Hash Cond'] || node['Join Filter'] || node['Sort Key']
  return (
    <li>
      <div className={`plan-node${isScan ? ' scan' : ''}${isIndex ? ' index' : ''}`}>
        <span className="plan-kind">{kind}{rel}{idx}</span>
        <span className="plan-meta">{[cost, rows].filter(Boolean).join(' · ')}</span>
        {filter && <span className="plan-cond">{Array.isArray(filter) ? filter.join(', ') : String(filter)}</span>}
      </div>
      {node.Plans?.length > 0 && (
        <ul>{node.Plans.map((c, i) => <PlanNode key={i} node={c} depth={depth + 1} />)}</ul>
      )}
    </li>
  )
}

export function TestResults({ results }) {
  if (!results) return null
  const passed = results.filter((r) => r.pass).length
  return (
    <div className="tests">
      <p className={`tests-sum ${passed === results.length ? 'ok' : 'bad'}`}>
        {passed === results.length ? '✓ 全部通過' : `✕ ${passed} / ${results.length} 通過`}
      </p>
      <ul>
        {results.map((r, i) => (
          <li key={i} className={r.pass ? 'ok' : 'bad'}>
            <span className="t-ico" aria-hidden="true">{r.pass ? '✓' : '✕'}</span>
            <span className="t-name">{r.name}</span>
            {!r.pass && r.error && <pre className="t-err">{r.error}</pre>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* 執行環境載入狀態（Python / PostgreSQL） */
export function RuntimeStatus({ kind }) {
  const get = kind === 'python' ? pyStatus : kind === 'sql' ? sqlStatus : () => 'ready'
  const sub = kind === 'python' ? onPyStatus : kind === 'sql' ? onSqlStatus : () => () => {}
  const [s, setS] = useState(get())
  useEffect(() => sub(setS), [sub])
  const label = { python: 'Python（Pyodide）', sql: 'PostgreSQL（PGlite）', js: 'JavaScript' }[kind]
  const size = { python: '約 13 MB', sql: '約 16 MB', js: '' }[kind]
  const text = s === 'ready' ? '就緒' : s === 'loading' ? `下載中 ${size}，只需一次` : s === 'error' ? '載入失敗' : (kind === 'js' ? '就緒' : '第一次執行時載入')
  return (
    <span className={`rt-status ${s}`} title={`${label}：${text}`}>
      <i aria-hidden="true" /> {label} · {text}
    </span>
  )
}
