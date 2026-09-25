import React, { useId, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Code, Callout } from './ui.jsx'

/* ============================================================
   SQL JOIN 視覺化：文氏圖 + 兩張來源表 + 即時結果表
   - 點來源表任一列可「模擬刪除」，看結果怎麼變
   - 滑過結果列，來源表對應列會亮起
   ============================================================ */

const USERS = [
  { id: 1, name: 'Alice', city: '台北' },
  { id: 2, name: 'Bob', city: '台中' },
  { id: 3, name: 'Carol', city: '高雄' },
  { id: 4, name: 'Dave', city: '台南' },
  { id: 5, name: 'Eve', city: '新竹' },
]
const ORDERS = [
  { id: 101, user_id: 1, item: '鍵盤', amount: 2400 },
  { id: 102, user_id: 1, item: '滑鼠', amount: 890 },
  { id: 103, user_id: 2, item: '螢幕', amount: 7990 },
  { id: 104, user_id: 3, item: '耳機', amount: 3200 },
  { id: 105, user_id: 9, item: '椅子', amount: 12000 }, // user 9 已不存在：孤兒訂單
]

const JOINS = {
  inner: {
    label: 'INNER', clause: 'INNER JOIN', where: '', regions: ['mid'],
    title: 'INNER JOIN：只留兩邊都對得上的',
    text: ['ON 條件成立的配對才會出現。沒有訂單的使用者（Dave、Eve）消失，找不到使用者的訂單（#105）也消失。', '這是預設的 JOIN——寫 `JOIN` 不加修飾詞就是 INNER。'],
    work: '報表「每筆訂單的買家是誰」用它：你只關心有對應關係的資料。',
  },
  left: {
    label: 'LEFT', clause: 'LEFT JOIN', where: '', regions: ['left', 'mid'],
    title: 'LEFT JOIN：左表全保留，右邊補 NULL',
    text: ['以 FROM 後面那張表（users）為主：每個使用者一定出現；有訂單的展開成多列，沒訂單的右側欄位填 NULL。', '注意 Alice 有兩筆訂單，所以出現兩列——JOIN 會讓左表「變多」，是 N+1 與重複計算 bug 的來源。'],
    work: '「列出所有使用者與他們的訂單數（含 0 筆）」——LEFT JOIN 再 COUNT(o.id)。',
  },
  right: {
    label: 'RIGHT', clause: 'RIGHT JOIN', where: '', regions: ['mid', 'right'],
    title: 'RIGHT JOIN：右表全保留，左邊補 NULL',
    text: ['和 LEFT 對稱：每筆訂單一定出現，找不到使用者的訂單（#105）左側欄位填 NULL。', '實務上很少寫 RIGHT JOIN——把兩張表對調改寫成 LEFT JOIN 可讀性更好，大多數團隊規範也這樣要求。'],
    work: '資料修復時找「使用者被刪了但訂單還在」的孤兒資料。',
  },
  full: {
    label: 'FULL', clause: 'FULL OUTER JOIN', where: '', regions: ['left', 'mid', 'right'],
    title: 'FULL OUTER JOIN：兩邊都全保留',
    text: ['對得上的配成一列，對不上的各自保留、另一邊填 NULL。結果列數 = 配對數 + 左孤兒 + 右孤兒。', 'MySQL 不支援 FULL JOIN（要用 LEFT UNION RIGHT 模擬），PostgreSQL 有原生支援。'],
    work: '對帳：比對兩個系統的資料，找出「只在 A」「只在 B」「兩邊都有但值不同」。',
  },
  leftOnly: {
    label: 'LEFT 排除', clause: 'LEFT JOIN', where: 'WHERE o.id IS NULL', regions: ['left'],
    title: 'LEFT JOIN + IS NULL：只要左邊的孤兒',
    text: ['先 LEFT JOIN 保留所有使用者，再用 WHERE 把「右邊有值」的濾掉——剩下就是沒有任何訂單的使用者。', '這叫 anti-join。也可寫成 `WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)`，在 PostgreSQL 通常執行計畫更好。'],
    work: '「找出從未下單的使用者」發行銷 email；「找出沒被任何文章引用的標籤」清理資料。',
  },
  rightOnly: {
    label: 'RIGHT 排除', clause: 'RIGHT JOIN', where: 'WHERE u.id IS NULL', regions: ['right'],
    title: 'RIGHT JOIN + IS NULL：只要右邊的孤兒',
    text: ['對稱版本：保留所有訂單，濾掉有使用者的，剩下的就是找不到主人的訂單。', '如果資料表有正確的外鍵約束（FOREIGN KEY），這種孤兒根本不該存在——這正是外鍵的價值。'],
    work: '資料健檢：外鍵沒設好的舊系統常靠這招找壞資料。',
  },
  fullOnly: {
    label: 'FULL 排除', clause: 'FULL OUTER JOIN', where: 'WHERE u.id IS NULL OR o.id IS NULL', regions: ['left', 'right'],
    title: 'FULL JOIN + IS NULL：只要對不上的',
    text: ['兩邊的孤兒一次列出、配對成功的全部丟掉。', '這是七種 JOIN 裡最少用的，但在資料遷移驗證時很好用：結果應該是零列。'],
    work: '遷移驗證：新舊表 FULL JOIN 後篩對不上的，期待結果為空。',
  },
}
const ORDER = ['inner', 'left', 'right', 'full', 'leftOnly', 'rightOnly', 'fullOnly']

function computeJoin(users, orders, regions) {
  const has = (r) => regions.includes(r)
  const rows = []
  const matched = new Set()
  for (const u of users) {
    const mine = orders.filter((o) => o.user_id === u.id)
    if (mine.length) {
      for (const o of mine) { matched.add(o.id); if (has('mid')) rows.push({ u, o, key: `${u.id}-${o.id}` }) }
    } else if (has('left')) rows.push({ u, o: null, key: `${u.id}-null` })
  }
  for (const o of orders) if (!matched.has(o.id) && has('right')) rows.push({ u: null, o, key: `null-${o.id}` })
  return rows
}

export default function SqlJoinLab() {
  const [type, setType] = useState('left')
  const [offUsers, setOffUsers] = useState(() => new Set())
  const [offOrders, setOffOrders] = useState(() => new Set())
  const [hover, setHover] = useState(null)
  const j = JOINS[type]

  const users = USERS.filter((u) => !offUsers.has(u.id))
  const orders = ORDERS.filter((o) => !offOrders.has(o.id))
  const rows = useMemo(() => computeJoin(users, orders, j.regions), [users, orders, j])

  const usedU = new Set(rows.map((r) => r.u?.id).filter(Boolean))
  const usedO = new Set(rows.map((r) => r.o?.id).filter(Boolean))
  const pairs = rows.filter((r) => r.u && r.o).length
  const leftOrphans = users.filter((u) => !orders.some((o) => o.user_id === u.id)).length
  const rightOrphans = orders.filter((o) => !users.some((u) => u.id === o.user_id)).length
  const touched = offUsers.size + offOrders.size > 0

  const toggleUser = (id) => setOffUsers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleOrder = (id) => setOffOrders((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const reset = () => { setOffUsers(new Set()); setOffOrders(new Set()) }

  const sql = `SELECT u.name, o.item, o.amount
FROM users u
${j.clause} orders o
  ON o.user_id = u.id${j.where ? `\n${j.where}` : ''}`
  const hl = j.where ? [3, 5] : [3]

  return (
    <Lab accent="violet" kicker="SQL LAB" title="JOIN 七兄弟：文氏圖與真實結果同步變化"
         blurb="切換 JOIN 類型看結果表怎麼變。點來源表任何一列可以「假裝刪掉它」，觀察配對關係怎麼跟著改變；滑過結果列會亮出它來自哪兩列。">
      <LabControls>
        <Seg label="JOIN" tinted value={type} onChange={setType}
             options={ORDER.map((k) => ({ value: k, label: JOINS[k].label }))} />
        <span className="spacer" />
        {touched && <button type="button" className="btn ghost small" onClick={reset}>還原資料</button>}
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <div className="join-top">
            <Venn regions={j.regions} />
            <SourceTable
              caption="users（左表）" side="a"
              cols={['id', 'name', 'city']}
              rows={USERS}
              off={offUsers} used={usedU}
              hot={hover?.u ?? null}
              onToggle={toggleUser} />
            <SourceTable
              caption="orders（右表）" side="b"
              cols={['id', 'user_id', 'item', 'amount']}
              rows={ORDERS}
              off={offOrders} used={usedO}
              hot={hover?.o ?? null}
              onToggle={toggleOrder} />
          </div>

          <div className="dtable-wrap">
            <table className="dtable join-result">
              <caption>
                結果 <b>{rows.length}</b> 列
                <span className="muted">　配對 {pairs} · 沒訂單的使用者 {leftOrphans} · 沒使用者的訂單 {rightOrphans}</span>
              </caption>
              <thead>
                <tr>
                  <th className="th-a">u.id</th><th className="th-a">u.name</th>
                  <th className="th-b">o.id</th><th className="th-b">o.item</th><th className="th-b">o.amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="muted">（空結果——沒有任何一列符合）</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={`${type}-${r.key}`} className="row-in"
                      onMouseEnter={() => setHover({ u: r.u?.id ?? null, o: r.o?.id ?? null })}
                      onMouseLeave={() => setHover(null)}>
                    <Cell v={r.u?.id} side="a" /><Cell v={r.u?.name} />
                    <Cell v={r.o?.id} side="b" /><Cell v={r.o?.item} /><Cell v={r.o?.amount} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <Code lang="sql" title="查詢" highlight={hl}>{sql}</Code>
          <LabExplain title={j.title}>
            {j.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">{j.work}</Callout>
        </div>
      </LabGrid>

      <style>{`
        .join-top { display: grid; grid-template-columns: 200px 1fr 1fr; gap: 14px; align-items: start; }
        @media (max-width: 900px) { .join-top { grid-template-columns: 1fr 1fr; } .join-top > :first-child { grid-column: 1 / -1; justify-self: center; } }
        @media (max-width: 560px) { .join-top { grid-template-columns: 1fr; } }
        .join-result caption b { color: var(--ink-1); font-family: var(--mono); }
        .venn { width: 200px; }
        .venn .region { fill: var(--lab-accent); fill-opacity: 0; transition: fill-opacity 0.35s ease; }
        .venn .region.on { fill-opacity: 0.55; }
        .venn .outline { fill: none; stroke: var(--ink-3); stroke-width: 1.5; }
        .venn text { font-family: var(--mono); font-size: 11px; fill: var(--ink-2); }
      `}</style>
    </Lab>
  )
}

function md(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>')
}

function Cell({ v, side }) {
  const isNull = v === undefined || v === null
  return <td className={`${isNull ? 'null' : ''} ${side ? `src-${side}` : ''}`}>{isNull ? 'NULL' : v}</td>
}

function SourceTable({ caption, side, cols, rows, off, used, hot, onToggle }) {
  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <caption><span className={`tag ${side}`}>{side === 'a' ? 'L' : 'R'}</span>　{caption}</caption>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const isOff = off.has(r.id)
            const cls = ['clickable', isOff ? 'off' : used.has(r.id) ? '' : 'dim', hot === r.id ? 'hit' : ''].join(' ')
            return (
              <tr key={r.id} className={cls} onClick={() => onToggle(r.id)}
                  title={isOff ? '點一下復原這筆' : '點一下模擬刪除這筆'}>
                {cols.map((c) => <td key={c}>{r[c] ?? 'NULL'}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* 文氏圖：左圓 users、右圓 orders；三個區域各自用 mask/clip 切出 */
function Venn({ regions }) {
  const id = useId().replace(/:/g, '')
  const A = { cx: 78, cy: 78, r: 56 }
  const B = { cx: 132, cy: 78, r: 56 }
  const on = (r) => (regions.includes(r) ? 'region on' : 'region')
  return (
    <svg className="venn" viewBox="0 0 210 160" role="img"
         aria-label={`文氏圖：${regions.join('、')} 區域被選取`}>
      <defs>
        <clipPath id={`${id}-inB`}><circle {...B} /></clipPath>
        <mask id={`${id}-notB`}><rect width="210" height="160" fill="#fff" /><circle {...B} fill="#000" /></mask>
        <mask id={`${id}-notA`}><rect width="210" height="160" fill="#fff" /><circle {...A} fill="#000" /></mask>
      </defs>
      <circle className={on('left')} {...A} mask={`url(#${id}-notB)`} />
      <circle className={on('right')} {...B} mask={`url(#${id}-notA)`} />
      <circle className={on('mid')} {...A} clipPath={`url(#${id}-inB)`} />
      <circle className="outline" {...A} />
      <circle className="outline" {...B} />
      <text x={A.cx - 30} y={A.cy + 4} textAnchor="middle">users</text>
      <text x={B.cx + 30} y={B.cy + 4} textAnchor="middle">orders</text>
      <text x="105" y="152" textAnchor="middle" style={{ fontSize: 10, fill: 'var(--ink-3)' }}>
        著色 = 會出現在結果的區域
      </text>
    </svg>
  )
}
