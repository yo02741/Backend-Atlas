import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Toggle, Stepper, usePlayer, Code, Callout } from './ui.jsx'

/* ============================================================
   docker compose 視覺化：一份 YAML → 網路 / 服務 / volume 拓樸
   - 點 YAML 的服務段落或圖上節點：互相 highlight、顯示 DNS 名
   - Stepper 依 depends_on 順序啟動；Toggle「db 沒 ready」示範
     depends_on 只保證啟動順序、不保證就緒
   ============================================================ */

function buildYaml(healthy) {
  const L = []
  const add = (svc, ...lines) => lines.forEach((t) => L.push({ svc, t }))
  add(null, 'services:')
  add('nginx', '  nginx:', '    image: nginx:1.27', '    ports:', '      - "80:80"            # 主機 80 → 容器 80', '    depends_on: [api]')
  add('api', '  api:', '    build: .', '    expose: ["8000"]       # 只在網路內開放，沒綁主機', '    environment:',
      '      DATABASE_URL: postgresql://app:secret@db:5432/app', '      REDIS_URL: redis://redis:6379')
  if (healthy) add('api', '    depends_on:', '      db:', '        condition: service_healthy', '      redis:', '        condition: service_started')
  else add('api', '    depends_on: [db, redis]')
  add('db', '  db:', '    image: postgres:16')
  L.push({ svc: 'db', vol: true, t: '    volumes:' }, { svc: 'db', vol: true, t: '      - pgdata:/var/lib/postgresql/data' })
  add('db', '    healthcheck:', '      test: ["CMD", "pg_isready", "-U", "app"]', '      interval: 5s')
  add('redis', '  redis:', '    image: redis:7')
  add('pgdata', 'volumes:', '  pgdata:')
  return L
}

const DNS = {
  nginx: '網路內名字 nginx；主機 :80 綁到它的 :80，是唯一從外面進得來的服務',
  api: '同網路的容器用 http://api:8000 找到它——服務名就是 hostname',
  db: 'postgresql://app:secret@db:5432/app：db 不是 IP，是 compose 自動註冊的 DNS 名',
  redis: 'redis://redis:6379——不用查 IP、不用寫 links',
  pgdata: 'named volume，由 Docker 管理、放在主機上；compose down 不會刪它',
}
const STATUS_TEXT = { off: '', starting: 'starting…', up: 'up', healthy: 'healthy ✓', down: 'exited (1)' }
const STEP_LABELS = ['compose up', 'db · redis', 'api', 'nginx', '請求進來']

/* 依步驟 × db 慢不慢 × 有沒有 condition 算每個服務的狀態 */
function statuses(step, slow, healthy) {
  const s = { nginx: 'off', api: 'off', db: 'off', redis: 'off' }
  if (step >= 1) { s.redis = 'up'; s.db = slow ? 'starting' : healthy ? 'healthy' : 'up' }
  if (step >= 2) {
    if (slow && !healthy) s.api = 'down'
    else { s.db = healthy ? 'healthy' : 'up'; s.api = 'up' }
  }
  if (step >= 3) { s.nginx = 'up'; if (s.db === 'starting') s.db = 'up' }
  return s
}

export default function ComposeLab() {
  const [slow, setSlow] = useState(false)
  const [healthy, setHealthy] = useState(false)
  const [sel, setSel] = useState(null)
  const [hover, setHover] = useState(null)
  const total = 5
  const player = usePlayer(total, 1300)
  const step = player.step
  const goStep = (n) => { setSel(null); player.setStep(n) }
  const pick = (id) => setSel((cur) => (cur === id ? null : id))

  const lines = useMemo(() => buildYaml(healthy), [healthy])
  const src = lines.map((l) => l.t).join('\n')
  const hl = sel ? lines.map((l, i) => (l.svc === sel || (sel === 'pgdata' && l.vol) ? i + 1 : 0)).filter(Boolean) : []
  const st = statuses(step, slow, healthy)
  const apiDown = st.api === 'down'
  const explain = sel ? svcExplain(sel) : stepExplain(step, slow, healthy, apiDown)
  const info = hover ?? sel

  const onCodeClick = (e) => {
    const ln = e.target.closest('.ln'); if (!ln) return
    const l = lines[Number(ln.dataset.n) - 1]
    if (l?.svc) pick(l.svc)
  }

  return (
    <Lab className="cmp" accent="yellow" kicker="DEPLOY LAB" title="docker compose：一份 YAML 起整套服務"
         blurb="點 YAML 的服務段落或圖上的節點，看它在拓樸裡的位置與網路內的 DNS 名字。按「compose up」依 depends_on 順序啟動；打開「db 沒 ready」看為什麼 depends_on 不等於就緒。">
      <LabControls>
        <Toggle label="db 沒 ready（啟動慢）" checked={slow} onChange={(v) => { setSlow(v); setSel(null) }} />
        <Toggle label="condition: service_healthy" checked={healthy} onChange={(v) => { setHealthy(v); setSel(null) }} />
        <span className="spacer" />
        <Stepper step={step} total={total} onStep={goStep} playing={player.playing} onPlay={player.toggle} labels={STEP_LABELS} />
      </LabControls>

      <LabGrid variant="even">
        <div className="cmp-code" onClick={onCodeClick} title="點服務段落可在圖上標出它">
          <Code lang="yaml" title="compose.yaml（點服務段落）" highlight={hl} dim>{src}</Code>
        </div>

        <div className="lab-stack">
          <LabStage label="compose 拓樸圖" caption={info ? DNS[info] : '穿出「主機」框的線 = ports；沒穿出的 = expose（只在網路內）。滑過或點節點看它的 DNS 名字。'}>
            <Topology sel={sel} st={st} step={step} apiDown={apiDown} slow={slow} healthy={healthy} onPick={pick} onHover={setHover} />
          </LabStage>
          <LabExplain title={explain.title}>
            {explain.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            本機開發一鍵起 db / redis / nginx（<code>docker compose up -d</code>），團隊每個人拿到一模一樣的環境，CI 也能用同一份跑整合測試。
            <strong>不要把 compose 當正式環境的編排器</strong>：它是單機工具，沒有多節點、滾動更新、自動復原——那是 Kubernetes 或雲端託管服務的事。環境差異用 <code>compose.override.yaml</code> 疊加，不要複製整份。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .cmp-code { min-width: 0; }
        .cmp-code .ln { cursor: pointer; }
        .cmp-code .ln:hover { background: color-mix(in srgb, var(--ink-1) 6%, transparent); }
        .cmp .stepper button, .cmp .stepper .count, .cmp .stepper .seg-label { white-space: nowrap; }
        @media (max-width: 640px) { .cmp .stepper .seg-label { display: none; } }
        .cmp-frame { fill: none; stroke: var(--ink-3); stroke-width: 1.2; }
        .cmp-frame.net { stroke: var(--lab-accent); stroke-dasharray: 5 4; opacity: 0.75; transition: opacity 0.3s ease; }
        .cmp-frame.lit { stroke-width: 2; opacity: 1; }
        .cmp-node { cursor: pointer; outline: none; }
        .cmp-node rect, .cmp-node path, .cmp-node ellipse { transition: stroke 0.25s ease, fill 0.25s ease, opacity 0.25s ease; }
        .cmp-node.off rect { stroke-dasharray: 4 3; opacity: 0.7; }
        .cmp-node.off text { fill: var(--ink-3); }
        .cmp-node.up rect, .cmp-node.healthy rect { stroke: var(--good); }
        .cmp-node.starting rect { stroke: var(--warning); }
        .cmp-node.down rect { stroke: var(--critical); fill: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); }
        .cmp-node.sel rect, .cmp-node.sel path, .cmp-node.sel ellipse { stroke: var(--lab-accent); stroke-width: 2.5; fill: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); }
        .cmp-node:hover rect, .cmp-node:hover path, .cmp-node:hover ellipse, .cmp-node:focus-visible rect { stroke: var(--lab-accent); }
        .cmp-st { font-family: var(--mono); font-size: 9.5px; font-weight: 700; }
        .cmp-st.up, .cmp-st.healthy { fill: var(--good); } .cmp-st.starting { fill: var(--warning); } .cmp-st.down { fill: var(--critical); }
        .cmp-edge { transition: stroke 0.25s ease; }
        .cmp-edge.dead { stroke: var(--critical); }
        .cmp-vol { fill: var(--surface-1); stroke: var(--ink-3); stroke-width: 1.2; }
        .cmp-port { fill: var(--surface-1); stroke: var(--lab-accent); stroke-width: 1.5; }
        .cmp-err { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--critical); }
        .cmp-lbl { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); paint-order: stroke; stroke: var(--page); stroke-width: 4; }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>') }

function svcExplain(id) {
  return {
    nginx: { title: 'nginx：對外的唯一入口', text: [
      '`ports: "80:80"` 把主機的 80 埠綁到這個容器的 80 埠，所以瀏覽器打 `localhost:80` 進得來——這是圖上唯一穿出主機框的線。',
      '它把請求轉給 `http://api:8000`：`api` 不是 IP，是 compose 在 `default` 網路裡自動註冊的 DNS 名字，**服務名就是 hostname**。`depends_on: [api]` 只決定啟動順序。'] },
    api: { title: 'api：自己 build 的應用，只在網路內開放', text: [
      '`build: .` 用目前目錄的 Dockerfile 建映像。`expose: ["8000"]` 只是宣告，沒有把埠綁到主機——外面連不到，但同網路的 nginx 可以用 `api:8000` 連進來。',
      '環境變數裡的 `db:5432`、`redis:6379` 一樣是服務名。這裡用 `environment` 直接寫死是為了示範；實務上放 `.env`（compose 會自動讀）或 `env_file`，密碼不要進版控。'] },
    db: { title: 'db：資料放 volume，容器重建也還在', text: [
      '容器的檔案系統是拋棄式的：`docker compose down` 再 `up`，容器內寫的東西全沒了。`pgdata:/var/lib/postgresql/data` 把 Postgres 的資料目錄掛到 named volume `pgdata`，資料活在主機上、跟容器生命週期脫鉤。',
      '`healthcheck` 每 5 秒跑一次 `pg_isready`，讓 compose 知道它「真的能接連線」，而不只是程序啟動了——這正是 `condition: service_healthy` 需要的訊號。'] },
    redis: { title: 'redis：一行就有的快取', text: [
      '`image: redis:7` 直接用官方映像，不用 build、不用設定。沒掛 volume，重啟資料就沒了——快取本來就可以丟；要持久化再掛。',
      '其他服務用 `redis://redis:6379` 連它。它沒有 `depends_on`，所以第一波就啟動。'] },
    pgdata: { title: 'named volume：跟容器脫鉤的儲存', text: [
      '頂層 `volumes: pgdata:` 宣告一個由 Docker 管理的 named volume，實際目錄在主機上（`docker volume inspect pgdata` 看得到）。它不在 compose 網路裡——網路是給容器互連的，volume 是儲存。',
      '`docker compose down` 不會刪 volume，`down -v` 才會。清資料庫之前先想清楚。'] },
  }[id]
}

function stepExplain(step, slow, healthy, apiDown) {
  const T = [
    ['docker compose up：先建網路和 volume', [
      'compose 先依專案名建一個 bridge 網路 `default`，所有 service 都接進來、彼此用服務名互相解析；再建（或沿用）named volume `pgdata`。',
      '接著讀 `depends_on` 算出啟動順序：沒有依賴的先跑，被依賴的先於依賴它的。']],
    ['第一波：db、redis（沒有依賴誰）', [
      '兩個都沒寫 `depends_on`，所以同時啟動。',
      slow ? '這次 db 啟動慢（例如第一次初始化資料目錄、或在做 recovery）：容器狀態是 running，但 Postgres 還不能接連線——healthcheck 還沒通過。'
           : 'db 很快就能接連線、healthcheck 通過；redis 也就緒。']],
    ['第二波：api', [
      slow && !healthy
        ? '`depends_on: [db, redis]` 只保證「db 的容器先啟動」，不等它能接連線。api 一起來就連 `db:5432` → connection refused → 程序 crash、容器 exited(1)。**depends_on 保證順序，不保證就緒。**'
        : slow && healthy
          ? '改成 `condition: service_healthy` 後，compose 會等 db 的 healthcheck 回報 healthy 才啟動 api（redis 沒有 healthcheck，用 `service_started` 即可）。api 一起來連線就成功。'
          : healthy ? 'db 的 healthcheck 已通過，api 立刻啟動、連線成功。'
                    : 'db、redis 剛好都就緒了，api 連線成功——但這只是運氣好：換台慢一點的機器（或 db 要跑 migration）就會踩到 depends_on 不等就緒的坑。試試打開「db 沒 ready」。']],
    ['第三波：nginx', [
      '`depends_on: [api]`——只要 api 容器「啟動過」就算數。',
      apiDown ? 'api 早就 exited 了，nginx 照樣啟動：它不知道、也不管 api 死活。' : 'api 就緒，nginx 開始把 80 埠的請求轉給 `http://api:8000`。']],
    ['請求進來：localhost:80 → nginx → api → db / redis', [
      apiDown
        ? '瀏覽器打 `localhost:80` → nginx 轉給 `api:8000` → 沒人回應 → **502 Bad Gateway**。db 後來 ready 了也救不回來：api 已經死了，除非設 `restart: on-failure` 或程式自己重試連線。'
        : 'nginx 收到請求，代理到 api；api 用 `db:5432` 查資料、`redis:6379` 讀快取。整條路都在 `default` 網路內解析，只有 80 埠穿出主機。']],
  ]
  return { title: T[step][0], text: T[step][1] }
}

/* ---- 拓樸 SVG ---- */
const W = 84, H = 44
const N = {
  nginx: { x: 124, y: 124, title: 'nginx', port: ':80', sub: 'nginx:1.27' },
  api:   { x: 250, y: 124, title: 'api', port: ':8000', sub: 'build .' },
  db:    { x: 384, y: 124, title: 'db', port: ':5432', sub: 'postgres:16' },
  redis: { x: 284, y: 214, title: 'redis', port: ':6379', sub: 'redis:7' },
}
const keyPick = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }

function Topology({ sel, st, step, apiDown, slow, healthy, onPick, onHover }) {
  const flowing = step === 4
  const edge = (a, b, extra = '') => `svg-edge cmp-edge${sel === a || sel === b ? ' on' : ''} ${extra}`
  const dead = flowing && apiDown
  const flow = flowing ? 'svg-flow' : ''
  const flowOk = flowing && !apiDown ? 'svg-flow' : ''
  return (
    <svg viewBox="0 0 500 350" role="img" aria-label="compose 拓樸：主機內的 default 網路包含 nginx、api、db、redis；db 掛 pgdata volume"
         onClick={(e) => { if (e.target.tagName === 'svg') onPick(null) }}>
      <defs>
        <marker id="cmp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--ink-3)' }} />
        </marker>
      </defs>

      {/* 主機框 + 網路框 */}
      <rect x="96" y="26" width="398" height="314" rx="6" className="cmp-frame" />
      <text x="108" y="42" className="svg-text small">主機（Docker host）</text>
      <rect x="112" y="56" width="372" height="224" rx="6" className={`cmp-frame net${step >= 1 ? ' lit' : ''}`} />
      <text x="122" y="72" className="svg-text small" style={{ fill: 'var(--lab-accent)', fontWeight: 700 }}>network: default（compose 自動建立，服務名 = DNS 名）</text>

      {/* 瀏覽器 → 主機 :80 → nginx（唯一穿出主機框的線） */}
      <rect x="6" y="126" width="64" height="40" rx="20" className="svg-node" />
      <text x="38" y="143" className="svg-text" textAnchor="middle" style={{ fontWeight: 700 }}>瀏覽器</text>
      <text x="38" y="157" className="svg-text small" textAnchor="middle">localhost</text>
      <path d="M70 146 H 122" className={`${edge('nginx', null)} ${flow}`} markerEnd="url(#cmp-arrow)" />
      <circle cx="96" cy="146" r="9" className="cmp-port" />
      <text x="96" y="149.5" className="svg-mono" textAnchor="middle" style={{ fontSize: 9, fontWeight: 700 }}>80</text>
      <text x="120" y="180" className="cmp-lbl" textAnchor="end">ports "80:80"</text>

      {/* nginx → api → db / redis */}
      <path d="M208 146 H 248" className={`${edge('nginx', 'api', dead ? 'dead' : '')} ${flow}`} markerEnd="url(#cmp-arrow)" />
      <text x="229" y="118" className="cmp-lbl" textAnchor="middle">api:8000</text>
      <path d="M334 146 H 382" className={`${edge('api', 'db')} ${flowOk}`} markerEnd="url(#cmp-arrow)" />
      <text x="359" y="118" className="cmp-lbl" textAnchor="middle">db:5432</text>
      <path d="M326 168 V 212" className={`${edge('api', 'redis')} ${flowOk}`} markerEnd="url(#cmp-arrow)" />
      <text x="332" y="196" className="cmp-lbl">redis:6379</text>
      {dead && <text x="229" y="200" className="cmp-err svg-pulse" textAnchor="middle">502 Bad Gateway</text>}
      {step === 2 && slow && !healthy && <text x="359" y="162" className="cmp-err svg-pulse" textAnchor="middle">refused</text>}
      <text x="298" y="270" className="svg-text small" textAnchor="middle">expose 8000：沒有線穿出主機框，外面連不到 api</text>

      {/* db → volume（離開網路框，仍在主機內） */}
      <path d="M440 168 V 292" className={`svg-edge svg-dash cmp-edge${sel === 'db' || sel === 'pgdata' ? ' on' : ''}`} />
      <text x="432" y="292" className="cmp-lbl" textAnchor="end">/var/lib/postgresql/data</text>

      {Object.entries(N).map(([id, n]) => (
        <g key={id} className={`cmp-node ${st[id]}${sel === id ? ' sel' : ''}`}
           onClick={(e) => { e.stopPropagation(); onPick(id) }} onKeyDown={keyPick(() => onPick(id))}
           onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}
           onFocus={() => onHover(id)} onBlur={() => onHover(null)}
           role="button" tabIndex={0} aria-label={`服務 ${id}`}>
          <rect x={n.x} y={n.y} width={W} height={H} rx="5" className="svg-node" />
          <text x={n.x + 9} y={n.y + 18} className="svg-text" style={{ fontWeight: 700 }}>{n.title}</text>
          <text x={n.x + W - 8} y={n.y + 18} className="svg-mono" textAnchor="end" style={{ fontSize: 10, fill: 'var(--ink-2)' }}>{n.port}</text>
          <text x={n.x + 9} y={n.y + 33} className="svg-text small">{n.sub}</text>
          {st[id] !== 'off' && (
            <text x={n.x} y={n.y + H + 13} className={`cmp-st ${st[id]}${st[id] === 'starting' ? ' svg-pulse' : ''}`}>{STATUS_TEXT[st[id]]}</text>
          )}
        </g>
      ))}

      {/* volume 圓柱 */}
      <g className={`cmp-node${sel === 'pgdata' ? ' sel' : ''}`} onClick={(e) => { e.stopPropagation(); onPick('pgdata') }}
         onKeyDown={keyPick(() => onPick('pgdata'))} onMouseEnter={() => onHover('pgdata')} onMouseLeave={() => onHover(null)}
         onFocus={() => onHover('pgdata')} onBlur={() => onHover(null)} role="button" tabIndex={0} aria-label="volume pgdata">
        <path d="M410 300 a30 6 0 0 0 60 0 v 24 a30 6 0 0 1 -60 0 z" className="cmp-vol" />
        <ellipse cx="440" cy="300" rx="30" ry="6" className="cmp-vol" />
        <text x="440" y="318" className="svg-mono" textAnchor="middle" style={{ fontSize: 10 }}>pgdata</text>
        <text x="400" y="316" className="svg-text small" textAnchor="end">volume</text>
      </g>
    </svg>
  )
}
