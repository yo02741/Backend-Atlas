// 程式題：網路、HTTP 與 API 設計（JavaScript 在瀏覽器 Worker 裡執行）
export default [
  {
    id: 'http-basics-1', skill: 'http-basics', kind: 'js', level: 1,
    title: '解析一段原始 HTTP 請求',
    prompt: '實作 `parseRequest(raw)`：把原始 HTTP 請求文字解析成 `{ method, path, headers, body }`。\n\n- 第一行是 `METHOD PATH HTTP/1.1`\n- 標頭一行一個 `Name: value`，key 轉成**小寫**、value 去頭尾空白\n- 空行之後全部是 body（可能沒有，回空字串）\n- 行尾是 `\\r\\n`',
    starter: `function parseRequest(raw) {
  // TODO
  return { method: '', path: '', headers: {}, body: '' }
}

const raw = 'POST /orders HTTP/1.1\\r\\nHost: api.example.com\\r\\nContent-Type: application/json\\r\\n\\r\\n{"item":"鍵盤"}'
console.log(parseRequest(raw))
`,
    solution: `function parseRequest(raw) {
  const sep = raw.indexOf('\\r\\n\\r\\n')
  const head = sep === -1 ? raw : raw.slice(0, sep)
  const body = sep === -1 ? '' : raw.slice(sep + 4)
  const [requestLine, ...headerLines] = head.split('\\r\\n')
  const [method, path] = requestLine.split(' ')
  const headers = {}
  for (const line of headerLines) {
    if (!line) continue
    const i = line.indexOf(':')
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return { method, path, headers, body }
}

const raw = 'POST /orders HTTP/1.1\\r\\nHost: api.example.com\\r\\nContent-Type: application/json\\r\\n\\r\\n{"item":"鍵盤"}'
console.log(parseRequest(raw))
`,
    tests: [
      { name: 'GET 無 body', code: `const r = parseRequest('GET /users/1?x=1 HTTP/1.1\\r\\nHost: api.example.com\\r\\nAccept: application/json\\r\\n\\r\\n')\nassertEqual(r, { method: 'GET', path: '/users/1?x=1', headers: { host: 'api.example.com', accept: 'application/json' }, body: '' })` },
      { name: 'POST 帶 JSON body', code: `const r = parseRequest('POST /orders HTTP/1.1\\r\\nHost: a\\r\\nContent-Type: application/json\\r\\n\\r\\n{"item":"鍵盤"}')\nassertEqual(r.method, 'POST')\nassertEqual(r.headers['content-type'], 'application/json')\nassertEqual(JSON.parse(r.body), { item: '鍵盤' })` },
      { name: 'header 值含冒號也要對', code: `const r = parseRequest('GET / HTTP/1.1\\r\\nAuthorization: Bearer abc:def\\r\\n\\r\\n')\nassertEqual(r.headers.authorization, 'Bearer abc:def')` },
    ],
    hints: ['先用 indexOf("\\r\\n\\r\\n") 把 head 與 body 切開。', '標頭只切第一個冒號：indexOf(":") 而不是 split(":")。'],
  },
  {
    id: 'api-patterns-1', skill: 'api-patterns', kind: 'js', level: 2,
    title: 'cursor 分頁',
    prompt: '實作 `page(items, limit, cursor)`：`items` 已依 `id` 遞增排序。`cursor` 是上一頁最後一筆 id 的 base64（`btoa(String(id))`），第一頁為 `null`。回傳 `{ items, next_cursor }`：取 id **大於** cursor 的前 `limit` 筆；還有下一頁才給 `next_cursor`，否則 `null`。',
    starter: `function page(items, limit, cursor = null) {
  // TODO
  return { items: items.slice(0, limit), next_cursor: null }
}

const all = [1, 2, 3, 4, 5].map((id) => ({ id, name: 'item' + id }))
const p1 = page(all, 2)
console.log(p1)
console.log(page(all, 2, p1.next_cursor))
`,
    solution: `function page(items, limit, cursor = null) {
  const after = cursor === null ? -Infinity : Number(atob(cursor))
  const rest = items.filter((it) => it.id > after)
  const slice = rest.slice(0, limit)
  const hasMore = rest.length > limit
  return { items: slice, next_cursor: hasMore ? btoa(String(slice[slice.length - 1].id)) : null }
}

const all = [1, 2, 3, 4, 5].map((id) => ({ id, name: 'item' + id }))
const p1 = page(all, 2)
console.log(p1)
console.log(page(all, 2, p1.next_cursor))
`,
    tests: [
      { name: '第一頁', code: `const all = [1, 2, 3, 4, 5].map((id) => ({ id }))\nconst p = page(all, 2)\nassertEqual(p.items.map((i) => i.id), [1, 2])\nassertEqual(p.next_cursor, btoa('2'))` },
      { name: '用 cursor 翻頁', code: `const all = [1, 2, 3, 4, 5].map((id) => ({ id }))\nconst p = page(all, 2, btoa('2'))\nassertEqual(p.items.map((i) => i.id), [3, 4])\nassertEqual(p.next_cursor, btoa('4'))` },
      { name: '最後一頁 next_cursor 為 null', code: `const all = [1, 2, 3, 4, 5].map((id) => ({ id }))\nassertEqual(page(all, 2, btoa('4')), { items: [{ id: 5 }], next_cursor: null })\nassertEqual(page(all, 5), { items: all, next_cursor: null })` },
    ],
    hints: ['atob / btoa 在 Worker 裡可以直接用。', '「還有下一頁」要看「大於 cursor 的筆數」是否超過 limit，不能只看這頁滿不滿。'],
  },
]
