import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Callout, Status, Stats, Stat, Caption, fmtN } from '../ui.jsx'

/* 週末上線情境模擬器：同一份改版（醫令表 schema 變更 + 新的外部檢驗介面），三種上線做法的時間軸。
   可注入三種故障：migration 比預期慢、外部介面不相容、某一步沒人簽核。逐步播放，
   看停機多久、回滾要多久、受影響人次、週一 08:00 能不能開診、稽核紀錄齊不齊。全部是示意數字 */

const MODES = [
  { value: 'bigbang', label: '週末停機一次上' },
  { value: 'phased', label: '平日分批上' },
  { value: 'window', label: '維護窗口 + 預演' },
]
const DAYS = ['週二', '週三', '週四', '週五', '週六', '週日', '週一', '下週二']
const DAY = 1440
const at = (d, h, m = 0) => d * DAY + h * 60 + m
const DEADLINE = at(6, 8)            // 週一 08:00 開診
const SPAN_END = at(6, 12)           // 時間軸畫到週一中午
const WEEKEND_PER_H = 120            // 停機期間急診與住院受影響人次 / 小時（示意）
const CLINIC_PER_H = 1500            // 週一開診後每小時門診人次（示意）
const MIG = 240                      // 測試機量到的 migration 時間（分）
const pad = (n) => String(n).padStart(2, '0')
const clock = (t) => `${DAYS[Math.floor(t / DAY)]} ${pad(Math.floor((t % DAY) / 60))}:${pad(t % 60)}`
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`)

/* 依序排步驟：add 之後時間往後推 dur；at() 跳到指定時刻。audit：ok 系統紀錄 / partial email 或個人終端機 / none 沒紀錄 / null 不是變更動作 */
function track() {
  const steps = []
  let t = 0
  const k = {
    jump(v) { t = v; return k },
    add(s) { steps.push({ dur: 0, tone: '', down: false, audit: null, ...s, t }); t += s.dur || 0; return k },
    now: () => t,
    steps,
  }
  return k
}

function planBigbang(f) {
  const k = track()
  k.jump(at(3, 16)).add({ title: '變更單：整版一張', audit: 'partial', detail: 'schema、程式、介面全部寫在同一張單；資訊室主任以 email 回覆「可以」。' })
  k.jump(at(4, 22)).add({ title: '停機、全量備份', dur: 90, down: true, audit: 'ok', detail: '門診系統關閉，急診與住院改走紙本流程。' })
  const mig = f.slow ? MIG * 3 : MIG
  k.add({ title: '執行 migration（一次跑完）', dur: mig, down: true, audit: 'partial', tone: f.slow ? 'warn' : '',
          detail: f.slow ? `預估 4 小時，實際跑了 ${hm(mig)}。沒有中途檢核點，也不知道還要多久，只能等。` : '拆欄位、轉換 4,000 萬列；工程師在 DB 主機上手動執行。' })
  if (f.nosign) k.add({ title: '現場追加資料修正 SQL', dur: 20, down: true, audit: 'none', tone: 'bad', detail: '轉換後發現一批舊資料格式不對，工程師直接下 UPDATE。這一步不在變更單上，也沒有人簽核。' })
  k.add({ title: '部署新版程式', dur: 30, down: true, audit: 'partial', detail: '在主機上執行部署腳本，紀錄只留在個人終端機。' })
  let rollback = { v: '約 5 h', note: '未演練，估計' }
  if (f.ext) {
    const restore = f.slow ? 480 : 300
    k.add({ title: '介面測試：衡安檢驗平台回 400', dur: 30, down: true, tone: 'bad', detail: '正式環境的平台版本和測試環境不同，新格式的檢驗醫令被拒收。' })
    k.add({ title: '嘗試往前修', dur: 660, down: true, audit: 'none', tone: 'bad', detail: '沒有事先寫好的回滾條件，大家都想「再改一下就好」：連絡廠商、改程式、重新部署好幾輪，11 小時後放棄。' })
    k.add({ title: '還原備份 + 部署舊版', dur: restore + 30, down: true, audit: 'partial', tone: 'warn', detail: `還原從沒演練過，實際花了 ${hm(restore)}${f.slow ? '（資料量大，還原也跟著慢）' : ''}。` })
    k.add({ title: '驗證、重新對帳', dur: 60, down: true, detail: '確認還原後的資料和停機前一致。' })
    rollback = { v: hm(restore + 30), note: '實際花費，未演練' }
  } else {
    k.add({ title: '介面測試 + 冒煙測試', dur: 60, down: true, tone: 'ok', detail: '開醫令、送檢驗、查報告都正常。' })
  }
  const version = f.ext ? '舊版' : '新版'
  return { steps: finish(k, version), version, rollback }
}

function planPhased(f) {
  const k = track()
  k.jump(at(0, 10)).add({ title: 'MR 核准：expand migration', audit: 'ok', detail: '只新增可為空的欄位與新表，不刪不改。MR 由 DBA 與主管核准，作者不能自己核准。' })
  k.jump(at(0, 14)).add({ title: 'expand migration（線上）', dur: 1, audit: 'ok', detail: '`SET lock_timeout` 後新增欄位，只改 catalog，幾秒完成；舊版照常運作。' })
  const fill = f.slow ? 480 * 3 : 480
  k.jump(at(0, 14, 30)).add({ title: '背景分批回填', dur: fill, audit: 'ok', tone: f.slow ? 'warn' : '',
    detail: f.slow ? `回填比預期慢 3 倍，跑了 ${hm(fill)}。只是背景作業久一點，服務照常，後面的步驟順延。` : '每批 5,000 筆，新版雙寫期間由 pipeline 排程執行。' })
  let day = Math.floor(k.now() / DAY) + 1
  let full = false, hit = 0
  if (f.nosign) {
    k.jump(at(day, 10)).add({ title: '部署 job 等核准', tone: 'warn', audit: 'ok', detail: '核准人請假，受保護環境擋住部署；作者不能自己核准，延到隔天。被擋下的紀錄也留在 pipeline 裡。' })
    day++
  }
  k.jump(at(day, 10)).add({ title: '部署新版（旗標關）', dur: 20, audit: 'ok', detail: 'rolling 換版，新版程式在線上但走舊流程。部署紀錄：誰觸發、哪個 image digest。' })
  day++
  if (day > 3) {
    k.jump(at(4, 9)).add({ title: '金絲雀延到下週', tone: 'warn', detail: '前面的步驟順延，金絲雀排不進本週的門診日；週一照舊流程開診，下週再開旗標。' })
  } else if (f.ext) {
    hit = 15
    k.jump(at(day, 10)).add({ title: '金絲雀：復健科開旗標', dur: 15, audit: 'ok', tone: 'bad', detail: '衡安平台拒收新格式；分版本監控 5 分鐘內看到錯誤率升高，關旗標。只影響復健科櫃台約 15 人次。' })
    k.add({ title: '旗標維持關閉，等廠商修正', tone: 'warn', detail: '新舊格式並存，舊流程照常。新功能延後，不影響週一開診。' })
  } else {
    k.jump(at(day, 10)).add({ title: '金絲雀：復健科開旗標', dur: 120, audit: 'ok', tone: 'ok', detail: '約 5% 門診量走新流程，觀察 2 小時，錯誤率與延遲和舊流程一致。' })
    day++
    full = day <= 3
    if (full) k.jump(at(day, 10)).add({ title: '旗標全開', audit: 'ok', tone: 'ok', detail: '全院走新流程；舊欄位仍保留，有問題隨時關旗標。' })
    else k.jump(at(4, 9)).add({ title: '全開延到下週', tone: 'warn', detail: '金絲雀做完已是週五，院內規定週末與週一上午不放量；週一照舊流程開診。' })
  }
  k.jump(at(7, 10)).add({ title: 'contract：刪舊欄位（另一張變更）', audit: 'ok', detail: '回滾窗口過後、確定沒有舊版在跑，才刪 legacy 欄位。' })
  const version = full ? '新版（旗標全開）' : '新版程式、旗標關（舊流程）'
  return { steps: finish(k, version, true), version, rollback: { v: '< 5 分', note: '關旗標退回舊流程' }, canaryHit: hit }
}

function planWindow(f) {
  const k = track()
  k.jump(at(0, 10)).add({ title: '變更單 + 三方核准', audit: 'ok', detail: '一般變更：影響範圍、回復計畫、回復條件寫清楚；主管、DBA、門診業務窗口簽核。' })
  const reh = f.slow ? MIG * 3 : 252
  k.jump(at(1, 14)).add({ title: '預演 migration（正式資料量複本）', dur: reh, audit: 'ok', tone: f.slow ? 'warn' : 'ok',
    detail: f.slow ? `預演量到 ${hm(reh)}，窗口塞不下。調整：索引平日先線上建好、窗口提前到 20:00，窗口內只剩 5 h。` : `實測 ${hm(reh)}，和測試機的 4 小時接近，排進窗口。` })
  k.add({ title: '回滾演練', dur: 58, audit: 'ok', tone: 'ok', detail: '實際回滾一次：反向 migration + 上一版 image，58 分。這個數字寫進變更單。' })
  k.jump(at(2, 10)).add({ title: '介面測試（衡安測試環境）', dur: 60, tone: 'ok', detail: '測試環境通過。正式環境的版本由廠商控制，只能在上線當下驗證。' })
  const start = f.slow ? at(4, 20) : at(4, 22)
  k.jump(start - 30).add({ title: 'go/no-go 1：停機前', dur: f.nosign ? 30 : 0, audit: 'ok', tone: f.nosign ? 'warn' : 'gate',
    detail: f.nosign ? 'DBA 簽核還沒進來，檢核表規定不得停機。聯絡值班主管確認後 DBA 補簽，延後 30 分開始。' : '簽核齊全、備份就緒、人員到位 → Go。' })
  k.jump(start + (f.nosign ? 30 : 0)).add({ title: '停機、全量備份', dur: 90, down: true, audit: 'ok', detail: '依公告時間停機，急診與住院啟動紙本流程。' })
  k.add({ title: '執行 migration', dur: f.slow ? 300 : 252, down: true, audit: 'ok', detail: '由 pipeline 執行，和預演同一份腳本；每個階段印列數，對照預演的進度。' })
  k.add({ title: '部署新版程式', dur: 30, down: true, audit: 'ok', detail: '同一個 image digest 從測試環境推到正式環境。' })
  k.add({ title: '正式環境介面 + 冒煙測試', dur: 30, down: true, tone: f.ext ? 'bad' : 'ok', detail: f.ext ? '衡安正式環境拒收新格式的檢驗醫令。' : '開醫令、送檢驗、查報告都正常。' })
  if (f.ext) {
    k.add({ title: 'go/no-go 2：No-Go', audit: 'ok', tone: 'gate', detail: '條件「正式環境往返測試通過」不成立。不往前修，照演練步驟回滾。' })
    k.add({ title: '回滾（演練過的步驟）', dur: 58, down: true, audit: 'ok', tone: 'warn', detail: '和週三演練一樣的 58 分；週一用舊版開診，改版排下一個窗口。' })
  } else {
    k.add({ title: 'go/no-go 2：Go', audit: 'ok', tone: 'gate', detail: '列數核對一致、介面通過、在週日 06:00 截止前完成 → 開放。' })
  }
  const version = f.ext ? '舊版' : '新版'
  return { steps: finish(k, version), version, rollback: { v: '58 分', note: '演練實測' } }
}

/* 收尾：開放服務（若有停機）與週一 08:00 開診兩個節點 */
function finish(k, version, noDowntime = false) {
  if (!noDowntime) {
    const late = k.now() > DEADLINE
    k.add({ title: '開放服務', tone: late ? 'bad' : 'ok', detail: late ? `開放時已過 08:00，門診櫃台開診延誤 ${hm(k.now() - DEADLINE)}。` : `門診系統恢復（${version}）。` })
  }
  const open = noDowntime ? DEADLINE : k.now()
  const late = open > DEADLINE
  k.steps.push({ t: Math.max(DEADLINE, open), dur: 0, title: late ? '週一開診（延誤）' : '週一 08:00 開診', down: false, audit: null, tone: late ? 'bad' : 'ok', detail: `門診使用${version}${late ? '；08:00 起門診櫃台只能先走紙本掛號' : ''}。` })
  return k.steps.sort((a, b) => a.t - b.t)
}

const PLANS = { bigbang: planBigbang, phased: planPhased, window: planWindow }

function summarize(plan) {
  const { steps } = plan
  const down = steps.filter((s) => s.down)
  const downMin = down.reduce((a, s) => a + s.dur, 0)
  const end = down.length ? down[down.length - 1].t + down[down.length - 1].dur : 0
  const late = Math.max(0, end - DEADLINE)
  const affected = Math.round(((downMin - late) / 60) * WEEKEND_PER_H + (late / 60) * CLINIC_PER_H) + (plan.canaryHit || 0)
  const audited = steps.filter((s) => s.audit)
  const score = audited.reduce((a, s) => a + (s.audit === 'ok' ? 1 : s.audit === 'partial' ? 0.5 : 0), 0)
  return { downMin, late, affected, audit: Math.round((score / audited.length) * 100), missing: audited.filter((s) => s.audit === 'none').length }
}

const EXPLAIN = {
  bigbang: { title: '一次上線：步驟最少，但每一步都沒有退路', body: ['沒有故障時，它和維護窗口的停機時間差不多，而且不用寫任何相容程式——這是它吸引人的地方。', '問題出在「出事之後」：migration 慢了沒有停損點、介面不通時沒有寫好的回滾條件，大家會傾向往前修；回滾要還原備份，花多久沒人量過。三個故障一起開，就會拖過週一 08:00。'] },
  phased: { title: '分批上線：把一次大變更拆成好幾次可以退的小變更', body: ['expand 只新增欄位，回填在背景跑，新版程式部署時旗標關著，所以每一步都不必停機；慢、沒簽核、介面不通，代價都只是「時程往後推」。', '週一開診不依賴新版有沒有上：旗標關著就是舊流程。代價是雙寫、回填、相容程式與旗標清理，工期拉長；contract（刪舊欄位）還要另一張變更。'] },
  window: { title: '維護窗口 + 預演：停機一樣要停，但時間與退路都量過', body: ['預演在正式資料量的複本上跑，migration 慢的問題在週三就被發現，週六只是照表操課；回滾也實際做過一次，回復時間是 58 分而不是「應該很快」。', '外部介面只有正式環境測得到，所以設第二個 go/no-go：條件不成立就回滾，不在半夜往前修。沒簽核的步驟在第一個檢核點就被擋下，稽核紀錄完整。'] },
}

export default function WeekendReleaseScenarioLab() {
  const [mode, setMode] = useState('bigbang')
  const [slow, setSlow] = useState(false)
  const [ext, setExt] = useState(false)
  const [nosign, setNosign] = useState(false)
  const plan = useMemo(() => PLANS[mode]({ slow, ext, nosign }), [mode, slow, ext, nosign])
  const sum = useMemo(() => summarize(plan), [plan])
  const steps = plan.steps
  const { step, setStep, playing, toggle } = usePlayer(steps.length, 1300)
  const cur = Math.min(step, steps.length - 1)
  const s = steps[cur]
  const ex = EXPLAIN[mode]
  const from = mode === 'phased' ? 0 : at(4, 12)
  const pct = (t) => `${(Math.max(0, Math.min(1, (t - from) / (SPAN_END - from))) * 100).toFixed(2)}%`
  const ticks = DAYS.slice(0, 7).map((d, i) => ({ d, t: at(i, 0) })).filter((x) => x.t >= from)
  if (from > 0) ticks.unshift({ d: '週六 12:00', t: from })
  const shown = steps.slice(0, cur + 1)
  const downShown = shown.filter((x) => x.down)
  const bandStart = downShown.length ? downShown[0].t : null
  const bandEnd = downShown.length ? downShown[downShown.length - 1].t + downShown[downShown.length - 1].dur : null

  return (
    <Lab accent="blue" kicker="SCENARIO LAB" title="同一份改版，三種上線法：週一 08:00 趕不趕得上"
         blurb="選做法、開啟故障，再逐步播放時間軸；看停機多久、回滾要多久、受影響多少人次、週一能不能開診、稽核紀錄齊不齊。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={(v) => { setMode(v); setStep(0) }} options={MODES} />
        <Toggle label="migration 慢 3 倍" checked={slow} onChange={setSlow} />
        <Toggle label="外部介面不相容" checked={ext} onChange={setExt} />
        <Toggle label="某一步沒人簽核" checked={nosign} onChange={setNosign} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <Stepper step={cur} total={steps.length} onStep={setStep} playing={playing} onPlay={toggle} />
            <span className="spacer" />
            {sum.late > 0 ? <Status>開診延誤 {hm(sum.late)}</Status> : <Status ok>週一 08:00 可開診</Status>}
          </LabControls>
          <LabStage plain label="上線時間軸">
            <div className="wr-axis" role="img" aria-label={`時間軸：${clock(from)} 到 ${clock(SPAN_END)}，紅色區段為停機`}>
              <div className="wr-track">
                {bandStart !== null && <span className="wr-band" style={{ left: pct(bandStart), width: `calc(${pct(bandEnd)} - ${pct(bandStart)})` }} />}
                <span className="wr-deadline" style={{ left: pct(DEADLINE) }}><em>開診</em></span>
                {shown.map((x, i) => x.t >= from && <i key={i} className={`wr-dot ${x.tone}${i === cur ? ' cur' : ''}`} style={{ left: pct(x.t) }} />)}
              </div>
              <div className="wr-ticks">{ticks.map((x) => <span key={x.d} style={{ left: pct(x.t) }}>{x.d}</span>)}</div>
            </div>
            <ol className="wr-steps">
              {steps.map((x, i) => (
                <li key={`${mode}-${i}`} className={`${x.tone}${i === cur ? ' cur' : i < cur ? ' past' : ' future'}`} onClick={() => setStep(i)}>
                  <span className="wr-time">{clock(x.t)}</span>
                  <span className="wr-title">{x.title}
                    {x.down && <span className="tag">停機 {hm(x.dur)}</span>}
                    {x.audit === 'none' && <span className="tag wr-warn">無紀錄</span>}
                    {x.audit === 'partial' && <span className="tag">紀錄不全</span>}
                  </span>
                  {i === cur && <span className="wr-detail">{x.detail.replace(/`/g, '')}</span>}
                </li>
              ))}
            </ol>
            <Caption>目前：{clock(s.t)} {s.title}（示意；點任一列可跳到該步）</Caption>
          </LabStage>
          <Stats min={118}>
            <Stat label="停機時間" value={sum.downMin ? hm(sum.downMin) : '0'} tone={sum.downMin > 600 ? 'bad' : sum.downMin ? 'warn' : 'ok'} />
            <Stat label="回滾所需時間" value={plan.rollback.v} note={plan.rollback.note} tone={mode === 'bigbang' ? 'bad' : ''} />
            <Stat label="受影響（人次）" value={fmtN(sum.affected)} note={sum.late ? `含開診延誤 ${hm(sum.late)}` : mode === 'phased' ? '只有金絲雀科別' : '急診與住院走紙本'} tone={sum.late ? 'bad' : ''} />
            <Stat label="週一 08:00 開診" value={sum.late ? '延誤' : '可以'} note={plan.version} tone={sum.late ? 'bad' : 'ok'} />
            <Stat label="稽核紀錄完整度" value={`${sum.audit}%`} note={sum.missing ? `${sum.missing} 步沒有紀錄` : sum.audit < 100 ? '部分只有 email 或終端機紀錄' : '每一步可追溯'} tone={sum.audit < 70 ? 'bad' : sum.audit < 100 ? 'warn' : 'ok'} />
          </Stats>
          <Caption>受影響人次：停機期間急診與住院約 {WEEKEND_PER_H} 人次/小時，週一開診後約 {fmtN(CLINIC_PER_H)} 人次/小時；稽核完整度：系統紀錄算 1、email 或個人終端機算 0.5、沒紀錄算 0（全部示意）</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title="這一步">
            <p><b>{s.title}</b>：{s.detail.replace(/`/g, '')}</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">資料轉換在測試機上跑得很快，到正式資料量就慢好幾倍；外部廠商的測試環境和正式環境不同版；凌晨三點有人說「這個小修正我直接下 SQL」。三件事都很常見，差別只在於事先有沒有量過時間、寫好回滾條件，以及每一步是不是都走有紀錄的管道。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .wr-axis { padding: 18px 4px 0; }
        .wr-track { position: relative; height: 26px; border-radius: 4px; background: var(--surface-2); border: 1px solid var(--hairline); }
        .wr-band { position: absolute; top: 0; bottom: 0; background: var(--critical); opacity: 0.28; transition: width 0.4s ease, left 0.4s ease; }
        .wr-deadline { position: absolute; top: -4px; bottom: -4px; width: 0; border-left: 2px dashed var(--ink-2); }
        .wr-deadline em { position: absolute; top: -16px; left: -12px; font-style: normal; font-size: 0.66rem; color: var(--ink-2); white-space: nowrap; }
        .wr-dot { position: absolute; top: 50%; width: 9px; height: 9px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--ink-3); border: 1px solid var(--surface-1); transition: transform 0.2s ease; }
        .wr-dot.ok { background: var(--good); } .wr-dot.warn { background: var(--serious); } .wr-dot.bad { background: var(--critical); } .wr-dot.gate { background: var(--lab-accent); }
        .wr-dot.cur { transform: scale(1.6); box-shadow: 0 0 0 2px var(--lab-accent); }
        .wr-ticks { position: relative; height: 16px; margin-top: 2px; }
        .wr-ticks span { position: absolute; font-size: 0.66rem; color: var(--ink-3); transform: translateX(2px); white-space: nowrap; }
        .wr-steps { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 4px; }
        .wr-steps li { display: grid; grid-template-columns: 92px 1fr; gap: 2px 10px; padding: 5px 8px; border-left: 3px solid var(--hairline); border-radius: 0 4px 4px 0; cursor: pointer; font-size: 0.82rem; transition: background 0.2s ease, opacity 0.2s ease; }
        .wr-steps li.future { opacity: 0.4; }
        .wr-steps li.cur { background: var(--surface-2); }
        .wr-steps li.ok { border-left-color: var(--good); } .wr-steps li.warn { border-left-color: var(--serious); } .wr-steps li.bad { border-left-color: var(--critical); } .wr-steps li.gate { border-left-color: var(--lab-accent); }
        .wr-time { font-family: var(--mono); font-size: 0.74rem; color: var(--ink-3); padding-top: 1px; }
        .wr-title { color: var(--ink-1); min-width: 0; }
        .wr-title .tag { margin-left: 6px; font-size: 0.66rem; }
        .wr-title .tag.wr-warn { color: var(--critical); border-color: var(--critical); }
        .wr-detail { grid-column: 2; color: var(--ink-2); font-size: 0.78rem; line-height: 1.5; }
        @media (max-width: 560px) { .wr-steps li { grid-template-columns: 1fr; } .wr-detail { grid-column: 1; } }
      `}</style>
    </Lab>
  )
}
