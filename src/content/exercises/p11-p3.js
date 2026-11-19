// 程式題：p11-p3（spa-containers）
// 設定檔題的測試碼是 JS：使用者內容是 `source`，`lines` 是去掉 # 註解與空行的各行。
// 測試碼用 String.raw 寫；測試碼裡不要出現 `${` 與反引號。
const R = String.raw

// Dockerfile 用：依 FROM 切成各個 stage；copyArgs 取出 COPY 的來源與目的地（去掉 --from 這類旗標）
const DOCKER = R`
function stages() {
  const out = []
  for (const l of lines) {
    if (/^\s*FROM\s/i.test(l)) out.push([l])
    else if (out.length) out[out.length - 1].push(l)
  }
  return out
}
function stageName(st) { return (st[0].match(/\sAS\s+(\S+)/i) || [])[1] || null }
function copyArgs(l) {
  const parts = l.trim().split(/\s+/).slice(1).filter((t) => !t.startsWith('--'))
  return { srcs: parts.slice(0, -1), dest: parts[parts.length - 1] || '' }
}
const isCopyFrom = (l) => /^\s*COPY\s+(--\S+\s+)*--from=/i.test(l) || /^\s*COPY\s.*\s--from=/i.test(l)
`

// nginx 用：小型的 nginx 設定直譯器。解析 server 區塊，照 nginx 的規則選 location（= 精確、^~、最長前綴、
// 依序試 regex、巢狀 location）、處理 try_files 與內部轉址，並套用 add_header / root / proxy_set_header 的繼承規則
// （這一層有自己的指令就不繼承上一層；支援 add_header_inherit）。檔案系統是一份假的 dist。
const NGINX = R`
function tokenize(src) {
  const toks = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '{' || c === '}' || c === ';') { toks.push({ t: c }); i++; continue }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++ }
      toks.push({ w: src.slice(i + 1, j) }); i = j + 1; continue
    }
    let j = i
    while (j < src.length && !/[\s{};]/.test(src[j])) j++
    toks.push({ w: src.slice(i, j) }); i = j
  }
  return toks
}
function parseConf(src) {
  const toks = tokenize(src)
  let pos = 0
  function block() {
    const out = []
    while (pos < toks.length && toks[pos].t !== '}') {
      const words = []
      while (pos < toks.length && toks[pos].w !== undefined) words.push(toks[pos++].w)
      const tk = toks[pos]
      if (!tk) { assert(false, '設定沒有結束：最後一個指令少了分號或大括號'); }
      if (tk.t === ';') { pos++; if (words.length) out.push({ name: words[0], args: words.slice(1) }); continue }
      if (tk.t === '{') { pos++; const body = block(); assert(toks[pos] && toks[pos].t === '}', '大括號沒有成對'); pos++; out.push({ name: words[0], args: words.slice(1), block: body }); continue }
      break
    }
    return out
  }
  const top = block()
  assert(pos >= toks.length, '多了一個 }，大括號沒有成對')
  return top
}
function server() {
  const top = parseConf(lines.join('\n'))
  const http = top.find((d) => d.name === 'http')
  const all = (http ? http.block : top).filter((d) => d.name === 'server' && d.block)
  assert(all.length, '找不到 server { … } 區塊')
  return all[0]
}
function locs(level) {
  return (level.block || []).filter((d) => d.name === 'location' && d.block).map((d) => {
    const mod = d.args.length > 1 ? d.args[0] : ''
    return { mod, path: d.args.length > 1 ? d.args[1] : d.args[0], node: d }
  })
}
function pick(list, uri) {
  const exact = list.find((l) => l.mod === '=' && l.path === uri)
  if (exact) return exact
  let best = null
  for (const l of list) if ((l.mod === '' || l.mod === '^~') && uri.startsWith(l.path) && (!best || l.path.length > best.path.length)) best = l
  if (best && best.mod === '^~') return best
  for (const l of list) {
    if (l.mod !== '~' && l.mod !== '~*') continue
    let re = null
    try { re = new RegExp(l.path, l.mod === '~*' ? 'i' : '') } catch (e) { assert(false, 'location 的 regex 寫錯了：' + l.path) }
    if (re.test(uri)) return l
  }
  return best
}
function chainFor(uri) {
  const chain = [server()]
  let level = chain[0]
  for (;;) {
    const l = pick(locs(level), uri)
    if (!l) break
    chain.push(l.node)
    level = l.node
  }
  return chain
}
function own(level, name) { return (level.block || []).filter((d) => d.name === name) }
function inherited(chain, name) {
  for (let i = chain.length - 1; i >= 0; i--) { const d = own(chain[i], name); if (d.length) return d }
  return []
}
function headersOf(chain) {
  let eff = [], mode = 'on'
  for (const level of chain) {
    const m = own(level, 'add_header_inherit')
    if (m.length) mode = m[m.length - 1].args[0]
    const mine = own(level, 'add_header')
    if (mode === 'off') eff = mine
    else if (mine.length) eff = mode === 'merge' ? eff.concat(mine) : mine
  }
  const h = {}
  for (const d of eff) { const k = (d.args[0] || '').toLowerCase(); h[k] = h[k] ? h[k] + ', ' + d.args[1] : d.args[1] }
  return h
}
const FILES = new Set(['/index.html', '/favicon.ico', '/assets/index-3f9c2a1b.js', '/assets/vendor-8d1e7f40.js', '/assets/index-5b2e9c11.css'])
const DIRS = new Set(['/', '/assets/'])
const ROOT = '/etc/nginx/html'
function handle(uri, depth) {
  depth = depth || 0
  assert(depth < 10, uri + '：內部轉址超過 10 次，try_files 的 fallback 繞成迴圈了')
  const chain = chainFor(uri)
  const loc = chain[chain.length - 1]
  const where = chain.length > 1 ? 'location ' + loc.args.join(' ') : 'server（沒有 location 符合）'
  const headers = headersOf(chain)
  const pp = own(loc, 'proxy_pass')[0]
  if (pp) return { kind: 'proxy', target: pp.args[0], uri, headers, where, chain }
  const ret = own(loc, 'return')[0]
  if (ret) return { kind: 'return', status: Number(ret.args[0]), headers, where, chain }
  const rootD = inherited(chain, 'root')[0]
  const root = rootD ? rootD.args[0].replace(/\/+$/, '') : null
  const isFile = (p) => root === ROOT && FILES.has(p)
  const isDir = (p) => root === ROOT && DIRS.has(p)
  const serveUri = (p) => {
    if (p.endsWith('/')) return isDir(p) ? handle(p + 'index.html', depth + 1) : { kind: 'status', status: 404, headers, where, chain, root }
    return isFile(p) ? { kind: 'file', file: p, status: 200, headers, where, chain, root } : { kind: 'status', status: 404, headers, where, chain, root }
  }
  const tf = inherited(chain, 'try_files')[0]
  if (!tf) return serveUri(uri)
  const args = tf.args
  for (const a of args.slice(0, -1)) {
    const p = a.split('$uri').join(uri)
    if (p.endsWith('/') ? isDir(p) : isFile(p)) return serveUri(p)
  }
  const last = args[args.length - 1] || ''
  if (/^=\d{3}$/.test(last)) return { kind: 'status', status: Number(last.slice(1)), headers, where, chain, root }
  return handle(last.split('$uri').join(uri), depth + 1)
}
function cacheOf(r) { return (r.headers['cache-control'] || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean) }
function describe(r) {
  if (r.kind === 'file') return '由 ' + r.where + ' 送出 ' + r.file + '，Cache-Control: ' + (r.headers['cache-control'] || '（沒有）')
  if (r.kind === 'proxy') return '由 ' + r.where + ' 轉給 ' + r.target
  const why = r.root === null ? '（這個 location 讀不到 root：root 只寫在別的 location 裡，nginx 改用預設的 html 目錄）'
    : r.root && r.root !== ROOT ? '（這裡的 root 是 ' + r.root + '，檔案在 ' + ROOT + '）' : ''
  return '由 ' + r.where + ' 回 ' + r.status + why
}
`

export default [
  {
    id: 'spa-containers-1', skill: 'spa-containers', kind: 'config', level: 2, file: 'Dockerfile',
    title: '修正前端的多階段 Dockerfile',
    prompt: '門診掛號前端（Vue 3 + Vite）的 Dockerfile 已經分成兩個階段，但有四個問題：base image 用 `latest`、node 階段用 `npm install` 而且先 `COPY . .`、把整個 `/app`（連同 `node_modules` 與原始碼）帶進 nginx 映像、dist 複製到的目錄和 nginx 的 `root` 不一致。\n\n已知條件：\n\n- 專案有 `package.json` 與 `package-lock.json`，`npm run build` 的輸出在 `/app/dist`\n- 同目錄的 `nginx.conf` 寫的是 `root /etc/nginx/html;`，這個檔案不改\n- `.dockerignore` 已經排除 `node_modules` 與 `dist`\n\n修改成：\n\n- 每個 `FROM` 都用明確的版本 tag（例如 `node:24-alpine`、`nginx:1.30-alpine`），不能是 `latest` 或省略 tag\n- node 階段先只複製 `package.json` 與 `package-lock.json`，用 `npm ci` 安裝，**之後**才複製原始碼、執行 `npm run build`\n- 最後的 nginx 階段只用 `COPY --from=<建置階段>` 拿 `/app/dist`，目的地是 `/etc/nginx/html`\n- 保留把 `nginx.conf` 複製到 `/etc/nginx/conf.d/default.conf` 的那一行',
    starter: `# 門診掛號前端：Vue 3 + Vite，建置後交給 nginx
FROM node:latest AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

FROM nginx:latest
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app /usr/share/nginx/html
EXPOSE 80
`,
    solution: `# 門診掛號前端：Vue 3 + Vite，建置後交給 nginx

# ---- build：照 lock 檔裝依賴、建置 ----
FROM node:24-alpine AS build
WORKDIR /app
# 先只複製依賴清單：原始碼改了，npm ci 這一層還能用快取
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime：只有 nginx、設定與 dist ----
FROM nginx:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# 只拿建置結果；目的地和 nginx.conf 的 root 一致
COPY --from=build /app/dist /etc/nginx/html
EXPOSE 80
`,
    hints: [
      '`node:latest` 與 `nginx:latest` 都換成固定的 tag，例如 `node:24-alpine`、`nginx:1.30-alpine`。',
      '建置階段的順序：`COPY package.json package-lock.json ./` → `RUN npm ci` → `COPY . .` → `RUN npm run build`。`npm ci` 完全照 lock 檔安裝，`npm install` 可能改寫 lock 檔。',
      '最後一個階段的 `COPY --from=build` 來源寫 `/app/dist`（只有建置結果），目的地寫 `/etc/nginx/html`，和 nginx.conf 的 `root` 相同。',
    ],
    tests: [
      { name: '每個 FROM 都固定版本', code: R`
const froms = lines.filter((l) => /^\s*FROM\s/i.test(l))
assert(froms.length >= 2, '要有兩個階段：node 建置、nginx 執行')
for (const f of froms) {
  const img = f.trim().split(/\s+/).slice(1).find((t) => !t.startsWith('--')) || ''
  const pinned = /@sha256:[0-9a-f]+$/i.test(img) || (/:[^/:]+$/.test(img) && !/:latest$/i.test(img))
  assert(pinned, 'FROM 要寫明確的版本 tag（或 digest），不能是 latest 或省略 tag：' + f.trim())
}` },
      { name: 'node 階段：先複製依賴清單、npm ci，再複製原始碼與建置', code: DOCKER + R`
const build = stages().find((s) => s.some((l) => /npm\s+run\s+build/.test(l)))
assert(build, '找不到執行 npm run build 的階段')
assert(!build.some((l) => /^\s*RUN\s.*\bnpm\s+(install|i)\b/i.test(l)), '建置階段不要用 npm install：它可能更新 lock 檔，同一個 commit 兩次建置裝到不同版本；改用 npm ci')
const ci = build.findIndex((l) => /^\s*RUN\s.*\bnpm\s+ci\b/i.test(l))
assert(ci >= 0, '建置階段要用 RUN npm ci 照 package-lock.json 安裝')
const before = build.slice(0, ci).filter((l) => /^\s*COPY\s/i.test(l))
assert(before.some((l) => /package-lock\.json|package\*\.json/.test(l)), 'npm ci 之前要先複製 package.json 與 package-lock.json')
assert(!before.some((l) => copyArgs(l).srcs.some((s) => s === '.' || s === './')), 'npm ci 之前不要 COPY . .：原始碼一改，npm ci 那一層的快取就失效，每次都重裝依賴')
const after = build.slice(ci + 1)
const nb = after.findIndex((l) => /npm\s+run\s+build/.test(l))
assert(nb >= 0, 'npm run build 要在 npm ci 之後另一個 RUN 執行（中間先把原始碼複製進來）')
assert(after.slice(0, nb).some((l) => /^\s*COPY\s/i.test(l)), 'npm ci 之後、npm run build 之前要把原始碼複製進來（例如 COPY . .）')` },
      { name: 'nginx 映像只拿 dist，不帶 node_modules', code: DOCKER + R`
const st = stages()
assert(st.length >= 2, '要有兩個階段')
const names = st.slice(0, -1).map(stageName).filter(Boolean)
const last = st[st.length - 1]
const cps = last.filter(isCopyFrom)
assert(cps.length, '最後一個階段要用 COPY --from=<建置階段> 拿建置結果')
for (const l of cps) {
  const from = (l.match(/--from=(\S+)/i) || [])[1]
  assert(names.includes(from) || /^\d+$/.test(from), 'COPY --from= 要寫建置階段的名稱（例如 build）：' + l.trim())
  const { srcs } = copyArgs(l)
  assert(srcs.length && srcs.every((s) => /\/dist\/?$/.test(s)), '從建置階段只複製 dist（/app/dist），不要把整個 /app 連同 node_modules 與原始碼帶進 nginx 映像：' + l.trim())
}
assert(!last.some((l) => /node_modules/.test(l)), '最後一個階段不要碰 node_modules')` },
      { name: 'dist 複製到 nginx.conf 的 root（/etc/nginx/html）', code: DOCKER + R`
const last = stages().pop()
const l = last.find(isCopyFrom)
assert(l, '最後一個階段要有 COPY --from=… 那一行')
const dest = copyArgs(l).dest.replace(/\/+$/, '')
assert(dest === '/etc/nginx/html', 'nginx.conf 的 root 是 /etc/nginx/html，dist 要複製到同一個目錄（現在是 ' + (dest || '空的') + '）；目錄不一致時 nginx 找不到 index.html')` },
      { name: '保留 nginx.conf 的複製', code: DOCKER + R`
const last = stages().pop()
assert(last.some((l) => /^\s*COPY\s/i.test(l) && !/--from=/i.test(l) && /nginx\.conf\s+\/etc\/nginx\/conf\.d\/\S+\.conf\s*$/.test(l)), '最後一個階段要保留 COPY nginx.conf /etc/nginx/conf.d/default.conf')` },
    ],
  },
  {
    id: 'spa-containers-2', skill: 'spa-containers', kind: 'config', level: 2, file: 'default.conf',
    title: '替 SPA 的 nginx 設定分開快取',
    prompt: '這份 nginx 設定把 `no-cache, no-store, must-revalidate` 套在整個 `/`，連檔名帶 hash 的 `/assets/index-3f9c2a1b.js` 都不准存，每次開頁都重新下載全部的 JS；`/assets/` 底下找不到的檔案也會被換成 `index.html`。另外 server 層寫了 `X-Content-Type-Options`，但實際上沒有任何靜態檔的回應帶著它。\n\n修改成：\n\n- `index.html`（包含 `/`、直接開 `/patients/123` 這類 SPA fallback 的回應）：`Cache-Control: no-cache`，不能有 `no-store`\n- `/assets/` 底下的檔案：`Cache-Control: public, max-age=31536000, immutable`；不存在的檔案回 **404**，不能換成 `index.html`\n- 其他靜態檔（例如 `/favicon.ico`）照樣送得出來，不能有 `no-store`\n- 每個靜態檔的回應都帶 `X-Content-Type-Options: nosniff`\n- 保留 SPA fallback，以及 `/api/` 轉給 `http://clinic-api:9696` 的設定與三個 `proxy_set_header`；nginx 不替 `/api/` 的回應加 `Cache-Control`\n\n快取標頭用 `add_header` 設定（不用 `expires`）。檢查器會用一份假的 dist（`/index.html`、`/favicon.ico`、`/assets/` 底下三個檔案，放在 `/etc/nginx/html`）實際走一遍 location 的選擇、`try_files` 與 `add_header` 的繼承規則。',
    starter: `server {
    listen 8080;
    server_name _;

    add_header X-Content-Type-Options "nosniff" always;

    location / {
        root /etc/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    location /api/ {
        proxy_pass http://clinic-api:9696;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }
}
`,
    solution: `server {
    listen 8080;
    server_name _;
    root /etc/nginx/html;            # 搬到 server 層，下面每個 location 都用得到
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;

    # 入口：每次驗證。SPA fallback 是內部轉址到 /index.html，也會落到這裡
    location = /index.html {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;   # 這一層有 add_header，不再繼承 server 層
    }

    # 檔名帶 hash：存一年；找不到就 404，不要換成 index.html
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    location /api/ {
        proxy_pass http://clinic-api:9696;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }
}
`,
    hints: [
      '加一個 `location = /index.html` 給 `no-cache`。`try_files` 最後的 `/index.html` 是內部轉址，nginx 會用這個路徑重新選 location，所以 `/patients/123` 也會拿到這裡的標頭。',
      '`location /assets/` 裡寫 `try_files $uri =404;` 與長效快取的 `add_header`。`root` 原本只寫在 `location /` 裡，新的 location 讀不到，把它搬到 server 層。',
      '一個 location 只要有自己的 `add_header`，就不再繼承 server 層的 `add_header`：在每個有 `add_header` 的 location 再寫一次 nosniff（nginx 1.29.3 起也可以在 server 層寫 `add_header_inherit merge;`）。',
    ],
    tests: [
      { name: 'index.html 與 SPA fallback：no-cache，沒有 no-store', code: NGINX + R`
for (const uri of ['/', '/index.html', '/patients/123']) {
  const r = handle(uri)
  assert(r.kind === 'file' && r.file === '/index.html', uri + ' 應該送出 /index.html：' + describe(r))
  const cc = cacheOf(r)
  assert(cc.includes('no-cache'), uri + ' 的 Cache-Control 要有 no-cache：' + describe(r))
  assert(!cc.includes('no-store'), uri + ' 不要 no-store：index.html 可以存，只是每次要確認（' + describe(r) + '）')
}` },
      { name: '/assets/ 底下：長效快取加 immutable', code: NGINX + R`
for (const uri of ['/assets/index-3f9c2a1b.js', '/assets/vendor-8d1e7f40.js', '/assets/index-5b2e9c11.css']) {
  const r = handle(uri)
  assert(r.kind === 'file' && r.file === uri, uri + ' 應該送出檔案本身：' + describe(r))
  const cc = cacheOf(r)
  assert(cc.includes('public') && cc.includes('max-age=31536000') && cc.includes('immutable'), uri + ' 的 Cache-Control 要是 public, max-age=31536000, immutable：' + describe(r))
  assert(!cc.includes('no-store') && !cc.includes('no-cache'), uri + ' 不能同時有 no-store 或 no-cache：' + describe(r))
}` },
      { name: '/assets/ 底下找不到的檔案回 404', code: NGINX + R`
const r = handle('/assets/Billing-77aa1c2e.js')
assert(r.kind === 'status' && r.status === 404, '不存在的 /assets/Billing-77aa1c2e.js 要回 404，不能換成 index.html（瀏覽器會拿到 text/html 當 JS 執行失敗，長效快取還會把它存一年）：' + describe(r))` },
      { name: '其他靜態檔送得出來，沒有 no-store', code: NGINX + R`
const r = handle('/favicon.ico')
assert(r.kind === 'file' && r.file === '/favicon.ico', '/favicon.ico 應該送出檔案本身：' + describe(r))
assert(!cacheOf(r).includes('no-store'), '/favicon.ico 不要 no-store：' + describe(r))` },
      { name: '每個靜態檔的回應都帶 X-Content-Type-Options: nosniff', code: NGINX + R`
for (const uri of ['/patients/123', '/index.html', '/assets/index-3f9c2a1b.js', '/favicon.ico']) {
  const r = handle(uri)
  const v = (r.headers['x-content-type-options'] || '').toLowerCase()
  assert(v === 'nosniff', uri + ' 少了 X-Content-Type-Options: nosniff（' + r.where + ' 有自己的 add_header，就不會繼承 server 層的）')
}` },
      { name: '/api/ 照樣轉給 clinic-api:9696，nginx 不加 Cache-Control', code: NGINX + R`
const r = handle('/api/patients')
assert(r.kind === 'proxy', '/api/patients 應該轉給後端：' + describe(r))
assert(r.target === 'http://clinic-api:9696', 'proxy_pass 維持 http://clinic-api:9696（不帶 URI 部分，路徑原樣轉送）；現在是 ' + r.target)
const names = inherited(r.chain, 'proxy_set_header').map((d) => (d.args[0] || '').toLowerCase())
for (const h of ['host', 'x-forwarded-for', 'x-forwarded-proto']) assert(names.includes(h), '/api/ 少了 proxy_set_header ' + h)
assert(!r.headers['cache-control'], '/api/ 的回應不要由 nginx 加 Cache-Control，交給後端決定（現在會加上 ' + r.headers['cache-control'] + '）')` },
    ],
  },
]
