import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Callout, Status, useTicker, Stats, Stat, Flow, LineChart, Caption, fmtN, kfmt } from '../ui.jsx'

/* 事故處理情境模擬器：週一 08:00 掛號尖峰，07:40 上線的 v4.2 占滿資料庫連線池，錯誤率升到 25%。
   三種處理方式各有一條事件時間線與錯誤率曲線；可加「回滾本身失敗」。按「開始事故」逐分鐘播放，
   看錯誤率、錯誤預算、MTTR、重複或衝突的操作、對外公告延遲。全部是示意數字 */

const MODES = [
  { value: 'chaos', label: '各自救火' },
  { value: 'ic', label: '事故指揮制度' },
  { value: 'auto', label: '自動化優先' },
]
const T_END = 90
const RPM = 2000                     // 尖峰每分鐘請求數（示意）
const BUDGET = 17280                 // 30 天錯誤預算（請求數）：平均 400 req/min × 30 天 × 0.1%
const LEFT0 = 0.6                    // 事故前預算剩 60%
const IMPACT = 2                     // 錯誤率在第 2 分鐘開始超出 SLO
const TICKS = [0, 20, 40, 60, 80]   // 09:30 的標籤會被右邊切掉，最後一格標 09:20
const FAST = 14.4                    // 快速燃燒門檻：1 小時燒掉 30 天預算的 2%
const pad = (n) => String(n).padStart(2, '0')
const clock = (t) => `${pad(8 + Math.floor(t / 60))}:${pad(t % 60)}`

/* 每種做法：錯誤率關鍵點 [分鐘, %]（線性內插）與事件。kind：dup 重複、conflict 衝突、comm 對外公告、evidence 保全證據、fix 止血、bad 變糟、auto 自動化 */
const RAMP = [[0, 0.2], [2, 1], [6, 25]]          // 三種做法共用：08:02 超出 SLO，08:06 到 25%
const SCRIPTS = {
  chaos: (rf) => ({
    keys: [...RAMP, [8, 22], [9, 60], [11, 23], [12, 24], [14, 40], [18, 40], [19, 100], [23, 100], [25, 45], [27, 30], [50, 30],
      ...(rf ? [[51, 45], [54, 35], [58, 50], [60, 32], [66, 30], [69, 6], [72, 0.4]] : [[52, 8], [54, 0.4]]), [T_END, 0.2]],
    events: [
      [7, '告警', '快速燃燒告警丟進群組，四個人都看到了'],
      [8, 'A', '重啟 API Pod'],
      [9, 'B', '也重啟 API Pod（不知道 A 剛做過），重啟期間錯誤率衝高', 'dup'],
      [12, 'C', '把資料庫連線池上限從 200 調到 500'],
      [14, '系統', '資料庫 CPU 滿載，錯誤率反而升到 40%', 'bad'],
      [16, '客服', '在群組問「掛號怎麼了？」，沒人回'],
      [19, 'A', '重啟資料庫：所有請求失敗 4 分鐘，連線與慢查詢狀態沒保存', 'bad'],
      [25, 'B', '把 C 的連線池設定改回 200', 'conflict'],
      [28, 'D', '又重啟一次 API Pod', 'dup'],
      [33, '主管', '打電話問進度，三個人停下來解釋'],
      [38, '客服', '自己在官網貼「系統維護中」', 'comm'],
      [45, 'B', '想到「最近改了什麼」，翻出 07:40 上線的 v4.2'],
      ...(rf ? [
        [50, 'A', '回滾到 v4.1：失敗，舊版寫入被 v4.2 新增的 NOT NULL 欄位拒絕', 'bad'],
        [54, 'C', '同時手動把舊版 image 再部署一次', 'dup'],
        [58, 'B', '直接在資料庫拿掉 NOT NULL，和 C 的部署撞在一起', 'conflict'],
        [66, 'A', '補一個 migration 把欄位改回可為空，再回滾一次', 'fix'],
      ] : [[50, 'A', '回滾到 v4.1', 'fix']]),
    ],
    after: '隔天的檢討會變成追問「是誰重啟了資料庫」。沒有當下的時間線、重啟前沒保存狀態，慢查詢是哪一句只能猜，改善項目寫成「大家以後小心」。',
  }),
  ic: (rf) => ({
    keys: [...RAMP, [18, 25], ...(rf ? [[19, 28], [22, 4], [38, 4], [41, 0.4]] : [[21, 0.4]]), [T_END, 0.2]],
    events: [
      [7, '告警', '快速燃燒告警呼叫 on-call A'],
      [8, 'A', '宣告 SEV2，「我是 IC」；B 處理、C 溝通、D 紀錄'],
      [10, 'C', '狀態更新：線上掛號異常，請櫃台改走現場與電話掛號；下次更新 08:40 前', 'comm'],
      [11, 'IC', '問「最近改了什麼」；D 查部署紀錄：07:40 上線 v4.2'],
      [13, 'B', '保存 pg_stat_activity 快照與錯誤日誌', 'evidence'],
      [15, 'IC', '決定回滾 v4.2（理由：最近的變更 + 慢查詢來源吻合），B 執行'],
      ...(rf ? [
        [18, 'B', '回滾失敗：v4.2 的 NOT NULL 欄位讓舊版寫入被拒', 'bad'],
        [19, 'IC', '不重試回滾，改走備案：關掉 v4.2 的「候診進度」旗標、暫停報表排程'],
        [22, 'B', '降級完成，錯誤率降到 4%', 'fix'],
        [25, 'IC', '分派 B 寫相容 migration（欄位改回可為空），照常走 CI'],
        [32, 'C', '狀態更新：部分恢復，櫃台維持替代流程'],
        [38, 'B', '修正上線，錯誤率回到正常', 'fix'],
      ] : [[18, 'B', '回滾完成，連線數開始下降', 'fix']]),
      [rf ? 44 : 24, 'C', '狀態更新：服務恢復，持續觀察 15 分鐘'],
    ],
    after: '紀錄員的時間線就是 postmortem 的骨幹：觀察、決定、執行與理由都在。不咎責檢討寫的是「壓測資料量比正式小 10 倍」「連線池沒有告警」這類系統條件，每個改善項目有負責人與期限。',
  }),
  auto: (rf) => ({
    keys: [...RAMP, ...(rf ? [[8, 28], [10, 5], [12, 5], [13, 12], [14, 5], [15, 14], [16, 5], [28, 5], [31, 0.4]] : [[7, 25], [10, 0.4]]), [T_END, 0.2]],
    events: [
      [7, '告警', '多視窗燃燒率告警成立（1h 與 5m 視窗都超過 14.4 倍），呼叫 on-call'],
      [7, '自動化', '回滾腳本第一步：保存錯誤日誌與連線狀態快照', 'evidence'],
      [7, '自動化', '條件符合：部署 26 分鐘內、migration 標為 expand → 自動回滾到 v4.1', 'auto'],
      ...(rf ? [
        [8, '系統', '回滾失敗：migration 被標成 expand，實際加了 NOT NULL 欄位，舊版寫入被拒', 'bad'],
        [9, '自動化', '備案：自動關閉 v4.2 新開的功能旗標（降級），錯誤率降到 5%', 'auto'],
        [10, 'A', '接手擔任 IC'],
        [12, '自動化', '依規則再試一次回滾，又失敗', 'dup'],
        [13, 'C', '狀態更新：線上掛號部分失敗，櫃台改走替代流程', 'comm'],
        [15, '自動化', '第三次重試，和 B 正在檢查的 schema 變更撞在一起', 'conflict'],
        [16, 'IC', '暫停自動化：之後所有操作經 IC 分派'],
        [25, 'B', '相容 migration（欄位改回可為空）走完 CI 上線'],
        [28, 'B', 'IC 決定再回滾一次到 v4.1：成功', 'fix'],
      ] : [
        [10, '系統', '錯誤率回到正常', 'fix'],
        [11, 'A', '接手擔任 IC，確認回滾成功；暫停自動化，之後操作經 IC'],
        [13, 'C', '狀態更新：08:02–08:10 線上掛號部分失敗，已恢復', 'comm'],
      ]),
    ],
    after: '自動化的每個動作都有紀錄，時間線大半是現成的。不咎責檢討多一個題目：自動化為什麼會做錯（migration 標錯類型、重試沒有上限），改善項目包括「migration 類型由 CI 檢查，不靠人標」。',
  }),
}

function simulate(mode, rf) {
  const sc = SCRIPTS[mode](rf)
  const err = []
  for (let t = 0; t <= T_END; t++) {
    let i = 0
    while (i < sc.keys.length - 2 && sc.keys[i + 1][0] <= t) i++
    const [t0, v0] = sc.keys[i], [t1, v1] = sc.keys[i + 1]
    err.push(t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0))
  }
  let cum = 0
  const bad = [], left = []
  for (let t = 0; t <= T_END; t++) { cum += (err[t] / 100) * RPM; bad.push(Math.round(cum)); left.push(((LEFT0 * BUDGET - cum) / BUDGET) * 100) }
  const peak = err.indexOf(Math.max(...err))
  const recover = err.findIndex((v, t) => t > peak && v < 1)
  const events = sc.events.map(([t, who, text, kind = '']) => ({ t, who, text, kind }))
  // 燃燒率 = 錯誤率 ÷ 錯誤預算比例（0.1%）。事故前一小時錯誤率當成 0.2%
  const win = (n) => err.map((_, t) => {
    let sum = 0
    for (let k = t - n + 1; k <= t; k++) sum += k < 0 ? 0.2 : err[k]
    return sum / n / 0.1
  })
  const burn5 = win(5), burn60 = win(60)
  const firing = burn5.map((v, t) => v > FAST && burn60[t] > FAST)
  const alertAt = firing.indexOf(true)
  const clearAt = firing.findIndex((f, t) => t > alertAt && !f)
  const longOnlyClear = burn60.findIndex((v, t) => t > alertAt && v <= FAST)
  return { err, bad, left, recover, events, after: sc.after, burn5, burn60, alertAt, clearAt, longOnlyClear }
}

const EXPLAIN = {
  chaos: { title: '各自救火：每個人都在修，沒有人在指揮', body: ['四個人都看到告警，各自做了「看起來合理」的事：兩個人重啟同一組 Pod、一個人調大連線池、另一個人又改回去。單看每個動作都不算錯，疊在一起就互相抵銷，還把資料庫打掛了一次。', '沒有人負責對外說明，客服到 08:38 才自己貼公告；最關鍵的問題「最近改了什麼」，08:45 才有人問。'] },
  ic: { title: '事故指揮：先宣告、分工，再動手', body: ['IC 在 08:08 宣告事故並分派角色，第一件事是問「最近改了什麼」。宣告與分派花了幾分鐘，但之後每個動作都只做一次，沒有互相抵銷。', '先保存連線與慢查詢狀態再回滾，事後才查得到原因。溝通窗口 08:10 就讓櫃台改走替代流程。回滾失敗時，IC 不讓人重試同一招，改走降級再往前修。'] },
  auto: { title: '自動化優先：機器先止血，人再接手判斷', body: ['燃燒率告警成立就自動回滾，08:10 恢復，人還在開電腦。前提是事先做好：不可變的 image、可以安全回滾的 migration、可靠的多視窗告警。', '自動化只會照劇本走。開啟「回滾本身失敗」看看：降級接住了大部分，但自動重試和人同時動手會打架——人接手的第一件事是暫停自動化。'] },
}
const FLOWS = {
  chaos: [{ label: '告警', value: '丟進群組' }, { label: 'A、B、C、D', value: '各自看到', hot: true }, { label: '正式環境', value: '四個人同時改', bad: true }],
  ic: [{ label: '告警', value: '呼叫 on-call' }, { label: 'IC', value: '宣告、分派、決定', hot: true }, { label: '處理 B', value: '先告知 IC 再做' }, { label: '溝通 C / 紀錄 D', value: '更新、時間線' }],
  auto: [{ label: '燃燒率告警', value: '1h + 5m 視窗' }, { label: '自動化', value: '回滾或降級', hot: true }, { label: 'on-call → IC', value: '接手、暫停自動化' }, { label: '溝通 / 紀錄', value: '人來做' }],
}
const KIND = { dup: '重複', conflict: '衝突', comm: '對外公告', evidence: '保全證據', fix: '止血', bad: '變糟', auto: '自動' }
const pctFmt = (v) => `${Math.round(v)}%`

export default function IncidentDrillScenarioLab() {
  const [mode, setMode] = useState('chaos')
  const [rf, setRf] = useState(false)
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 90)
  const [scrub, setScrub] = useState(null)
  useEffect(() => { if (tick >= T_END) setRunning(false) }, [tick])
  const sim = useMemo(() => simulate(mode, rf), [mode, rf])
  const t = started ? Math.min(T_END, tick) : T_END
  const shown = scrub ?? t
  const play = () => { setStarted(true); resetTick(); setRunning(true) }

  const past = sim.events.filter((e) => e.t <= shown)
  const dups = past.filter((e) => e.kind === 'dup').length
  const conflicts = past.filter((e) => e.kind === 'conflict').length
  const comm = sim.events.find((e) => e.kind === 'comm')
  const evidence = sim.events.some((e) => e.kind === 'evidence' && e.t <= shown)
  const recovered = sim.recover >= 0 && sim.recover <= shown
  const left = sim.left[shown]
  const ex = EXPLAIN[mode]
  const badMax = Math.max(12000, Math.ceil(sim.bad[T_END] / 10000) * 10000)

  return (
    <Lab accent="red" kicker="SCENARIO LAB" title="08:00 掛號尖峰，錯誤率 25%：三種處理方式的 90 分鐘"
         blurb="按「開始事故」逐分鐘播放；切換做法比較錯誤率曲線、錯誤預算、MTTR、重複或衝突的操作次數與對外公告延遲，再開啟「回滾本身失敗」看備案。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Toggle label="回滾本身失敗" checked={rf} onChange={setRf} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={play}>{started ? '重新開始事故' : '開始事故'}</button>
            <button type="button" className="btn ghost small" onClick={() => { setStarted(false); setRunning(false) }}>看全程</button>
            <span className="spacer" />
            {recovered ? <Status ok>{clock(sim.recover)} 恢復</Status> : <Status>處理中 · {clock(shown)}</Status>}
            {left < 0 ? <Status>預算超支</Status> : <Status warn>預算剩 {left.toFixed(0)}%</Status>}
          </LabControls>
          <LabStage plain label="錯誤率、錯誤預算與事件時間線">
            <div className="id-charts">
              <LineChart title="錯誤率（%）" xMax={T_END} yMax={100} upto={t} xTicks={TICKS} fmtX={clock} fmtY={pctFmt} mark={scrub} onScrub={setScrub}
                         thresholds={[{ v: 25, label: '尖峰時的錯誤率 25%' }]}
                         series={[{ key: 'e', label: '錯誤率', color: 'var(--critical)', values: sim.err }]} />
              <LineChart title="燃燒率（倍）：5 分鐘 vs 1 小時視窗" xMax={T_END} yMax={300} upto={t} xTicks={TICKS} fmtX={clock} fmtY={(v) => `${v}×`} mark={scrub} onScrub={setScrub}
                         thresholds={[{ v: FAST, label: '快速燃燒 14.4×' }]}
                         series={[{ key: 's', label: '5m', color: 'var(--c-orange)', values: sim.burn5 }, { key: 'l', label: '1h', color: 'var(--c-violet)', values: sim.burn60 }]} />
              <LineChart title="30 天錯誤預算剩餘（%）" xMax={T_END} yMax={60} upto={t} xTicks={TICKS} fmtX={clock} fmtY={pctFmt} mark={scrub} onScrub={setScrub}
                         series={[{ key: 'b', label: '剩餘', color: 'var(--lab-accent)', values: sim.left.map((v) => Math.max(0, v)) }]} />
              <LineChart title="累計失敗請求" xMax={T_END} yMax={badMax} upto={t} xTicks={TICKS} fmtX={clock} fmtY={kfmt} mark={scrub} onScrub={setScrub}
                         thresholds={[{ v: LEFT0 * BUDGET, label: '事故前剩下的預算' }]}
                         series={[{ key: 'f', label: '失敗', color: 'var(--c-blue)', values: sim.bad }]} />
            </div>
            <Caption>
              告警 {clock(sim.alertAt)} 成立（5 分鐘與 1 小時視窗都超過 14.4×），{sim.clearAt >= 0 ? `${clock(sim.clearAt)} 因短視窗回落而解除` : '到 09:30 仍未解除'}；
              只看 1 小時視窗的話，{sim.longOnlyClear >= 0 ? `要響到 ${clock(sim.longOnlyClear)}` : '09:30 還在響'}——這就是要搭配短視窗的原因（示意）
            </Caption>
            <Flow title="告警之後誰動手" steps={FLOWS[mode]} back={mode === 'chaos' ? '互相覆蓋的設定、重複的重啟' : ''} />
            <ol className="id-log" aria-label="事件時間線">
              {past.slice().reverse().map((e, i) => (
                <li key={`${mode}-${rf}-${e.t}-${e.who}-${i}`} className={`${e.kind}${i === 0 ? ' new' : ''}`}>
                  <span className="id-t">{clock(e.t)}</span>
                  <span className="id-who">{e.who}</span>
                  <span className="id-text">{e.text}{e.kind && <span className="tag">{KIND[e.kind]}</span>}</span>
                </li>
              ))}
              {!past.length && <li><span className="id-t">{clock(shown)}</span><span className="id-who">系統</span><span className="id-text">錯誤率開始上升，還沒有人察覺</span></li>}
            </ol>
            <Caption>{clock(shown)}：錯誤率 {sim.err[shown].toFixed(1)}% · 累計失敗 {fmtN(sim.bad[shown])} 個請求 · 尖峰每分鐘 {fmtN(RPM)} 個請求（示意；游標移到圖上可看任一分鐘）</Caption>
          </LabStage>
          <Stats min={100}>
            <Stat label="MTTR" note="從錯誤超出 SLO 到恢復"
                  value={recovered ? `${sim.recover - IMPACT} 分` : `> ${Math.max(0, shown - IMPACT)} 分`}
                  tone={recovered ? (sim.recover - IMPACT > 30 ? 'bad' : sim.recover - IMPACT > 12 ? 'warn' : 'ok') : 'bad'} />
            <Stat label="錯誤預算剩餘" note={`事故前 ${LEFT0 * 100}%`}
                  value={left < 0 ? `超支 ${Math.abs(left).toFixed(0)}%` : `${left.toFixed(0)}%`}
                  tone={left < 0 ? 'bad' : left < 30 ? 'warn' : 'ok'} />
            <Stat label="失敗請求" value={fmtN(sim.bad[shown])} />
            <Stat label="重複 / 衝突操作" value={`${dups} / ${conflicts}`} tone={dups + conflicts ? 'bad' : 'ok'} />
            <Stat label="對外公告延遲" note="從錯誤超出 SLO 起算"
                  value={comm && comm.t <= shown ? `${comm.t - IMPACT} 分` : '尚未公告'}
                  tone={!comm || comm.t > shown || comm.t - IMPACT > 15 ? 'bad' : 'ok'} />
            <Stat label="證據保全" value={evidence ? '有' : mode === 'chaos' ? '已遺失' : '尚未'}
                  note={mode === 'chaos' ? '重啟前沒保存' : '連線與慢查詢快照'} tone={evidence ? 'ok' : mode === 'chaos' ? 'bad' : ''} />
          </Stats>
          <Caption>錯誤預算：SLO 99.9%、30 天平均每分鐘 400 個請求 → 預算 {fmtN(BUDGET)} 個失敗請求；尖峰流量是平均的 5 倍，所以燒得比燃燒率換算的時間更快（全部示意）</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title={mode === 'chaos' ? '事後：咎責式檢討' : '事後：不咎責的 postmortem'}><p>{sim.after}</p></LabExplain>
          <Callout title="什麼時候會真的踩到">尖峰前剛上線、告警丟進大群組、每個人都有正式環境權限——三件事同時成立時，第一個十分鐘幾乎一定會出現重複重啟和互相改回的設定。事故指揮與自動回滾都要在平常演練過，臨場才用得出來。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .id-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 560px) { .id-charts { grid-template-columns: 1fr; } }
        .id-log { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 3px; max-height: 260px; overflow-y: auto; }
        .id-log li { display: grid; grid-template-columns: 44px 52px 1fr; gap: 8px; align-items: baseline; padding: 4px 8px; font-size: 0.8rem; border-left: 3px solid var(--hairline); border-radius: 0 4px 4px 0; }
        .id-log li.new { background: var(--surface-2); animation: id-in 0.3s ease; }
        .id-log li.dup, .id-log li.conflict, .id-log li.bad { border-left-color: var(--critical); }
        .id-log li.fix, .id-log li.evidence { border-left-color: var(--good); }
        .id-log li.comm { border-left-color: var(--c-blue); }
        .id-log li.auto { border-left-color: var(--lab-accent); }
        .id-t { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
        .id-who { font-size: 0.74rem; font-weight: 700; color: var(--ink-2); }
        .id-text { color: var(--ink-1); min-width: 0; line-height: 1.45; }
        .id-text .tag { margin-left: 6px; font-size: 0.66rem; }
        .id-log li.dup .tag, .id-log li.conflict .tag, .id-log li.bad .tag { color: var(--critical); border-color: var(--critical); }
        @keyframes id-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .id-log li.new { animation: none; } }
        @media (max-width: 560px) { .id-log li { grid-template-columns: 40px 1fr; } .id-text { grid-column: 1 / -1; } }
      `}</style>
    </Lab>
  )
}
