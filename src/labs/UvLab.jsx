import React from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Stepper, usePlayer, Code, Callout } from './ui.jsx'

/* ============================================================
   uv：從空資料夾到能跑的專案（7 步 step-through）
   - 左：檔案樹隨步驟長出來，這一步新增 / 變動的檔案會亮
   - 右：pyproject.toml 內容演進（新增的行 highlight）
   - 下：相依圖，對照「pyproject 只記你直接要的」vs「uv.lock 記完整解析」
   ============================================================ */

const PY_BASE = `[project]
name = "api"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []`
const PY_DEPS = `[project]
name = "api"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.34",
]`
const PY_DEV = `${PY_DEPS}

[dependency-groups]
dev = [
    "pytest>=8.3",
    "ruff>=0.8",
]`

/* 每步：指令、終端輸出、檔案狀態（new / mod / lock）、pyproject 版本與 highlight、說明 */
const STEPS = [
  { label: '建專案', cmd: 'uv init api && cd api', out: 'Initialized project `api` at `/home/me/api`',
    files: { 'pyproject.toml': 'new', '.python-version': 'new', 'main.py': 'new', 'README.md': 'new', '.gitignore': 'new' }, py: PY_BASE, hl: [1, 6, 7],
    title: 'uv init：一個指令長出專案骨架',
    text: ['`uv init api` 建立資料夾，生出 `pyproject.toml`（專案的身分證：名稱、需要的 Python 版本、依賴清單）、`.python-version`（釘住這個專案用哪個 Python）、一個 `main.py` 範例、README 與 `.gitignore`，還會順手 `git init`。', '這時候還沒有 `.venv`——uv 是懶惰的，需要時才建。'] },
  { label: '加依賴', cmd: 'uv add fastapi uvicorn', out: 'Resolved 11 packages in 310ms\nInstalled 10 packages in 40ms\n + fastapi\n + starlette\n + pydantic\n + uvicorn\n + h11\n + click\n …',
    files: { 'pyproject.toml': 'mod', 'uv.lock': 'new', '.venv/': 'new' }, py: PY_DEPS, hl: [7, 8, 9, 10], pkgs: 10,
    title: 'uv add：改 pyproject、解析、鎖版本、裝進 .venv，一次做完',
    text: ['`uv add` 做了四件事：把 `fastapi`、`uvicorn` 寫進 `pyproject.toml` 的 `dependencies`（只記「你直接要的」加一個下限版本）；解析整棵依賴樹（fastapi 需要 starlette、pydantic…）；把完整結果寫進 `uv.lock`；建立 `.venv` 並安裝。', '以前是 `pip install` 之後再手動 `pip freeze`，兩邊常對不上；現在一個指令，而且完全不用 activate。'] },
  { label: '開發工具', cmd: 'uv add --dev pytest ruff', out: 'Resolved 17 packages in 180ms\nInstalled 6 packages in 25ms\n + pytest\n + pluggy\n + iniconfig\n + ruff\n …',
    files: { 'pyproject.toml': 'mod', 'uv.lock': 'mod', '.venv/': 'mod' }, py: PY_DEV, hl: [12, 13, 14, 15, 16], pkgs: 16,
    title: 'uv add --dev：開發工具分開放',
    text: ['測試、lint 工具只有開發時需要，放進 `[dependency-groups]` 的 `dev` 群組（PEP 735），不算這個套件的正式依賴。', '`uv sync` 預設會一起裝 dev 群組；部署時用 `uv sync --no-dev`，pytest 就不會跑進正式環境。'] },
  { label: '鎖定', cmd: 'uv lock', out: 'Resolved 17 packages in 4ms\n# 沒有變動：add 的時候已經鎖好了',
    files: { 'uv.lock': 'mod' }, py: PY_DEV, hl: [], pkgs: 16,
    title: 'uv lock：其實剛才已經自動做了',
    text: ['`uv add` 每次都會順手更新 lock，所以這裡 `uv lock` 沒有變動。它單獨存在的用途：手動編輯 `pyproject.toml` 之後重新解析；`uv lock --upgrade` 把所有套件升到允許範圍內的最新版；`uv lock --check` 在 CI 驗證 lock 是否過期。', '`uv.lock` 記的是**跨平台**的完整解析結果（每個套件的精確版本、來源、wheel 的 hash），所以 macOS 上鎖的檔在 Linux 上一樣能用。'] },
  { label: '同步', cmd: 'uv sync', out: 'Resolved 17 packages in 3ms\nAudited 16 packages in 1ms\n# .venv 已和 uv.lock 一致，沒動作',
    files: { '.venv/': 'mod' }, py: PY_DEV, hl: [], pkgs: 16,
    title: 'uv sync：讓 .venv 長得和 uv.lock 一模一樣',
    text: ['`uv sync` 讀的是 `uv.lock`（不是 pyproject），把 `.venv` 調整成完全一致：缺的裝上、多的移除——你手動 `pip install` 進去的、不在 lock 裡的套件會被拔掉。', '這就是「可重現環境」：同一份 lock，在哪台機器 sync 出來都一樣。'] },
  { label: '執行', cmd: 'uv run uvicorn main:app --reload', out: 'INFO:     Uvicorn running on http://127.0.0.1:8000\nINFO:     Application startup complete.',
    files: { 'main.py': 'mod', '.venv/': 'mod' }, py: PY_DEV, hl: [], pkgs: 16,
    title: 'uv run：不用 activate，跑之前先確認環境對',
    text: ['`uv run <指令>` 會先確認 `.venv` 與 lock 一致（不一致就自動 sync），再在 venv 裡執行。團隊裡不用再提醒「記得 source .venv/bin/activate」，也少掉「我這邊可以跑」的問題。', '`uv run pytest`、`uv run ruff check .` 同理。一次性、不想裝進專案的工具用 `uvx ruff check .`（等於 `uv tool run`，跑在暫時的獨立環境）。'] },
  { label: '同事 clone', cmd: 'git clone git@…:team/api && cd api\nuv sync --frozen', out: 'Using CPython 3.12\nCreating virtual environment at: .venv\nInstalled 16 packages in 80ms',
    files: { '.venv/': 'new', 'uv.lock': 'lock', '.python-version': 'lock' }, py: PY_DEV, hl: [6], pkgs: 16, clone: true,
    title: '同事 clone：uv sync --frozen 一次到位',
    text: ['clone 下來有 `pyproject.toml`、`uv.lock`、`.python-version`，沒有 `.venv`（它在 `.gitignore` 裡，本來就不進版控）。`--frozen` 的意思是「照 lock 檔裝，不要重新解析、不要動 lock」。', 'uv 會依 `.python-version` 自動下載對的 Python、建 `.venv`、裝好全部套件。CI 與 Dockerfile 也是同一行；`--locked` 更嚴：lock 過期就直接失敗，適合在 CI 把關。這也是 lock 檔一定要進版控的原因——沒有它，同事解析出來的版本可能和你不同。'] },
]

const FILES = [
  { name: 'pyproject.toml', from: 0, tag: '' },
  { name: '.python-version', from: 0, tag: '' },
  { name: 'main.py', from: 0, tag: '' },
  { name: 'README.md', from: 0, tag: '' },
  { name: '.gitignore', from: 0, tag: '' },
  { name: 'uv.lock', from: 1, tag: '進版控' },
  { name: '.venv/', from: 1, tag: 'gitignore', ignored: true },
]

/* 相依圖：上排 = pyproject 直接要的；下排 = lock 才記得的間接依賴 */
const TOP = [
  { id: 'fastapi', x: 44, from: 1 }, { id: 'uvicorn', x: 200, from: 1 },
  { id: 'pytest', x: 356, from: 2, dev: true }, { id: 'ruff', x: 470, from: 2, dev: true },
]
const SUB = [
  { id: 'starlette', x: 6, p: 'fastapi', from: 1 }, { id: 'pydantic', x: 86, p: 'fastapi', from: 1 },
  { id: 'h11', x: 166, p: 'uvicorn', from: 1 }, { id: 'click', x: 246, p: 'uvicorn', from: 1 },
  { id: 'pluggy', x: 326, p: 'pytest', from: 2 }, { id: 'iniconfig', x: 406, p: 'pytest', from: 2 },
]

export default function UvLab() {
  const { step, setStep, playing, toggle } = usePlayer(STEPS.length, 2600)
  const s = STEPS[step]
  const pkgs = STEPS.slice(0, step + 1).reduce((a, x) => x.pkgs ?? a, 0)

  return (
    <Lab accent="blue" kicker="PYTHON LAB" title="uv：從空資料夾到能跑的專案"
         blurb="七個指令走一遍：看檔案樹怎麼長出來、pyproject.toml 記了什麼、uv.lock 又多記了什麼，最後同事 clone 下來一行就能跑。">
      <LabControls>
        <Stepper step={step} total={STEPS.length} onStep={setStep} playing={playing} onPlay={toggle} labels={STEPS.map((x) => x.label)} />
      </LabControls>

      <LabGrid variant="wide">
        <LabStage label="檔案樹、pyproject.toml 與相依圖" caption="左：專案資料夾（亮起 = 這一步新增或變動）；右：pyproject.toml；下：pyproject 只記上排，uv.lock 連下排的版本與 hash 都記">
          <div className="uvl-top">
            <FileTree step={step} s={s} pkgs={pkgs} />
            <Code lang="yaml" title="pyproject.toml" highlight={s.hl}>{s.py}</Code>
          </div>
          <DepGraph step={step} />
        </LabStage>

        <div className="lab-stack">
          <Code lang="bash" title={`第 ${step + 1} 步`} highlight={s.cmd.split('\n').map((_, i) => i + 1)}>{s.cmd.split('\n').map((l) => `$ ${l}`).join('\n')}</Code>
          <pre key={step} className="uvl-out row-in">{s.out}</pre>
          <LabExplain title={s.title}>
            {s.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            新專案直接 <code>uv init</code>；接手有 <code>requirements.txt</code> 的舊專案，<code>uv add -r requirements.txt</code> 轉過來。日常只要記三個：<code>uv add</code>（要新套件）、<code>uv sync</code>（拉了別人的變更）、<code>uv run</code>（跑東西）。<code>uv.lock</code> 一定 commit，<code>.venv</code> 一定不 commit。
          </Callout>
        </div>
      </LabGrid>

      <Callout title="對照以前的 pip + venv">
        <div className="dtable-wrap">
          <table className="dtable uvl-cmp">
            <thead><tr><th>以前（pip + venv）</th><th>現在（uv）</th></tr></thead>
            <tbody>
              <tr><td>python -m venv .venv<br />source .venv/bin/activate</td><td>不用做：uv 自動建 .venv，uv run 直接在裡面跑</td></tr>
              <tr><td>pip install fastapi<br />pip freeze &gt; requirements.txt</td><td>uv add fastapi（同時更新 pyproject 與 uv.lock）</td></tr>
              <tr><td>pip install -r requirements.txt</td><td>uv sync（或 uv sync --frozen）</td></tr>
              <tr><td>pyenv install 3.12 && pyenv local 3.12</td><td>.python-version（缺的 Python 版本 uv 自動下載）</td></tr>
              <tr><td>python main.py</td><td>uv run main.py（跑之前先自動 sync）</td></tr>
              <tr><td>pipx run ruff</td><td>uvx ruff</td></tr>
            </tbody>
          </table>
        </div>
        <p className="uvl-cmp-note">uv 把 Python 版本、虛擬環境、lock、執行一次管好；requirements.txt 那套「手動 freeze」的流程就退場了。</p>
      </Callout>

      <style>{`
        .uvl-top { display: grid; grid-template-columns: minmax(200px, 1fr) minmax(0, 1.4fr); gap: 16px; align-items: start; margin-bottom: 16px; }
        @media (max-width: 640px) { .uvl-top { grid-template-columns: 1fr; } }
        .uvl-tree { font-family: var(--mono); font-size: 0.8rem; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); overflow: hidden; }
        .uvl-tree .head { padding: 6px 12px; border-bottom: 1px solid var(--hairline); background: var(--surface-2); font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3); font-weight: 700; font-family: var(--sans); }
        .uvl-tree ul { list-style: none; margin: 0; padding: 6px 0; }
        .uvl-tree li { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; padding: 4px 12px 4px 22px; color: var(--ink-1); position: relative; transition: background 0.2s ease; }
        .uvl-tree li::before { content: ''; position: absolute; left: 12px; top: 50%; width: 6px; height: 1px; background: var(--hairline); }
        .uvl-tree li.new { background: color-mix(in srgb, var(--lab-accent) 14%, transparent); box-shadow: inset 3px 0 0 var(--lab-accent); animation: row-in 0.35s ease-out; }
        .uvl-tree li.mod { background: color-mix(in srgb, var(--c-yellow) 16%, transparent); box-shadow: inset 3px 0 0 var(--c-yellow); }
        .uvl-tree li.lock { background: color-mix(in srgb, var(--good) 12%, transparent); box-shadow: inset 3px 0 0 var(--good); }
        .uvl-tree li.ignored { color: var(--ink-3); }
        .uvl-tree li.ignored .name { text-decoration: underline dotted; text-underline-offset: 3px; }
        .uvl-tree li .tag { font-size: 0.62rem; padding: 0 6px; }
        .uvl-tree li.new .tag.state { border-color: var(--lab-accent); color: var(--lab-accent); }
        .uvl-tree li.mod .tag.state { border-color: var(--c-yellow); color: var(--c-yellow); }
        .uvl-tree li.lock .tag.state { border-color: var(--good); color: var(--good); }
        .uvl-tree li.sub { padding-left: 40px; color: var(--ink-3); font-size: 0.72rem; }
        .uvl-tree li.sub::before { left: 30px; }
        .uvl-out { margin: 0; font-family: var(--mono); font-size: 0.76rem; line-height: 1.55; color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 8px 12px; white-space: pre-wrap; word-break: break-all; }
        .uvl-out.row-in { animation: row-in 0.35s ease-out; }
        .uvl-cmp { margin-top: 8px; }
        .uvl-cmp td { white-space: normal; vertical-align: top; font-size: 0.76rem; }
        .uvl-cmp td:first-child { color: var(--ink-3); }
        .uvl-cmp-note { margin-top: 8px; }
        .uvl-dep .box { fill: none; stroke: var(--hairline); stroke-width: 1; stroke-dasharray: 4 3; }
        .uvl-dep .box.lock { stroke: var(--good); }
        .uvl-dep .box.py { stroke: var(--lab-accent); }
        .uvl-dep .boxlab { font-family: var(--sans); font-size: 10px; font-weight: 700; }
        .uvl-dep .boxlab.lock { fill: var(--good); } .uvl-dep .boxlab.py { fill: var(--lab-accent); }
        .uvl-dep .svg-node.dev { stroke-dasharray: 3 3; }
        .uvl-dep .svg-node.sub { fill: var(--surface-2); }
        .uvl-dep .ver { font-family: var(--mono); font-size: 8.5px; fill: var(--ink-3); }
        .uvl-dep .ghost { opacity: 0.18; }
        @media (prefers-reduced-motion: reduce) { .uvl-tree li.new, .uvl-out.row-in { animation: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

function FileTree({ step, s, pkgs }) {
  const state = (f) => {
    if (s.clone && f.name !== '.venv/' && !s.files[f.name]) return 'git'
    return s.files[f.name] || ''
  }
  const label = { new: s.clone ? '建出來' : '新增', mod: s.clone ? '' : '變動', lock: 'git · 唯讀', git: 'git' }
  return (
    <div className="uvl-tree" role="list" aria-label="專案檔案樹">
      <div className="head">{s.clone ? '同事的機器 · api/' : '你的機器 · api/'}</div>
      <ul>
        {FILES.filter((f) => step >= f.from).map((f) => {
          const st = state(f)
          return (
            <React.Fragment key={f.name}>
              <li className={`${st === 'git' ? '' : st} ${f.ignored ? 'ignored' : ''}`} role="listitem">
                <span className="name">{f.name}</span>
                {f.tag && <span className="tag">{f.tag}</span>}
                {st && label[st] && <span className="tag state">{label[st]}</span>}
              </li>
              {f.name === '.venv/' && <li className="sub" key={`${f.name}-sub-${pkgs}`}>site-packages · {pkgs} 個套件</li>}
            </React.Fragment>
          )
        })}
      </ul>
    </div>
  )
}

function DepGraph({ step }) {
  const W = 548, NW = 72, NH = 24, Y1 = 52, Y2 = 132
  const vis = (n) => step >= n.from
  const appearedNow = (n) => n.from === step
  const byId = Object.fromEntries(TOP.map((n) => [n.id, n]))
  return (
    <svg className="uvl-dep" viewBox={`0 0 ${W} 182`} role="img" aria-label="相依圖：pyproject 記直接依賴，uv.lock 記完整解析">
      <rect className="box lock" x="2" y="18" width={W - 4} height="160" rx="6" />
      <text className="boxlab lock" x="10" y="12">uv.lock：完整解析結果（節錄；每個套件的精確版本 + wheel hash）</text>
      <rect className="box py" x="30" y="28" width={W - 40} height="58" rx="5" />
      <text className="boxlab py" x="40" y="42">pyproject.toml：只記你直接要的（dev 群組虛線框）</text>
      {SUB.filter(vis).map((n) => {
        const p = byId[n.p]
        return <path key={n.id} className={`svg-edge${appearedNow(n) ? ' svg-pop' : ''}`} d={`M${p.x + NW / 2},${Y1 + NH} C${p.x + NW / 2},${Y1 + NH + 30} ${n.x + NW / 2},${Y2 - 30} ${n.x + NW / 2},${Y2}`} />
      })}
      {TOP.filter(vis).map((n) => (
        <g key={n.id} className={appearedNow(n) ? 'svg-pop' : ''}>
          <rect className={`svg-node on${n.dev ? ' dev' : ''}`} x={n.x} y={Y1} width={NW} height={NH} rx="4" />
          <text className="svg-mono" x={n.x + NW / 2} y={Y1 + 16} textAnchor="middle">{n.id}</text>
        </g>
      ))}
      {SUB.filter(vis).map((n) => (
        <g key={n.id} className={appearedNow(n) ? 'svg-pop' : ''}>
          <rect className="svg-node sub" x={n.x} y={Y2} width={NW} height={NH} rx="4" />
          <text className="svg-mono" x={n.x + NW / 2} y={Y2 + 16} textAnchor="middle">{n.id}</text>
          <text className="ver" x={n.x + NW / 2} y={Y2 + NH + 11} textAnchor="middle">v… · sha256:…</text>
        </g>
      ))}
      {step === 0 && <text className="svg-text small" x={W / 2} y={Y2 + 14} textAnchor="middle">還沒有任何依賴——下一步 uv add 之後這裡會長出來</text>}
      {step >= 1 && SUB.filter(vis).length < SUB.length && (
        <g className="ghost">
          {SUB.filter((n) => !vis(n)).map((n) => <rect key={n.id} className="svg-node sub" x={n.x} y={Y2} width={NW} height={NH} rx="4" />)}
          {TOP.filter((n) => !vis(n)).map((n) => <rect key={n.id} className="svg-node dev" x={n.x} y={Y1} width={NW} height={NH} rx="4" />)}
        </g>
      )}
    </svg>
  )
}
