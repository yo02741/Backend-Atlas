import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Callout, Status } from '../ui.jsx'

/* 軟刪除情境模擬器：
   同一組操作（刪除 Alice → 列出使用者 → 同 email 重新註冊 → 30 天後 → 客服復原）
   在 hard / soft / anonymize / archive 四種做法下，三張有外鍵的表與財務報表分別變成什麼樣。
   操作是「已做過的事」的集合，切換做法會立刻重算結果，方便並排比較。 */

const USERS = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
  { id: 3, name: 'Carol', email: 'carol@example.com' },
]
const ORDERS = [
  { id: 101, user_id: 1, total: 2400, invoice: 'INV-0101' },
  { id: 102, user_id: 2, total: 7990, invoice: 'INV-0102' },
  { id: 103, user_id: 1, total: 890, invoice: 'INV-0103' },
]
const COMMENTS = [
  { id: 501, user_id: 1, body: '出貨很快' },
  { id: 502, user_id: 3, body: '包裝完整' },
  { id: 503, user_id: 1, body: '會再回購' },
]
const T0 = '09-26 10:00'
const ANON = { name: '已刪除的使用者 #1', email: 'deleted-1@invalid' }

const MODES = {
  hard: {
    label: 'hard · DELETE', sql: `DELETE FROM users WHERE id = 1;\n-- orders / comments 的 FK 是 ON DELETE CASCADE`,
    title: 'DELETE 把訂單一起帶走',
    text: ['外鍵 CASCADE 的意思就是「父列消失，子列跟著消失」。Alice 的兩筆訂單、兩張發票、兩則留言全部不見，財務報表當月少了 NT$ 3,290，稽核找不到 INV-0101。', '改成 SET NULL 訂單會留下來，但 user_id 變 NULL：報表有數字、卻不知道是誰買的，退款也找不到人。個資倒是真的清乾淨了，重新註冊也沒問題。'],
  },
  soft: {
    label: 'soft · deleted_at', sql: `UPDATE users SET deleted_at = now() WHERE id = 1;\n-- 之後每一條查詢：WHERE deleted_at IS NULL`,
    title: '列還在，一切靠 WHERE 過濾',
    text: ['三張表一列都沒少，復原就是把 deleted_at 改回 NULL。代價是「每一條查詢都要記得過濾」：開啟「查詢忘了加 WHERE」看列表把 Alice 吐出來。', 'UNIQUE(email) 也會擋住重新註冊，因為那個 email 還躺在表裡；要換成 partial unique index。個資仍在資料庫，30 天後法規要求的清除還沒發生——soft 幾乎一定要配一個排程做第二階段。'],
  },
  anonymize: {
    label: 'anonymize · 覆寫個資', sql: `BEGIN;\nINSERT INTO deletion_audit (user_id, email_hash, at) VALUES (1, 'sha256:3f9a…', now());\nUPDATE users SET name = '已刪除的使用者 #1', email = 'deleted-1@invalid', deleted_at = now() WHERE id = 1;\nCOMMIT;`,
    title: '列留著、id 留著、個資當下消失',
    text: ['訂單與留言的外鍵指的 id=1 還在，JOIN 出來的名字變成「已刪除的使用者 #1」，商品頁與財務報表都不受影響。email 被覆寫成不可能撞到的值，重新註冊自然放行。', '不可逆是它的本質：覆寫就是清除。想「保留 30 天可復原」就要先 soft 再匿名化，兩段式。稽核表只留 email 的 hash，能證明「這個人曾經被刪」而不留個資。'],
  },
  archive: {
    label: 'archive · 搬到歷史表', sql: `BEGIN;\nINSERT INTO users_archive SELECT *, now() FROM users WHERE id = 1;\nDELETE FROM users WHERE id = 1;  -- FK 是 ON DELETE SET NULL\nCOMMIT;`,
    title: '主表乾淨，代價是外鍵斷了',
    text: ['users 表只剩活人，任何列表查詢不用過濾。但 orders.user_id 指向的列不在 users 了：外鍵要改成 SET NULL（訂單變無主）或乾脆拆掉；財務要「JOIN users_archive」才找得回買家。', '復原是把列搬回去，再把訂單的 user_id 補回來（要有地方記著原本的 id）。個資在 users_archive 裡原封不動，30 天後一樣要清。'],
  },
}

/* 依做法 + 已做過的操作，算出四張表與各項結果 */
function simulate(mode, done, forgot, partial) {
  let users = USERS.map((u) => ({ ...u, deleted_at: null }))
  let orders = ORDERS.map((o) => ({ ...o, gone: false }))
  let comments = COMMENTS.map((c) => ({ ...c, gone: false }))
  const archive = []
  const audit = []
  const r = {}
  if (!done.del) return { users, orders, comments, archive, audit, r }

  if (mode === 'hard') {
    users = users.filter((u) => u.id !== 1)
    orders = orders.map((o) => ({ ...o, gone: o.user_id === 1 }))
    comments = comments.map((c) => ({ ...c, gone: c.user_id === 1 }))
  } else if (mode === 'soft') {
    users = users.map((u) => (u.id === 1 ? { ...u, deleted_at: T0 } : u))
  } else if (mode === 'anonymize') {
    users = users.map((u) => (u.id === 1 ? { ...u, ...ANON, deleted_at: T0, anon: true } : u))
    audit.push({ user_id: 1, email_hash: 'sha256:3f9a…c21e', at: T0 })
  } else {
    archive.push({ ...USERS[0], archived_at: T0 })
    users = users.filter((u) => u.id !== 1)
    orders = orders.map((o) => (o.user_id === 1 ? { ...o, user_id: null } : o))
    comments = comments.map((c) => (c.user_id === 1 ? { ...c, user_id: null } : c))
  }

  if (done.signup) {
    const conflict = mode === 'soft' && !partial
    r.signup = conflict
      ? { ok: false, text: 'INSERT 失敗：UNIQUE(email) 衝突，alice@example.com 還在 users 表裡' }
      : { ok: true, text: `註冊成功：新列 id=4（${mode === 'hard' ? '和舊帳號、舊訂單毫無關聯' : mode === 'soft' ? 'partial unique index 只約束 deleted_at IS NULL 的列' : mode === 'anonymize' ? '舊 email 已被覆寫' : '舊列已不在 users'}）` }
    if (!conflict) users = [...users, { id: 4, name: 'Alice', email: 'alice@example.com', deleted_at: null, fresh: true }]
  }
  if (done.list) {
    const visible = users.filter((u) => forgot || !u.deleted_at)
    const leak = visible.find((u) => u.deleted_at)
    r.list = leak
      ? (mode === 'anonymize'
        ? { warn: true, text: `列出 ${visible.length} 人，包含「${leak.name}」——個資沒外洩，但殭屍帳號出現在列表`, rows: visible }
        : { ok: false, text: `列出 ${visible.length} 人，包含已刪除的 Alice（deleted_at 有值卻被列出來）`, rows: visible })
      : { ok: true, text: `列出 ${visible.length} 人：${visible.map((u) => u.name).join('、')}`, rows: visible }
  }
  if (done.age) {
    r.age = mode === 'hard' ? { ok: true, text: '個資在刪除當下就不存在（備份與日誌另計）' }
      : mode === 'anonymize' ? { ok: true, text: '個資在刪除當下已被覆寫，稽核表只有 hash' }
      : mode === 'soft' ? { ok: false, text: '第 30 天：users 表裡 Alice 的姓名與 email 原封不動，comments JOIN users 仍顯示 Alice——沒有排程就沒有清除' }
      : { ok: false, text: '第 30 天：users_archive 裡 Alice 的個資原封不動，需要排程清 archive' }
  }
  if (done.restore) {
    r.restore = mode === 'hard' ? { ok: false, text: '做不到：列已不存在，訂單也被 CASCADE 帶走，只能從備份撈' }
      : mode === 'anonymize' ? { ok: false, text: '做不到：姓名與 email 已被覆寫，沒有原值可還原' }
      : mode === 'soft'
        ? (done.signup && partial
          ? { ok: false, text: 'UPDATE 失敗：復原後兩筆 alice@example.com 都是 deleted_at IS NULL，撞 partial unique index' }
          : { ok: true, text: 'UPDATE users SET deleted_at = NULL WHERE id = 1；訂單與留言從來沒動' })
        : { warn: true, text: '搬回 users 可行；但 orders / comments 的 user_id 已是 NULL，要靠 archive 記的舊 id 逐筆補回' }
    if (r.restore.ok && mode === 'soft') users = users.map((u) => (u.id === 1 ? { ...u, deleted_at: null, restored: true } : u))
    if (r.restore.warn && mode === 'archive') { users = [{ ...USERS[0], deleted_at: null, restored: true }, ...users]; archive.length = 0 }
  }
  return { users, orders, comments, archive, audit, r }
}

const DONE0 = { del: false, list: false, signup: false, age: false, restore: false }

export default function SoftDeleteScenarioLab() {
  const [mode, setMode] = useState('soft')
  const [done, setDone] = useState(DONE0)
  const [forgot, setForgot] = useState(false)
  const [partial, setPartial] = useState(false)
  const sim = useMemo(() => simulate(mode, done, forgot, partial), [mode, done, forgot, partial])
  const m = MODES[mode]
  const mark = (k) => setDone((d) => ({ ...d, [k]: true }))

  const live = sim.orders.filter((o) => !o.gone)
  const revenue = live.reduce((s, o) => s + o.total, 0)
  const lost = ORDERS.reduce((s, o) => s + o.total, 0) - revenue
  const orphan = live.filter((o) => o.user_id === null).length
  const nameOf = (uid) => {
    if (uid === null) return null
    const u = sim.users.find((x) => x.id === uid) || sim.archive.find((x) => x.id === uid)
    return u ? u.name : null
  }

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="刪掉 Alice 之後：三張表、一份財務報表、五個後續動作"
         blurb="先選做法，按「刪除使用者 Alice」，再依序按後面的動作。切換做法會用同一組動作重算，直接比較後果。所有資料為示意。">
      <LabControls>
        <Seg tinted value={mode} onChange={setMode} options={Object.entries(MODES).map(([k, v]) => ({ value: k, label: v.label }))} />
      </LabControls>
      <LabControls>
        <button type="button" className="btn small" onClick={() => mark('del')} disabled={done.del}>刪除使用者 Alice</button>
        <button type="button" className="btn ghost small" onClick={() => mark('list')} disabled={!done.del}>列出使用者</button>
        <button type="button" className="btn ghost small" onClick={() => mark('signup')} disabled={!done.del || done.signup}>Alice 用同 email 重新註冊</button>
        <button type="button" className="btn ghost small" onClick={() => mark('age')} disabled={!done.del || done.age}>30 天後</button>
        <button type="button" className="btn ghost small" onClick={() => mark('restore')} disabled={!done.del || done.restore}>客服復原</button>
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => setDone(DONE0)}>重來</button>
      </LabControls>
      <LabControls>
        <Toggle label="查詢忘了加 WHERE deleted_at IS NULL" checked={forgot} onChange={setForgot} />
        <Toggle label="UNIQUE(email) 改成 partial unique index（WHERE deleted_at IS NULL）" checked={partial} onChange={setPartial} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage plain>
            <pre className="sd-sql">{m.sql}</pre>
            <div className="sd-tables">
              <div className="dtable-wrap">
                <table className="dtable">
                  <caption>users</caption>
                  <thead><tr><th>id</th><th>name</th><th>email</th><th>deleted_at</th></tr></thead>
                  <tbody>
                    {sim.users.map((u) => (
                      <tr key={u.id} className={u.deleted_at ? 'dim' : u.fresh || u.restored ? 'row-in' : ''}>
                        <td>{u.id}</td>
                        <td className={u.anon ? 'sd-anon' : ''}>{u.name}{u.fresh ? <span className="sd-b">新</span> : null}{u.restored ? <span className="sd-b ok">復原</span> : null}</td>
                        <td className={u.anon ? 'sd-anon' : ''}>{u.email}</td>
                        <td className={u.deleted_at ? '' : 'null'}>{u.deleted_at || 'NULL'}</td>
                      </tr>
                    ))}
                    {!sim.users.length && <tr><td colSpan={4} className="null">（空）</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="dtable-wrap">
                <table className="dtable">
                  <caption>orders（FK user_id → users.id）</caption>
                  <thead><tr><th>id</th><th>user_id</th><th>total</th><th>invoice</th></tr></thead>
                  <tbody>
                    {sim.orders.map((o) => (
                      <tr key={o.id} className={o.gone ? 'off sd-gone' : ''}>
                        <td>{o.id}</td>
                        <td className={o.user_id === null ? 'null' : ''}>{o.user_id === null ? 'NULL' : `${o.user_id} · ${nameOf(o.user_id) ?? '？'}`}</td>
                        <td>{o.total.toLocaleString()}</td>
                        <td>{o.invoice}{o.gone ? <span className="sd-b bad">CASCADE</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dtable-wrap">
                <table className="dtable">
                  <caption>comments（FK user_id → users.id）</caption>
                  <thead><tr><th>id</th><th>user_id</th><th>body</th></tr></thead>
                  <tbody>
                    {sim.comments.map((c) => (
                      <tr key={c.id} className={c.gone ? 'off sd-gone' : ''}>
                        <td>{c.id}</td>
                        <td className={c.user_id === null ? 'null' : ''}>{c.user_id === null ? 'NULL' : `${c.user_id} · ${nameOf(c.user_id) ?? '？'}`}</td>
                        <td>{c.body}{c.gone ? <span className="sd-b bad">CASCADE</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(mode === 'archive') && (
                <div className="dtable-wrap">
                  <table className="dtable">
                    <caption>users_archive</caption>
                    <thead><tr><th>id</th><th>name</th><th>email</th><th>archived_at</th></tr></thead>
                    <tbody>
                      {sim.archive.map((u) => <tr key={u.id} className="row-in"><td>{u.id}</td><td>{u.name}</td><td>{u.email}</td><td>{u.archived_at}</td></tr>)}
                      {!sim.archive.length && <tr><td colSpan={4} className="null">（空）</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              {(mode === 'anonymize') && (
                <div className="dtable-wrap">
                  <table className="dtable">
                    <caption>deletion_audit</caption>
                    <thead><tr><th>user_id</th><th>email_hash</th><th>at</th></tr></thead>
                    <tbody>
                      {sim.audit.map((a) => <tr key={a.user_id} className="row-in"><td>{a.user_id}</td><td>{a.email_hash}</td><td>{a.at}</td></tr>)}
                      {!sim.audit.length && <tr><td colSpan={3} className="null">（空）</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className={`sd-report${lost > 0 ? ' bad' : orphan > 0 ? ' warn' : ''}`}>
              <span className="sd-rt">財務報表（示意）</span>
              <span>訂單 <b>{live.length}</b> / 3</span>
              <span>營收 <b>NT$ {revenue.toLocaleString()}</b></span>
              <span>發票 <b>{live.length}</b> 張</span>
              {lost > 0 && <Status>少了 NT$ {lost.toLocaleString()}、{3 - live.length} 張發票</Status>}
              {orphan > 0 && <Status warn>{orphan} 筆訂單不知道買家（要 JOIN users_archive）</Status>}
              {lost === 0 && orphan === 0 && done.del && <Status ok>報表完整</Status>}
            </div>
          </LabStage>
        </div>

        <div className="lab-stack">
          <ul className="sd-results" aria-label="各動作的結果">
            <Row label="刪除" res={done.del ? { ok: true, text: `已執行（${m.label.split(' · ')[0]}）` } : null} hint="按「刪除使用者 Alice」開始" />
            <Row label="列出使用者" res={sim.r.list} />
            <Row label="重新註冊" res={sim.r.signup} />
            <Row label="30 天後" res={sim.r.age} />
            <Row label="客服復原" res={sim.r.restore} />
          </ul>
          <LabExplain title={m.title}>{m.text.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會真的踩到">
            上線半年後有人加了一個新的列表 API 忘了過濾 deleted_at；行銷匯出 email 名單把已刪除的使用者寄了一封信；財務對帳發現去年 12 月少了三張發票——這三件事分別對應 soft 忘了 WHERE、soft 沒做第二階段清除、hard 的 CASCADE。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .sd-sql { font-family: var(--mono); font-size: 0.74rem; color: var(--ink-2); white-space: pre-wrap; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 8px 12px; margin-bottom: 12px; line-height: 1.55; }
        .sd-tables { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 760px) { .sd-tables { grid-template-columns: 1fr; } }
        .sd-tables .dtable-wrap:first-child { grid-column: 1 / -1; }
        .sd-tables td { white-space: normal; }
        .sd-anon { color: var(--c-violet); font-style: italic; }
        .sd-gone td { background: color-mix(in srgb, var(--critical) 8%, transparent); }
        .sd-b { display: inline-block; margin-left: 6px; font-size: 0.64rem; font-weight: 700; padding: 0 6px; border-radius: 999px; border: 1px solid var(--good); color: var(--good); font-family: var(--sans); vertical-align: middle; }
        .sd-b.ok { border-color: var(--c-blue); color: var(--c-blue); }
        .sd-b.bad { border-color: var(--critical); color: var(--critical); text-decoration: none; }
        .sd-report { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-size: 0.8rem; color: var(--ink-2); }
        .sd-report b { font-family: var(--mono); color: var(--ink-1); }
        .sd-report.bad { border-color: var(--critical); }
        .sd-report.warn { border-color: var(--serious); }
        .sd-rt { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-3); }
        .sd-results { list-style: none; display: grid; gap: 6px; padding: 0; margin: 0; }
        .sd-results li { display: grid; grid-template-columns: 84px 1fr; gap: 10px; align-items: start; padding: 7px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-size: 0.8rem; }
        .sd-results li.bad { border-color: var(--critical); }
        .sd-results li.warn { border-color: var(--serious); }
        .sd-results li.ok { border-color: color-mix(in srgb, var(--good) 50%, var(--hairline)); }
        .sd-results .k { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-3); padding-top: 3px; }
        .sd-results .v { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; color: var(--ink-2); line-height: 1.5; }
        .sd-results .v .status { font-size: 0.7rem; padding: 1px 8px; }
        .sd-results .pending { color: var(--ink-3); font-style: italic; }
      `}</style>
    </Lab>
  )
}

function Row({ label, res, hint }) {
  const cls = !res ? '' : res.ok ? 'ok' : res.warn ? 'warn' : 'bad'
  return (
    <li className={cls}>
      <span className="k">{label}</span>
      <span className="v">
        {res
          ? <>{res.ok ? <Status ok>可以</Status> : res.warn ? <Status warn>勉強</Status> : <Status>不行</Status>}<span>{res.text}</span></>
          : <span className="pending">{hint || '尚未執行'}</span>}
      </span>
    </li>
  )
}
