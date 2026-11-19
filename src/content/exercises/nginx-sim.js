// nginx 設定的小型直譯器（設定檔題的測試碼用，接在測試碼前面）：解析 server 區塊，照 nginx 的規則選 location
// （= 精確、^~、最長前綴、依序試 regex、巢狀 location）、處理 try_files 與內部轉址，並套用 add_header / root /
// proxy_set_header 的繼承規則（這一層有自己的指令就不繼承上一層；支援 add_header_inherit）。
// 檔案系統是一份假的 dist：使用的題目要在後面宣告 FILES（檔案的 URI）、DIRS（目錄的 URI）與 ROOT（dist 放的目錄）。
// 測試碼用 String.raw 寫；裡面不要出現 `${` 與反引號。
const R = String.raw

export const NGINX_SIM = R`
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
