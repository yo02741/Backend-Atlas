import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Code, Callout } from './ui.jsx'

/* ============================================================
   nginx 反向代理視覺化：一個請求怎麼被 location 分派
   - 選路徑、按「送出請求」：對應 location 區塊 highlight，
     箭頭流向正確目的地；/api/ 走 upstream round-robin 並計數
   - Toggle「app2 掛了」：被動健康檢查跳過它
   - Toggle「TLS 終結」：外面 https、內網 http
   ============================================================ */

const CONF = `upstream api {
    server app1:8000;
    server app2:8000;
    server app3:8000;
}

server {
    listen 443 ssl;
    server_name example.com;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location = /health {
        return 200 "ok";
    }

    location /static/ {
        root /var/www;
    }

    location /api/ {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        root /var/www/spa;
        try_files $uri /index.html;
    }
}`

const PATHS = {
  spa:    { label: '/', target: 'spa', lines: [27, 28, 29, 30] },
  api:    { label: '/api/users', target: 'upstream', lines: [21, 22, 23, 24, 25] },
  static: { label: '/static/logo.png', target: 'static', lines: [17, 18, 19] },
  health: { label: '/health', target: 'nginx', lines: [13, 14, 15] },
}
const APPS = ['app1', 'app2', 'app3']
const APP_LINE = { app1: 2, app2: 3, app3: 4 }

export default function NginxLab() {
  const [path, setPath] = useState('api')
  const [app2Down, setApp2Down] = useState(false)
  const [tls, setTls] = useState(false)
  const [counts, setCounts] = useState({ app1: 0, app2: 0, app3: 0 })
  const [rr, setRr] = useState(0)          // round-robin 下一台的索引
  const [last, setLast] = useState(null)   // 最近一次請求的結果
  const [marked, setMarked] = useState(false) // app2 已被標記為暫時不可用（fail_timeout 內）
  const p = PATHS[path]
  const alive = (a) => !(app2Down && a === 'app2')
  const setDown = (v) => { setApp2Down(v); setMarked(false) }

  const send = () => {
    const id = (last?.id ?? 0) + 1
    if (p.target !== 'upstream') { setLast({ id, path, target: p.target }); return }
    let i = rr, attempt = null, skipped = null
    if (!alive(APPS[i])) { if (marked) skipped = APPS[i]; else { attempt = APPS[i]; setMarked(true) } i = (i + 1) % 3 }
    const server = APPS[i]
    setCounts((c) => ({ ...c, [server]: c[server] + 1 }))
    setRr((i + 1) % 3)
    setLast({ id, path, target: server, attempt, skipped, seq: counts[server] + 1 })
  }
  const reset = () => { setCounts({ app1: 0, app2: 0, app3: 0 }); setRr(0); setLast(null); setMarked(false) }
  const total = counts.app1 + counts.app2 + counts.app3

  const hit = last?.path === path ? last : null
  const hl = [...p.lines, ...(hit && hit.target in APP_LINE ? [APP_LINE[hit.target]] : [])]
  const marks = [
    ...(tls ? [{ line: 8, text: 'ssl', ok: true }, { line: 10, text: 'ssl_certificate', ok: true }, { line: 11, text: 'ssl_certificate_key', ok: true }] : []),
    ...(app2Down ? [{ line: 3, text: 'app2:8000' }] : []),
  ]
  const explain = explainFor(path, hit)

  return (
    <Lab className="ngx" accent="yellow" kicker="DEPLOY LAB" title="nginx 反向代理：一個請求怎麼被分派"
         blurb="選一個路徑、按「送出請求」，看 nginx 用哪個 location 接住它、送去哪裡。/api/ 會在三台 app 之間輪流；把 app2 關掉看它怎麼被跳過；打開 TLS 終結看加密在哪裡結束。">
      <LabControls>
        <Seg label="請求路徑" tinted mono value={path} onChange={setPath}
             options={Object.entries(PATHS).map(([v, o]) => ({ value: v, label: o.label }))} />
        <button type="button" className="btn small" onClick={send}>送出請求 →</button>
        <Toggle label="app2 掛了" checked={app2Down} onChange={setDown} />
        <Toggle label="TLS 終結" checked={tls} onChange={setTls} />
        <span className="spacer" />
        {total > 0 && <button type="button" className="btn ghost small" onClick={reset}>計數歸零</button>}
      </LabControls>

      <LabGrid variant="even">
        <Code lang="nginx" title="nginx.conf" highlight={hl} dim marks={marks}>{CONF}</Code>

        <div className="lab-stack">
          <LabStage label="nginx 分派圖"
                    caption={tls ? 'TLS 在 nginx 終結：瀏覽器到 nginx 是 https，nginx 到 app 是內網 http 明文；憑證與私鑰只放在 nginx 這一台。'
                                 : hit ? `第 ${hit.id} 個請求 ${p.label} → ${DEST[hit.target]}` : '按「送出請求」看箭頭往哪裡走；app 節點右側是各台收到的請求數。'}>
            <Diagram path={path} hit={hit} counts={counts} app2Down={app2Down} tls={tls} />
          </LabStage>
          <LabExplain title={explain.title}>
            {explain.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <LabExplain title="為什麼前面要放一台 nginx">
            <p>TLS 終結（憑證只管一處）、靜態檔直出、負載平衡與故障轉移、gzip 與快取標頭、限流（<code>limit_req</code>）、緩衝慢客戶端——慢速連線由 nginx 慢慢收發，後端 worker 秒回就能去服務下一個請求。</p>
          </LabExplain>
          <Callout title="工作上什麼時候用">
            後端 log 裡的來源 IP 全都是同一個？先查 nginx 有沒有 <code>proxy_set_header X-Forwarded-For</code>，再查後端有沒有信任 proxy header（uvicorn 的 <code>--proxy-headers --forwarded-allow-ips</code>）。
            SPA 部署後重新整理深層路徑就 404？就是少了 <code>try_files $uri /index.html</code>。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .ngx .lab-controls .btn { white-space: nowrap; }
        .ngx-box { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease, fill 0.25s ease; }
        .ngx-box.on { stroke: var(--lab-accent); stroke-width: 2.5; fill: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); }
        .ngx-box.down { stroke: var(--critical); stroke-dasharray: 4 3; fill: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .ngx-down text { fill: var(--ink-3); }
        .ngx-edge { stroke: var(--ink-3); stroke-width: 1.5; fill: none; opacity: 0.45; transition: opacity 0.25s ease, stroke 0.25s ease; }
        .ngx-edge.on { stroke: var(--lab-accent); stroke-width: 2.5; opacity: 1; }
        .ngx-edge.dead { stroke: var(--critical); stroke-width: 2; stroke-dasharray: 3 3; opacity: 1; }
        .ngx-frame { fill: none; stroke: var(--ink-3); stroke-dasharray: 5 4; stroke-width: 1.2; opacity: 0.8; }
        .ngx-count { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--ink-2); }
        .ngx-count.hot { fill: var(--lab-accent); }
        .ngx-ok { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--good); }
        .ngx-err { font-family: var(--mono); font-size: 9.5px; font-weight: 700; fill: var(--critical); }
        .ngx-lbl { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); paint-order: stroke; stroke: var(--page); stroke-width: 4; }
        .ngx-lock { fill: var(--good); }
        .ngx-lock path { fill: none; stroke: var(--good); stroke-width: 1.5; }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>') }

const DEST = { nginx: 'nginx 直接回 200', static: '靜態檔 /var/www/static/logo.png', spa: 'SPA index.html', app1: 'app1:8000', app2: 'app2:8000', app3: 'app3:8000' }

function explainFor(path, hit) {
  const rule = 'nginx 選 location 的順序：`=` 精確命中 → `^~` 前綴 → `~` / `~*` regex（依出現順序）→ 否則**最長的前綴**。'
  return {
    spa: { title: 'location /：接住其他所有路徑，交給 SPA', text: [
      '`/` 是最短的前綴，所有沒被其他 location 接走的請求都落到這裡。`try_files $uri /index.html` 先看 `/var/www/spa` 底下有沒有這個檔案，沒有就回 `index.html`——前端 router 接手 `/dashboard/42` 這種深層連結，重新整理不會 404。',
      '為什麼 `/api/users` 不會落到這裡？' + rule + '`/api/` 比 `/` 長，所以贏。'] },
    api: { title: 'location /api/：反向代理到 upstream，輪流分派', text: [
      '最長前綴 `/api/` 命中 → `proxy_pass http://api`：`api` 不是網址，是上面 `upstream api` 區塊的名字。預設 round-robin，每個請求輪到下一台。',
      hit ? (hit.attempt
        ? `這次輪到 **${hit.attempt}**，但連線失敗 → nginx 把它標成暫時不可用（預設 max_fails=1、fail_timeout=10s），同一個請求改送 **${hit.target}**。這是**被動健康檢查**：靠真實請求發現壞掉，不會主動 ping（主動探測要 nginx Plus 或第三方模組）。`
        : hit.skipped
          ? `輪到 **${hit.skipped}**，但它還在 fail_timeout（10 秒）內，nginx 直接跳過不嘗試，送 **${hit.target}**（第 ${hit.seq} 個）。時間到會再試一次，成功就回到輪替。`
          : `這次分派到 **${hit.target}**（它收到的第 ${hit.seq} 個）。再按一次會輪到下一台。`)
        : '按「送出請求」看它落到哪一台；連按幾次看 round-robin 怎麼輪。',
      '`proxy_set_header Host $host` 讓後端看到原本的網域（否則 Host 會變成 `api`）；`X-Forwarded-For` 帶上真實來源 IP——不加的話後端看到的 client IP 永遠是 nginx 自己。'] },
    static: { title: 'location /static/：nginx 直接吐檔案，後端不用醒來', text: [
      '`/static/` 比 `/` 長，贏了。`root /var/www` 會把**整個 URI** 接在後面：`/var/www/static/logo.png`（想去掉 `/static/` 前綴要改用 `alias`）。',
      '檔案由 nginx 直接送出，順便 gzip、加 Cache-Control。讓應用程式伺服器（uvicorn、node）吐靜態檔既慢又浪費 worker。'] },
    health: { title: 'location = /health：精確匹配，nginx 自己回 200', text: [
      '`=` 精確匹配優先權最高，一命中就停止比對。`return 200 "ok"` 直接回應，不經過任何後端。',
      '給 load balancer 或 k8s 探針打的：只想知道「nginx 活著」用這個就好；要確認後端也活著，得另外開一個真的 proxy 到後端的路徑。'] },
  }[path]
}

/* ---- 分派圖 ---- */
const T = {
  app1:   { x: 380, y: 36, h: 34, title: 'app1', sub: ':8000' },
  app2:   { x: 380, y: 82, h: 34, title: 'app2', sub: ':8000' },
  app3:   { x: 380, y: 128, h: 34, title: 'app3', sub: ':8000' },
  static: { x: 380, y: 200, h: 40, title: '靜態檔', sub: '/var/www/static/…' },
  spa:    { x: 380, y: 256, h: 40, title: 'SPA', sub: '/var/www/spa/index.html' },
}
const TW = 140, NX = 170, NY = 126, NW = 110, NH = 80, NMID = NY + NH / 2
const curve = (id) => { const t = T[id]; const my = t.y + t.h / 2; return `M${NX + NW} ${NMID} C 330 ${NMID}, 330 ${my}, ${t.x - 2} ${my}` }

function Diagram({ path, hit, counts, app2Down, tls }) {
  const active = hit?.target ?? null
  return (
    <svg viewBox="0 0 532 330" role="img" aria-label="nginx 分派圖：Internet 到 nginx，再到 app1/app2/app3、靜態檔或 SPA">
      <defs>
        <marker id="ngx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--ink-3)' }} />
        </marker>
      </defs>

      {/* Internet → nginx */}
      <rect x="4" y={NMID - 20} width="60" height="40" rx="20" className="ngx-box" />
      <text x="34" y={NMID - 3} className="svg-text" textAnchor="middle" style={{ fontWeight: 700 }}>Internet</text>
      <text x="34" y={NMID + 11} className="svg-text small" textAnchor="middle">瀏覽器</text>
      <path d={`M64 ${NMID} H ${NX - 2}`} className={`ngx-edge${hit ? ' on svg-flow' : ''}`} markerEnd="url(#ngx-arrow)" />
      <text x="116" y={NMID - 30} className="ngx-lbl" textAnchor="middle">GET {PATHS[path].label}</text>
      {tls && (
        <g className="ngx-lock svg-pop">
          <rect x="102" y={NMID + 22} width="12" height="9" rx="2" />
          <path d={`M104.5 ${NMID + 22} v-3 a3.5 3.5 0 0 1 7 0 v3`} />
          <text x="118" y={NMID + 30} className="ngx-lbl" style={{ fill: 'var(--good)' }}>https</text>
        </g>
      )}

      {/* nginx */}
      <rect x={NX} y={NY} width={NW} height={NH} rx="6" className={`ngx-box${hit ? ' on' : ''}`} />
      <text x={NX + 12} y={NY + 22} className="svg-text" style={{ fontWeight: 700, fontSize: 14 }}>nginx</text>
      <text x={NX + 12} y={NY + 40} className="svg-mono" style={{ fill: 'var(--ink-2)' }}>:443 ssl</text>
      <text x={NX + 12} y={NY + 58} className="svg-text small">比對 location</text>
      <text x={NX + 12} y={NY + 71} className="svg-text small">→ 分派</text>
      {hit?.target === 'nginx' && (
        <text key={hit.id} x={NX + NW / 2} y={NY + NH + 16} className="ngx-ok svg-pop" textAnchor="middle">200 ok（不碰後端）</text>
      )}
      {hit && hit.path === 'api' && (
        <g key={`h${hit.id}`} className="svg-pop">
          <text x={NX} y={NY + NH + 16} className="ngx-lbl">+ Host: example.com</text>
          <text x={NX} y={NY + NH + 28} className="ngx-lbl">+ X-Forwarded-For: 203.0.113.7</text>
        </g>
      )}

      {/* upstream 框 */}
      <rect x="366" y="14" width="160" height="162" rx="6" className="ngx-frame" />
      <text x="374" y="28" className="svg-text small">upstream api（round-robin）</text>

      {/* 邊 */}
      {Object.keys(T).map((id) => (
        <path key={id} d={curve(id)} className={`ngx-edge${active === id ? ' on svg-flow' : ''}${hit?.attempt === id ? ' dead' : ''}`}
              markerEnd={active === id ? 'url(#ngx-arrow)' : undefined} />
      ))}
      {hit?.attempt && <text key={`x${hit.id}`} x="336" y={T[hit.attempt].y + T[hit.attempt].h / 2 - 8} className="ngx-err svg-pop" textAnchor="middle">✕ 連不上 → 換下一台</text>}
      {hit?.skipped && <text key={`s${hit.id}`} x="336" y={T[hit.skipped].y + T[hit.skipped].h / 2 - 8} className="ngx-lbl svg-pop" textAnchor="middle">fail_timeout 內，跳過</text>}
      {tls && <text x="330" y="318" className="ngx-lbl" textAnchor="middle" style={{ fill: 'var(--ink-2)' }}>nginx → app：http 明文（憑證只在 nginx）</text>}

      {/* 目的地 */}
      {Object.entries(T).map(([id, t]) => {
        const isApp = id.startsWith('app')
        const down = isApp && app2Down && id === 'app2'
        return (
          <g key={id} className={down ? 'ngx-down' : ''}>
            <rect x={t.x} y={t.y} width={TW} height={t.h} rx="5" className={`ngx-box${active === id ? ' on' : ''}${down ? ' down' : ''}`} />
            <text x={t.x + 10} y={t.y + (isApp ? 21 : 17)} className="svg-text" style={{ fontWeight: 700 }}>{t.title}</text>
            {isApp ? (
              <>
                <text x={t.x + 46} y={t.y + 21} className="svg-mono" style={{ fill: 'var(--ink-2)' }}>{t.sub}</text>
                {down
                  ? <text x={t.x + TW - 8} y={t.y + 21} className="ngx-err" textAnchor="end">down ✕</text>
                  : <text x={t.x + TW - 8} y={t.y + 21} className={`ngx-count${active === id ? ' hot' : ''}`} textAnchor="end">×{counts[id]}</text>}
              </>
            ) : <text x={t.x + 10} y={t.y + 31} className="svg-text small">{t.sub}</text>}
            {active === id && <text key={hit.id} x={t.x - 8} y={t.y + t.h / 2 - 5} className="ngx-ok svg-pop" textAnchor="end">200 OK</text>}
          </g>
        )
      })}
    </svg>
  )
}
