import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Code, Callout, Status, useWidth } from './ui.jsx'

/* ============================================================
   REST API 設計：資源、方法、狀態碼
   - 選「我想要…」→ 資源樹亮出碰到的節點、大字顯示正確的 METHOD /path
   - 右邊 orders 表跟著請求變：新增列、改欄位、PUT 清掉沒帶的欄位、DELETE 劃掉
   - 重送情境切 Idempotency-Key 看會不會重複下單
   ============================================================ */

const BASE_ROWS = [
  { id: 40, status: 'paid', note: null },
  { id: 41, status: 'pending', note: null },
  { id: 42, status: 'paid', note: '先來電' },
]

const PROPS = {
  GET: { idem: true, safe: true, cache: true },
  POST: { idem: false, safe: false, cache: false },
  PUT: { idem: true, safe: false, cache: false },
  PATCH: { idem: false, safe: false, cache: false },
  DELETE: { idem: true, safe: false, cache: false },
}

const ORDER = ['list', 'create', 'get', 'patch', 'put', 'delete', 'retry', 'filter']
const SCEN = {
  list: { label: '列出訂單', method: 'GET', path: '/orders', target: 'orders', code: '200 OK', wrong: ['GET /getOrders', 'POST /orders/list'],
    title: 'GET 集合：名詞、複數，動作交給方法',
    text: ['資源用**名詞、複數**：`/orders` 是「訂單這個集合」，動作由 HTTP 方法表達，所以不需要 `getOrders`、`list` 這種動詞塞進路徑。', 'GET 是安全（不改狀態）又冪等的，中間的 CDN / proxy 才敢快取。回傳集合時用物件包起來（`{"data": [...]}`）而不是裸陣列，之後要加 `next_cursor`、`total` 才有地方放。'] },
  create: { label: '建立訂單', method: 'POST', path: '/orders', target: 'orders', code: '201 Created', wrong: ['POST /createOrder', 'GET /orders/new?customer=7'],
    title: 'POST 集合：新增一筆，回 201 + Location',
    text: ['對集合 POST = 「在這個集合裡新增一筆」。成功回 **201 Created**（不是 200），並用 `Location` 標頭告訴 client 新資源住在哪。', 'POST **不是冪等的**：同樣的請求送兩次就是兩筆訂單——這正是「重送同一個建立請求」情境要處理的問題。'] },
  get: { label: '看一筆', method: 'GET', path: '/orders/42', target: 'id', code: '200 OK', wrong: ['GET /getOrder?id=42', 'POST /orders/detail'],
    title: 'GET 單一資源：集合名 + id',
    text: ['`/orders/42` 是**單一資源**：集合名接 id。巢狀最多兩層——`/orders/42/items` 可以，`/customers/7/orders/42/items/3` 就該拆成 `/order-items/3`。', '找不到回 **404**。錯誤回應全站統一格式 `{"error": {"code", "message"}}`，client 才能一致處理；4xx 是 client 的錯（要的東西不存在、格式不對、沒權限），5xx 才是 server 的錯。'] },
  patch: { label: '部分更新', method: 'PATCH', path: '/orders/42', target: 'id', code: '200 OK', wrong: ['POST /updateOrder', 'PUT /orders/42（只帶一個欄位）'],
    title: 'PATCH：只改我送的欄位',
    text: ['PATCH = **只改 body 裡有的欄位**，沒送的不動——看表格，`status` 變了但 `note` 還在。這是「部分更新」的正確方法；`POST /updateOrder` 是把動詞塞進 URL 的 RPC 寫法。', 'PATCH 規範上不保證冪等（例如「數量 +1」這種語意的 patch），實務上多數是設值型、重送無害，但別依賴它。'] },
  put: { label: '整筆取代', method: 'PUT', path: '/orders/42', target: 'id', code: '200 OK', wrong: ['POST /orders/42/update', 'PUT /orders（沒有 id）'],
    title: 'PUT：整筆取代，沒帶的欄位等於刪掉',
    text: ['PUT 的 body 要帶**完整的資源表示**，server 用它整個換掉舊的——看表格，這次沒帶 `note`，所以 `note` 變成 NULL 了。', '因此 PUT 是冪等的（同樣 body 送幾次結果都一樣），但拿 PUT 做部分更新會意外清掉欄位，這是最常見的 PUT / PATCH 誤用。'] },
  delete: { label: '刪除', method: 'DELETE', path: '/orders/42', target: 'id', code: '204 No Content', wrong: ['GET /orders/delete/42', 'POST /orders/42/delete'],
    title: 'DELETE：成功回 204，沒有 body',
    text: ['DELETE 單一資源，成功回 **204 No Content**。DELETE 是冪等的：第二次刪同一筆，最終狀態一樣（資源不存在），回 404 或 204 都有人用，團隊統一就好。', '絕對不要用 GET 做刪除——爬蟲、瀏覽器的連結預抓（prefetch）會幫你把資料刪光；GET 必須是安全的。'] },
  retry: { label: '重送同一個建立請求', method: 'POST', path: '/orders', target: 'orders', twice: true, wrong: ['timeout 後直接重送，沒有任何識別'],
    title: '' },
  filter: { label: '篩選＋分頁', method: 'GET', path: '/orders?status=paid&limit=20&cursor=eyJpZCI6NDB9', target: 'orders', code: '200 OK', wrong: ['GET /orders/paid/page/3', 'POST /orders/search'],
    title: '篩選、排序、分頁都放 query string',
    text: ['條件不要長進路徑（`/orders/paid/page/3`），放 query string：`?status=paid&limit=20`。路徑描述「哪個資源」，query 描述「怎麼看它」。', '分頁用 **cursor**：`next_cursor` 是「最後一筆的位置」編碼（這裡是 base64 的 `{"id":42}`），下一頁帶回來，server 做 `WHERE id > 42 LIMIT 20`——資料中途新增或刪除也不會跳頁、重複，大表不用 `OFFSET 100000` 從頭數。offset 分頁（`?page=3`）簡單、可跳頁，適合後台小表。'] },
}

const RETRY = {
  off: { code: '201 ×2', title: '沒有 key：timeout 重送 = 重複下單',
    text: ['Client 送出 POST 後網路 timeout，它不知道 server 到底收到沒，於是重送——server 收到兩個一模一樣的請求，老實地建了兩筆訂單（43、44）。', 'POST 本身不冪等；client SDK 的自動 retry、手機弱網、gateway 的重試策略都會把這個問題放大。任何「會扣款、會出貨」的 POST 都該防。'] },
  on: { code: '201（同一筆）', title: 'Idempotency-Key：同一把 key 只做一次',
    text: ['Client 先產生一把唯一的 `Idempotency-Key`（UUID），兩次請求帶同一把。Server 第一次處理時把 key → 結果存起來（例如 Redis，設 24 小時 TTL）；第二次看到同一把 key，直接回存好的結果，**不再建立**。', '回應可以是原樣的 201 加 `Idempotent-Replayed: true` 標頭（Stripe 的做法），也有人回 200——重點是 **id 是同一筆**。這把 key 是 client 給的，server 不能自己猜。'] },
}

function httpSample(k, v1, nf, key) {
  const P = (p) => (v1 ? '/v1' : '') + p
  switch (k) {
    case 'list': return `GET ${P('/orders')} HTTP/1.1
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json

{"data": [
  {"id": 40, "status": "paid"},
  {"id": 41, "status": "pending"},
  {"id": 42, "status": "paid"}
]}`
    case 'create': return `POST ${P('/orders')} HTTP/1.1
Content-Type: application/json

{"customer_id": 7,
 "items": [{"sku": "KB-01", "qty": 1}]}

HTTP/1.1 201 Created
Location: ${P('/orders/43')}

{"id": 43, "status": "pending", "total": 2400}`
    case 'get': return nf ? `GET ${P('/orders/999')} HTTP/1.1

HTTP/1.1 404 Not Found
Content-Type: application/json

{"error": {
  "code": "order_not_found",
  "message": "Order 999 does not exist"
}}` : `GET ${P('/orders/42')} HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{"id": 42, "status": "paid", "total": 2400,
 "note": "先來電",
 "items": [{"sku": "KB-01", "qty": 1}]}`
    case 'patch': return `PATCH ${P('/orders/42')} HTTP/1.1
Content-Type: application/json

{"status": "shipped"}

HTTP/1.1 200 OK

{"id": 42, "status": "shipped",
 "note": "先來電"}`
    case 'put': return `PUT ${P('/orders/42')} HTTP/1.1
Content-Type: application/json

{"customer_id": 7, "status": "paid",
 "items": [{"sku": "KB-01", "qty": 1}]}

HTTP/1.1 200 OK

{"id": 42, "status": "paid", "note": null}`
    case 'delete': return `DELETE ${P('/orders/42')} HTTP/1.1

HTTP/1.1 204 No Content`
    case 'retry': return key ? `POST ${P('/orders')} HTTP/1.1
Idempotency-Key: 8f1c2d-…-77a1

HTTP/1.1 201 Created
Location: ${P('/orders/43')}

# 網路 timeout，client 重送同一個請求
POST ${P('/orders')} HTTP/1.1
Idempotency-Key: 8f1c2d-…-77a1

HTTP/1.1 201 Created
Idempotent-Replayed: true

{"id": 43, "status": "pending"}` : `POST ${P('/orders')} HTTP/1.1
Content-Type: application/json

HTTP/1.1 201 Created
Location: ${P('/orders/43')}

# 網路 timeout，client 重送同一個請求
POST ${P('/orders')} HTTP/1.1
Content-Type: application/json

HTTP/1.1 201 Created
Location: ${P('/orders/44')}`
    case 'filter': return `GET ${P('/orders')}?status=paid&limit=20
    &cursor=eyJpZCI6NDB9 HTTP/1.1

HTTP/1.1 200 OK

{"data": [
  {"id": 42, "status": "paid"},
  …
],
 "next_cursor": "eyJpZCI6NDJ9"}`
    default: return ''
  }
}

function dbRows(k, nf, key) {
  const rows = BASE_ROWS.map((r) => ({ ...r, cls: '' }))
  const r42 = rows[2]
  switch (k) {
    case 'create': rows.push({ id: 43, status: 'pending', note: null, cls: 'row-in hit' }); break
    case 'get': if (!nf) r42.cls = 'hit'; break
    case 'patch': r42.status = 'shipped'; r42.cls = 'hit'; r42.changed = ['status']; break
    case 'put': r42.note = null; r42.cls = 'hit'; r42.changed = ['note']; break
    case 'delete': r42.cls = 'off'; break
    case 'retry':
      rows.push({ id: 43, status: 'pending', note: null, cls: 'row-in hit' })
      if (!key) rows.push({ id: 44, status: 'pending', note: null, cls: 'row-in hit dup' })
      break
    case 'filter': rows.forEach((r) => { r.cls = r.status === 'paid' ? 'hit' : 'dim' }); break
    default: break
  }
  return rows
}

export default function RestLab() {
  const [k, setK] = useState('list')
  const [v1, setV1] = useState(false)
  const [key, setKey] = useState(false)
  const [nf, setNf] = useState(false)
  const s = SCEN[k]
  const props = { ...PROPS[s.method] }
  if (k === 'retry' && key) props.idem = 'key'
  const code = k === 'retry' ? RETRY[key ? 'on' : 'off'].code : k === 'get' && nf ? '404 Not Found' : s.code
  const family = code.startsWith('4') ? '4xx' : '2xx'
  const explain = k === 'retry' ? RETRY[key ? 'on' : 'off'] : s
  const rows = dbRows(k, nf, key)
  const shownPath = (v1 ? '/v1' : '') + (k === 'get' && nf ? '/orders/999' : s.path)

  return (
    <Lab accent="aqua" kicker="API LAB" title="REST API 設計：資源、方法、狀態碼"
         blurb="先想「我想對哪個資源做什麼」，再對照出正確的方法與路徑。切換情境看資源樹亮哪個節點、資料表怎麼變；重送情境可以打開 Idempotency-Key 看它怎麼擋住重複下單。">
      <LabControls>
        <Seg label="我想要…" tinted value={k} onChange={setK}
             options={ORDER.map((x) => ({ value: x, label: SCEN[x].label }))} />
        {k === 'retry' && <Toggle label="帶 Idempotency-Key 標頭" checked={key} onChange={setKey} />}
        {k === 'get' && <Toggle label="id 不存在" checked={nf} onChange={setNf} />}
        <span className="spacer" />
        <Toggle label="路徑加版本 /v1" checked={v1} onChange={setV1} />
      </LabControls>

      <LabGrid>
        <LabStage label="資源樹與請求" caption="上：資源樹，亮起的節點是這次請求碰到的；下：orders 表（節錄）跟著請求變">
          <div className="rest-hero" key={`${k}-${nf}-${key}-${v1}`}>
            <div className="rest-line">
              <span className={`rest-m m-${s.method}`}>{s.method}</span>
              <span className="rest-path">{shownPath}</span>
              {s.twice && <span className="tag">送 2 次</span>}
            </div>
            <div className="rest-wrong">常見錯誤寫法：{s.wrong.map((w) => <s key={w}>{w}</s>)}</div>
            <div className="rest-chips">
              {props.idem === 'key' ? <Status ok>冪等（靠 key）</Status> : props.idem ? <Status ok>冪等</Status> : <Status>不冪等</Status>}
              {props.safe ? <Status ok>安全（不改狀態）</Status> : <Status>不安全（會改狀態）</Status>}
              {props.cache ? <Status ok>可快取</Status> : <Status>不可快取</Status>}
            </div>
          </div>
          <div className="rest-mid">
            <Tree target={s.target} twice={s.twice} filter={k === 'filter'} nf={k === 'get' && nf} />
            <div className="dtable-wrap">
              <table className="dtable rest-db">
                <caption>orders 表（節錄）</caption>
                <thead><tr><th>id</th><th>status</th><th>note</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${k}-${r.id}-${key}`} className={r.cls}>
                      <td>{r.id}{r.cls.includes('dup') && <span className="tag rest-dup">重複下單</span>}</td>
                      <td className={r.changed?.includes('status') ? 'rest-chg' : ''}>{r.status}</td>
                      <td className={r.note ? (r.changed?.includes('note') ? 'rest-chg' : '') : `null${r.changed?.includes('note') ? ' rest-chg' : ''}`}>{r.note ?? 'NULL'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rest-codes">
            <span className="seg-label">狀態碼家族</span>
            <span className={`pill ${family === '2xx' ? 'on' : ''}`}>2xx 成功</span>
            <span className={`pill ${family === '4xx' ? 'on' : ''}`}>4xx client 的錯</span>
            <span className="pill">5xx server 的錯</span>
            <b key={code} className="rest-code">{code}</b>
          </div>
        </LabStage>

        <div className="lab-stack">
          <Code lang="http" title="請求 → 回應">{httpSample(k, v1, nf, key)}</Code>
          <LabExplain title={explain.title}>
            {explain.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            開新功能先畫資源樹（哪些名詞、誰包含誰），再對每個節點列出允許的方法，endpoint 自然就出來了；動詞想塞進 URL 時，先問「這是哪個資源的哪種狀態變化」。PUT 與 PATCH 別混用：前端表單「只改一個欄位」就是 PATCH，拿 PUT 會把別人剛填的欄位洗掉。版本用 <code>/v1</code> 前綴，破壞性改動才升 v2、兩版並行一陣子。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .rest-hero { display: grid; gap: 8px; padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--hairline); animation: rest-in 0.3s ease-out; }
        @keyframes rest-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        .rest-line { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-family: var(--mono); }
        .rest-m { --m: var(--lab-accent); font-weight: 700; font-size: 1.15rem; letter-spacing: 0.04em; padding: 2px 8px; border-radius: var(--radius); color: var(--m); background: color-mix(in srgb, var(--m) 16%, transparent); box-shadow: inset 0 0 0 1.5px var(--m); }
        .rest-m.m-POST { --m: var(--c-orange); } .rest-m.m-PUT { --m: var(--c-violet); } .rest-m.m-PATCH { --m: var(--c-yellow); } .rest-m.m-DELETE { --m: var(--c-red); }
        .rest-path { font-size: 1.3rem; font-weight: 600; color: var(--ink-1); word-break: break-all; }
        .rest-wrong { font-size: 0.8rem; color: var(--ink-3); display: flex; gap: 10px; flex-wrap: wrap; }
        .rest-wrong s { font-family: var(--mono); color: var(--critical); text-decoration-color: var(--critical); opacity: 0.85; }
        .rest-chips { display: flex; gap: 8px; flex-wrap: wrap; }
        .rest-mid { display: grid; gap: 16px; }
        .rest-tree { width: 100%; max-width: 560px; margin: 0 auto; }
        .rest-db td.rest-chg { background: color-mix(in srgb, var(--c-yellow) 22%, transparent); }
        .rest-db .rest-dup { margin-left: 8px; color: var(--critical); border-color: var(--critical); font-size: 0.62rem; }
        .rest-codes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline); }
        .rest-codes .pill { font-size: 0.72rem; padding: 2px 9px; border: 1px solid var(--hairline); border-radius: 999px; color: var(--ink-3); background: var(--surface-1); }
        .rest-codes .pill.on { border-color: var(--lab-accent); color: var(--lab-accent); font-weight: 700; }
        .rest-codes .rest-code { margin-left: auto; font-family: var(--mono); font-size: 1rem; color: var(--ink-1); animation: rest-in 0.3s ease-out; }
        .rest-tree .svg-node.pass { stroke: var(--lab-accent); stroke-dasharray: 3 3; }
        .rest-tree .svg-node.on { fill: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); }
        .rest-tree .role { font-family: var(--sans); font-size: 10px; fill: var(--ink-3); }
        .rest-tree .client { fill: var(--surface-2); stroke: var(--ink-3); }
        .rest-tree .q { font-family: var(--mono); font-size: 10px; fill: var(--lab-accent); }
        .rest-tree .miss { fill: var(--critical); font-family: var(--mono); font-size: 10px; }
        @media (prefers-reduced-motion: reduce) { .rest-hero, .rest-codes .rest-code { animation: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

/* 資源樹：client → /orders → /orders/{id} → /orders/{id}/items（手機改直排） */
function Tree({ target, twice, filter, nf }) {
  const box = useRef(null)
  const vertical = useWidth(box, 600) < 480
  const onOrders = target === 'orders'
  const onId = target === 'id'
  const h = 30
  const nodes = [
    { t: '/orders', w: 96, role: '集合', cls: onOrders ? 'on' : onId ? 'pass' : '' },
    { t: '/orders/{id}', w: 110, role: '單一資源', cls: onId ? 'on' : '' },
    { t: '/orders/{id}/items', w: 140, role: '子資源（最多兩層）', cls: '' },
  ]
  /* 橫排：節點沿 x 排；直排：沿 y 排、角色標籤放右邊 */
  const N = nodes.map((n, i) => vertical
    ? { ...n, x: 14, y: 64 + i * 58 }
    : { ...n, x: [84, 220, 370][i], y: 34 })
  const client = vertical ? { x: 14, y: 8, w: 52 } : { x: 6, y: 34, w: 52 }
  const mid = (n) => vertical ? { x: n.x + 40, y: n.y } : { x: n.x, y: n.y + h / 2 }
  const end = (n) => vertical ? { x: n.x + 40, y: n.y + h } : { x: n.x + n.w, y: n.y + h / 2 }
  const edge = (a, b) => `M${end(a).x},${end(a).y} L${mid(b).x - (vertical ? 0 : 2)},${mid(b).y}`
  const labelY = (n) => vertical ? n.y - 8 : n.y - 8
  const W = vertical ? 340 : 520, H = vertical ? 250 : 120
  return (
    <div ref={box}>
      <svg className="rest-tree" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`資源樹，目前碰到 ${onId ? '/orders/{id}' : '/orders'}`}>
        <rect className="svg-node client" x={client.x} y={client.y} width={client.w} height={h} rx="15" />
        <text className="svg-text small" x={client.x + 26} y={client.y + 19} textAnchor="middle">client</text>
        <path className="svg-edge on svg-flow" d={edge({ ...client, w: client.w }, N[0])} />
        <path className={`svg-edge ${onId ? 'on svg-flow' : ''}`} d={edge(N[0], N[1])} />
        <path className="svg-edge svg-dash" d={edge(N[1], N[2])} />
        {N.map((n) => (
          <g key={n.t}>
            <rect className={`svg-node ${n.cls}`} x={n.x} y={n.y} width={n.w} height={h} rx="4" />
            <text className="svg-mono" x={n.x + n.w / 2} y={n.y + 19} textAnchor="middle">{n.t}</text>
            {vertical
              ? <text className="role" x={n.x + n.w + 10} y={n.y + 19}>{n.role}</text>
              : <text className="role" x={n.x + n.w / 2} y={n.y + h + 16} textAnchor="middle">{n.role}</text>}
          </g>
        ))}
        {twice && <text key="twice" className="svg-mono svg-pop" x={vertical ? client.x + 66 : 70} y={vertical ? client.y + 19 : N[0].y - 6} textAnchor={vertical ? 'start' : 'middle'} style={{ fill: 'var(--c-orange)', fontWeight: 700 }}>×2 送兩次</text>}
        {filter && <text key="q" className="q svg-pop" x={vertical ? N[0].x + N[0].w + 10 : N[0].x + N[0].w / 2} y={vertical ? N[0].y + 19 : labelY(N[0])} textAnchor={vertical ? 'start' : 'middle'}>{vertical ? '?status=paid&limit=20' : '?status=paid&limit=20&cursor=…'}</text>}
        {nf && <text key="nf" className="miss svg-pop" x={vertical ? N[1].x + N[1].w + 10 : N[1].x + N[1].w / 2} y={vertical ? N[1].y + 19 : labelY(N[1])} textAnchor={vertical ? 'start' : 'middle'}>id=999 不存在 → 404</text>}
        {!vertical && <text className="svg-text small" x="260" y="108" textAnchor="middle">路徑描述「哪個資源」；方法描述「做什麼」；query 描述「怎麼看」</text>}
      </svg>
    </div>
  )
}
