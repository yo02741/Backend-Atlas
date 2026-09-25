import React, { useId, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, Status, useWidth } from './ui.jsx'

/* ============================================================
   一個 HTTP 請求的一生
   - 7 步 step-through：DNS → TCP → TLS → 請求 → 伺服器（nginx→app→db）→ 回應 → 瀏覽器
   - 舞台：瀏覽器｜伺服器 兩條泳道的序列圖 + 各階段耗時堆疊條（示意）
   - 情境：切狀態碼看原始請求/回應、誰的錯；keep-alive 開關看第二次請求省了什麼
   ============================================================ */

const STEPS = [
  { short: 'DNS', label: 'DNS 解析', ms: 20 },
  { short: 'TCP', label: 'TCP 三向交握', ms: 30 },
  { short: 'TLS', label: 'TLS 握手', ms: 40 },
  { short: '請求', label: '送出請求', ms: 5 },
  { short: '伺服器', label: '伺服器處理', ms: null }, // 依情境
  { short: '回應', label: '回應', ms: 10 },
  { short: '瀏覽器', label: '瀏覽器處理', ms: 15 },
]
const N = ['①', '②', '③', '④', '⑤', '⑥', '⑦']

const STEP_TEXT = [
  ['① DNS：把網域名稱換成 IP', '瀏覽器先問：`api.example.com` 的 IP 是多少？答案通常已快取在瀏覽器或作業系統裡，真正跑出去問的機會不多；第一次問要經過遞迴解析器一路查到權威伺服器。', 'TTL 到期前都用快取——這就是改 DNS 紀錄後「有人看得到新站、有人看不到」的原因。'],
  ['② TCP：先握手，才有連線', '有了 IP，雙方要先建立 TCP 連線：SYN → SYN-ACK → ACK，剛好一個來回（RTT）。這一步只是「確認彼此在線、談好序號」，還沒有任何 HTTP 內容。', '跨海的 RTT 動輒 100–200 ms，所以建立連線的成本主要來自距離，不是頻寬。'],
  ['③ TLS：在 TCP 之上再握一次手', 'HTTPS 要交換支援的加密套件、伺服器出示憑證、雙方算出對稱金鑰。TLS 1.3 只要 1 個 RTT（1.2 要 2 個）。', '之後所有 HTTP 內容都在加密通道裡走，中間節點只看得到 IP 與 SNI 裡的網域名稱。'],
  ['④ 請求：起始行 + 標頭 + 空行 + body', 'HTTP 本身**無狀態**：伺服器不記得上一個請求，所以身份要每次自帶（Cookie 或 `Authorization` 標頭），`Content-Type` 告訴對方 body 怎麼解讀。', '方法有語意：GET 安全且冪等、PUT / DELETE 冪等（重送結果一樣）、POST 不冪等——重試邏輯與快取都建立在這個約定上。'],
  ['⑤ 伺服器：nginx → app → db', '請求先到反向代理（nginx）：終止 TLS、擋掉明顯異常、轉給應用程式。app 解析路由、驗證身份與輸入、查資料庫、組回應。愈早擋下的錯誤成本愈低。'],
  ['⑥ 回應：狀態行 + 標頭 + body', '狀態碼分五類：1xx 資訊、2xx 成功、3xx 重新導向、4xx 客戶端錯、5xx 伺服器錯。分類決定了誰該修、能不能重試、要不要快取。'],
  ['⑦ 瀏覽器：讀標頭，決定怎麼處理', '`Cache-Control` / `ETag` 決定要不要存起來、下次要不要帶 `If-None-Match` 去問；`Set-Cookie` 寫入 cookie；`Content-Type` 決定 body 交給誰（JSON 回給呼叫 fetch 的程式，HTML 進渲染管線）。'],
]

const AUTH = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...'
const SCENARIOS = {
  200: { reason: 'OK', cls: 2, meaning: '成功，body 就是你要的資源。', reach: 2, srvMs: 30, srvNote: 'app 查 db，序列化成 JSON', brwNote: '存進快取 60 秒，並記住 ETag',
    req: ['GET /api/posts/42 HTTP/1.1', 'Host: api.example.com', 'Accept: application/json', AUTH], reqHl: [1],
    res: ['HTTP/1.1 200 OK', 'Content-Type: application/json', 'Cache-Control: private, max-age=60', 'ETag: "a1b2c3"', '', '{"id": 42, "title": "Hello", "author": "alice"}'], resHl: [1, 3, 4] },
  201: { reason: 'Created', cls: 2, meaning: '建立成功；Location 指向新資源。POST 不冪等，重送會再建一筆。', reach: 2, srvMs: 35, srvNote: 'app 驗證 body → db INSERT → 回新 id', brwNote: '拿 Location 或 body 裡的 id 跳轉',
    req: ['POST /api/posts HTTP/1.1', 'Host: api.example.com', 'Content-Type: application/json', AUTH, '', '{"title": "New post"}'], reqHl: [1, 6],
    res: ['HTTP/1.1 201 Created', 'Location: /api/posts/43', 'Content-Type: application/json', '', '{"id": 43, "title": "New post"}'], resHl: [1, 2] },
  301: { reason: 'Moved Permanently', cls: 3, meaning: '永久搬家：瀏覽器自動改去 Location，而且會長期快取這個跳轉。', reach: 0, srvMs: 1, srvNote: 'nginx 依 rewrite 規則直接回，不進 app', brwNote: '自動對 Location 再發一次請求',
    req: ['GET /blog HTTP/1.1', 'Host: example.com'], reqHl: [1],
    res: ['HTTP/1.1 301 Moved Permanently', 'Location: https://example.com/blog/', 'Cache-Control: max-age=31536000', 'Content-Length: 0'], resHl: [1, 2] },
  304: { reason: 'Not Modified', cls: 3, meaning: '資源沒變，body 省掉：瀏覽器用自己快取裡的那份。', reach: 2, srvMs: 25, srvNote: 'app 仍要算出目前的 ETag 來比對', brwNote: '沿用快取的 body，延長快取期限',
    req: ['GET /api/posts/42 HTTP/1.1', 'Host: api.example.com', 'If-None-Match: "a1b2c3"'], reqHl: [3],
    res: ['HTTP/1.1 304 Not Modified', 'ETag: "a1b2c3"', 'Cache-Control: private, max-age=60'], resHl: [1, 2] },
  401: { reason: 'Unauthorized', cls: 4, meaning: '沒認證（不知道你是誰）：缺 token 或已過期。名字叫 Unauthorized，意思其實是 Unauthenticated。', reach: 1, srvMs: 4, srvNote: 'app 的認證 middleware 擋下，沒查 db', brwNote: '導去登入頁，或刷新 token 後重試',
    req: ['GET /api/me HTTP/1.1', 'Host: api.example.com', 'Accept: application/json'], reqHl: [1],
    res: ['HTTP/1.1 401 Unauthorized', 'WWW-Authenticate: Bearer realm="api"', 'Content-Type: application/json', '', '{"error": "missing or expired token"}'], resHl: [1, 2] },
  403: { reason: 'Forbidden', cls: 4, meaning: '已認證但沒權限：知道你是 bob，但這篇是 alice 的。重試沒用，別和 401 混用。', reach: 2, srvMs: 12, srvNote: 'app 查 db 取得作者，比對後拒絕', brwNote: '顯示「沒有權限」，不要導去登入頁',
    req: ['DELETE /api/posts/42 HTTP/1.1', 'Host: api.example.com', AUTH], reqHl: [1, 3],
    res: ['HTTP/1.1 403 Forbidden', 'Content-Type: application/json', '', '{"error": "not the author of post 42"}'], resHl: [1] },
  404: { reason: 'Not Found', cls: 4, meaning: '找不到資源：路徑不存在，或這個 id 沒有資料。', reach: 2, srvMs: 22, srvNote: 'app 路由命中，db 查無此列', brwNote: '顯示「找不到」；SPA 在這裡渲染 404 頁',
    req: ['GET /api/posts/999 HTTP/1.1', 'Host: api.example.com'], reqHl: [1],
    res: ['HTTP/1.1 404 Not Found', 'Content-Type: application/json', '', '{"error": "post 999 not found"}'], resHl: [1] },
  422: { reason: 'Unprocessable Content', cls: 4, meaning: '格式看得懂但內容不合法（驗證失敗）。FastAPI、Rails 預設用它；有些團隊用 400。', reach: 1, srvMs: 4, srvNote: 'app 的 schema 驗證擋下，沒碰 db', brwNote: '把 errors 對應回表單欄位顯示',
    req: ['POST /api/posts HTTP/1.1', 'Host: api.example.com', 'Content-Type: application/json', '', '{"title": ""}'], reqHl: [5],
    res: ['HTTP/1.1 422 Unprocessable Content', 'Content-Type: application/json', '', '{"errors": {"title": ["不可為空"]}}'], resHl: [1, 4] },
  500: { reason: 'Internal Server Error', cls: 5, meaning: '伺服器自己出錯（未捕捉的例外）。客戶端沒做錯，重送也不一定會好。', reach: 2, fail: 2, srvMs: 40, srvNote: 'db 查詢丟例外，app 沒接住 → 框架回 500', brwNote: '顯示通用錯誤 + request_id 方便回報',
    req: ['GET /api/posts/42 HTTP/1.1', 'Host: api.example.com'], reqHl: [1],
    res: ['HTTP/1.1 500 Internal Server Error', 'Content-Type: application/json', '', '{"error": "internal error", "request_id": "c7f1a9"}'], resHl: [1, 4] },
  503: { reason: 'Service Unavailable', cls: 5, meaning: '服務暫時不可用：app 沒起來、過載或維護中。帶 Retry-After 告訴客戶端何時再試。', reach: 0, fail: 1, srvMs: 2, srvNote: 'nginx 連不上 upstream（app），自己回 503', brwNote: '依 Retry-After 退避重試，別立刻狂打',
    req: ['GET /api/posts/42 HTTP/1.1', 'Host: api.example.com'], reqHl: [1],
    res: ['HTTP/1.1 503 Service Unavailable', 'Retry-After: 30', 'Content-Type: text/html', '', '<html>503 Service Unavailable</html>'], resHl: [1, 2] },
}
const CODES = Object.keys(SCENARIOS).map(Number)
const BLAME = { 2: <Status ok>2xx 成功</Status>, 3: <Status ok>3xx 重新導向</Status>, 4: <Status warn>4xx 客戶端的錯</Status>, 5: <Status>5xx 伺服器的錯</Status> }

export default function HttpLab() {
  const { step, setStep, playing, toggle } = usePlayer(7, 1500)
  const [code, setCode] = useState(200)
  const [keep, setKeep] = useState(false)
  const sc = SCENARIOS[code]
  const [title, ...paras] = STEP_TEXT[step]
  const tail = step === 4 ? `這個情境：${sc.srvNote}。` : step === 5 ? `這個情境：${sc.meaning}` : step === 6 ? `這個情境：${sc.brwNote}。` : ''

  return (
    <Lab className="htp" accent="aqua" kicker="WEB LAB" title="一個 HTTP 請求的一生"
         blurb="按「播放」跟著一個請求從 DNS 走到瀏覽器渲染。切換狀態碼看原始請求與回應長什麼樣、伺服器在哪一層回頭；打開連線重用看第二次請求省了哪幾步。">
      <LabControls>
        <Stepper step={step} total={7} onStep={setStep} playing={playing} onPlay={toggle} labels={STEPS.map((s) => s.label)} />
        <span className="spacer" />
        <Toggle label="keep-alive / HTTP/2 連線重用" checked={keep} onChange={setKeep} />
      </LabControls>
      <LabControls>
        <Seg label="情境（狀態碼）" mono value={code} onChange={setCode} options={CODES.map((c) => ({ value: c, label: String(c), title: SCENARIOS[c].reason }))} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="序列圖：瀏覽器與伺服器之間的訊息" caption="目前步驟的箭頭會流動；伺服器泳道裡的 nginx → app → db 依情境決定走到哪一層。">
            <Sequence step={step} sc={sc} code={code} keep={keep} />
          </LabStage>
          <LabStage plain label="各階段耗時（示意）">
            <Timeline step={step} sc={sc} keep={keep} />
          </LabStage>
        </div>

        <div className="lab-stack">
          <div className="htp-meaning">
            <div className="htp-meaning-head"><span className="htp-code">{code} {sc.reason}</span>{BLAME[sc.cls]}</div>
            <p>{sc.meaning}</p>
          </div>
          <Code lang="http" title="請求（瀏覽器 → 伺服器）" highlight={sc.reqHl} dim={step === 3}>{sc.req.join('\n')}</Code>
          <Code lang="http" title="回應（伺服器 → 瀏覽器）" highlight={sc.resHl} dim={step >= 5}>{sc.res.join('\n')}</Code>
          <LabExplain title={title}>
            {paras.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
            {tail && <p><strong>{tail}</strong></p>}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            API 回錯要<b>挑對狀態碼</b>：驗證失敗 422（或 400）、沒登入 401、沒權限 403、找不到 404、自己炸了 500、暫時不可用 503 加 <code>Retry-After</code>。
            別把所有錯誤都包成 200 + <code>{'{"ok": false}'}</code>——瀏覽器快取、fetch 的錯誤處理、重試、監控告警全都靠狀態碼分流，你會讓每一層都失明。只有冪等方法（GET / PUT / DELETE）能放心自動重試。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .htp .lab-grid > * { min-width: 0; }
        .htp-meaning { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); padding: 10px 14px; font-size: 0.86rem; color: var(--ink-2); line-height: 1.6; }
        .htp-meaning-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
        .htp-code { font-family: var(--mono); font-weight: 700; color: var(--ink-1); font-size: 0.92rem; }
        .htp-life { stroke: var(--hairline); stroke-width: 1.5; stroke-dasharray: 3 4; }
        .htp-row { transition: opacity 0.35s ease; }
        .htp-row.future { opacity: 0.28; }
        .htp-row.past { opacity: 0.7; }
        .htp-lbl { font-family: var(--mono); font-size: 10px; fill: var(--ink-2); }
        .htp-row.on .htp-lbl { fill: var(--ink-1); font-weight: 600; }
        .htp-step { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .htp-row.on .htp-step { fill: var(--ink-1); font-weight: 700; }
        .htp-mk { fill: var(--ink-3); } .htp-mk.on { fill: var(--lab-accent); }
        .htp-fail { stroke: var(--critical) !important; stroke-dasharray: 3 3; }
        .htp-fail-edge { stroke: var(--critical); stroke-width: 2; stroke-dasharray: 3 3; fill: none; }
        .htp-x { font-family: var(--mono); font-size: 11px; font-weight: 700; fill: var(--critical); }
        .htp-keep { fill: color-mix(in srgb, var(--lab-accent) 7%, transparent); stroke: var(--lab-accent); stroke-dasharray: 4 4; stroke-width: 1; }
        .htp-seg { fill: color-mix(in srgb, var(--lab-accent) 16%, transparent); transition: fill 0.3s ease; }
        .htp-seg.past { fill: color-mix(in srgb, var(--lab-accent) 50%, transparent); }
        .htp-seg.on { fill: var(--lab-accent); }
        .htp-seg-n { font-family: var(--sans); font-size: 10px; fill: var(--ink-1); }
        .htp-ghost { fill: none; stroke: var(--ink-3); stroke-dasharray: 3 3; }
      `}</style>
    </Lab>
  )
}

function md(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/* ---- 序列圖：兩條泳道，依量到的寬度排版（手機不縮字） ---- */
function Sequence({ step, sc, code, keep }) {
  const ref = useRef(null)
  const id = useId().replace(/:/g, '')
  const w = useWidth(ref, 640)
  const W = Math.max(340, w)
  const narrow = W < 520
  const bx = narrow ? 64 : 150
  const sx = W - (narrow ? 72 : 150)
  const nw = narrow ? 40 : 58
  const gap = narrow ? 48 : 84
  const rowH = 50, top = 68
  const ys = STEPS.map((_, i) => top + i * rowH)
  const H = top + 7 * rowH - 4
  const mx = (bx + sx) / 2
  const dnsW = narrow ? 56 : 76
  const cls = (i) => `htp-row ${i === step ? 'on' : i < step ? 'past' : 'future'}`
  const on = (i) => i === step
  const mk = (i) => `url(#${id}-${on(i) ? 'on' : 'off'})`
  const arrow = (i, x1, x2, y, label, below) => (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} className={`svg-edge${on(i) ? ' on svg-flow' : ''}`} markerEnd={mk(i)} />
      {label && <text x={(x1 + x2) / 2} y={below ? y + 13 : y - 4} textAnchor="middle" className="htp-lbl">{label}</text>}
    </g>
  )
  const chain = ['nginx', 'app', 'db'].map((n, k) => ({ n, x: sx + (k - 1) * gap }))
  const fail = sc.fail ?? -1

  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`序列圖，目前在第 ${step + 1} 步：${STEPS[step].label}`}>
        <defs>
          {['on', 'off'].map((k) => (
            <marker key={k} id={`${id}-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" className={`htp-mk ${k}`} />
            </marker>
          ))}
        </defs>
        {keep && <>
          <rect x="2" y={ys[0] - 24} width={W - 4} height={rowH * 3 - 4} rx="4" className="htp-keep" />
          <text x={W - 8} y={ys[0] - 11} textAnchor="end" className="svg-text small">連線重用：第 2 次請求跳過 ①②③</text>
        </>}
        <line x1={bx} y1="32" x2={bx} y2={H} className="htp-life" />
        <line x1={sx} y1="32" x2={sx} y2={H} className="htp-life" />
        <rect x={bx - 40} y="6" width="80" height="24" rx="3" className="svg-node" />
        <text x={bx} y="22" textAnchor="middle" className="svg-text">瀏覽器</text>
        <rect x={sx - gap - nw / 2 - 6} y="6" width={gap * 2 + nw + 12} height="24" rx="3" className="svg-node" />
        <text x={sx} y="22" textAnchor="middle" className="svg-text">{narrow ? '伺服器' : '伺服器（nginx → app → db）'}</text>

        {STEPS.map((s, i) => {
          const y = ys[i]
          return (
            <g key={i} className={cls(i)}>
              <text x="4" y={y + 4} className="htp-step">{N[i]} {s.short}</text>
              {i === 0 && <>
                <rect x={mx - dnsW / 2} y={y - 10} width={dnsW} height="20" rx="3" className={`svg-node${on(0) ? ' on' : ''}`} />
                <text x={mx} y={y + 4} textAnchor="middle" className="svg-mono">DNS</text>
                {arrow(0, bx, mx - dnsW / 2, y - 6, narrow ? 'IP？' : 'api.example.com 的 IP？')}
                {arrow(0, mx - dnsW / 2, bx, y + 8, '203.0.113.10', true)}
              </>}
              {i === 1 && <>
                {arrow(1, bx, sx, y - 15, 'SYN')}
                {arrow(1, sx, bx, y, 'SYN-ACK')}
                {arrow(1, bx, sx, y + 15, 'ACK')}
              </>}
              {i === 2 && <>
                {arrow(2, bx, sx, y - 15, 'ClientHello')}
                {arrow(2, sx, bx, y, narrow ? 'ServerHello + 憑證' : 'ServerHello · 憑證 · Finished')}
                {arrow(2, bx, sx, y + 15, narrow ? 'Finished' : 'Finished（之後全部加密）')}
              </>}
              {i === 3 && arrow(3, bx, sx, y, sc.req[0].replace(' HTTP/1.1', ''))}
              {i === 4 && <>
                {chain.map((c, k) => (
                  <g key={c.n} opacity={k > sc.reach && k !== fail ? 0.35 : 1}>
                    {k > 0 && (k <= sc.reach
                      ? <line x1={chain[k - 1].x + nw / 2} y1={y} x2={c.x - nw / 2} y2={y} className={`svg-edge${on(4) ? ' on svg-flow' : ''}`} markerEnd={mk(4)} />
                      : k === fail
                        ? <line x1={chain[k - 1].x + nw / 2} y1={y} x2={c.x - nw / 2} y2={y} className="htp-fail-edge" />
                        : <line x1={chain[k - 1].x + nw / 2} y1={y} x2={c.x - nw / 2} y2={y} className="svg-edge svg-dash" />)}
                    <rect x={c.x - nw / 2} y={y - 11} width={nw} height="22" rx="3" className={`svg-node${on(4) && k <= sc.reach ? ' on' : ''}${k === fail ? ' htp-fail' : ''}`} />
                    <text x={c.x} y={y + 4} textAnchor="middle" className="svg-mono">{c.n}</text>
                    {k === fail && <text x={c.x + nw / 2 + 4} y={y - 8} className="htp-x">✕</text>}
                  </g>
                ))}
                <text x={bx + 12} y={y + 27} className="svg-text small">{sc.srvNote}</text>
              </>}
              {i === 5 && arrow(5, sx, bx, y, `${narrow ? '' : 'HTTP/1.1 '}${code} ${sc.reason}`)}
              {i === 6 && <>
                <rect x={narrow ? bx - 10 : bx - 80} y={y - 11} width={narrow ? 100 : 160} height="22" rx="3" className={`svg-node${on(6) ? ' on' : ''}`} />
                <text x={narrow ? bx + 40 : bx} y={y + 4} textAnchor="middle" className="svg-mono">{narrow ? '處理回應' : '讀標頭 → 快取 → 交給程式'}</text>
                <text x={narrow ? bx - 10 : bx - 80} y={y + 27} className="svg-text small">{sc.brwNote}</text>
              </>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ---- 各階段耗時堆疊條（示意）：第 2 次請求對齊在第 1 次下方，跳過的部分畫虛線 ---- */
function Timeline({ step, sc, keep }) {
  const ref = useRef(null)
  const w = useWidth(ref, 640)
  const W = Math.max(340, w)
  const segs = STEPS.map((s, i) => ({ ...s, ms: s.ms ?? sc.srvMs, i }))
  const total = segs.reduce((a, s) => a + s.ms, 0)
  const setup = segs.slice(0, 3).reduce((a, s) => a + s.ms, 0)
  const barW = W - 92
  const k = barW / total
  const H = keep ? 108 : 52
  const bar = (y, items, x0, label, totalMs) => {
    let cx = x0
    return (
      <g>
        <text x="0" y={y - 6} className="svg-text small">{label}</text>
        {items.map((s, j) => {
          const x = cx, wd = Math.max(0, s.ms * k - 2)
          cx += s.ms * k
          const last = j === items.length - 1
          const d = last
            ? `M${x} ${y} h${wd - 4} q4 0 4 4 v8 q0 4 -4 4 h${-(wd - 4)} z`
            : `M${x} ${y} h${wd} v16 h${-wd} z`
          const state = s.i === step ? 'on' : s.i < step ? 'past' : ''
          return (
            <g key={s.i}>
              <title>{N[s.i]} {s.label}：約 {s.ms} ms</title>
              <path d={d} className={`htp-seg ${state}`} />
              {wd >= 14 && <text x={x + wd / 2} y={y + 12} textAnchor="middle" className="htp-seg-n">{N[s.i]}</text>}
              {wd >= 30 && <text x={x + wd / 2} y={y + 28} textAnchor="middle" className="svg-text small">{s.ms}ms</text>}
            </g>
          )
        })}
        <text x={x0 + items.reduce((a, s) => a + s.ms, 0) * k + 8} y={y + 12} className="svg-text">≈ {totalMs} ms</text>
      </g>
    )
  }
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`各階段耗時示意，總計約 ${total} 毫秒`}>
        {bar(16, segs, 0, '第 1 次請求（含建立連線）', total)}
        {keep && <>
          {bar(72, segs.slice(3), setup * k, '第 2 次請求（連線重用）', total - setup)}
          <rect x="0" y={72} width={setup * k - 2} height="16" rx="3" className="htp-ghost" />
          <text x={(setup * k) / 2} y={72 + 12} textAnchor="middle" className="svg-text small">跳過 ①②③：省下 {setup} ms</text>
        </>}
      </svg>
      <p className="lab-caption">毫秒是示意值，用來看比例：建立連線（①②③）常常比伺服器真正工作的時間還長。</p>
    </div>
  )
}
