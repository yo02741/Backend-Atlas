import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Code, Callout } from './ui.jsx'

/* ============================================================
   同一份資料的兩種長相：正規化的 3 張表 vs 一份文件（嵌入 / 參照）
   - 切換模式看同一篇文章＋作者＋留言怎麼擺
   - 「新增一則留言」在三種模式下分別長在哪裡、代價是什麼
   ============================================================ */

const USERS = [
  { id: 7, name: 'Alice', email: 'alice@example.com' },
  { id: 8, name: 'Bob', email: 'bob@example.com' },
  { id: 9, name: 'Carol', email: 'carol@example.com' },
  { id: 10, name: 'Dave', email: 'dave@example.com' },
]
const POST = { id: 42, author_id: 7, title: '索引為什麼快', created_at: '2026-09-01' }
const BASE = [
  { id: 501, post_id: 42, author_id: 8, body: '寫得好，B-tree 終於懂了' },
  { id: 502, post_id: 42, author_id: 9, body: '複合索引那段可以再多講' },
]
const POOL = [
  { author_id: 10, body: 'MySQL 也一樣嗎？' },
  { author_id: 8, body: 'EXPLAIN ANALYZE 救過我' },
  { author_id: 9, body: '收藏了' },
  { author_id: 10, body: 'LIKE 那個踩過坑' },
  { author_id: 8, body: '想看下一篇講快取' },
  { author_id: 9, body: '+1' },
]
const MAX = 12
const nameOf = (id) => USERS.find((u) => u.id === id)?.name ?? '?'

const MODES = [
  { value: 'rel', label: '關聯式（3 張表）' },
  { value: 'embed', label: '文件（嵌入 embed）' },
  { value: 'ref', label: '文件（參照 reference）' },
]

export default function DocVsRelLab() {
  const [mode, setMode] = useState('rel')
  const [comments, setComments] = useState(BASE)
  const [last, setLast] = useState(null)   // 最後新增的留言 id（動畫 / 高亮用）
  const [hover, setHover] = useState(null) // { user, post, comment }

  const author = USERS.find((u) => u.id === POST.author_id)
  const embedDoc = useMemo(() => embedJson(comments), [comments])
  const bytes = useMemo(() => new TextEncoder().encode(embedDoc).length, [embedDoc])
  const newLine = last ? 7 + comments.findIndex((c) => c.id === last) : -1

  const add = () => {
    if (comments.length >= MAX) return
    const i = comments.length - BASE.length
    const src = POOL[i % POOL.length]
    const id = 501 + comments.length
    setComments((cs) => [...cs, { id, post_id: POST.id, ...src }])
    setLast(id)
  }
  const reset = () => { setComments(BASE); setLast(null) }
  const changeMode = (m) => { setMode(m); setLast(null); setHover(null) }

  const full = comments.length >= MAX
  const text = EXPLAIN[mode](comments.length, bytes)
  const query = QUERY[mode](comments[comments.length - 1])

  return (
    <Lab accent="violet" kicker="DATABASE LAB" title="同一份資料的兩種長相：正規化表格 vs 文件"
         blurb="一篇文章、一位作者、幾則留言。切換三種擺法，再按「新增一則留言」看它在每種擺法裡長在哪、誰付出代價。關聯式模式滑過任一列會亮出外鍵指向的列。">
      <LabControls>
        <Seg label="擺法" tinted value={mode} onChange={changeMode} options={MODES} />
        <span className="spacer" />
        <button type="button" className="btn small" onClick={add} disabled={full}>
          {full ? '留言已達示範上限' : '＋ 新增一則留言'}
        </button>
        {comments.length > BASE.length && <button type="button" className="btn ghost small" onClick={reset}>還原</button>}
      </LabControls>

      <LabGrid variant="wide">
        <LabStage label="資料擺法視覺" caption={CAPTION[mode]}>
          {mode === 'rel' && (
            <div className="dvr-tables">
              <div className="dtable-wrap">
                <table className="dtable">
                  <caption><span className="tag a">FK 目標</span>　users</caption>
                  <thead><tr><th className="th-a">id</th><th>name</th><th>email</th></tr></thead>
                  <tbody>
                    {USERS.map((u) => (
                      <tr key={u.id} className={hover?.user === u.id ? 'hit' : ''}
                          onMouseEnter={() => setHover({ user: u.id })} onMouseLeave={() => setHover(null)}>
                        <td>{u.id}</td><td>{u.name}</td><td>{u.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dtable-wrap">
                <table className="dtable">
                  <caption><span className="tag b">FK 目標</span>　posts</caption>
                  <thead><tr><th className="th-b">id</th><th className="th-a">author_id</th><th>title</th><th>created_at</th></tr></thead>
                  <tbody>
                    <tr className={hover?.post === POST.id || hover?.user === POST.author_id ? 'hit' : ''}
                        onMouseEnter={() => setHover({ post: POST.id, user: POST.author_id })} onMouseLeave={() => setHover(null)}>
                      <td>{POST.id}</td><td className="src-a">{POST.author_id}</td><td>{POST.title}</td><td>{POST.created_at}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="dtable-wrap dvr-span">
                <table className="dtable">
                  <caption>comments　<span className="muted">{comments.length} 列</span></caption>
                  <thead><tr><th>id</th><th className="th-b">post_id</th><th className="th-a">author_id</th><th>body</th></tr></thead>
                  <tbody>
                    {comments.map((c) => (
                      <tr key={c.id} className={`${c.id === last ? 'row-in' : ''} ${hover?.comment === c.id || (hover?.user === c.author_id && !hover.post) ? 'hit' : ''}`}
                          onMouseEnter={() => setHover({ comment: c.id, post: c.post_id, user: c.author_id })} onMouseLeave={() => setHover(null)}>
                        <td>{c.id}</td><td className="src-b">{c.post_id}</td><td className="src-a">{c.author_id}</td><td>{c.body}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mode === 'embed' && (
            <div className="lab-stack">
              <Code lang="json" title={`posts 集合 · 1 份文件（${comments.length} 則留言）`} highlight={newLine > 0 ? [newLine] : []}>{embedDoc}</Code>
              <div className="dvr-size">
                <span>文件大小 ≈ <b>{bytes}</b> bytes</span>
                <div className="dvr-bar" role="img" aria-label={`文件大小 ${bytes} bytes`}><i style={{ width: `${Math.min(100, bytes / 12)}%` }} /></div>
                <span className="muted">上限 16 MB</span>
              </div>
            </div>
          )}

          {mode === 'ref' && (
            <div className="lab-stack">
              <div className="dvr-two">
                <Code lang="json" title="posts 集合">{`{
  "_id": 42,
  "title": "${POST.title}",
  "created_at": "${POST.created_at}",
  "author_id": 7
}`}</Code>
                <Code lang="json" title="users 集合">{`{
  "_id": 7,
  "name": "${author.name}",
  "email": "${author.email}"
}`}</Code>
              </div>
              <div className="dtable-wrap">
                <table className="dtable dvr-docs">
                  <caption>comments 集合　<span className="muted">{comments.length} 份小文件，各自獨立</span></caption>
                  <tbody>
                    {comments.map((c) => (
                      <tr key={c.id} className={c.id === last ? 'row-in hit' : ''}>
                        <td>{`{ "_id": ${c.id}, "post_id": ${c.post_id}, "author_id": ${c.author_id}, "body": "${c.body}" }`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </LabStage>

        <div className="lab-stack">
          <Code lang={mode === 'rel' ? 'sql' : 'js'} title={mode === 'rel' ? '讀一篇文章：JOIN 三張表' : mode === 'embed' ? 'MongoDB：一次讀完' : 'MongoDB：兩次查詢或 $lookup'}>{query}</Code>
          <LabExplain title={text.title}>
            {text.body.map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(p) }} />)}
          </LabExplain>
          <Callout title="工作上怎麼選">
            先把最常跑的三個查詢寫出來，再決定資料長相。<b>一起讀、數量有限、被擁有</b> → 嵌入；<b>會被共享、會無限長、要獨立查</b> → 參照。
            混用很正常：文章裡嵌一份作者名字當快取，留言走參照。查詢模式還沒定的時候，正規化的關聯式表格是最不會後悔的預設。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .dvr-tables { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: start; }
        .dvr-span { grid-column: 1 / -1; }
        @media (max-width: 640px) { .dvr-tables { grid-template-columns: 1fr; } }
        .dvr-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 560px) { .dvr-two { grid-template-columns: 1fr; } }
        .dvr-docs td { white-space: normal; word-break: break-all; line-height: 1.5; }
        .dvr-size { display: flex; align-items: center; gap: 12px; font-size: 0.78rem; color: var(--ink-2); flex-wrap: wrap; }
        .dvr-size b { font-family: var(--mono); color: var(--ink-1); }
        .dvr-bar { flex: 1; min-width: 120px; height: 8px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--hairline); overflow: hidden; }
        .dvr-bar i { display: block; height: 100%; background: var(--lab-accent); transition: width 0.4s ease; }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

/* 嵌入模式的文件：手動排版，讓每則留言剛好佔一行（第 7 行起），好做高亮 */
function embedJson(comments) {
  const author = USERS.find((u) => u.id === POST.author_id)
  return `{
  "_id": ${POST.id},
  "title": "${POST.title}",
  "created_at": "${POST.created_at}",
  "author": { "_id": ${author.id}, "name": "${author.name}", "email": "${author.email}" },
  "comments": [
${comments.map((c) => `    { "_id": ${c.id}, "author": "${nameOf(c.author_id)}", "body": "${c.body}" }`).join(',\n')}
  ]
}`
}

const CAPTION = {
  rel: '色條 = 外鍵：藍色指向 users.id、橘色指向 posts.id。滑過任一列看它連到誰。',
  embed: '整篇文章、作者、留言都在同一份文件裡；每新增一則留言，文件就原地長大。',
  ref: '留言各自是一份小文件，用 post_id 指回文章；文章文件本身不會變大。',
}

const QUERY = {
  rel: (c) => `SELECT p.title, u.name AS author,
       c.id, c.body, cu.name AS by
FROM posts p
JOIN users u ON u.id = p.author_id
LEFT JOIN comments c
  ON c.post_id = p.id
LEFT JOIN users cu
  ON cu.id = c.author_id
WHERE p.id = 42;

-- 新增留言：只碰 comments
INSERT INTO comments
  (post_id, author_id, body)
VALUES (42, ${c.author_id}, '…');`,
  embed: (c) => `// 一次查詢：作者與留言都在文件裡
db.posts.findOne({ _id: 42 })

// 新增留言：$push 進陣列，文件原地變大
db.posts.updateOne(
  { _id: 42 },
  { $push: { comments: {
      _id: ${c.id}, author: "${nameOf(c.author_id)}",
      body: "…" } } }
)`,
  ref: (c) => `// 兩次查詢，應用程式自己組（可分頁）
const post = db.posts
  .findOne({ _id: 42 })
const cs = db.comments
  .find({ post_id: 42 })
  .sort({ _id: -1 }).limit(20)

// 或 $lookup：在資料庫端拼
db.posts.aggregate([
  { $match: { _id: 42 } },
  { $lookup: {
      from: "comments",
      localField: "_id",
      foreignField: "post_id",
      as: "comments" } },
])

// 新增留言：一份獨立的小文件
db.comments.insertOne({
  _id: ${c.id}, post_id: 42,
  author_id: ${c.author_id}, body: "…" })`,
}

const EXPLAIN = {
  rel: (n) => ({
    title: '正規化：每個事實只存一次，靠外鍵連起來',
    body: [
      'users、posts、comments 各一張表，每件事只存一次：Alice 改名只改 users 那一列，所有文章、留言自動跟著對。外鍵約束還能擋掉「留言指向不存在的文章」這種壞資料。',
      `代價是讀一篇文章要 JOIN 三張表組回來（${n} 則留言就是 ${n} 列結果）。好處是任何方向都能查：「Bob 留過哪些言」不必另外設計，一個 WHERE 就有。`,
      '新增留言 = comments 多一列，posts 與 users 完全不動；不管留言多到幾百萬則，文章那一列永遠一樣大。',
    ],
  }),
  embed: (n, bytes) => ({
    title: '嵌入：一起讀的資料放在一起',
    body: [
      '整篇文章連作者、留言是**一份文件**：讀一次就全部到手，不用 JOIN，這是文件資料庫的甜蜜點。應用程式拿到的就是要渲染的形狀。',
      `但留言裡的作者名字是**副本**：Bob 改名，每一則留言都要找出來改。留言沒有上限，文件就一直長（目前 ${n} 則、約 ${bytes} bytes）：每次讀文章都得把整份搬出來，MongoDB 單一文件上限 16 MB——「無上限陣列」是文件資料庫最常見的反模式。`,
      '適合嵌入的三個條件：**一起讀**（總是跟父文件一起出現）、**數量有上限**（地址、標籤）、**被擁有**（不會被別的文件共享）。',
    ],
  }),
  ref: (n) => ({
    title: '參照：拆開存，用 id 指過去',
    body: [
      '留言各自是一份小文件，用 `post_id` 指向文章，像關聯式的外鍵——但 MongoDB 不會幫你檢查它指的東西存在。文章文件不會長大，留言可以分頁、可以獨立查「Bob 的所有留言」。',
      '代價：MongoDB 沒有 JOIN。要嘛應用程式查兩次自己組（多一次往返），要嘛用 aggregation 的 `$lookup` 在資料庫端拼；`$lookup` 可用，但不像關聯式的 JOIN 那樣有 planner 幫你最佳化到底、也沒有外鍵保證。',
      `適合參照：**多對多**、**數量無上限**（${n} 則留言只是開始）、**被多處共享**（作者是典型：一個人被很多文章與留言指向）。`,
    ],
  }),
}
