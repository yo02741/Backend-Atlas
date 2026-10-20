import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, Stats, Stat, useTicker, useWidth } from './ui.jsx'

/* ============================================================
   Kubernetes：Deployment、Service 與滾動更新
   - 每個 tick 跑一次簡化版的 Deployment controller：
     先建新版（總數 ≤ replicas + maxSurge），再關舊版（可用數 ≥ replicas − maxUnavailable）
   - readiness 通過才算 Ready；Service 只把流量送給 Ready 的 Pod
   - 關掉節點：上面的 Pod 消失，ReplicaSet 補新的、scheduler 排到其他節點；放不下就 Pending
   時間全部縮短（真實叢集是秒到分鐘級）
   ============================================================ */

const NODES = 3, NODE_CAP = 4     // 假設每台節點最多放 4 個 Pod
const READY_T = 5, TERM_T = 3     // 幾個 tick 後 Ready / 終止完成
const VCOL = ['var(--c-blue)', 'var(--c-orange)', 'var(--c-violet)', 'var(--c-teal)', 'var(--c-magenta)']
const vcol = (v) => VCOL[(v - 1) % VCOL.length]

function initSim() {
  return {
    pods: [0, 1, 2].map((n) => ({ id: n + 1, ver: 1, node: n, st: 'ready', age: 9 })),
    seq: 4, target: 1, stable: 1, broken: {}, down: null, served: 0, failed: 0, rr: 0, dots: [], tick: 0,
  }
}

const isActive = (p) => p.st !== 'term'
const isReady = (p) => p.st === 'ready'

/* 挑 Pod 最少的存活節點；都滿了回 null（Pending） */
function pickNode(pods, down) {
  let best = null, bestN = Infinity
  for (let n = 0; n < NODES; n++) {
    if (n === down) continue
    const c = pods.filter((p) => p.node === n).length
    if (c < NODE_CAP && c < bestN) { best = n; bestN = c }
  }
  return best
}

/* 一個 tick：純函式（StrictMode 下 updater 可能跑兩次） */
function step(s0, { replicas, surge, unavail }) {
  const s = { ...s0, tick: s0.tick + 1 }
  let pods = s0.pods
    .filter((p) => !(p.st === 'term' && p.age >= TERM_T))
    .filter((p) => p.node === null || p.node !== s.down)
    .map((p) => ({ ...p, age: p.age + 1 }))
  // 排程 Pending、啟動中的跑 readiness
  for (const p of pods) {
    if (p.node === null && p.st !== 'term') { const n = pickNode(pods, s.down); if (n !== null) { p.node = n; p.age = 0 } }
    if (p.st === 'starting' && p.node !== null && p.age >= READY_T && !s.broken[p.ver]) p.st = 'ready'
  }
  const notReadyFirst = (a, b) => (isReady(a) - isReady(b)) || ((a.node === null ? 0 : 1) - (b.node === null ? 0 : 1))
  const kill = (list, k) => { for (const p of [...list].sort(notReadyFirst).slice(0, Math.max(0, k))) { p.st = 'term'; p.age = 0 } }
  // 新版：多的砍掉、少的補上（滾動中受 maxSurge 限制）
  let active = pods.filter(isActive)
  let neu = active.filter((p) => p.ver === s.target), old = active.filter((p) => p.ver !== s.target)
  if (neu.length > replicas) kill(neu, neu.length - replicas)
  const room = old.length ? replicas + surge - active.length : Infinity
  const want = Math.min(replicas - neu.length, room)
  for (let i = 0; i < want; i++) {
    const p = { id: s.seq++, ver: s.target, node: null, st: 'starting', age: 0 }
    p.node = pickNode(pods, s.down)
    pods = [...pods, p]
  }
  // 舊版：可用數不低於 replicas − maxUnavailable 才關
  active = pods.filter(isActive)
  neu = active.filter((p) => p.ver === s.target); old = active.filter((p) => p.ver !== s.target)
  const newUnavail = neu.filter((p) => !isReady(p)).length
  kill(old, Math.min(old.length, active.length - (replicas - unavail) - newUnavail))
  if (!pods.some((p) => isActive(p) && p.ver !== s.target)) s.stable = s.target
  // 流量：Service 輪流送給 Ready 的 Pod
  const ready = pods.filter(isReady)
  let dot
  if (ready.length) { const p = ready[s0.rr % ready.length]; dot = { id: s.tick, pod: p.id }; s.served = s0.served + 1; s.rr = s0.rr + 1 }
  else { dot = { id: s.tick, pod: null }; s.failed = s0.failed + 1 }
  s.dots = [...s0.dots, dot].slice(-4)
  s.pods = pods
  return s
}

const ST_LABEL = { ready: 'Ready', starting: '啟動中', stuck: '未就緒', term: '終止中', pending: 'Pending' }

export default function K8sLab() {
  const [replicas, setReplicas] = useState(3)
  const [surge, setSurge] = useState(1)
  const [unavail, setUnavail] = useState(0)
  const [probeFail, setProbeFail] = useState(false)
  const [sim, setSim] = useState(initSim)
  const [tick] = useTicker(true, 450)
  const params = useRef(); params.current = { replicas, surge, unavail }
  useEffect(() => { if (tick) setSim((s) => step(s, params.current)) }, [tick])

  const rolling = sim.target !== sim.stable
  const invalid = surge === 0 && unavail === 0
  const onProbe = (v) => { setProbeFail(v); setSim((s) => (s.target !== s.stable ? { ...s, broken: { ...s.broken, [s.target]: v } } : s)) }
  const deploy = () => setSim((s) => { const t = Math.max(...s.pods.map((p) => p.ver), s.target) + 1; return { ...s, target: t, broken: { ...s.broken, [t]: probeFail } } })
  const undo = () => setSim((s) => ({ ...s, target: s.stable }))
  const toggleNode = () => setSim((s) => ({ ...s, down: s.down === null ? 2 : null }))

  const active = sim.pods.filter(isActive)
  const ready = active.filter(isReady)
  const pending = active.filter((p) => p.node === null)
  const stuckPods = active.filter((p) => p.st === 'starting' && sim.broken[p.ver] && p.age > READY_T)
  const stuck = rolling && stuckPods.length > 0
  const lastFail = sim.dots.length && sim.dots[sim.dots.length - 1].pod === null
  const phase = ready.length === 0 ? 'outage' : stuck ? 'stuck' : pending.length ? 'pending' : rolling ? 'rolling' : sim.down !== null ? 'down' : 'steady'
  const oldVer = rolling ? [...new Set(active.filter((p) => p.ver !== sim.target).map((p) => p.ver))].join('/') : ''

  const box = useRef(null)
  const narrow = useWidth(box, 640) < 520

  const EX = {
    steady: ['穩定狀態：Deployment → ReplicaSet → Pod', [`Deployment 宣告「要 ${replicas} 個 v${sim.target}」，底下的 ReplicaSet 負責維持 Pod 數量；拉副本數，少了就建、多了就砍。`, 'Service 用 label selector 找到這組 Pod，但只把 Ready 的 Pod 放進 endpoints；Ingress 依網域與路徑把外部 HTTP 導到 Service。']],
    rolling: [`滾動更新中：v${oldVer} → v${sim.target}`, [`規則只有兩條：Pod 總數不超過 ${replicas} + maxSurge ${surge} = ${replicas + surge}；可用（Ready）數不低於 ${replicas} − maxUnavailable ${unavail} = ${Math.max(0, replicas - unavail)}。`, '新 Pod 要等 readiness probe 通過才算可用，controller 才會再關掉一個舊的。所以更新過程中 Service 一直有 Ready 的 Pod 在接流量。']],
    stuck: [`更新卡住：v${sim.target} 的 readiness 一直失敗`, [`v${sim.target} 永遠不 Ready，不算可用，舊 Pod 就不會再被關（maxUnavailable 允許的除外）；Service 只送流量給 Ready 的舊 Pod，使用者沒感覺。`, '卡住不會自己好：超過 progressDeadlineSeconds（預設 600 秒）後 Deployment 被標成 ProgressDeadlineExceeded，但不會自動回滾。按「回滾」等同 kubectl rollout undo；或把「新版 readiness 失敗」關掉，模擬修好後繼續。']],
    outage: ['沒有任何 Ready 的 Pod：503', ['Service 的 endpoints 是空的，請求全部失敗。常見原因：只有 1 個副本又設 maxUnavailable ≥ 1、新版 readiness 失敗又沒留舊 Pod，或節點全掛。', '副本數至少 2、maxUnavailable 設 0 搭配 maxSurge ≥ 1，更新時才一定有 Pod 在接流量。']],
    down: ['node-3 停機：Pod 被重新排到其他節點', ['節點失聯後，上面的 Pod 被移除；ReplicaSet 發現數量不夠就建新的，scheduler 排到還有空間的節點，等 readiness 通過才接流量。', '真實叢集裡，節點失聯到驅逐 Pod 預設約 5 分鐘（Pod 的 not-ready / unreachable toleration 300 秒），這裡縮短成立即。節點恢復後，已經跑著的 Pod 不會自動搬回去。']],
    pending: [`${pending.length} 個 Pod Pending：剩下的節點放不下`, ['這裡假設每台節點最多 4 個 Pod。關掉一台後，剩下的容量不夠，多出來的 Pod 停在 Pending，直到節點恢復或加節點。', '容量規劃要算「少一台還放得下」；滾動更新時 maxSurge 也會多佔空間。']],
  }[phase]

  const yaml = `apiVersion: apps/v1
kind: Deployment
spec:
  replicas: ${replicas}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: ${surge}
      maxUnavailable: ${unavail}
  template:
    spec:
      containers:
        - name: api
          image: reg.local/api:v${sim.target}
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 5`
  const hl = phase === 'stuck' ? [14, 15, 16, 17] : phase === 'rolling' ? [8, 9, 14] : phase === 'steady' ? [4] : []

  return (
    <Lab accent="blue" kicker="K8S LAB" title="Deployment、Service 與滾動更新：流量只送給 Ready 的 Pod"
         blurb="按「部署新版本」看 v2 怎麼依 maxSurge / maxUnavailable 一個個換掉 v1；打開「新版 readiness 失敗」看更新卡住、舊 Pod 照樣服務；關掉一台節點，看 Pod 被重新排到別台。">
      <LabControls>
        <Slider label="副本數 replicas" min={1} max={8} value={replicas} onChange={setReplicas} format={(v) => `${v} 個`} />
        <Seg label="maxSurge" value={surge} onChange={setSurge} options={[0, 1, 2].map((v) => ({ value: v, label: String(v) }))} />
        <Seg label="maxUnavailable" value={unavail} onChange={setUnavail} options={[0, 1, 2].map((v) => ({ value: v, label: String(v) }))} />
        <Toggle label="新版 readiness probe 失敗" checked={probeFail} onChange={onProbe} />
      </LabControls>
      <LabControls>
        <button type="button" className="btn ghost small" onClick={deploy} disabled={rolling || invalid}>部署新版本 v{rolling ? sim.target : sim.target + 1}</button>
        {rolling && <button type="button" className="btn ghost small" onClick={undo}>回滾（rollout undo）</button>}
        <button type="button" className="btn ghost small" onClick={toggleNode}>{sim.down === null ? '關掉 node-3' : '恢復 node-3'}</button>
        <button type="button" className="btn ghost small" onClick={() => setSim(initSim())}>重置</button>
        {invalid && <Status warn>maxSurge 與 maxUnavailable 不能同時為 0（API 會拒絕）</Status>}
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack" ref={box}>
          <LabStage label="叢集" caption={`實線框 = Ready、虛線 = 啟動中、紅虛線 = readiness 失敗；每台節點最多 ${NODE_CAP} 個 Pod（示意）`}>
            <Cluster sim={sim} narrow={narrow} lastFail={lastFail} />
          </LabStage>
          <Stats min={120}>
            <Stat label="Ready / 期望" value={`${ready.length} / ${replicas}`} tone={ready.length === 0 ? 'bad' : ready.length < replicas ? 'warn' : 'ok'} />
            <Stat label="Service endpoints" value={ready.length} note={ready.map((p) => `v${p.ver}`).join(' ') || '空的'} />
            <Stat label={`新版 v${sim.target} / 舊版`} value={`${active.filter((p) => p.ver === sim.target).length} / ${active.filter((p) => p.ver !== sim.target).length}`} note={rolling ? (stuck ? '卡住' : '更新中') : '已完成'} tone={stuck ? 'warn' : ''} />
            <Stat label="成功 / 503" value={`${sim.served} / ${sim.failed}`} tone={sim.failed ? 'bad' : ''} />
            <Stat label="Pending" value={pending.length} tone={pending.length ? 'bad' : ''} />
          </Stats>
        </div>
        <div className="lab-stack">
          <LabExplain title={EX[0]}>{EX[1].map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <Code lang="yaml" title="deployment.yaml（節錄）" highlight={hl}>{yaml}</Code>
          <LabExplain title="readiness 與 liveness">
            <p>readiness 失敗：Pod 從 Service 移出、不收流量，但不會被重啟。liveness 失敗：容器被重啟。liveness 不要檢查資料庫，否則資料庫一抖，所有 Pod 一起重啟。</p>
          </LabExplain>
          <Callout tone="warn" title="地端叢集要自己補的">
            雲端代管叢集會幫你接好的，地端自建都要自己準備：<b>負載平衡</b>（Service type LoadBalancer 需要 MetalLB 之類的實作）、<b>Ingress controller</b>、<b>儲存</b>（CSI driver）、<b>映像倉庫</b>、<b>憑證</b>（如 cert-manager），還有監控與 etcd 備份。
          </Callout>
          <Callout title="實際用在哪裡">
            每次部署都會經過這個流程。上線前確認：副本數 ≥ 2、readiness probe 檢查的是「能不能接請求」、maxUnavailable 與 maxSurge 的組合在節點容量內放得下；更新卡住時先看 <code>kubectl rollout status</code> 與 Pod 的事件。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .k8s-svg { width: 100%; }
        .k8s-svg .node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.3s ease, opacity 0.3s ease; }
        .k8s-svg .node.down { stroke: var(--critical); stroke-dasharray: 5 4; opacity: 0.6; }
        .k8s-svg .front { fill: var(--surface-1); stroke: var(--lab-accent); stroke-width: 2; }
        .k8s-svg .front.bad { stroke: var(--critical); }
        .k8s-svg .link { stroke: var(--ink-3); stroke-width: 1.2; fill: none; opacity: 0.5; }
        .k8s-svg .link.on { stroke: var(--lab-accent); opacity: 0.9; stroke-width: 1.6; }
        .k8s-svg .pod { transition: transform 0.45s ease, opacity 0.3s ease; }
        .k8s-svg .pod rect { stroke-width: 1.5; }
        .k8s-svg .pod.starting rect { stroke-dasharray: 4 3; }
        .k8s-svg .pod.stuck rect { stroke: var(--critical) !important; stroke-dasharray: 4 3; }
        .k8s-svg .pod.ready rect { stroke-width: 2.2; }
        .k8s-svg .pod.term { opacity: 0.3; }
        .k8s-svg .pod .v { font-family: var(--mono); font-size: 12px; font-weight: 700; fill: var(--ink-1); }
        .k8s-svg .pod .st { font-family: var(--sans); font-size: 11px; fill: var(--ink-2); }
        .k8s-svg .pod.stuck .st { fill: var(--critical); }
        .k8s-svg .lbl { font-family: var(--sans); font-size: 12px; font-weight: 600; fill: var(--ink-1); }
        .k8s-svg .sub { font-family: var(--sans); font-size: 11px; fill: var(--ink-3); }
        .k8s-svg .err { font-family: var(--mono); font-size: 12px; font-weight: 700; fill: var(--critical); }
        .k8s-svg .dot { fill: var(--lab-accent); animation: k8s-go 0.42s ease-in both; }
        @keyframes k8s-go { from { transform: translate(0, 0); opacity: 1; } 85% { opacity: 1; } to { transform: translate(var(--dx), var(--dy)); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .k8s-svg .dot { animation: none; opacity: 0; } .k8s-svg .pod, .k8s-svg .node { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 舞台：Ingress → Service → 3 台節點，Pod 依節點排；寬版每台 2×2，窄版每台 1 欄 4 列 */
function Cluster({ sim, narrow, lastFail }) {
  const W = narrow ? 340 : 620
  const M = 10, G = narrow ? 8 : 12
  const NW = (W - 2 * M - 2 * G) / NODES
  const NY = 128
  const cols = narrow ? 1 : 2, PW = narrow ? NW - 12 : (NW - 18) / 2, PH = narrow ? 26 : 34, PG = 6
  const NH = 30 + (NODE_CAP / cols) * (PH + PG) + 4
  const pend = sim.pods.filter((p) => p.node === null && p.st !== 'term')
  const H = NY + NH + (pend.length ? 52 : 12)
  const svc = { x: W / 2, y: 92 }
  const pos = {}
  for (let n = 0; n < NODES; n++) {
    sim.pods.filter((p) => p.node === n).forEach((p, k) => {
      pos[p.id] = { x: M + n * (NW + G) + 6 + (k % cols) * (PW + 6), y: NY + 28 + Math.floor(k / cols) * (PH + PG) }
    })
  }
  pend.forEach((p, k) => { pos[p.id] = { x: M + k * ((narrow ? 80 : 92) + 6) + (narrow ? 0 : 64), y: NY + NH + 16, pending: true } })
  const shown = narrow ? 4 : 6
  const readyN = sim.pods.filter(isReady).length
  return (
    <svg className="k8s-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`叢集：${readyN} 個 Ready 的 Pod，${pend.length} 個 Pending`}>
      <rect x={W / 2 - 90} y="4" width="180" height="30" rx="6" className="front" />
      <text x={W / 2} y="23" textAnchor="middle" className="lbl">Ingress · /api → api-svc</text>
      <path d={`M${W / 2} 34 V60`} className="link on" />
      <rect x={W / 2 - 110} y="60" width="220" height="32" rx="6" className={`front${readyN ? '' : ' bad'}`} />
      <text x={W / 2} y="80" textAnchor="middle" className="lbl">Service api-svc · {readyN} 個 endpoint</text>
      {lastFail ? <text key={sim.tick} x={W / 2 + 118} y="81" className="err svg-pop">503</text> : null}
      {Array.from({ length: NODES }, (_, n) => {
        const x = M + n * (NW + G), dn = sim.down === n
        return (
          <g key={n}>
            <path d={`M${svc.x} ${svc.y} C ${svc.x} ${NY - 14}, ${x + NW / 2} ${svc.y + 10}, ${x + NW / 2} ${NY}`} className="link" />
            <rect x={x} y={NY} width={NW} height={NH} rx="8" className={`node${dn ? ' down' : ''}`} />
            <text x={x + 8} y={NY + 18} className="lbl">node-{n + 1}</text>
            {dn && <text x={x + NW - 8} y={NY + 18} textAnchor="end" className="err">停機</text>}
          </g>
        )
      })}
      {pend.length > 0 && !narrow && <text x={M} y={NY + NH + 37} className="err">Pending</text>}
      {sim.pods.filter((p) => pos[p.id] && (!pos[p.id].pending || pend.indexOf(p) < shown)).map((p) => {
        const q = pos[p.id]
        const st = p.st === 'starting' && sim.broken[p.ver] && p.age > READY_T ? 'stuck' : q.pending ? 'pending' : p.st
        const w = q.pending ? (narrow ? 80 : 92) : PW
        return (
          <g key={p.id} className={`pod ${st}`} style={{ transform: `translate(${q.x}px, ${q.y}px)` }}>
            <rect width={w} height={PH} rx="5" style={{ fill: `color-mix(in srgb, ${vcol(p.ver)} 16%, var(--surface-1))`, stroke: q.pending ? 'var(--critical)' : vcol(p.ver) }}
                  className={st === 'starting' ? 'svg-pulse' : ''} />
            {narrow || q.pending ? (
              <text x="7" y={PH / 2 + 4}><tspan className="v">v{p.ver}</tspan><tspan className="st" dx="5">{ST_LABEL[st]}</tspan></text>
            ) : (
              <g><text x="8" y="15" className="v">v{p.ver}</text><text x="8" y="28" className="st">{ST_LABEL[st]}</text></g>
            )}
          </g>
        )
      })}
      {sim.dots.map((d) => {
        const q = d.pod !== null && pos[d.pod]
        if (!q || q.pending) return null
        const tx = q.x + PW / 2, ty = q.y + PH / 2
        return <circle key={d.id} cx={svc.x} cy={svc.y} r="4" className="dot" style={{ '--dx': `${tx - svc.x}px`, '--dy': `${ty - svc.y}px` }} />
      })}
    </svg>
  )
}
