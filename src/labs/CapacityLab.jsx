import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, Stats, Stat, Caption, fmtN } from './ui.jsx'

/* ============================================================
   容量估算：尖峰 RPS × 每請求成本 ÷ 目標使用率
   - CPU 只看 CPU 時間；worker 數看「整段停留時間」（Little's Law）
   - VM 模式：依機器規格算台數；K8s 模式：依 Pod requests 算 Pod 數與節點數
   - 「掛掉一台」看 N+1：剩下的機器扛不扛得住
   數字皆依固定假設推算，是估算起點，不是量測值
   ============================================================ */

const SPECS = {
  s: { c: 4, m: 16, label: '4 核 / 16 GB' },
  m: { c: 8, m: 32, label: '8 核 / 32 GB' },
  l: { c: 16, m: 64, label: '16 核 / 64 GB' },
  xl: { c: 32, m: 128, label: '32 核 / 128 GB' },
}
const PODS = {
  s: { cpu: 0.5, w: 2, label: '0.5 核 · 2 worker' },
  m: { cpu: 1, w: 4, label: '1 核 · 4 worker' },
  l: { cpu: 2, w: 8, label: '2 核 · 8 worker' },
}
const ALLOC = 0.9        // 假設節點約 90% 可分配給 Pod（其餘給 kubelet、OS；實際依發行版與設定而定）
const DISK_FILL = 0.7    // 磁碟用到 70% 就該擴充
const MAX_SHOW = 6
const EPS = 1e-9

const f1 = (n) => (n >= 100 ? fmtN(Math.round(n)) : n >= 10 ? n.toFixed(1) : n.toFixed(2).replace(/\.?0+$/, ''))
const gb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} TB` : `${f1(n)} GB`)
const cpuStr = (c) => (c < 1 ? `${Math.round(c * 1000)}m` : `${c}`)

function calc(p) {
  const u = p.util / 100
  const rps = (p.users * p.rpm) / 60
  const busy = (rps * p.cpuMs) / 1000                     // 平均同時忙著的核心數
  const cores = busy / u
  const W = (p.cpuMs + p.waitMs) / 1000
  const L = rps * W                                        // Little's Law
  const workers = Math.max(1, Math.ceil(L / u - EPS))
  const memGB = (workers * p.memMB) / 1024
  const data = p.growth * p.months, backup = data * p.backups
  const disk = (data + backup) / DISK_FILL
  const spec = SPECS[p.spec]
  const vmCpuN = Math.ceil(cores / spec.c - EPS), vmMemN = Math.ceil(memGB / spec.m - EPS)
  const vmN = Math.max(1, vmCpuN, vmMemN)
  const pod = PODS[p.pod]
  const podMem = (pod.w * p.memMB) / 1024
  const podsCpu = Math.ceil(cores / pod.cpu - EPS), podsW = Math.ceil(workers / pod.w - EPS)
  const pods = Math.max(1, podsCpu, podsW)
  const ppnCpu = Math.floor((spec.c * ALLOC) / pod.cpu + EPS), ppnMem = Math.floor((spec.m * ALLOC) / podMem + EPS)
  const ppn = Math.min(ppnCpu, ppnMem)
  const nodes = ppn > 0 ? Math.ceil(pods / ppn) : 1
  return { u, rps, busy, cores, W, L, workers, memGB, data, backup, disk, spec, vmCpuN, vmMemN, vmN, pod, podMem, podsCpu, podsW, pods, ppnCpu, ppnMem, ppn, nodes }
}

export default function CapacityLab() {
  const [users, setUsers] = useState(2000)
  const [rpm, setRpm] = useState(6)
  const [cpuMs, setCpuMs] = useState(40)
  const [waitMs, setWaitMs] = useState(120)
  const [memMB, setMemMB] = useState(256)
  const [util, setUtil] = useState(70)
  const [growth, setGrowth] = useState(20)
  const [months, setMonths] = useState(24)
  const [backups, setBackups] = useState(2)
  const [mode, setMode] = useState('vm')
  const [spec, setSpec] = useState('m')
  const [pod, setPod] = useState('s')
  const [down, setDown] = useState(false)
  const m = calc({ users, rpm, cpuMs, waitMs, memMB, util, growth, months, backups, spec, pod })
  const k8s = mode === 'k8s'

  /* VM：掛一台後，CPU 負載攤到剩下的機器；worker 不會搬家，可用 worker 跟著變少 */
  const n = k8s ? m.nodes : m.vmN
  const alive = down ? n - 1 : n
  const perBusy = alive > 0 ? m.busy / alive : Infinity
  const perUtil = perBusy / m.spec.c
  const workersLeft = Math.round((m.workers * alive) / n)
  /* K8s：Pod 依 requests 排進節點；放不下的變 Pending */
  const placed = k8s ? Math.min(m.pods, alive * m.ppn) : 0
  const pending = k8s ? m.pods - placed : 0
  const vmTone = alive === 0 || perUtil > 1 ? 'bad' : perUtil > m.u + EPS || workersLeft < m.L ? 'warn' : ''

  const lines = [
    `尖峰 RPS = ${fmtN(users)} 人 × ${rpm} 次/分 ÷ 60 = ${f1(m.rps)} req/s`,
    `CPU 核心 = ${f1(m.rps)} × ${(cpuMs / 1000).toFixed(3)} s ÷ ${util}% = ${f1(m.cores)} → ${Math.ceil(m.cores - EPS)} 核`,
    `同時處理中 L = λ × W = ${f1(m.rps)} × (${(cpuMs / 1000).toFixed(3)} + ${(waitMs / 1000).toFixed(3)}) s = ${f1(m.L)} 個`,
    `worker = ${f1(m.L)} ÷ ${util}% → ${fmtN(m.workers)} 個；記憶體 = ${fmtN(m.workers)} × ${memMB} MB = ${gb(m.memGB)}`,
    `磁碟 = ${growth} GB × ${months} 月 × (1 + ${backups} 份備份) ÷ ${DISK_FILL * 100}% = ${gb(m.disk)}`,
    k8s
      ? `Pod = max(${f1(m.cores)} ÷ ${m.pod.cpu} 核, ${fmtN(m.workers)} ÷ ${m.pod.w} worker) = ${fmtN(m.pods)}；每節點 min(⌊${f1(m.spec.c * ALLOC)} ÷ ${m.pod.cpu}⌋, ⌊${f1(m.spec.m * ALLOC)} ÷ ${f1(m.podMem)} GB⌋) = ${m.ppn} 個 → ${m.ppn ? `${m.nodes} 台` : '放不下'}`
      : `機器 = max(⌈${f1(m.cores)} ÷ ${m.spec.c} 核⌉, ⌈${f1(m.memGB)} ÷ ${m.spec.m} GB⌉) = max(${m.vmCpuN}, ${m.vmMemN}) = ${m.vmN} 台`,
  ]

  const yaml = `resources:
  requests:     # 排程依據
    cpu: "${cpuStr(m.pod.cpu)}"
    memory: "${Math.round(m.podMem * 1024)}Mi"
  limits:
    cpu: "${cpuStr(m.pod.cpu * 2)}"     # 超過：節流
    memory: "${Math.round(m.podMem * 1024)}Mi"   # 超過：OOMKilled`

  return (
    <Lab accent="var(--c-teal)" kicker="OPS LAB" title="容量估算：從尖峰人數推到幾核、幾台、幾 GB"
         blurb="拉尖峰人數、每個請求的 CPU 時間與等待時間，看核心數、同時處理中的請求數、worker 與記憶體、磁碟怎麼跟著變；切到 Kubernetes 看 requests 換算成幾個 Pod、幾台節點；按「掛掉一台」檢查剩下的扛不扛得住。">
      <LabControls>
        <Seg label="部署方式" tinted value={mode} onChange={(v) => { setMode(v); setDown(false) }}
             options={[{ value: 'vm', label: 'VM' }, { value: 'k8s', label: 'Kubernetes' }]} />
        <Seg label={k8s ? '節點規格' : '機器規格'} value={spec} onChange={setSpec}
             options={Object.entries(SPECS).map(([k, s]) => ({ value: k, label: s.label }))} />
        {k8s && <Seg label="每個 Pod requests" value={pod} onChange={setPod}
                     options={Object.entries(PODS).map(([k, s]) => ({ value: k, label: s.label }))} />}
        <Toggle label="掛掉一台（N+1 檢查）" checked={down} onChange={setDown} />
      </LabControls>
      <LabControls>
        <Slider label="尖峰同時在線" min={100} max={20000} step={100} value={users} onChange={setUsers} format={(v) => `${fmtN(v)} 人`} />
        <Slider label="每人每分鐘請求" min={1} max={30} value={rpm} onChange={setRpm} format={(v) => `${v} 次`} />
        <Slider label="每請求 CPU 時間" min={5} max={300} step={5} value={cpuMs} onChange={setCpuMs} format={(v) => `${v} ms`} />
        <Slider label="每請求等 I/O 時間" min={0} max={1000} step={10} value={waitMs} onChange={setWaitMs} format={(v) => `${v} ms`} />
        <Slider label="每個 worker 記憶體" min={64} max={2048} step={64} value={memMB} onChange={setMemMB} format={(v) => `${v} MB`} />
        <Slider label="目標使用率上限" min={50} max={80} step={5} value={util} onChange={setUtil} format={(v) => `${v}%`} />
        <Slider label="資料每月成長" min={1} max={200} value={growth} onChange={setGrowth} format={(v) => `${v} GB`} />
        <Slider label="保留月數" min={1} max={60} value={months} onChange={setMonths} format={(v) => `${v} 月`} />
        <Slider label="備份份數" min={0} max={7} value={backups} onChange={setBackups} format={(v) => `${v} 份`} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label={k8s ? '節點與 Pod 排程' : '機器 CPU 與記憶體'}
                    caption={k8s
                      ? `條 = requests（一格一個 Pod），虛線 = 可分配量；${fmtN(m.pods)} 個 Pod × requests ${m.pod.cpu} 核 / ${f1(m.podMem)} GB；節點可分配量假設 ${ALLOC * 100}%`
                      : `每台 ${m.spec.label}；格子 = 核心，虛線格 = 超過目標使用率 ${util}% 的區段；記憶體未計 OS 與其他程序`}>
            <div className="cap-machines">
              {Array.from({ length: Math.min(n, MAX_SHOW) }, (_, i) => {
                const isDown = down && i === 0
                if (k8s) {
                  const idx = i - (down ? 1 : 0)
                  const cnt = isDown || alive <= 0 ? 0 : Math.floor(placed / alive) + (idx < placed % alive ? 1 : 0)
                  return <NodeSvg key={i} i={i} spec={m.spec} pod={m.pod} podMem={m.podMem} cnt={cnt} isDown={isDown} />
                }
                return <MachineSvg key={i} i={i} spec={m.spec} busy={isDown ? 0 : perBusy} mem={m.memGB / n} u={m.u} isDown={isDown} />
              })}
              {n > MAX_SHOW && <div className="cap-more">…共 {fmtN(n)} 台</div>}
            </div>
            {k8s && pending > 0 && (
              <div className="cap-pending"><Status>Pending {fmtN(pending)} 個 Pod</Status>
                <span>{m.ppn === 0 ? 'Pod 的 requests 比一整台節點的可分配量還大，排不上任何節點' : '剩下的節點可分配量放不下，這些 Pod 不會啟動'}</span></div>
            )}
          </LabStage>
          <Stats min={150}>
            <Stat label="尖峰 RPS" value={f1(m.rps)} unit="req/s" note={`平均忙 ${f1(m.busy)} 核`} />
            <Stat label="需要的 CPU" value={Math.ceil(m.cores - EPS)} unit="核" note={`${f1(m.cores)}（÷ ${util}%）`} />
            <Stat label="同時處理中 L" value={f1(m.L)} unit="個" note={`W = ${cpuMs + waitMs} ms`} />
            <Stat label="worker / 記憶體" value={`${fmtN(m.workers)} / ${gb(m.memGB)}`} note={`每個 ${memMB} MB`} />
            <Stat label="磁碟（含備份、headroom）" value={gb(m.disk)} note={`資料 ${gb(m.data)} + 備份 ${gb(m.backup)}`} />
            {k8s
              ? <Stat label="Pod / 節點" value={`${fmtN(m.pods)} / ${m.ppn ? m.nodes : '—'}`} tone={pending > 0 ? 'bad' : ''}
                      note={down ? (pending > 0 ? `掛一台：${fmtN(pending)} 個 Pending` : '掛一台：還放得下') : `每節點 ${m.ppn} 個`} />
              : <Stat label="機器台數" value={m.vmN} unit="台" tone={down ? vmTone : ''}
                      note={down ? (alive === 0 ? '只有一台，掛了就全停' : `剩 ${alive} 台：每台 CPU ${Math.round(perUtil * 100)}%`) : (m.vmMemN > m.vmCpuN ? '記憶體決定台數' : 'CPU 決定台數')} />}
          </Stats>
          <div className="cap-math" aria-label="公式代入">
            {lines.map((l, i) => <div key={i}><span className="k">{i + 1}</span><span>{l}</span></div>)}
          </div>
          {down && !k8s && (
            <LabControls>
              {alive === 0 ? <Status>服務全停</Status> : perUtil > 1 ? <Status>CPU 超過 100%：請求排隊、延遲飆高</Status>
                : perUtil > m.u + EPS ? <Status warn>CPU {Math.round(perUtil * 100)}%，超過目標 {util}%</Status> : <Status ok>CPU {Math.round(perUtil * 100)}%，仍在目標內</Status>}
              {alive > 0 && (workersLeft < m.L ? <Status warn>可用 worker {workersLeft} &lt; 同時處理中 {f1(m.L)}，請求開始排隊</Status> : <Status ok>可用 worker {workersLeft} ≥ {f1(m.L)}</Status>)}
            </LabControls>
          )}
        </div>

        <div className="lab-stack">
          {k8s ? (
            <>
              <Code lang="yaml" title={`Pod resources（${m.pod.label}）`} highlight={[2, 5]}>{yaml}</Code>
              <LabExplain title="Kubernetes：requests 管排程，limits 管上限">
                <p><strong>requests</strong> 是排程依據：scheduler 只看「節點剩下的可分配量放不放得下這個 Pod 的 requests」，不看實際用量。所以 Pod 數 = max(核心需求 ÷ 每 Pod CPU request, worker 需求 ÷ 每 Pod worker 數)，節點數再由「一台放得下幾個 Pod」換算。</p>
                <p><strong>limits</strong> 是上限：記憶體超過會被 OOMKilled（exit code 137）重啟；CPU 超過不會被殺，而是被節流（throttle）變慢。記憶體 limit 常設成跟 request 一樣，行為最好預期；CPU limit 要不要設，各團隊做法不同。</p>
                <p>試試把 Pod 調大、節點調小：requests 比整台節點的可分配量還大時，Pod 會一直 Pending。打開「掛掉一台」：剩下節點放不下的 Pod 也會 Pending——節點數要多留一台。</p>
              </LabExplain>
            </>
          ) : (
            <LabExplain title="CPU 看 CPU 時間，worker 看整段停留時間">
              <p>核心數只跟 CPU 時間有關：每秒 {f1(m.rps)} 個請求、每個吃 {cpuMs} ms CPU，平均就有 {f1(m.busy)} 顆核心一直在忙，再除以目標使用率留 headroom。</p>
              <p>worker 數看的是 Little&apos;s Law：同時在處理的請求數 L = 到達率 λ × 平均停留時間 W。等 DB、等外部 API 的時間不吃 CPU，但同步 worker 會被佔住。把「等 I/O」拉高：核心數不變，worker 與記憶體一路變多。</p>
              <p>打開「掛掉一台」做 N+1 檢查：負載攤到剩下的機器，每台使用率跟著上升，超過目標就是警告色。只有一台時，掛了就是全停。</p>
            </LabExplain>
          )}
          <LabExplain title="估算是起點，不是答案">
            <p><strong>尖峰與平均差很多</strong>：一天的平均 RPS 會把開放報名、上班第一個小時這種尖峰抹平；從尖峰推，平均只拿來估成本。</p>
            <p><strong>要壓測驗證</strong>：每個請求的 CPU 時間、記憶體、等待時間都要實測；用估算值設定壓測目標，再用壓測結果修正估算。</p>
            <p><strong>瓶頸不一定是 CPU</strong>：資料庫常卡在磁碟 IOPS 或延遲，大檔下載卡在網路頻寬，連線數也有上限。這裡的磁碟只算容量，索引、WAL、log 另計。</p>
          </LabExplain>
          <Callout title="實際用在哪裡">
            新系統上線前申請機器或設定 K8s requests、活動前評估要不要擴充、年度預算估儲存空間。把每一步的假設（尖峰人數、每請求成本、使用率上限）寫下來，壓測或上線後拿實際數字回頭校正。
          </Callout>
        </div>
      </LabGrid>
      <Caption>所有數字依上面的假設推算；實際值以壓測與監控為準。</Caption>

      <style>{`
        .cap-machines { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: flex-start; }
        .cap-machines svg { width: 200px; max-width: calc(50% - 5px); flex: 0 1 200px; }
        .cap-more { align-self: center; font-size: 0.8rem; color: var(--ink-3); font-family: var(--mono); }
        .cap-pending { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; font-size: 0.8rem; color: var(--ink-2); justify-content: center; }
        .cap-svg .box { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.3s ease, opacity 0.3s ease; }
        .cap-svg.down .box { stroke: var(--critical); stroke-dasharray: 4 3; }
        .cap-svg.down .body { opacity: 0.25; }
        .cap-svg .cell { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 0.8; transition: fill 0.3s ease; }
        .cap-svg .cell.head { stroke: var(--ink-3); stroke-dasharray: 2 2; }
        .cap-svg .cell-fill { fill: var(--lab-accent); transition: opacity 0.3s ease, fill 0.3s ease; }
        .cap-svg .cell-fill.over { fill: var(--serious); }
        .cap-svg .cell-fill.crit { fill: var(--critical); }
        .cap-svg .track { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 0.8; }
        .cap-svg .bar { fill: var(--lab-accent); transition: width 0.35s ease; }
        .cap-svg .bar.over { fill: var(--serious); }
        .cap-svg .bar.req { fill: var(--c-slate); }
        .cap-svg .tick { stroke: var(--ink-1); stroke-width: 1.5; }
        .cap-svg .t { font-family: var(--sans); font-size: 11px; fill: var(--ink-1); font-weight: 600; }
        .cap-svg .s { font-family: var(--mono); font-size: 10px; fill: var(--ink-2); }
        .cap-svg .x { stroke: var(--critical); stroke-width: 2; }
        @media (max-width: 560px) { .cap-svg .t { font-size: 13px; } .cap-svg .s { font-size: 12.5px; } }
        .cap-math { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); display: grid; gap: 4px; border-left: 3px solid var(--lab-accent); padding-left: 10px; }
        .cap-math div { display: flex; gap: 8px; align-items: baseline; }
        .cap-math div > span:last-child { min-width: 0; overflow-wrap: anywhere; }
        .cap-math .k { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--surface-2); color: var(--ink-3); font-size: 0.64rem; display: inline-flex; align-items: center; justify-content: center; }
        @media (prefers-reduced-motion: reduce) { .cap-svg .box, .cap-svg .cell, .cap-svg .cell-fill, .cap-svg .bar { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 一台 VM：核心格子（8 欄）＋記憶體條；超過目標使用率的格子是虛線框，被填到就變警告色 */
function MachineSvg({ i, spec, busy, mem, u, isDown }) {
  const COLS = 8, CW = 14, GAP = 2.5, X0 = 9
  const rows = Math.ceil(spec.c / COLS)
  const gridY = 26, memY = gridY + rows * (CW + GAP) + 12
  const H = memY + 34
  const limit = Math.floor(u * spec.c + EPS)     // 第 limit 格（0-based）起算 headroom 區
  const memPct = mem / spec.m
  const BW = 132
  return (
    <svg className={`cap-svg${isDown ? ' down' : ''}`} viewBox={`0 0 150 ${H}`} role="img"
         aria-label={isDown ? `VM ${i + 1} 已停機` : `VM ${i + 1}：CPU ${f1(busy)} / ${spec.c} 核，記憶體 ${f1(mem)} / ${spec.m} GB`}>
      <rect x="1" y="1" width="148" height={H - 2} rx="6" className="box" />
      <text x="9" y="17" className="t">VM {i + 1}</text>
      <text x="141" y="17" textAnchor="end" className="s">{isDown ? '停機' : `CPU ${Math.round((busy / spec.c) * 100)}%`}</text>
      <g className="body">
        {Array.from({ length: spec.c }, (_, k) => {
          const x = X0 + (k % COLS) * (CW + GAP), y = gridY + Math.floor(k / COLS) * (CW + GAP)
          const fill = Math.max(0, Math.min(1, busy - k))
          const cls = busy > spec.c ? 'crit' : k >= limit ? 'over' : ''
          return (
            <g key={k}>
              <rect x={x} y={y} width={CW} height={CW} rx="2" className={`cell${k >= limit ? ' head' : ''}`} />
              <rect x={x} y={y} width={CW} height={CW} rx="2" className={`cell-fill ${cls}`} style={{ opacity: fill }} />
            </g>
          )
        })}
        <rect x={X0} y={memY} width={BW} height="9" rx="2" className="track" />
        <rect x={X0} y={memY} width={Math.min(1, memPct) * BW} height="9" rx="2" className={`bar${memPct > u ? ' over' : ''}`} />
        <line x1={X0 + u * BW} x2={X0 + u * BW} y1={memY - 3} y2={memY + 12} className="tick" />
        <text x={X0} y={memY + 23} className="s">記憶體 {f1(mem)}/{spec.m}G</text>
      </g>
      {isDown && <path d={`M20 ${H / 2 - 14} l28 28 M48 ${H / 2 - 14} l-28 28`} className="x" transform="translate(41 0)" />}
    </svg>
  )
}

/* 一台 K8s 節點：CPU / 記憶體的 requests 條，一格一個 Pod；底色條 = 可分配量 */
function NodeSvg({ i, spec, pod, podMem, cnt, isDown }) {
  const X0 = 9, BW = 132
  const allocC = spec.c * ALLOC, allocM = spec.m * ALLOC
  const bars = [
    { y: 34, label: `CPU ${f1(cnt * pod.cpu)}/${f1(allocC)} 核`, per: pod.cpu / spec.c, allocW: ALLOC * BW },
    { y: 72, label: `記憶體 ${f1(cnt * podMem)}/${f1(allocM)}G`, per: podMem / spec.m, allocW: ALLOC * BW },
  ]
  return (
    <svg className={`cap-svg${isDown ? ' down' : ''}`} viewBox="0 0 150 110" role="img"
         aria-label={isDown ? `節點 ${i + 1} 已停機` : `節點 ${i + 1}：${cnt} 個 Pod`}>
      <rect x="1" y="1" width="148" height="108" rx="6" className="box" />
      <text x="9" y="17" className="t">node-{i + 1}</text>
      <text x="141" y="17" textAnchor="end" className="s">{isDown ? '停機' : `${cnt} 個 Pod`}</text>
      <g className="body">
        {bars.map((b) => (
          <g key={b.y}>
            <rect x={X0} y={b.y} width={BW} height="12" rx="2" className="track" />
            <rect x={X0} y={b.y} width={b.allocW} height="12" rx="2" className="cell head" style={{ fill: 'none' }} />
            {Array.from({ length: cnt }, (_, k) => (
              <rect key={k} x={X0 + k * b.per * BW + 0.5} y={b.y + 1} width={Math.max(0.8, b.per * BW - 1)} height="10" rx="1.5" className="bar req" />
            ))}
            <text x={X0} y={b.y + 25} className="s">{b.label}</text>
          </g>
        ))}
      </g>
      {isDown && <path d="M61 41 l28 28 M89 41 l-28 28" className="x" />}
    </svg>
  )
}
