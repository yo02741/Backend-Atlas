import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, Code, Callout, Stats, Stat, Caption, useWidth, useReducedMotion, useLabVisible } from './ui.jsx'

/* ============================================================
   NetworkPolicy：一條連線在哪裡被放行或擋下
   - clinic namespace 的 web、api、db，kube-system 的 DNS，reports 裡一個可疑的 Pod，叢集外的 Informix
   - Toggle 加減五組 policy；Seg 選連線、db-from-api 的 from 寫法（AND / OR）、舊系統防火牆放行誰
   - 播放五步：起點 → 來源 egress → Service 轉換或 SNAT → 目的 ingress 或防火牆 → 結果
   - 評估照 networking.k8s.io/v1 的語意：沒被選到不受限、選到後只剩規則列出的、兩端都要放行
   IP、port、名稱都是虛構的示意
   ============================================================ */

const POD = {
  web: { name: 'web', ns: 'clinic', labels: { app: 'clinic-web' }, lbl: 'app=clinic-web', ip: '10.244.1.10' },
  api: { name: 'api', ns: 'clinic', labels: { app: 'clinic-api' }, lbl: 'app=clinic-api', ip: '10.244.1.11', node: '10.20.30.11' },
  db: { name: 'db', ns: 'clinic', labels: { app: 'clinic-db' }, lbl: 'app=clinic-db', ip: '10.244.2.12' },
  dns: { name: 'DNS', ns: 'kube-system', labels: { 'k8s-app': 'kube-dns' }, lbl: 'k8s-app=kube-dns', ip: '10.244.0.5' },
  sus: { name: '可疑 Pod', ns: 'reports', labels: { app: 'debug' }, lbl: 'app=debug', ip: '10.244.2.30', node: '10.20.30.12' },
}
const HIS = { name: 'Informix', ext: true, ip: '10.20.5.31' }
const CONNS = {
  dns: { label: 'api 查 DNS', src: 'api', dst: 'dns', proto: 'UDP', port: 53, svc: 'kube-dns', cip: '10.96.0.10', sport: 53 },
  db: { label: 'api → db', src: 'api', dst: 'db', proto: 'TCP', port: 5432, svc: 'clinic-db', cip: '10.96.212.40', sport: 5432 },
  web: { label: 'web → api', src: 'web', dst: 'api', proto: 'TCP', port: 8000, svc: 'clinic-api', cip: '10.96.88.21', sport: 80 },
  sus: { label: '可疑 Pod → db', src: 'sus', dst: 'db', proto: 'TCP', port: 5432, svc: 'clinic-db.clinic', cip: '10.96.212.40', sport: 5432 },
  his: { label: 'api → 舊系統', src: 'api', dst: 'his', proto: 'TCP', port: 9088 },
  sushis: { label: '可疑 Pod → 舊系統', src: 'sus', dst: 'his', proto: 'TCP', port: 9088 },
}
const INTRO = {
  dns: 'api 連資料庫之前，要先把 `clinic-db` 解析成 IP：查詢送到 `kube-dns` Service（10.96.0.10）的 UDP 53。',
  db: 'api 用 `clinic-db:5432` 連 PostgreSQL。名稱已經解析成 Service 的 ClusterIP 10.96.212.40，前提是「api 查 DNS」那一條通了。',
  web: 'web 把 API 請求送到 `clinic-api:80`，也就是 Service 的 80；api 的容器監聽 8000。',
  sus: '`reports` 裡有一個來路不明的 Pod（`app=debug`），想直接連 `clinic-db.clinic:5432`。稽核找到的就是這種連線。',
  his: 'api 查病患基本資料，要連院內舊系統的 Informix（10.20.5.31:9088），它在叢集外。',
  sushis: '可疑 Pod 也試著連 Informix。它在 `reports`，`clinic` 裡的 policy 管不到它。',
}
const TOGGLES = [
  ['denyIn', 'default deny ingress'], ['denyOut', 'default deny egress'], ['apiDb', '允許 api → db:5432'],
  ['dns', '允許 egress DNS'], ['his', '允許 api → 舊系統 10.20.5.0/24'],
]
const STEPS_IN = ['起點', '來源 egress', 'Service 轉換', '目的 ingress', '結果']
const STEPS_EX = ['起點', '來源 egress', '離開節點：SNAT', '院內防火牆', '結果']

const all = {}
function policies(on, mode) {
  const ps = []
  if (on.denyIn) ps.push({ name: 'default-deny-ingress', sel: all, selT: 'clinic 全部', dir: 'Ingress', rules: [], allowT: '（沒有規則）' })
  if (on.denyOut) ps.push({ name: 'default-deny-egress', sel: all, selT: 'clinic 全部', dir: 'Egress', rules: [], allowT: '（沒有規則）' })
  if (on.apiDb) {
    ps.push({ name: 'api-to-db', sel: { app: 'clinic-api' }, selT: 'app=clinic-api', dir: 'Egress', rules: [{ peers: [{ pod: { app: 'clinic-db' } }], ports: [['TCP', 5432]] }], allowT: '→ app=clinic-db，TCP 5432' })
    ps.push({ name: 'db-from-api', sel: { app: 'clinic-db' }, selT: 'app=clinic-db', dir: 'Ingress',
      rules: [{ peers: mode === 'and' ? [{ pod: { app: 'clinic-api' } }] : [{ ns: all }, { pod: { app: 'clinic-api' } }], ports: [['TCP', 5432]] }],
      allowT: mode === 'and' ? '← app=clinic-api，TCP 5432' : '← 所有 namespace 的 Pod，或 app=clinic-api，TCP 5432' })
  }
  if (on.dns) ps.push({ name: 'allow-dns', sel: all, selT: 'clinic 全部', dir: 'Egress', rules: [{ peers: [{ ns: { 'kubernetes.io/metadata.name': 'kube-system' }, pod: { 'k8s-app': 'kube-dns' } }], ports: [['UDP', 53], ['TCP', 53]] }], allowT: '→ kube-system 的 k8s-app=kube-dns，UDP、TCP 53' })
  if (on.his) ps.push({ name: 'api-to-his', sel: { app: 'clinic-api' }, selT: 'app=clinic-api', dir: 'Egress', rules: [{ peers: [{ cidr: '10.20.5.0/24' }], ports: [['TCP', 9088]] }], allowT: '→ ipBlock 10.20.5.0/24，TCP 9088' })
  return ps
}

const matches = (sel, labels) => Object.entries(sel).every(([k, v]) => labels[k] === v)
const ipNum = (ip) => ip.split('.').reduce((a, b) => a * 256 + Number(b), 0)
const inCidr = (ip, cidr) => { const [b, n] = cidr.split('/'); const size = 2 ** (32 - Number(n)); return Math.floor(ipNum(ip) / size) === Math.floor(ipNum(b) / size) }
function peerHit(peer, other) {
  if (peer.cidr) return !!other.ext && inCidr(other.ip, peer.cidr)
  if (other.ext) return false
  const nsOk = peer.ns ? matches(peer.ns, { 'kubernetes.io/metadata.name': other.ns }) : other.ns === 'clinic'   // 只寫 podSelector：policy 自己的 namespace
  return nsOk && (!peer.pod || matches(peer.pod, other.labels))   // 同一個元素裡是 AND
}
const selects = (p, pod, dir) => !pod.ext && pod.ns === 'clinic' && p.dir === dir && matches(p.sel, pod.labels)
const allows = (p, other, c) => p.rules.some((r) => r.peers.some((x) => peerHit(x, other)) && r.ports.some(([pr, n]) => pr === c.proto && n === c.port))
function judge(dir, self, other, c, ps) {
  const sel = ps.filter((p) => selects(p, self, dir))
  if (!sel.length) return { ok: true, open: true, sel }
  const by = sel.find((p) => allows(p, other, c))
  return { ok: !!by, by, sel }
}
function evaluate(c, ps, fw) {
  const s = POD[c.src], d = c.dst === 'his' ? HIS : POD[c.dst]
  const out = judge('Egress', s, d, c, ps)
  const inn = d.ext ? null : judge('Ingress', d, s, c, ps)
  const fwOk = d.ext ? fw === 'nodes' : null
  const stop = !out.ok ? 1 : (d.ext ? !fwOk : !inn.ok) ? 3 : null
  return { s, d, out, inn, fwOk, stop }
}
const names = (sel) => sel.map((p) => `\`${p.name}\``).join('、')

function story(c, r, step, mode) {
  const { s, d, out, inn, fwOk } = r
  const dn = d.ext ? 'Informix' : d.name
  if (step === 0) return [`${c.label}：${s.name} 要連 ${dn}`, [INTRO[c.key]]]
  if (step === 1) {
    if (out.open) return ['來源的 egress：不受限', [s.ns === 'clinic' ? `沒有任何含 Egress 的 policy 選到 ${s.name}，它連出去不受限制。` : '`reports` 沒有任何 NetworkPolicy，可疑 Pod 連出去完全不受限制。`clinic` 的 policy 只管 `clinic` 裡的 Pod。']]
    if (out.ok) return [`來源的 egress：${out.by.name} 放行`, [`${s.name} 被 ${names(out.sel)} 選到，egress 變成白名單。\`${out.by.name}\` 列了「${out.by.allowT}」，符合這條連線。`]]
    return ['來源的 egress：擋下', [`${s.name} 被 ${names(out.sel)} 選到，egress 只剩規則列出的，沒有一條符合 ${dn} 的 ${c.proto} ${c.port}。封包在節點上就被丟掉，程式只會等到逾時。`,
      c.key === 'dns' ? 'default deny 之後忘了放行 DNS 時，程式印出 `Temporary failure in name resolution`，看起來像資料庫壞了。打開「允許 egress DNS」。'
        : c.key === 'his' ? '要連舊系統，api 需要一條到 10.20.5.0/24 的 egress（`ipBlock`）。' : '要放行，替這個方向補一條規則，port 寫容器監聽的 port。']]
  }
  if (r.stop === 1 && step < 4) return ['封包沒有送出', ['在來源就被擋下，後面的檢查都沒有發生。']]
  if (step === 2) {
    if (d.ext) return ['離開節點：SNAT', [`封包離開節點時，來源從 Pod IP ${s.ip} 換成節點 IP ${s.node}。院內的路由器不認得 Pod 網段，舊系統的防火牆看得到的只有節點的位址。`]]
    return ['Service 轉換：ClusterIP 換成 Pod IP', [`kube-proxy 把目的 ${c.cip}:${c.sport} 改寫成 ${dn} 的 Pod IP ${d.ip}:${c.port}${c.sport !== c.port ? `（Service 的 ${c.sport} 換成容器的 ${c.port}）` : ''}。NetworkPolicy 比對的是改寫之後的 Pod 與 port。`]]
  }
  if (step === 3) {
    if (d.ext) return fwOk
      ? ['院內防火牆：放行', [`防火牆放行節點網段 10.20.30.0/24，來源 ${s.node} 在範圍內，封包通過。`, c.src === 'sus' ? '可疑 Pod 也走得通：防火牆只看得到節點的 IP，分不出是哪個 Pod。要擋住它，`reports` 也要有自己的 default deny egress。' : '同一個節點上，沒被 egress policy 限制的 Pod 都能走這條路，試試「可疑 Pod → 舊系統」。']]
      : ['院內防火牆：擋下', [`防火牆只放行舊主機 10.20.8.15，來源 ${s.node} 不在名單裡，封包被丟掉，用戶端等到逾時。`, '程式沒改、Informix 也沒壞，變的是來源 IP。網路組要放行節點網段或出口 IP。']]
    if (inn.open) return ['目的的 ingress：不受限', [d.ns === 'clinic' ? `沒有任何含 Ingress 的 policy 選到 ${dn}，進來不受限制。` : '`kube-system` 沒有 policy，DNS Pod 進來不受限制。']]
    if (inn.ok) return [`目的的 ingress：${inn.by.name} 放行`, [`${dn} 被 ${names(inn.sel)} 選到，ingress 變成白名單；\`${inn.by.name}\` 列了「${inn.by.allowT}」。`,
      ...(mode === 'or' && c.src === 'sus' ? ['這一條把 `- namespaceSelector: {}` 寫成獨立的元素（OR），等於放行所有 namespace 的所有 Pod，可疑 Pod 也在內。合併成同一個元素（AND）就只剩 api。'] : [])]]
    return ['目的的 ingress：擋下', [`${dn} 被 ${names(inn.sel)} 選到，ingress 只剩規則列出的，${s.name} 不在任何一條裡。`,
      c.key === 'web' ? 'default deny ingress 之後，web → api 也要自己開一條（port 8000）。這裡沒有那一條，沒開的就是擋。' : '規則只有允許、沒有拒絕；沒被列進任何一條，就進不來。']]
  }
  if (r.stop === null) {
    const by = [`出：${out.open ? '不受限' : `\`${out.by.name}\``}`, d.ext ? '防火牆：放行節點網段' : `進：${inn.open ? '不受限' : `\`${inn.by.name}\``}`]
    return ['放行', [`決定的規則　${by.join('；')}。`, '兩端都要放行：來源的 egress 與目的的 ingress（或叢集外的防火牆）缺一不可。']]
  }
  return ['擋下', [r.stop === 1 ? `在來源被擋：${names(out.sel)} 選到 ${s.name}，沒有規則放行。` : d.ext ? '在院內防火牆被擋：來源是節點 IP，不在放行名單。' : `在目的被擋：${names(inn.sel)} 選到 ${dn}，沒有規則放行 ${s.name}。`]]
}

export default function NetworkPolicyLab() {
  const [on, setOn] = useState({ denyIn: true, denyOut: true, apiDb: true, dns: false, his: false })
  const [key, setKey] = useState('dns')
  const [mode, setMode] = useState('and')
  const [fw, setFw] = useState('old')
  const [step, setStep] = useState(4)
  const [playing, setPlaying] = useState(false)
  const reduced = useReducedMotion(), visible = useLabVisible()
  const ref = useRef(null)
  const W = Math.max(280, useWidth(ref, 900))
  useEffect(() => {
    if (!playing || !visible) return
    if (step >= 4) { setPlaying(false); return }
    const t = setTimeout(() => setStep((s) => Math.min(4, s + 1)), reduced ? 500 : 950)
    return () => clearTimeout(t)
  }, [playing, step, visible, reduced])
  const play = () => { setStep(0); setPlaying(true) }
  const pick = (k) => { setKey(k); play() }

  const c = { ...CONNS[key], key }
  const ps = policies(on, mode)
  const r = evaluate(c, ps, fw)
  const ext = r.d.ext
  const k = r.stop !== null ? Math.min(step, r.stop) : step
  const [title, paras] = story(c, r, step, mode)
  const relevant = (p) => selects(p, r.s, 'Egress') || selects(p, r.d, 'Ingress')
  const state = (p) => selects(p, r.s, 'Egress') ? (allows(p, r.d, c) ? '出口放行' : '選到來源，沒放行') : selects(p, r.d, 'Ingress') ? (allows(p, r.s, c) ? '進入放行' : '選到目的，沒放行') : '與這條無關'
  const outV = step < 1 ? '—' : r.out.open ? '不受限' : r.out.ok ? r.out.by.name : '擋下'
  const inV = step < 3 || r.stop === 1 ? '—' : ext ? (r.fwOk ? '防火牆放行' : '防火牆擋下') : r.inn.open ? '不受限' : r.inn.ok ? r.inn.by.name : '擋下'
  const pkt = ext
    ? { src: k >= 2 ? r.s.node : r.s.ip, sch: k >= 2, dst: `${HIS.ip}:${c.port}`, dch: false }
    : { src: r.s.ip, sch: false, dst: k >= 2 ? `${r.d.ip}:${c.port}` : `${c.cip}:${c.sport}（${c.svc}）`, dch: k >= 2 }
  const dbYaml = mode === 'and'
    ? 'ingress:\n  - from:\n      - podSelector:     # 只有一個元素\n          matchLabels:\n            app: clinic-api\n    ports:\n      - protocol: TCP\n        port: 5432'
    : 'ingress:\n  - from:\n      - namespaceSelector: {}  # 所有 namespace\n      - podSelector:     # OR clinic 的 api\n          matchLabels:\n            app: clinic-api\n    ports:\n      - protocol: TCP\n        port: 5432'

  return (
    <Lab accent="aqua" className="np" kicker="K8S NETWORK LAB" title="NetworkPolicy：一條連線在哪裡被放行或擋下"
         blurb="clinic 的 web、api、db，kube-system 的 DNS，reports 裡一個可疑的 Pod，加上叢集外的 Informix。每條連線經過哪些檢查、由哪一條 policy 放行或擋下。">
      <LabControls>
        {TOGGLES.map(([k2, label]) => <Toggle key={k2} label={label} checked={on[k2]} onChange={(v) => setOn((o) => ({ ...o, [k2]: v }))} />)}
      </LabControls>
      <LabControls>
        <Seg label="連線" tinted value={key} onChange={pick} options={Object.keys(CONNS).map((v) => ({ value: v, label: CONNS[v].label }))} />
        <Seg label="db-from-api 的 from" value={mode} onChange={setMode} options={[{ value: 'and', label: '只有 api' }, { value: 'or', label: '多一個 namespaceSelector: {}' }]} />
        <Seg label="舊系統防火牆放行" mono value={fw} onChange={setFw} options={[{ value: 'old', label: '10.20.8.15' }, { value: 'nodes', label: '10.20.30.0/24' }]} />
        <span className="spacer" />
        <Stepper step={step} total={5} onStep={(s) => { setPlaying(false); setStep(s) }} playing={playing}
                 onPlay={() => (playing ? setPlaying(false) : step >= 4 ? play() : setPlaying(true))} labels={ext ? STEPS_EX : STEPS_IN} />
      </LabControls>

      <LabStage label="clinic、kube-system、reports 三個 namespace 與叢集外的 Informix" caption="IP、port 與名稱都是示意；Pod 出叢集時是否 SNAT、NetworkPolicy 由誰執行，都依 CNI 而定。">
        <div ref={ref}><Diagram W={W} c={c} r={r} step={step} k={k} ps={ps} /></div>
        <div className="np-pkt" aria-live="polite">
          <span className="l">封包</span>
          <span className={`f${pkt.sch ? ' ch' : ''}`}>src {pkt.src}</span>
          <span className="a">→</span>
          <span className={`f${pkt.dch ? ' ch' : ''}`}>dst {pkt.dst}</span>
          <span className="pr">{c.proto}</span>
          {r.stop !== null && step >= r.stop && <span className="drop">已丟棄</span>}
        </div>
      </LabStage>

      <Stats min={170} className="np-stats">
        <Stat label="這條連線" value={step < 4 ? '播放中…' : r.stop === null ? '放行' : '擋下'} tone={step < 4 ? '' : r.stop === null ? 'ok' : 'bad'}
              note={step < 4 ? (ext ? STEPS_EX : STEPS_IN)[step] : r.stop === null ? '兩端都放行' : r.stop === 1 ? '在來源被擋' : ext ? '在防火牆被擋' : '在目的被擋'} />
        <Stat label="來源 egress" value={outV} tone={outV === '擋下' ? 'bad' : ''} note={step < 1 ? '還沒檢查' : r.out.open ? '沒有 policy 選到' : `選到它的：${r.out.sel.map((p) => p.name).join('、')}`} />
        <Stat label={ext ? '院內防火牆' : '目的 ingress'} value={inV} tone={/擋下/.test(inV) ? 'bad' : ''}
              note={inV === '—' ? (r.stop === 1 ? '沒有走到這一步' : '還沒檢查') : ext ? `來源是節點 ${r.s.node}` : r.inn.open ? '沒有 policy 選到' : `選到它的：${r.inn.sel.map((p) => p.name).join('、')}`} />
      </Stats>

      <LabGrid variant="even">
        <div className="lab-stack">
          <LabExplain title={title}>{paras.map((t, i) => <p key={i}><Md>{t}</Md></p>)}</LabExplain>
          <div className="dtable-wrap">
            <table className="dtable np-table">
              <caption>clinic 目前套用的 NetworkPolicy</caption>
              <thead><tr><th>policy</th><th>選到 · 方向 · 允許</th><th>這條連線</th></tr></thead>
              <tbody>
                {ps.length === 0 && <tr><td colSpan={3} className="np-none">沒有任何 policy：每個 Pod 進出都不受限</td></tr>}
                {ps.map((p) => {
                  const st = state(p)
                  return (
                    <tr key={p.name} className={/放行$/.test(st) && (r.out.by === p || r.inn?.by === p) ? 'hit' : relevant(p) ? '' : 'dim'}>
                      <td>{p.name}</td><td>{p.selT} · {p.dir}<span className="np-allow">{p.allowT}</span></td><td className={/沒放行/.test(st) ? 'np-no' : ''}>{st}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lab-stack">
          <Code lang="yaml" title="db-from-api 的 ingress" highlight={mode === 'and' ? [3, 4, 5] : [3, 4, 5, 6]}>{dbYaml}</Code>
          <Callout title="工作上什麼時候用">
            一個 namespace 開始套 NetworkPolicy 時：先確認 CNI 有實作，再套兩個方向的 default deny，立刻補 DNS，接著照服務之間實際的呼叫逐條開，每開一條就從來源 Pod 測一次。要連院內舊系統，防火牆申請的來源寫節點網段或出口 IP，叢集內再用 egress 限定只有需要的服務能出去；其他 namespace 也要有自己的 default deny。
          </Callout>
        </div>
      </LabGrid>
      <Caption>評估照 networking.k8s.io/v1 的語意，selector 只示範 matchLabels；Calico、Cilium 另有自己的政策 CRD（可寫拒絕規則與優先順序），不在這裡。</Caption>

      <style>{`
        .np .seg-group { flex-wrap: wrap; }
        .np .lab-controls + .lab-controls { margin-top: -6px; }
        .np .lab-grid { margin-top: 14px; }
        .np-svg { display: block; width: 100%; margin: 0 auto; }
        .np-svg.wide { max-width: 920px; }
        .np-svg .clu { fill: none; stroke: var(--ink-3); stroke-width: 1.2; stroke-dasharray: 6 5; }
        .np-svg .ns { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 1.2; }
        .np-svg .pod { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease, stroke-width 0.25s ease; }
        .np-svg .pod.src { stroke: var(--lab-accent); stroke-width: 2.5; }
        .np-svg .pod.dst { stroke: var(--lab-accent); stroke-width: 2; stroke-dasharray: 5 3; }
        .np-svg .pod.sus { fill: color-mix(in srgb, var(--serious) 10%, var(--surface-1)); }
        .np-svg .pod.ok { stroke: var(--good); stroke-dasharray: none; fill: color-mix(in srgb, var(--good) 10%, var(--surface-1)); }
        .np-svg .fw { fill: color-mix(in srgb, var(--serious) 22%, transparent); stroke: var(--serious); stroke-width: 1.2; }
        .np-svg .path { fill: none; stroke: var(--lab-accent); stroke-width: 2; stroke-dasharray: 6 5; opacity: 0.55; }
        .np-svg .lbl { font-family: var(--sans); font-size: 12px; font-weight: 700; fill: var(--ink-1); }
        .np-svg .sub { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-2); }
        .np-svg .cap { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .np-svg .iso { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .np-svg .iso.on { fill: var(--serious); font-weight: 600; }
        .np-svg .dot { fill: var(--lab-accent); stroke: var(--page); stroke-width: 2; transition: transform 0.75s ease, fill 0.25s ease; }
        .np-svg .dot.bad { fill: var(--critical); }
        .np-svg .dot.ok { fill: var(--good); }
        .np-svg .mk { font-family: var(--sans); font-size: 16px; font-weight: 800; }
        .np-svg .mk.bad { fill: var(--critical); } .np-svg .mk.ok { fill: var(--good); }
        .np-pkt { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 12px; font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); }
        .np-pkt .l { font-family: var(--sans); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-3); }
        .np-pkt .f { padding: 2px 8px; border: 1px solid var(--hairline); border-radius: 3px; background: var(--surface-1); color: var(--ink-1); transition: background 0.3s ease, border-color 0.3s ease; overflow-wrap: anywhere; }
        .np-pkt .f.ch { border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 16%, var(--surface-1)); }
        .np-pkt .a { color: var(--ink-3); }
        .np-pkt .drop { font-family: var(--sans); font-weight: 700; color: var(--critical); }
        .np-stats .lab-stat .v { font-size: 0.95rem; font-family: var(--mono); overflow-wrap: anywhere; }
        .np-table td { white-space: normal; vertical-align: top; }
        .np-table td:first-child { white-space: nowrap; }
        .np-table .np-allow { display: block; color: var(--ink-3); font-size: 0.74rem; }
        .np-table .np-no { color: var(--serious); }
        .np-table .np-none { color: var(--ink-3); font-family: var(--sans); white-space: normal; }
        @media (prefers-reduced-motion: reduce) { .np-svg .dot { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 版面：寬版用 760 × 320 的固定座標；窄版 viewBox = 實際寬度、改成直式，文字不會被縮小 */
function layout(W) {
  if (W >= 660) {
    return {
      wide: true, VW: 760, VH: 322, bw: 118,
      clu: [8, 8, 550, 306, '叢集（節點 10.20.30.11–13）', 22, 300],
      ns: [[22, 34, 326, 176, 'namespace clinic'], [368, 34, 178, 112, 'namespace kube-system'], [368, 186, 178, 112, 'namespace reports']],
      at: { web: [100, 84], db: [270, 84], api: [185, 172], dns: [457, 94], sus: [457, 248], his: [690, 212] },
      fw: [590, 40, 16, 270], fwT: [598, 30], hisT: [690, 260],
      out: (p) => [[558, p[1]], [598, p[1]]],
    }
  }
  const half = (W - 24) / 2
  const at = { web: [12 + (W - 24) * 0.27, 80], db: [12 + (W - 24) * 0.73, 80], api: [W / 2, 158], dns: [12 + (half - 4) / 2, 266], sus: [W / 2 + 4 + (half - 4) / 2, 266], his: [W / 2, 412] }
  return {
    wide: false, VW: W, VH: 464, bw: Math.min(118, half - 14),
    clu: [4, 4, W - 8, 326, '叢集（節點 10.20.30.11–13）', 14, 20],
    ns: [[12, 30, W - 24, 172, 'namespace clinic'], [12, 212, half - 4, 108, 'kube-system'], [W / 2 + 4, 212, half - 4, 108, 'reports']],
    at, fw: [12, 346, W - 24, 10], fwT: [14, 376], hisT: [W / 2, 458], fwAnchor: 'start',
    out: (p) => [[p[0], 330], [p[0], 351]],
  }
}
function along(pts, d) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], L = Math.hypot(x2 - x1, y2 - y1)
    if (d <= L || i === pts.length - 2) { const t = L ? Math.min(1, d / L) : 0; return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t] }
    d -= L
  }
  return pts[pts.length - 1]
}
const length = (pts) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

function Diagram({ W, c, r, step, k, ps }) {
  const L = layout(W)
  const P = L.at
  const ext = r.d.ext
  const pts = ext ? [P[c.src], ...L.out(P[c.src]), P.his] : [P[c.src], P[c.dst]]
  const bh = 56
  // 封包停在方框邊緣外（不蓋住文字）：從中心沿路徑走到框線的距離
  const exitD = (a, b2) => { const ux = Math.abs(b2[0] - a[0]), uy = Math.abs(b2[1] - a[1]), n = Math.hypot(ux, uy) || 1; return Math.min(ux ? (L.bw / 2) * n / ux : Infinity, uy ? (bh / 2) * n / uy : Infinity) + 7 }
  const total = length(pts), last = pts.length - 1
  const d0 = exitD(pts[0], pts[1]), dEnd = total - exitD(pts[last], pts[last - 1])
  const gap = Math.min(30, (dEnd - d0) * 0.3)
  const spots = ext ? [along(pts, d0), along(pts, d0 + gap), pts[1], pts[2], along(pts, dEnd)]
    : [along(pts, d0), along(pts, d0 + gap), along(pts, (d0 + dEnd) / 2), along(pts, dEnd - gap), along(pts, dEnd)]
  const [dx, dy] = spots[k]
  const blocked = r.stop !== null && step >= r.stop, done = r.stop === null && step >= 4
  const iso = (key) => {
    const pod = POD[key]
    if (pod.ns !== 'clinic') return ['不受限（沒有 policy）', false]
    const i = ps.some((p) => selects(p, pod, 'Ingress')), o = ps.some((p) => selects(p, pod, 'Egress'))
    return [i && o ? '進、出都是白名單' : i ? '進：白名單' : o ? '出：白名單' : '不受限', i || o]
  }
  return (
    <svg className={`np-svg${L.wide ? ' wide' : ''}`} viewBox={`0 0 ${L.VW} ${L.VH}`} role="img"
         aria-label={`${c.label}：${r.stop === null ? '放行' : r.stop === 1 ? '在來源的 egress 被擋下' : ext ? '在院內防火牆被擋下' : '在目的的 ingress 被擋下'}`}>
      <rect x={L.clu[0]} y={L.clu[1]} width={L.clu[2]} height={L.clu[3]} rx="8" className="clu" />
      <text x={L.clu[5]} y={L.clu[6]} className="cap">{L.clu[4]}</text>
      {L.ns.map(([x, y, w, h, t]) => (
        <g key={t}><rect x={x} y={y} width={w} height={h} rx="6" className="ns" /><text x={x + 8} y={y + 15} className="cap">{t}</text></g>
      ))}
      <rect x={L.fw[0]} y={L.fw[1]} width={L.fw[2]} height={L.fw[3]} rx="3" className="fw" />
      <text x={L.fwT[0]} y={L.fwT[1]} textAnchor={L.fwAnchor || 'middle'} className="cap">院內防火牆</text>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} className="path" />
      {ext && <text x={pts[1][0] + (L.wide ? 4 : 8)} y={pts[1][1] + (L.wide ? -6 : 13)} className="cap">SNAT</text>}
      {Object.keys(POD).map((key) => {
        const [x, y] = P[key], p = POD[key], [t, onIso] = iso(key)
        const cls = `pod${c.src === key ? ' src' : ''}${c.dst === key ? (done ? ' dst ok' : ' dst') : ''}${key === 'sus' ? ' sus' : ''}`
        return (
          <g key={key}>
            <rect x={x - L.bw / 2} y={y - bh / 2} width={L.bw} height={bh} rx="5" className={cls} />
            <text x={x} y={y - 9} textAnchor="middle" className="lbl">{p.name}</text>
            <text x={x} y={y + 6} textAnchor="middle" className="sub">{p.lbl}</text>
            <text x={x} y={y + 21} textAnchor="middle" className={`iso${onIso ? ' on' : ''}`}>{t}</text>
          </g>
        )
      })}
      <g>
        <rect x={P.his[0] - L.bw / 2} y={P.his[1] - bh / 2} width={L.bw} height={bh} rx="5" className={`pod${ext ? (done ? ' dst ok' : ' dst') : ''}`} />
        <text x={P.his[0]} y={P.his[1] - 9} textAnchor="middle" className="lbl">Informix</text>
        <text x={P.his[0]} y={P.his[1] + 6} textAnchor="middle" className="sub">10.20.5.31:9088</text>
        <text x={P.his[0]} y={P.his[1] + 21} textAnchor="middle" className="iso">叢集外</text>
        <text x={L.hisT[0]} y={L.hisT[1]} textAnchor="middle" className="cap">{r.fwOk ? '防火牆放行 10.20.30.0/24' : '防火牆只放行 10.20.8.15'}</text>
      </g>
      <circle r="7" className={`dot${blocked ? ' bad' : done ? ' ok' : ''}`} style={{ transform: `translate(${dx}px, ${dy}px)` }} />
      {blocked && <text key={`x${c.key}${r.stop}`} x={dx + 11} y={dy + 6} className="mk bad svg-pop">✕</text>}
      {done && <text key={`v${c.key}`} x={dx + 11} y={dy + 6} className="mk ok svg-pop">✓</text>}
    </svg>
  )
}

/* `code` 與 **粗體** 轉成 React 節點 */
function Md({ children }) {
  return String(children).split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, i) => (
    s[0] === '`' ? <code key={i}>{s.slice(1, -1)}</code> : s.startsWith('**') ? <strong key={i}>{s.slice(2, -2)}</strong> : s))
}
