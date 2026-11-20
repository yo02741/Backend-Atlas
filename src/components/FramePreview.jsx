import React, { useEffect, useRef, useState } from 'react'

/* 前端題與 Playground 的預覽：看得見的沙箱 iframe（src/runtime/frame.js，第一次執行時才 import）。
   寬度可切換 390、768、1280；比窗格寬時整個縮小顯示，iframe 自己的 viewport 維持選的寬度（media query 照那個寬度算）。
   下方是 iframe 回報的 Console（含 [Vue warn] 與未處理的錯誤）與假 API 的網路紀錄。
   props：kind、code、ex（題目的 html / css / api）、setup（Playground 的假 API 設定）、runKey（變了就重建 iframe）、
   onStatus（選填：{ state, errors, warns, lastError } 變了就呼叫，Playground 的狀態列與 live region 用） */
const WIDTHS = [390, 768, 1280]
const MAX_ENTRIES = 300

export default function FramePreview({ kind, code, ex = {}, setup = '', runKey = 0, height = 320, empty = '按「執行」看畫面。', onStatus }) {
  const stageRef = useRef(null)
  const hostRef = useRef(null)
  const frameRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: height })
  const [width, setWidth] = useState('auto')
  const [stageW, setStageW] = useState(0)
  const [logs, setLogs] = useState([])
  const [network, setNetwork] = useState([])
  const [state, setState] = useState('idle') // idle | loading | ready | error
  const [tab, setTab] = useState('console')

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setStageW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frameW = width === 'auto' ? stageW : width
  const scale = frameW > 0 && stageW > 0 ? Math.min(1, stageW / frameW) : 1
  const frameH = Math.round(height / scale)
  sizeRef.current = { w: frameW, h: frameH }
  useEffect(() => { frameRef.current?.resize(frameW, frameH) }, [frameW, frameH])

  useEffect(() => {
    if (!runKey) return
    let cancelled = false
    setLogs([]); setNetwork([]); setState('loading')
    frameRef.current?.destroy(); frameRef.current = null
    const add = (setter, item) => setter((xs) => (xs.length >= MAX_ENTRIES ? xs : [...xs, item]))
    import('../runtime/frame.js')
      .then((F) => F.mountPreview(hostRef.current, {
        kind, code, ex, setup, width: sizeRef.current.w, height: sizeRef.current.h,
        onEvent: (m) => {
          if (cancelled) return
          if (m.type === 'console') add(setLogs, { level: m.level, text: String(m.text) })
          else if (m.type === 'error') {
            // stack 的第一行是錯誤訊息本身，只接後面「at …」的呼叫位置
            const at = String(m.stack || '').split('\n').filter((l) => /^\s+at /.test(l)).join('\n')
            add(setLogs, { level: 'error', text: String(m.message) + (at ? '\n' + at : '') })
          }
          else if (m.type === 'network') add(setNetwork, m)
        },
      }))
      .then((f) => { if (cancelled) f.destroy(); else { frameRef.current = f; setState('ready') } })
      .catch(() => { if (!cancelled) { setState('error'); setLogs([{ level: 'error', text: '執行環境載入失敗（可能是網路問題，重新整理再試）。' }]) } })
    return () => { cancelled = true }
    // 只在按「執行」時重建；code 等內容取按下當時的值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])
  useEffect(() => () => { frameRef.current?.destroy(); frameRef.current = null }, [])

  const errors = logs.filter((l) => l.level === 'error').length
  const warns = logs.filter((l) => l.level === 'warn').length
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const lastError = errors ? logs.filter((l) => l.level === 'error').pop().text : ''
  useEffect(() => { onStatusRef.current?.({ state, errors, warns, lastError, runKey }) }, [state, errors, warns, lastError, runKey])
  return (
    <div className="fp">
      <div className="fp-bar">
        <span className="kicker">預覽</span>
        <div className="fp-widths" role="group" aria-label="預覽寬度">
          {['auto', ...WIDTHS].map((w) => (
            <button key={w} type="button" className={`chip${width === w ? ' on' : ''}`} aria-pressed={width === w} onClick={() => setWidth(w)}>{w === 'auto' ? '自動' : w}</button>
          ))}
        </div>
        <span className="fp-size mono">{frameW ? `${frameW} px` : ''}{scale < 1 ? ` · 縮放 ${Math.round(scale * 100)}%` : ''}</span>
      </div>
      <div className="fp-stage" ref={stageRef} style={{ height }}>
        <div className="fp-host" ref={hostRef} style={{ width: Math.round(frameW * scale) || '100%', height, '--fp-scale': scale }} />
        {state === 'idle' && <p className="fp-empty">{empty}</p>}
        {state === 'loading' && <p className="fp-empty">載入中…</p>}
      </div>
      <div className="fp-panels">
        <div className="fp-tabs" role="tablist" aria-label="輸出">
          <button type="button" role="tab" aria-selected={tab === 'console'} className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>
            Console{logs.length ? ` ${logs.length}` : ''}{errors ? <b className="fp-badge err">{errors} 錯誤</b> : warns ? <b className="fp-badge warn">{warns} 警告</b> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'network'} className={tab === 'network' ? 'on' : ''} onClick={() => setTab('network')}>網路{network.length ? ` ${network.length}` : ''}</button>
        </div>
        {tab === 'console' && (
          logs.length
            ? <ol className="fp-console">{logs.map((l, i) => <li key={i} className={l.level}>{l.text}</li>)}</ol>
            : <p className="out-empty">{state === 'idle' ? '（還沒執行）' : '（沒有輸出）'}</p>
        )}
        {tab === 'network' && (
          network.length
            ? (
              <div className="dtable-wrap">
                <table className="fp-net">
                  <thead><tr><th>方法</th><th>網址</th><th>狀態</th><th>耗時</th></tr></thead>
                  <tbody>
                    {network.map((n, i) => (
                      <tr key={i} className={n.aborted || n.network || n.status >= 400 ? 'bad' : ''}>
                        <td className="mono">{n.method}</td>
                        <td className="mono fp-url">{n.url}</td>
                        <td className="mono">{n.aborted ? '已取消' : n.network ? '網路錯誤' : n.status}</td>
                        <td className="mono">{n.ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
            : <p className="out-empty">（沒有請求。假 API 的請求只列在這裡，不會出現在瀏覽器 DevTools 的 Network 分頁）</p>
        )}
      </div>
    </div>
  )
}
