import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Stepper, usePlayer, Code, Callout } from './ui.jsx'

/* ============================================================
   Docker 層快取視覺化：Dockerfile 每一行 = 一層唯讀 layer
   - Stepper 逐層「build」，對應 Dockerfile 行 highlight
   - 切「這次改了什麼」看哪些層 cache hit、哪些從頭重建
   - 切「Dockerfile 順序」比較好壞順序對快取的影響
   ============================================================ */

const CMD_LINE = 'CMD ["uv", "run", "uvicorn", "app:app", "--host", "0.0.0.0"]'
const L = {
  base:  { src: 'FROM python:3.12-slim', short: 'FROM python:3.12-slim', kind: 'base',  size: '≈150 MB', w: 240, h: 34, sec: 25 },
  work:  { src: 'WORKDIR /app', short: 'WORKDIR /app', kind: 'meta', size: '0 B', w: 104, h: 18, sec: 0 },
  lock:  { src: 'COPY pyproject.toml uv.lock ./', short: 'COPY pyproject+lock', kind: 'files', size: '≈8 KB', w: 146, h: 22, sec: 0.2 },
  deps:  { src: 'RUN pip install uv && uv sync --frozen --no-dev', short: 'RUN uv sync', kind: 'deps', size: '≈60 MB', w: 190, h: 30, sec: 40 },
  code:  { src: 'COPY . .', short: 'COPY . .', kind: 'code', size: '≈200 KB', w: 156, h: 22, sec: 0.3 },
  cmd:   { src: CMD_LINE, short: 'CMD ["uv", …]', kind: 'meta', size: '0 B', w: 110, h: 18, sec: 0 },
}
const ORDERS = {
  good: { label: '好的順序', keys: ['base', 'work', 'lock', 'deps', 'code', 'cmd'] },
  bad:  { label: '壞的順序', keys: ['base', 'work', 'code', 'deps', 'cmd'] },
}
const CHANGES = {
  none: { label: '沒改' },
  app:  { label: '只改 app.py' },
  deps: { label: '改了 pyproject（新增依賴）' },
}
const KIND_TINT = { base: 24, deps: 16, files: 10, code: 10, meta: 6 }

/* 第一個失效的層：改 app.py → 第一個「COPY . .」；改 pyproject → 第一個會把它複製進來的 COPY */
function firstInvalid(keys, change) {
  if (change === 'none') return Infinity
  if (change === 'app') return keys.indexOf('code')
  const i = keys.indexOf('lock')
  return i >= 0 ? i : keys.indexOf('code')
}

export default function DockerLab() {
  const [order, setOrderRaw] = useState('good')
  const [change, setChange] = useState('none')
  const keys = ORDERS[order].keys
  const layers = keys.map((k) => L[k])
  const total = layers.length + 1
  const player = usePlayer(total, 1100)
  const step = Math.min(player.step, total - 1)
  const setOrder = (v) => { setOrderRaw(v); player.setStep(0) }

  const inv = firstInvalid(keys, change)
  const built = layers.map((l, i) => ({
    ...l, i, line: i + 1,
    built: i < step, current: i === step - 1,
    status: i < step ? (i >= inv ? 'rebuilt' : 'hit') : 'pending',
  }))
  const fullSec = layers.reduce((s, l) => s + l.sec, 0)
  const thisSec = built.filter((l) => l.built && l.status === 'rebuilt').reduce((s, l) => s + l.sec, 0)
  const hits = built.filter((l) => l.built && l.status === 'hit').length
  const rebuilds = built.filter((l) => l.built && l.status === 'rebuilt').length

  const src = layers.map((l) => l.src).join('\n')
  const explain = useMemo(() => explainFor(step, keys, change, order, inv), [step, keys, change, order, inv])
  const labels = ['讀取 build context', ...layers.map((l) => l.short)]

  return (
    <Lab className="dkr" accent="yellow" kicker="DEPLOY LAB" title="Dockerfile 每一行都是一層：順序決定快取命中"
         blurb="按「docker build」看每行指令怎麼變成一層唯讀 layer。切換「這次改了什麼」觀察哪些層能直接用快取、哪些得從頭重做——再把 COPY . . 挪到依賴安裝前面，感受壞順序有多痛。">
      <LabControls>
        <Seg label="Dockerfile 順序" tinted value={order} onChange={setOrder}
             options={Object.entries(ORDERS).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Seg label="這次改了什麼" value={change} onChange={setChange}
             options={Object.entries(CHANGES).map(([v, o]) => ({ value: v, label: o.label }))} />
        <span className="spacer" />
        <Stepper step={step} total={total} onStep={player.setStep} playing={player.playing} onPlay={player.toggle} labels={labels} />
      </LabControls>

      <LabGrid variant="even">
        <div className="lab-stack">
          <Code lang="bash" title="Dockerfile" highlight={step > 0 ? [step] : []} dim>{src}</Code>
          <LabExplain title={explain.title}>
            {explain.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            build 很慢，先看層順序：最少變動的（base、依賴）放前面，最常變的（程式碼）放最後，而且依賴描述檔要「單獨先 COPY」。
            <code>uv.lock</code>（或 <code>package-lock.json</code>）一定要 COPY 進去並用 <code>--frozen</code> 安裝，否則每台機器裝到的版本可能不同，快取也失去意義。
          </Callout>
        </div>

        <div className="lab-stack">
          <LabStage label="image layers 堆疊圖"
                    caption={step === 0 ? '虛線 = 還沒 build 的層；每層寬度示意大小（數字為示意值）' : `已 build ${step} / ${layers.length} 層 · 命中 ${hits} · 重建 ${rebuilds}`}>
            <LayerStack layers={built} step={step} fullSec={fullSec} thisSec={thisSec} />
          </LabStage>
          <LabStage plain label="image 與 container 的關係" caption="image 是唯讀模板；每個 container 只多一層自己的可寫層，底下共用同一份 image">
            <ImageVsContainer />
          </LabStage>
        </div>
      </LabGrid>

      <style>{`
        .dkr-layer rect.body { fill: color-mix(in srgb, var(--lab-accent) var(--dkr-tint), var(--surface-1)); stroke: var(--hairline); stroke-width: 1.5; transition: fill 0.3s ease, stroke 0.3s ease, opacity 0.3s ease; }
        .dkr-layer.pending rect.body { fill: none; stroke-dasharray: 4 4; opacity: 0.55; }
        .dkr-layer.pending text { fill: var(--ink-3); }
        .dkr-layer.rebuilt rect.body { stroke: var(--serious); }
        .dkr-layer.current rect.body { stroke: var(--lab-accent); stroke-width: 2.5; }
        .dkr-layer.built { animation: dkr-in 0.35s ease-out both; }
        @keyframes dkr-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .dkr-badge rect { stroke-width: 1; }
        .dkr-badge.hit rect { fill: color-mix(in srgb, var(--good) 14%, var(--surface-1)); stroke: var(--good); }
        .dkr-badge.hit text { fill: var(--good); }
        .dkr-badge.rebuilt rect { fill: color-mix(in srgb, var(--serious) 16%, var(--surface-1)); stroke: var(--serious); }
        .dkr-badge.rebuilt text { fill: var(--serious); }
        .dkr-badge text { font-family: var(--mono); font-size: 9.5px; font-weight: 700; }
        .dkr-num { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); }
        .dkr-ground { stroke: var(--ink-3); stroke-width: 1.5; }
        .dkr-slab { fill: color-mix(in srgb, var(--lab-accent) 14%, var(--surface-1)); stroke: var(--hairline); stroke-width: 1.2; }
        .dkr-slab.ghost { fill: none; stroke-dasharray: 3 3; opacity: 0.6; }
        .dkr-slab.rw { fill: color-mix(in srgb, var(--c-blue) 18%, var(--surface-1)); stroke: var(--c-blue); }
        .dkr-est { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-2); }
        .dkr-est b { fill: var(--ink-1); font-weight: 700; }
        .dkr .stepper button { white-space: nowrap; }
        .dkr .stepper .seg-label, .dkr .stepper .count { white-space: nowrap; }
        @media (max-width: 640px) { .dkr .stepper .seg-label { display: none; } }
        @media (prefers-reduced-motion: reduce) { .dkr-layer.built { animation: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>') }

/* ---- 說明文字：依步驟 × 改動 × 順序 ---- */
function explainFor(step, keys, change, order, inv) {
  if (step === 0) return {
    title: 'docker build：先把 build context 送給引擎',
    text: [
      '`docker build .` 會把目前目錄（build context）整包送給 Docker 引擎，Dockerfile 裡的 `COPY` 只能拿這裡面的檔案。用 `.dockerignore` 排除 `.venv/`、`.git/`、`node_modules/`，否則 context 又大又慢，`COPY . .` 的快取也更容易失效。',
      '接著每一行指令依序執行，各自產生一層**唯讀 layer** 疊在前一層上面。按 → 逐層看它怎麼來、什麼時候能用快取。',
    ],
  }
  const k = keys[step - 1]
  const status = step - 1 >= inv ? 'rebuilt' : 'hit'
  const chain = '快取是鏈狀的：**某一層失效，它上面的每一層一律重做**，不管內容有沒有變。'
  const tail = status === 'rebuilt'
    ? (step - 1 === inv ? '這層就是第一個失效的：它的輸入變了，從這裡開始往上全部重建。' : '這層本身沒變，但父層已經失效，所以也得重做。')
    : '指令沒變、父層也命中 → 直接拿快取，幾乎零秒。'
  const T = {
    base: ['FROM：拉基底映像，體積最大、最少變動', ['從 registry 拉 `python:3.12-slim` 當底——它本身就是好幾層疊起來的映像。tag 沒換這層就永遠命中，所以放最底層最划算。', tail]],
    work: ['WORKDIR：只改設定，0 B 的 metadata 層', ['之後的指令都在 `/app` 下執行。這種指令（還有 `ENV`、`EXPOSE`、`CMD`）只寫進映像設定，不產生檔案，`docker history` 會看到 0 B。', tail]],
    lock: ['COPY 依賴描述檔：先只複製兩個小檔', ['COPY 的快取比對的是**檔案內容的 checksum**：`pyproject.toml` 與 `uv.lock` 沒變就命中。只複製這兩個檔，讓下一層安裝依賴的快取只在「依賴真的變了」時失效。', change === 'deps' ? '你改了 `pyproject.toml`，checksum 變了 → 這層 rebuilt。' + chain : tail]],
    deps: ['RUN uv sync：最花時間的一層', ['RUN 的快取**只看指令字串和父層**，不會真的去檢查 pyproject 有沒有變——所以它能不能命中，完全取決於前面那個 COPY 有沒有失效。', order === 'bad' && change === 'app'
      ? '壞順序下 `COPY . .` 在它前面：改一行 `app.py` 就讓父層失效，`uv sync` 得重跑 40 秒——這就是「程式碼放依賴前面」的代價。'
      : tail]],
    code: ['COPY . .：程式碼最常改，放最後', ['把整個 context（扣掉 `.dockerignore`）複製進來。程式碼幾乎每次 build 都不同，所以放越後面越好：它失效時，上面只剩 `CMD` 這種 0 B 的層要重做。', order === 'bad' ? '這裡它被放在 `RUN uv sync` 前面：只要任何檔案變動，整個依賴安裝就跟著失效。' + chain : tail]],
    cmd: ['CMD：container 啟動時要跑什麼，build 完成', ['`CMD` 只寫進映像設定，告訴 container 啟動時執行哪個程序；不產生檔案。到這裡映像就建好了，可以 `docker run` 起 container。', status === 'rebuilt' ? '它是 0 B，所以雖然標 rebuilt 也幾乎不花時間。' : tail, '進階：**multi-stage build** 先在一個 stage 裝好編譯工具做出成品，再用 `COPY --from=builder` 只把成品搬進乾淨的最終映像，讓映像更小、攻擊面更少。']],
  }
  return { title: T[k][0], text: T[k][1] }
}

/* ---- 主圖：由下往上堆疊的 layers ---- */
function LayerStack({ layers, step, fullSec, thisSec }) {
  const GAP = 4, X = 30, BOTTOM = 206, done = step === layers.length
  let y = BOTTOM
  const placed = layers.map((l) => { y -= l.h; const py = y; y -= GAP; return { ...l, y: py } })
  const fmt = (s) => (s < 1 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`)
  return (
    <svg viewBox="0 0 400 240" role="img" aria-label={`Docker image 共 ${layers.length} 層，已 build ${step} 層`}>
      <text x={X} y="16" className="svg-text" style={{ fontWeight: 700 }}>image <tspan className="svg-mono">api:latest</tspan></text>
      <text x="396" y="16" className="svg-text small" textAnchor="end">→ 上層蓋在下層之上</text>
      {placed.map((l) => (
        <g key={l.i} className={`dkr-layer ${l.status} ${l.built ? 'built' : ''} ${l.current ? 'current' : ''}`}
           style={{ '--dkr-tint': `${KIND_TINT[l.kind]}%` }}>
          <text x={X - 8} y={l.y + l.h / 2 + 3.5} className="dkr-num" textAnchor="end">{l.line}</text>
          <rect className="body" x={X} y={l.y} width={l.w} height={l.h} rx="3" />
          <text x={X + 8} y={l.y + l.h / 2 + 4} className="svg-mono">{l.short}</text>
          <text x="318" y={l.y + l.h / 2 + 3.5} className="svg-text small" textAnchor="end">{l.size}</text>
          {l.built && (
            <g className={`dkr-badge ${l.status}${l.current && l.status === 'rebuilt' ? ' svg-pulse' : ''}`}>
              <rect x="328" y={l.y + l.h / 2 - 8} width="68" height="16" rx="8" />
              <text x="362" y={l.y + l.h / 2 + 3.5} textAnchor="middle">
                {l.status === 'hit' ? 'cache hit' : l.current && !done ? 'building…' : 'rebuilt'}
              </text>
            </g>
          )}
        </g>
      ))}
      <line x1={X - 14} y1={BOTTOM + 6} x2="396" y2={BOTTOM + 6} className="dkr-ground" />
      <text x={X - 14} y={BOTTOM + 24} className="dkr-est">全部重做 ≈ {fmt(fullSec)}</text>
      {step > 0 && (
        <text x="396" y={BOTTOM + 24} className="dkr-est" textAnchor="end">這次 build ≈ <tspan style={{ fontWeight: 700, fill: thisSec > 10 ? 'var(--serious)' : 'var(--good)' }}>{fmt(thisSec)}</tspan></text>
      )}
    </svg>
  )
}

/* ---- 小圖：image（唯讀）與 container（可寫層） ---- */
function ImageVsContainer() {
  const slabs = [18, 13, 10, 8]
  const Stack = ({ x, ghost, top }) => {
    let y = 100
    return (
      <g>
        {slabs.map((h, i) => { y -= h + 3; return <rect key={i} className={`dkr-slab${ghost ? ' ghost' : ''}`} x={x} y={y} width="100" height={h} rx="2" /> })}
        {top && <>
          <rect className="dkr-slab rw" x={x} y={y - 19} width="100" height="16" rx="2" />
          <text x={x + 50} y={y - 7.5} className="svg-text small" textAnchor="middle" style={{ fill: 'var(--c-blue)', fontWeight: 700 }}>可寫層（rw）</text>
        </>}
      </g>
    )
  }
  return (
    <svg viewBox="0 0 400 124" role="img" aria-label="一個 image 被兩個 container 共用，各自有可寫層">
      <defs>
        <marker id="dkr-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--ink-3)' }} />
        </marker>
      </defs>
      <text x="64" y="13" className="svg-text" textAnchor="middle" style={{ fontWeight: 700 }}>image（唯讀）</text>
      <text x="230" y="13" className="svg-text small" textAnchor="middle">container A</text>
      <text x="340" y="13" className="svg-text small" textAnchor="middle">container B</text>
      <Stack x={14} />
      <Stack x={180} ghost top />
      <Stack x={290} ghost top />
      <path d="M64 103 V 114 H 230 V 106" className="svg-edge svg-dash" markerEnd="url(#dkr-arrow)" />
      <path d="M180 114 H 340 V 106" className="svg-edge svg-dash" markerEnd="url(#dkr-arrow)" />
      <text x="150" y="111" className="svg-text small" textAnchor="middle" style={{ fill: 'var(--ink-2)', paintOrder: 'stroke', stroke: 'var(--surface-1)', strokeWidth: 5 }}>docker run ×2</text>
    </svg>
  )
}
