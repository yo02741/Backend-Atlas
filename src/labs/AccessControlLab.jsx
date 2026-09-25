import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status } from './ui.jsx'

/* ============================================================
   RBAC vs ABAC：誰能做什麼
   - RBAC：角色 × 權限矩陣可點擊，使用者可勾多角色，追蹤「為什麼可以／不行」
   - ABAC：拉屬性，四條政策規則各自亮綠／紅，deny-overrides 合併成最終決定
   ============================================================ */

const ROLES = ['viewer', 'editor', 'admin']
const PERMS = ['read', 'write', 'delete', 'manage_users']
const MATRIX0 = { viewer: ['read'], editor: ['read', 'write'], admin: ['read', 'write', 'delete', 'manage_users'] }
const USERS0 = { Alice: ['editor'], Bob: ['viewer'], Carol: ['editor', 'admin'] }
const toSets = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new Set(v)]))
const flip = (set, v) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n }

/* ABAC 規則：parts 逐條件評估，全部成立才「命中」；effect 決定命中後是允許還是拒絕 */
const RULES = [
  { id: 'R1', effect: 'permit', title: '允許 read', cond: 'action == read 且 user.department == resource.department',
    parts: (c) => [
      { label: `action == read（目前 ${c.action}）`, ok: c.action === 'read' },
      { label: `user.department ${c.user.department} == resource.department ${c.resource.department}`, ok: c.user.department === c.resource.department },
    ] },
  { id: 'R2', effect: 'permit', title: '允許 write / delete', cond: 'action ∈ {write, delete} 且 user.id == resource.owner_id',
    parts: (c) => [
      { label: `action ∈ {write, delete}（目前 ${c.action}）`, ok: c.action !== 'read' },
      { label: `user.id ${c.user.id} == resource.owner_id ${c.resource.owner_id}`, ok: c.user.id === c.resource.owner_id },
    ] },
  { id: 'R3', effect: 'deny', title: '拒絕一切', cond: 'resource.classification == secret 且 user.clearance < 3',
    parts: (c) => [
      { label: `classification == secret（目前 ${c.resource.classification}）`, ok: c.resource.classification === 'secret' },
      { label: `user.clearance ${c.user.clearance} < 3`, ok: c.user.clearance < 3 },
    ] },
  { id: 'R4', effect: 'deny', title: '拒絕', cond: 'env.hour ∉ 09–18 且 resource.classification != public',
    parts: (c) => [
      { label: `env.hour ${String(c.env.hour).padStart(2, '0')}:00 ∉ 09–18`, ok: c.env.hour < 9 || c.env.hour > 18 },
      { label: `classification != public（目前 ${c.resource.classification}）`, ok: c.resource.classification !== 'public' },
    ] },
]

export default function AccessControlLab() {
  const [mode, setMode] = useState('rbac')
  // RBAC
  const [matrix, setMatrix] = useState(() => toSets(MATRIX0))
  const [users, setUsers] = useState(() => toSets(USERS0))
  const [user, setUser] = useState('Alice')
  const [perm, setPerm] = useState('write')
  // ABAC
  const [action, setAction] = useState('read')
  const [dept, setDept] = useState('sales')
  const [clearance, setClearance] = useState(2)
  const [mine, setMine] = useState(false)
  const [cls, setCls] = useState('internal')
  const [hour, setHour] = useState(14)

  const rbac = mode === 'rbac'
  const myRoles = ROLES.filter((r) => users[user].has(r))
  const grants = myRoles.filter((r) => matrix[r].has(perm))
  const rbacOk = grants.length > 0

  const ctx = { action, user: { id: 'u_alice', department: dept, clearance }, resource: { owner_id: mine ? 'u_alice' : 'u_bob', department: 'engineering', classification: cls }, env: { hour } }
  const evald = RULES.map((r) => { const parts = r.parts(ctx); return { ...r, parts, hit: parts.every((p) => p.ok) } })
  const denies = evald.filter((r) => r.hit && r.effect === 'deny')
  const permits = evald.filter((r) => r.hit && r.effect === 'permit')
  const abacOk = denies.length === 0 && permits.length > 0

  return (
    <Lab accent="orange" kicker="AUTH LAB" title="RBAC vs ABAC：誰能做什麼"
         blurb="同一個問題「這個人能不能做這件事」，兩種答法。RBAC 把權限掛在角色上、人掛角色；ABAC 拿人、資源、環境的屬性去跑政策規則。點矩陣、拉屬性，判定和追蹤過程即時變。">
      <LabControls>
        <Seg label="模型" tinted value={mode} onChange={setMode} options={[{ value: 'rbac', label: 'RBAC' }, { value: 'abac', label: 'ABAC' }]} />
        {rbac ? (
          <>
            <Seg label="使用者" value={user} onChange={setUser} options={Object.keys(USERS0).map((u) => ({ value: u, label: u }))} />
            <Seg label="動作" mono value={perm} onChange={setPerm} options={PERMS.map((p) => ({ value: p, label: p }))} />
          </>
        ) : (
          <>
            <Seg label="action" mono value={action} onChange={setAction} options={['read', 'write', 'delete'].map((p) => ({ value: p, label: p }))} />
            <Seg label="user.department" mono value={dept} onChange={setDept} options={[{ value: 'sales', label: 'sales' }, { value: 'engineering', label: 'engineering' }]} />
            <Slider label="user.clearance" min={1} max={3} value={clearance} onChange={setClearance} />
            <Toggle label="resource 是本人的" checked={mine} onChange={setMine} />
            <Seg label="resource.classification" mono value={cls} onChange={setCls} options={['public', 'internal', 'secret'].map((p) => ({ value: p, label: p }))} />
            <Slider label="env.hour" min={0} max={23} value={hour} onChange={setHour} format={(v) => `${String(v).padStart(2, '0')}:00`} />
          </>
        )}
      </LabControls>

      <LabGrid>
        <div className="ac-col">
        {rbac ? (
          <LabStage label="RBAC 矩陣與判定" caption="點矩陣格子開關權限；點角色晶片幫使用者加減角色。">
            <div className="dtable-wrap">
              <table className="dtable ac-matrix">
                <caption>角色 × 權限</caption>
                <thead><tr><th>角色</th>{PERMS.map((p) => <th key={p} className={p === perm ? 'ac-col' : ''}>{p}</th>)}</tr></thead>
                <tbody>
                  {ROLES.map((r) => {
                    const has = users[user].has(r)
                    return (
                      <tr key={r} className={has ? 'ac-row' : 'dim'}>
                        <td className="ac-role">{r}{has && <span className="ac-me">{user}</span>}</td>
                        {PERMS.map((p) => {
                          const on = matrix[r].has(p)
                          const hit = has && p === perm && on
                          return (
                            <td key={p} className={`ac-cell${p === perm ? ' ac-col' : ''}${hit ? ' ac-hit' : ''}`}>
                              <button type="button" aria-pressed={on} title={`${r} ${on ? '有' : '沒有'} ${p}，點一下切換`}
                                      onClick={() => setMatrix((m) => ({ ...m, [r]: flip(m[r], p) }))}>{on ? '✓' : '·'}</button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="ac-chips">
              <span className="seg-label">{user} 的角色</span>
              {ROLES.map((r) => (
                <button key={r} type="button" className={`ac-chip${users[user].has(r) ? ' on' : ''}`} aria-pressed={users[user].has(r)}
                        onClick={() => setUsers((u) => ({ ...u, [user]: flip(u[user], r) }))}>{r}</button>
              ))}
            </div>
            <div className="ac-verdict">
              {rbacOk ? <Status ok>{user} 可以 {perm}</Status> : <Status>{user} 不能 {perm}</Status>}
              <ol className="ac-trace">
                <li>{user} 的角色 = {myRoles.length ? myRoles.map((r) => <code key={r}>{r}</code>) : <em>（沒有任何角色）</em>}</li>
                {myRoles.map((r) => (
                  <li key={r} className={matrix[r].has(perm) ? 'ok' : 'no'}><code>{r}</code> {matrix[r].has(perm) ? `有 ${perm} ✓` : `沒有 ${perm} ✕`}</li>
                ))}
                <li className={rbacOk ? 'ok' : 'no'}>{rbacOk ? `任一角色有 ${perm} → 允許` : `沒有任何角色有 ${perm} → 拒絕`}</li>
              </ol>
            </div>
          </LabStage>
        ) : (
          <LabStage label="ABAC 屬性與政策評估" caption="每條規則的條件逐一比對；只要有一條 deny 命中就拒絕（deny-overrides）。">
            <div className="ac-attrs">
              <div><b>user</b><code>id = u_alice</code><code>department = {dept}</code><code>clearance = {clearance}</code></div>
              <div><b>resource</b><code>owner_id = {ctx.resource.owner_id}</code><code>department = engineering</code><code>classification = {cls}</code></div>
              <div><b>env / action</b><code>hour = {String(hour).padStart(2, '0')}:00</code><code>action = {action}</code></div>
            </div>
            <div className="ac-rules">
              {evald.map((r) => (
                <div key={r.id} className={`ac-rule ${r.hit ? r.effect : 'idle'}`}>
                  <div className="ac-rule-head">
                    <span className="ac-rid">{r.id}</span>
                    <b>{r.title}</b>
                    <span className="ac-eff">{r.hit ? (r.effect === 'permit' ? '命中 → 允許' : '命中 → 拒絕') : '不適用'}</span>
                  </div>
                  <div className="ac-cond">若 {r.cond}</div>
                  <ul>{r.parts.map((p, i) => <li key={i} className={p.ok ? 'ok' : 'no'}>{p.ok ? '✓' : '✕'} {p.label}</li>)}</ul>
                </div>
              ))}
            </div>
            <div className="ac-verdict">
              {abacOk ? <Status ok>允許 {action}</Status> : <Status>拒絕 {action}</Status>}
              <span className="muted">
                {denies.length ? `${denies.map((d) => d.id).join('、')} 拒絕命中，拒絕優先` : permits.length ? `${permits.map((p) => p.id).join('、')} 允許命中，沒有拒絕` : '沒有任何規則允許 → 預設拒絕'}
              </span>
            </div>
          </LabStage>
        )}
        </div>

        <div className="lab-stack ac-col">
          {rbac ? (
            <LabExplain title={rbacOk ? `RBAC：${user} 透過 ${grants.join(' / ')} 拿到 ${perm}` : `RBAC：${user} 的角色裡沒有一個有 ${perm}`}>
              <p>RBAC 把「誰」和「能做什麼」拆開：人只掛角色，角色才掛權限。判定只有一步——把使用者所有角色的權限聯集起來，看裡面有沒有這個動作。</p>
              <p>好處是簡單、好稽核（看矩陣就知道全貌）、換人不用改權限。壞處是<strong>粗粒度</strong>：它回答不了「editor 能不能改<em>別人</em>的文章」——要嘛全部能、要嘛全部不能。</p>
              <p>硬要用角色表達細節就會出現 <strong>role explosion</strong>：editor_own、editor_team、editor_after_hours……角色數爆炸，矩陣反而沒人看得懂。</p>
            </LabExplain>
          ) : (
            <LabExplain title={abacOk ? 'ABAC：屬性符合允許規則，且沒有拒絕命中' : denies.length ? `ABAC：${denies[0].id} 拒絕命中，其他都不用看` : 'ABAC：沒有任何允許規則成立，預設拒絕'}>
              <p>ABAC 不看角色，看屬性：使用者的部門、等級，資源的擁有者、機密等級，還有環境（時間、IP）。政策是規則的集合，每條規則各自評估，最後用合併策略（這裡是 deny-overrides）得出一個決定。</p>
              <p>優點是<strong>細粒度、彈性</strong>：「只能改自己的」「秘密資料要等級 3」「下班後不能碰內部資料」都是一條規則的事，不用新增角色。</p>
              <p>代價是<strong>難稽核、難測試</strong>：要回答「誰能讀這份文件」得跑遍所有屬性組合；規則多了之後互相牴觸也不容易發現。政策通常會抽出來交給 policy engine（例如 OPA、Casbin）集中管理與測試。</p>
            </LabExplain>
          )}
          <LabExplain title="實務上大多是混用">
            <p>常見做法是「角色 + 擁有權檢查」：先用 RBAC 擋大門（admin 才能進管理頁），進到資料層再補一行 <code>resource.owner_id == user.id</code>。這樣矩陣還是看得懂，又能處理「只能改自己的」。</p>
          </LabExplain>
          <Callout title="工作上什麼時候用哪個">
            <b>後台、內部工具、權限層級少</b>：RBAC，矩陣放在 DB 或設定檔就夠。
            <b>多租戶 SaaS、文件協作、合規要求</b>（誰在什麼條件下能看什麼）：ABAC 或 RBAC 混擁有權／租戶檢查，政策抽成獨立模組並寫測試。
            判斷訊號：當你發現在想「要不要再加一個角色」時，多半是該補屬性檢查了。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .ac-col { min-width: 0; }
        .ac-matrix th.ac-col, .ac-matrix td.ac-col { background: color-mix(in srgb, var(--lab-accent) 10%, transparent); }
        .ac-matrix tr.ac-row td { background: color-mix(in srgb, var(--lab-accent) 6%, transparent); }
        .ac-matrix tr.ac-row td.ac-col { background: color-mix(in srgb, var(--lab-accent) 16%, transparent); }
        .ac-matrix td.ac-hit { box-shadow: inset 0 0 0 2px var(--good); }
        .ac-matrix td.ac-cell { padding: 3px 6px; text-align: center; }
        .ac-matrix td.ac-cell button { font-family: var(--mono); font-size: 0.9rem; width: 30px; height: 26px; border-radius: var(--radius);
          border: 1px solid transparent; background: transparent; color: var(--ink-3); cursor: pointer; transition: color 0.15s ease, background 0.15s ease; }
        .ac-matrix td.ac-cell button[aria-pressed="true"] { color: var(--good); font-weight: 700; }
        .ac-matrix td.ac-cell button:hover { border-color: var(--ink-3); color: var(--ink-1); }
        .ac-role { font-weight: 600; }
        .ac-me { display: inline-block; margin-left: 8px; font-size: 0.66rem; padding: 0 6px; border-radius: 999px; background: var(--lab-accent); color: var(--page); font-family: var(--sans); }
        .ac-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
        .ac-chip { font-family: var(--mono); font-size: 0.78rem; padding: 3px 10px; border-radius: 999px; cursor: pointer;
          border: 1px solid var(--border); background: var(--surface-1); color: var(--ink-3); transition: all 0.15s ease; }
        .ac-chip.on { border-color: var(--lab-accent); color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 10%, transparent); font-weight: 700; }
        .ac-verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 12px; font-size: 0.82rem; }
        .ac-trace { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.8rem; color: var(--ink-2); padding: 0; margin: 0; }
        .ac-trace li + li::before { content: '→'; color: var(--ink-3); margin-right: 8px; }
        .ac-trace li.ok { color: var(--good); } .ac-trace li.no { color: var(--critical); }
        .ac-trace code { font-family: var(--mono); background: var(--surface-2); padding: 0 5px; border-radius: 3px; color: var(--ink-1); margin-right: 3px; }
        .ac-attrs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
        .ac-attrs > div { display: grid; gap: 2px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; min-width: 0; }
        .ac-attrs b { font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 2px; }
        .ac-attrs code { font-family: var(--mono); font-size: 0.74rem; color: var(--ink-1); overflow-wrap: anywhere; }
        .ac-rules { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        @media (max-width: 640px) { .ac-attrs, .ac-rules { grid-template-columns: 1fr; } }
        .ac-rule { --tone: var(--ink-3); border: 1px solid var(--hairline); border-left: 3px solid var(--tone); border-radius: var(--radius);
          background: var(--surface-1); padding: 8px 10px; font-size: 0.78rem; min-width: 0; transition: border-color 0.25s ease, background 0.25s ease; }
        .ac-rule.permit { --tone: var(--good); background: color-mix(in srgb, var(--good) 8%, var(--surface-1)); }
        .ac-rule.deny { --tone: var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .ac-rule.idle { opacity: 0.75; }
        .ac-rule-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--ink-1); }
        .ac-rid { font-family: var(--mono); font-size: 0.7rem; color: var(--tone); font-weight: 700; }
        .ac-eff { margin-left: auto; font-size: 0.72rem; font-weight: 700; color: var(--tone); }
        .ac-cond { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); margin: 3px 0 5px; overflow-wrap: anywhere; }
        .ac-rule ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 2px; font-family: var(--mono); font-size: 0.72rem; }
        .ac-rule li.ok { color: var(--good); } .ac-rule li.no { color: var(--ink-3); }
        .ac-rule.deny li.ok { color: var(--critical); }
      `}</style>
    </Lab>
  )
}
