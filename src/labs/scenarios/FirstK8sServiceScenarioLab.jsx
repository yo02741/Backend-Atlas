import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Callout, Status, useTicker, Stats, Stat, Flow, LineChart, Caption } from '../ui.jsx'

/* 第一批搬上 K8s 的服務：同樣四個要搬的服務（Informix 不搬），四種搬遷順序，12 個月逐月推演。
   每個月搬了什麼、前置問題（防火牆、SIGTERM、寫本機磁碟、長連線）卡在哪、事故、病人流程是否受影響、回退、團隊熟練度、稽核待辦。
   可注入：第 4 個月節點故障、防火牆申請延誤、稽核提前。全部依各做法的月計畫推算，是示意值 */

const MODES = [
  { value: 'stateless', label: '先搬前端與 API' },
  { value: 'report', label: '先搬報表' },
  { value: 'bigbang', label: '一次全部搬' },
  { value: 'platform', label: '先只建平台' },
]
const SVCS = [['fe', '掛號前端'], ['api', '掛號 API'], ['rpt', '報表服務'], ['pay', '付款 socket']]
const PRE = { fw: '防火牆', sigterm: 'SIGTERM', disk: '寫本機磁碟', longconn: '長連線', nonroot: '非 root' }
const AUDIT = ['RBAC 權限', '變更紀錄', '映像來源', '非 root', '備份還原演練']
const T = 12
const NODE_MONTH = 4
const GAIN = { plat: 4, tools: 8, prep: 2, wait: 0, drill: 8, inc: 3, node: 4, note: 0, audit: 0 }   // 熟練度（示意）
const KIND = { plat: '平台', tools: '平台', prep: '前置', wait: '卡住', move: '搬遷', inc: '事故', node: '節點故障', note: '觀察', drill: '演練', audit: '稽核' }
const TILE = { vm: '舊 VM', prep: '前置修改中', wait: '等防火牆', canary: 'K8s・部分流量', k8s: 'K8s', back: '本月切回 VM' }
const WHERE = { vm: 'VM', prep: 'VM・改程式中', wait: 'VM・等防火牆', canary: 'K8s・部分流量', k8s: 'K8s', back: '切回 VM' }
const onK = (s) => s === 'k8s' || s === 'canary'

/* 每個做法的月計畫。fw：防火牆從第幾個月起放行叢集節點；fwFull：一次全搬補件後才放行整段網段 */
function plan(mode, fwDelay) {
  const lag = fwDelay ? 4 : 1
  const E = []
  const ev = (m, kind, svc, text, x = {}) => E.push({ m, kind, svc, text, ...x })
  const wait = (m, svcs, until, who) => svcs.forEach((s, i) => ev(m, 'wait', s, i ? '' : `防火牆申請延誤，${who}等到第 ${until} 個月`, { pre: 'fw' }))
  const fe = (m) => {
    ev(m - 1, 'prep', 'fe', '前端映像改以非 root 執行，nginx 改聽 8080', { pre: 'nonroot' })
    ev(m, 'move', 'fe', '掛號前端上叢集：先導 10% 流量，月底全量；舊 VM 保留 30 天')
  }
  const api = (m) => {
    ev(m, 'move', 'api', '掛號 API 上叢集，先導 20% 流量')
    ev(m, 'inc', 'api', 'API 副本變 3 個，連 Informix 的連線數超過上限；先導流量期間發現，調小連線池')
  }
  const pay = (m) => {
    ev(m - 2, 'prep', 'pay', '付款程式處理 SIGTERM：停止接新連線，等手上的交易做完', { pre: 'sigterm' })
    ev(m - 1, 'prep', 'pay', '長連線改在交易之間關閉；繳費機斷線後重連，先查交易編號再重送', { pre: 'longconn' })
    ev(m, 'move', 'pay', '付款服務上叢集：先接 10 台繳費機', { canary: true })
  }
  const rptPrep = (m) => ev(m, 'prep', 'rpt', '報表改寫到 volume、暫存檔改用 /tmp，輸出目錄給非 root 寫入權限', { pre: 'disk' })
  const p = { E, fwReq: 1, fw: 1 + lag, cut: Infinity }
  if (mode === 'stateless') {
    ev(1, 'plat', null, '建 Ingress、registry、監控；送出防火牆申請（節點網段 → Informix）')
    fe(2)
    ev(2, 'prep', 'api', 'API 分開 /healthz 與 /ready，gunicorn 的關機等待對齊寬限期')
    const a = Math.max(3, p.fw)
    if (a > 3) wait(3, ['api'], a, 'API ')
    api(a)
    rptPrep(4)
    ev(6, 'move', 'rpt', '報表改成 CronJob 上叢集，requests 依幾個月的監控數據設定')
    ev(7, 'drill', null, '演練：drain 節點、備份還原')
    pay(9)
    ev(10, 'move', 'pay', '付款全量；舊 VM 保留到年底', { re: true })
    ev(11, 'plat', null, '叢集升級一個 minor 版本：照 drain 的步驟一次一台')
    p.audit = [3, 2, 1, 2, 7]
  } else if (mode === 'report') {
    ev(1, 'plat', null, '建 Ingress、registry、監控與儲存（CSI driver、StorageClass、volume 備份）；送出防火牆申請')
    rptPrep(2)
    const r = Math.max(4, p.fw)
    if (r > 4) wait(4, ['rpt'], r, '報表')
    ev(r, 'move', 'rpt', '報表改成 CronJob 上叢集')
    ev(r, 'inc', 'rpt', 'CPU limit 設太低，批次被節流跑到早上 9 點；醫事室晚半天拿到報表')
    fe(6)
    ev(6, 'prep', 'api', 'API 分開 /healthz 與 /ready')
    api(7)
    ev(8, 'drill', null, '演練：drain 節點、備份還原')
    pay(11)
    ev(12, 'move', 'pay', '付款全量', { re: true })
    p.audit = [5, 3, 1, 2, 8]
  } else if (mode === 'bigbang') {
    const c = Math.max(3, p.fw), a2 = c + 1 + lag
    p.cut = c; p.fwFull = a2
    ev(1, 'plat', null, '建 Ingress、registry、監控、儲存；送出防火牆申請，逐台列出節點 IP')
    ev(1, 'prep', 'fe', '前端映像改以非 root 執行', { pre: 'nonroot' })
    ev(1, 'prep', 'api', 'API 加探針，連線設定改從 Secret 讀')
    ev(2, 'prep', 'rpt', '報表改寫到 volume；趕工，下載網頁與批次共用同一個 PVC', { pre: 'disk' })
    ev(2, 'prep', 'pay', '付款程式加 SIGTERM 處理；趕工，長連線還沒處理', { pre: 'sigterm' })
    if (c > 3) wait(3, ['fe', 'api', 'rpt', 'pay'], c, '四個服務（包括不需要防火牆的前端）一起')
    SVCS.forEach(([s], i) => ev(c, 'move', s, i ? '' : '週末切換：四個服務一起上叢集，舊 VM 保留到月底'))
    ev(c, 'inc', 'api', '防火牆只列了 3 台節點，排到第 4 台的 API 連 Informix 逾時；掛號查詢間歇失敗，API 切回 VM', { patient: 40, back: true, short: '掛號查詢間歇失敗 40 分鐘' })
    ev(c, 'inc', 'pay', '第一次滾動更新切斷進行中的交易（長連線沒有在交易之間關閉）；繳費機停 25 分鐘、帳務對帳兩天，付款切回 VM', { patient: 25, back: true, short: '繳費機停 25 分鐘' })
    ev(c, 'inc', 'rpt', '下載網頁與批次掛同一個 ReadWriteOnce 的 PVC，排到另一個節點的 Pod 卡在 ContainerCreating')
    ev(c + 1, 'plat', null, '補送防火牆申請：改放行整段節點網段')
    ev(c + 1, 'prep', 'pay', '補做長連線：交易之間關閉，繳費機重連', { pre: 'longconn' })
    ev(c + 2, 'move', 'pay', '付款重新上叢集', { re: true })
    if (a2 > c + 2) wait(c + 2, ['api'], a2, 'API ')
    ev(a2, 'move', 'api', 'API 重新上叢集', { re: true })
    ev(c + 4, 'plat', null, '補 RBAC；把事故期間手動改過的 manifest 收回 git')
    ev(c + 5, 'drill', null, '演練：drain 節點、備份還原')
    p.audit = [c + 4, c + 4, 1, c + 2, c + 5]
  } else {
    p.fwReq = 3; p.fw = 3 + lag
    ev(1, 'plat', null, '建 Ingress、registry、監控；RBAC 接院內 AD，每人各自的權限')
    ev(2, 'plat', null, 'manifest 進 git、由流程套用，留下變更紀錄；namespace 套用 Pod Security restricted')
    ev(2, 'tools', null, '內部工具上叢集：wiki、監控儀表板')
    ev(3, 'plat', null, '建儲存與 volume 備份；送出防火牆申請')
    ev(4, 'drill', null, '演練：drain 節點、模擬節點故障、備份還原')
    fe(5)
    ev(5, 'prep', 'api', 'API 分開 /healthz 與 /ready')
    const a = Math.max(6, p.fw)
    if (a > 6) wait(6, ['api'], a, 'API ')
    api(a)
    rptPrep(7)
    ev(8, 'plat', null, '叢集升級一個 minor 版本：照 drain 的步驟一次一台')
    ev(9, 'move', 'rpt', '報表改成 CronJob 上叢集')
    pay(12)
    p.audit = [1, 2, 1, 2, 4]
  }
  p.fwFull ??= p.fw
  return p
}

/* 第 4 個月一台 worker 節點故障：依當時叢集上有哪些服務決定後果 */
function nodeEvents(mode, st) {
  const out = [{ kind: 'node', text: '一台 worker 節點故障，上面的 Pod 約 5 分鐘後才在別的節點重建' }]
  if (mode === 'platform') out.push({ kind: 'inc', text: '受影響的只有內部工具；照當月演練的步驟處理，病人流程沒有受影響' })
  if (onK(st.fe)) out.push({ kind: 'inc', svc: 'fe', patient: 7, short: '櫃台改用紙本掛號 7 分鐘', text: '掛號前端兩個副本都在那台節點上，櫃台改用紙本掛號 7 分鐘；之後補上 topologySpreadConstraints 與 PDB' })
  if (onK(st.api)) out.push({ kind: 'note', svc: 'api', text: 'API 的副本分在不同節點，剩下的照常服務' })
  if (onK(st.rpt)) out.push({ kind: 'inc', svc: 'rpt', back: mode === 'report', text: `報表的 volume 還掛在故障節點上，新的 Pod 掛不上；${mode === 'report' ? '當晚批次改回舊主機跑' : '舊主機已停用，批次延到白天重跑'}` })
  if (out.length === 1) out.push({ kind: 'note', text: '叢集上還沒有業務服務，只影響監控元件' })
  return out
}

function simulate(mode, opt) {
  const p = plan(mode, opt.fwDelay)
  const A = opt.early ? 6 : T
  const miss = AUDIT.filter((_, i) => p.audit[i] > A)
  const byM = Array.from({ length: T + 2 }, () => [])
  p.E.forEach((e) => byM[e.m].push(e))
  const st = { fe: 'vm', api: 'vm', rpt: 'vm', pay: 'vm' }
  const rows = [{ t: 0, st: { ...st }, ev: [], prof: 0, inc: 0, back: 0, hits: 0, mins: 0, moved: 0, todo: AUDIT.length }]
  let prof = 0, inc = 0, back = 0, hits = 0, mins = 0, started = false
  for (let m = 1; m <= T; m++) {
    for (const s in st) if (st[s] === 'back') st[s] = 'vm'
    const list = []
    let gain = 1, moves = 0
    const apply = (e) => {
      list.push(e)
      if (e.kind === 'move') {
        st[e.svc] = e.canary ? 'canary' : 'k8s'
        gain += e.re ? 3 : moves++ ? 2 : started ? 6 : 10   // 同一個月搬好幾個，後面的學不到多少
        started = true
        return
      }
      gain += GAIN[e.kind]
      if (e.kind === 'prep' && !onK(st[e.svc])) st[e.svc] = 'prep'
      if (e.kind === 'wait') st[e.svc] = 'wait'
      if (e.kind === 'inc') {
        inc++
        if (e.patient) { hits++; mins += e.patient }
        if (e.back) { back++; st[e.svc] = 'back' }
      }
    }
    byM[m].forEach(apply)
    if (opt.node && m === NODE_MONTH) {
      nodeEvents(mode, st).forEach(apply)
      if (st.rpt === 'back') byM[m + 1].push({ kind: 'move', svc: 'rpt', re: true, text: '報表回到叢集；補上節點故障時處理 volume 的步驟' })
    }
    if (m === A) apply({ kind: 'audit', text: miss.length ? `資安稽核：${miss.length} 項缺失（${miss.join('、')}）` : '資安稽核：通過，五個項目都有紀錄' })
    const incN = list.filter((e) => e.kind === 'inc').length
    if (incN >= 3) gain -= incN * 2                                  // 同時救好幾個火，學到的有限
    prof = Math.min(100, prof + gain)
    const moved = Object.values(st).filter(onK).length
    rows.push({ t: m, st: { ...st }, ev: list, prof, inc, back, hits, mins, moved, todo: p.audit.filter((x) => x > m).length })
  }
  return { p, A, miss, rows }
}

/* 四個前置問題在第 r.t 個月的狀態 */
function preChips(p, r) {
  const m = r.t
  return ['fw', 'sigterm', 'disk', 'longconn'].map((k) => {
    if (k === 'fw') {
      if (m < p.fwReq) return { k, label: '未申請', tone: '' }
      if (m < p.fw) return { k, label: '申請中', tone: 'warn' }
      if (m < p.fwFull) return { k, label: '放行 3 / 4 台節點', tone: m >= p.cut ? 'bad' : 'warn' }
      return { k, label: '已放行節點網段', tone: 'ok' }
    }
    const svc = k === 'disk' ? 'rpt' : 'pay'
    const prep = p.E.find((e) => e.pre === k)
    const done = p.E.find((e) => e.kind === 'move' && e.svc === svc && e.m > prep.m)
    if (m < prep.m) {
      const live = onK(r.st[svc]) || r.st[svc] === 'back'
      return { k, label: live ? '沒處理就上線' : '未處理', tone: live ? 'bad' : '' }
    }
    if (!done || m < done.m) return { k, label: '修改中', tone: 'warn' }
    return { k, label: '已解決', tone: 'ok' }
  })
}

const EXPLAIN = {
  stateless: { title: '先搬前端與 API：從風險低的學起', body: [
    '前端不連舊系統，第一個月要處理的只有映像、探針與 Ingress；防火牆申請同時送出，前端穩定時 API 也能接著上。每個服務都先導一部分流量，出事把入口指回 VM。',
    '代價是最痛的報表與最難的付款排在後面，收益來得慢。前端在門診時段流量最高，出事時就是病人在排隊的時候，好在有紙本掛號可以暫代。',
  ] },
  report: { title: '先搬報表：最痛的先解決，第一課就是儲存', body: [
    '報表的 CPU 爭用與磁碟塞滿最早解決，夜間批次也不碰門診流程，出錯白天重跑。',
    '代價是團隊第一個要學的就是儲存：CSI driver、StorageClass、ReadWriteOnce 只能掛在一個節點，以及節點故障時 volume 卡在原節點。報表一樣要連 Informix，防火牆延誤時照樣卡住。',
  ] },
  bigbang: { title: '一次全部搬：最慢的前置問題決定切換日', body: [
    '四個服務一起改、一起切，總時程最短。但防火牆、SIGTERM、寫本機磁碟、長連線同時處理，團隊第一次在叢集上排錯，就是四個服務同時出狀況的週末。',
    '掛號與繳費同一天受影響，回退牽連多個服務；防火牆補件又要再等一次審核。事故期間的手動修改，也是稽核最容易抓到的缺口。',
  ] },
  platform: { title: '先只建平台：先練維運，再碰病人流程', body: [
    '前四個月只有內部工具在叢集上：權限、變更紀錄、Pod Security、備份還原演練一開始就做，節點故障時受影響的只有 wiki 和儀表板。',
    '代價是頭幾個月沒有業務收益，付款服務到年底才上去；內部工具碰不到防火牆、長連線與儲存，這些問題仍要到搬業務服務時才遇到。',
  ] },
}

export default function FirstK8sServiceScenarioLab() {
  const [mode, setMode] = useState('stateless')
  const [node, setNode] = useState(false)
  const [fwDelay, setFwDelay] = useState(false)
  const [early, setEarly] = useState(false)
  const [month, setMonth] = useState(T)
  const [playing, setPlaying] = useState(false)
  const [scrub, setScrub] = useState(null)             // 游標移到圖上：看任一個月
  const sims = useMemo(() => Object.fromEntries(MODES.map(({ value }) => [value, simulate(value, { node, fwDelay, early })])), [node, fwDelay, early])
  const sim = sims[mode]
  const [tick, resetTick] = useTicker(playing, 650)
  useEffect(() => {
    if (!playing) return
    setMonth(Math.min(T, tick))
    if (tick >= T) setPlaying(false)
  }, [tick, playing])
  const play = () => { resetTick(); setScrub(null); setMonth(0); setPlaying(true) }
  const pick = (m) => { setPlaying(false); setScrub(null); setMonth(m) }
  const shown = scrub ?? month
  const r = sim.rows[shown]
  const end = sim.rows[T]
  const { p } = sim
  const ex = EXPLAIN[mode]
  const chips = preChips(p, r)
  const incMax = Math.max(4, ...Object.values(sims).map((s) => s.rows[T].inc))
  const chart = { xMax: T, upto: month, mark: scrub, onScrub: setScrub, xTicks: [0, 3, 6, 9, 12], fmtX: (m) => `${m}` }
  const incOn = (s) => r.ev.some((e) => e.kind === 'inc' && e.svc === s)
  const hurt = (svcs) => r.ev.filter((e) => e.patient && svcs.includes(e.svc)).map((e) => e.short).join('；') || undefined
  const fwPartial = shown >= p.fw && shown < p.fwFull
  const fwValue = shown < p.fw ? '只放行舊 VM' : fwPartial ? '放行 3 / 4 台節點' : '放行節點網段'
  const box = (s, label) => ({ label, value: WHERE[r.st[s]], hot: onK(r.st[s]), bad: incOn(s) })
  const pending = Object.values(r.st).filter((s) => s === 'prep' || s === 'wait').length
  const audited = shown >= sim.A
  const log = r.ev.filter((e) => e.text)

  return (
    <Lab accent="blue" kicker="SCENARIO LAB" title="同一批服務，四種搬遷順序：12 個月的進度、事故與病人流程"
         blurb="掛號前端、掛號 API、報表、付款四個服務搬上地端叢集的 12 個月；Informix 不搬。數字皆為示意。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Toggle label="注入：第 4 個月節點故障" checked={node} onChange={setNode} />
        <Toggle label="注入：防火牆申請延誤 3 個月" checked={fwDelay} onChange={setFwDelay} />
        <Toggle label="注入：稽核提前到第 6 個月" checked={early} onChange={setEarly} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={play}>{playing ? '重新播放' : '逐月播放'}</button>
            <span className="muted">{shown ? `第 ${shown} / ${T} 個月` : '現況'}</span>
            <span className="spacer" />
            {end.hits ? <Status>病人流程受影響 {end.hits} 次</Status> : <Status ok>病人流程沒有受影響</Status>}
            <Status ok={end.moved === 4} warn>第 12 個月：{end.moved} / 4 在叢集上</Status>
          </LabControls>
          <LabStage plain label="逐月的搬遷進度">
            <div className="fk-months" role="group" aria-label="月份">
              {sim.rows.slice(1).map((x) => {
                const has = (f) => x.ev.some(f)
                const cls = `fk-m${x.t === shown ? ' on' : ''}${x.t > month ? ' later' : ''}${has((e) => e.patient) ? ' hurt' : ''}`
                return (
                  <button key={x.t} type="button" className={cls} onClick={() => pick(x.t)} aria-pressed={x.t === shown} aria-label={`第 ${x.t} 個月`}>
                    <b>{x.t}</b>
                    <span className="fk-dots">
                      {has((e) => e.kind === 'move') && <i className="fk-mv" />}
                      {has((e) => e.kind === 'inc') && <i className="fk-ic" />}
                      {has((e) => e.back) && <i className="fk-bk" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="fk-legend">
              <span><i className="fk-mv" />搬遷</span><span><i className="fk-ic" />事故</span><span><i className="fk-bk" />回退</span>
              <span><i className="fk-hurt" />病人流程受影響</span>
            </div>
            <div className="fk-tiles" role="img" aria-label={`第 ${shown} 個月：${r.moved} 個服務在叢集上`}>
              {SVCS.map(([s, n]) => <div key={s} className={`fk-tile fk-${r.st[s]}${incOn(s) ? ' fk-hit' : ''}`}><b>{n}</b><span>{TILE[r.st[s]]}</span></div>)}
              <div className="fk-tile fk-stay"><b>Informix</b><span>不搬・原主機</span></div>
            </div>
            <div className="fk-pre">
              <span className="fk-pre-l">前置問題</span>
              {chips.map((c) => <span key={c.k} className={`fk-chip ${c.tone}`}>{PRE[c.k]}：{c.label}</span>)}
            </div>
            <Flow title={`掛號路徑（第 ${shown} 個月）`} back={hurt(['fe', 'api'])}
                  steps={[{ label: '櫃台／病人', value: '白天尖峰' }, box('fe', '掛號前端'), box('api', '掛號 API'),
                          { label: '院內防火牆', value: fwValue, bad: r.st.api === 'wait' || (fwPartial && shown >= p.cut) }, { label: 'Informix', value: '原主機' }]} />
            <Flow title="繳費路徑" back={hurt(['pay'])}
                  steps={[{ label: '繳費機與刷卡機', value: '約 60 條長連線' }, box('pay', '付款 socket'),
                          { label: '院內防火牆', value: fwValue, bad: r.st.pay === 'wait' }, { label: 'Informix', value: '帳務' }]} />
            <div className="fk-charts">
              <LineChart {...chart} title="團隊熟練度（0–100）" yMax={100} fmtY={(v) => `${Math.round(v)}`}
                         series={[{ key: 'prof', label: '熟練度', color: 'var(--c-blue)', values: sim.rows.map((x) => x.prof) }]} />
              <LineChart {...chart} title="累計次數" yMax={incMax} fmtY={(v) => `${Math.round(v)}`}
                         series={[
                           { key: 'inc', label: '事故', color: 'var(--c-orange)', values: sim.rows.map((x) => x.inc) },
                           { key: 'back', label: '回退', color: 'var(--c-violet)', values: sim.rows.map((x) => x.back) },
                           { key: 'hits', label: '病人流程受影響', color: 'var(--critical)', values: sim.rows.map((x) => x.hits) },
                         ]} />
            </div>
            <Caption>熟練度依每月的工作推算：建平台、改程式、搬遷、演練、處理事故各加不同分數，同一個月搬好幾個或同時救好幾個火時加得少；防火牆申請從送件到生效 {fwDelay ? 4 : 1} 個月（全部示意）</Caption>
          </LabStage>
          <Stats min={128}>
            <Stat label="在叢集上" value={`${r.moved} / 4`} note={r.moved === 4 ? '四個服務都搬完' : pending ? `${pending} 個改程式或等防火牆` : 'Informix 不搬'} tone={r.moved === 4 ? 'ok' : ''} />
            <Stat label="事故（累計）" value={r.inc} unit="次" note={`本月 ${r.ev.filter((e) => e.kind === 'inc').length} 次`} tone={r.inc >= 4 ? 'bad' : r.inc ? 'warn' : 'ok'} />
            <Stat label="病人流程受影響" value={r.hits} unit="次" note={r.hits ? `約 ${r.mins} 分鐘` : '掛號與繳費都沒中斷'} tone={r.hits ? 'bad' : 'ok'} />
            <Stat label="回退" value={r.back} unit="次" note="切回舊 VM" tone={r.back ? 'warn' : ''} />
            <Stat label="團隊熟練度" value={r.prof} unit="/ 100" note="示意" />
            <Stat label={`稽核（第 ${sim.A} 個月）`} value={audited ? (sim.miss.length ? `${sim.miss.length} 項缺失` : '通過') : `待辦 ${r.todo} 項`}
                  note={audited ? (sim.miss.join('、') || '五項都有紀錄') : `共 ${AUDIT.length} 項`} tone={audited ? (sim.miss.length ? 'bad' : 'ok') : ''} />
          </Stats>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <LabExplain title={shown ? `第 ${shown} 個月` : '現況'}>
            {shown === 0 ? <p>四個服務都在 VM 上，Informix 留在原主機；防火牆只放行這些 VM。</p>
              : log.length ? (
                <ul className="fk-log">
                  {log.map((e, i) => (
                    <li key={i}><span className={`fk-tag fk-${e.kind}`}>{KIND[e.kind]}{e.pre ? `・${PRE[e.pre]}` : ''}</span>{e.text}</li>
                  ))}
                </ul>
              ) : <p>照常維運，沒有新的變更。</p>}
          </LabExplain>
          <Callout title="什麼時候會踩到">挑第一個服務時通常同時有兩股壓力：院方想看到病人用得到的成果，維運想先解決最痛的系統。前置問題在 VM 上多半看不出來：防火牆只認舊主機的 IP、程式不處理 SIGTERM 但 systemd 重啟時沒人注意、報表寫在本機磁碟從來沒丟過。它們在叢集上第一次滾動更新、第一次節點維護時才出現，差別在於那時叢集上跑的是哪個服務。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .fk-months { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 4px; }
        .fk-m { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; padding: 4px 0 5px; border: 1px solid var(--hairline); border-radius: 4px; background: var(--surface-1); color: var(--ink-2); font: inherit; font-size: 0.72rem; cursor: pointer; transition: border-color 0.2s ease, opacity 0.2s ease, background 0.2s ease; }
        .fk-m b { font-family: var(--mono); font-weight: 600; }
        .fk-m:hover { border-color: var(--ink-3); }
        .fk-m.on { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); color: var(--ink-1); }
        .fk-m.hurt { background: color-mix(in srgb, var(--critical) 14%, var(--surface-1)); }
        .fk-m.later { opacity: 0.35; }
        .fk-dots { display: flex; gap: 2px; height: 6px; }
        .fk-dots i, .fk-legend i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; }
        .fk-mv { background: var(--good); }
        .fk-ic { background: var(--serious); }
        .fk-bk { background: var(--critical); }
        .fk-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 0.7rem; color: var(--ink-3); }
        .fk-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .fk-legend i.fk-hurt { width: 12px; height: 9px; border-radius: 2px; background: color-mix(in srgb, var(--critical) 14%, var(--surface-1)); border: 1px solid var(--hairline); }
        .fk-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 6px; margin-top: 12px; }
        .fk-tile { display: grid; gap: 2px; min-width: 0; padding: 6px 8px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface-2); transition: background 0.25s ease, border-color 0.25s ease; }
        .fk-tile b { font-size: 0.78rem; color: var(--ink-1); }
        .fk-tile span { font-size: 0.7rem; color: var(--ink-3); }
        .fk-tile.fk-prep, .fk-tile.fk-wait { border-style: dashed; border-color: var(--serious); }
        .fk-tile.fk-wait span { color: var(--serious); }
        .fk-tile.fk-canary { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); }
        .fk-tile.fk-k8s { background: var(--good); border-color: var(--good); }
        .fk-tile.fk-k8s b, .fk-tile.fk-k8s span { color: var(--surface-1); }
        .fk-tile.fk-back { border-color: var(--critical); box-shadow: inset 0 0 0 1px var(--critical); }
        .fk-tile.fk-back span { color: var(--critical); font-weight: 700; }
        .fk-tile.fk-hit { border-color: var(--critical); box-shadow: inset 0 0 0 2px var(--critical); }
        .fk-tile.fk-stay { background: var(--page); border-style: dotted; }
        .fk-pre { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; font-size: 0.72rem; }
        .fk-pre-l { color: var(--ink-3); font-weight: 600; }
        .fk-chip { padding: 2px 8px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface-1); color: var(--ink-2); }
        .fk-chip.warn { border-color: var(--serious); color: var(--serious); }
        .fk-chip.bad { border-color: var(--critical); color: var(--critical); font-weight: 700; }
        .fk-chip.ok { border-color: var(--good); color: var(--good); }
        .fk-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
        .fk-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .fk-log li { font-size: 0.84rem; line-height: 1.55; color: var(--ink-2); }
        .fk-tag { display: inline-block; margin-right: 6px; padding: 0 6px; border: 1px solid var(--hairline); border-radius: 3px; font-size: 0.68rem; color: var(--ink-2); white-space: nowrap; }
        .fk-tag.fk-inc, .fk-tag.fk-node { border-color: var(--critical); color: var(--critical); }
        .fk-tag.fk-move { border-color: var(--good); color: var(--good); }
        .fk-tag.fk-prep, .fk-tag.fk-wait { border-color: var(--serious); color: var(--serious); }
        .fk-tag.fk-audit, .fk-tag.fk-drill { border-color: var(--lab-accent); color: var(--lab-accent); }
        @media (max-width: 560px) { .fk-charts { grid-template-columns: 1fr; } }
        @media (prefers-reduced-motion: reduce) { .fk-m, .fk-tile { transition: none; } }
      `}</style>
    </Lab>
  )
}
