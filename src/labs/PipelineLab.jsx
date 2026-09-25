import React, { useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, useWidth } from './ui.jsx'

/* ============================================================
   CI/CD 管線：同一條 lint → test → build → staging → prod
   在 GitHub Actions 與 GitLab CI 的寫法對照，逐階段跑給你看
   - 「讓測試失敗」：看 fail-fast 怎麼把後面全部 skipped
   - 「feature branch」：看 if / rules 怎麼讓部署階段不執行
   ============================================================ */

const STAGES = [
  { key: 'lint', name: 'lint' },
  { key: 'test', name: 'test' },
  { key: 'build', name: 'build image' },
  { key: 'staging', name: 'deploy staging' },
  { key: 'prod', name: 'deploy prod' },
]

/* YAML 以 [文字, tags] 定義，行號由程式算，highlight 不會因為改幾行就對不上 */
const GHA = [
  ['name: ci', ''],
  ['on: push                 # 任何分支 push 都會觸發', 'trigger'],
  ['jobs:', ''],
  ['  lint:', 'lint'],
  ['    runs-on: ubuntu-latest', 'lint'],
  ['    steps:', 'lint'],
  ['      - uses: actions/checkout@v4', 'lint'],
  ['      - run: npm ci && npm run lint', 'lint'],
  ['  test:', 'test'],
  ['    needs: lint', 'test dep'],
  ['    runs-on: ubuntu-latest', 'test'],
  ['    steps:', 'test'],
  ['      - uses: actions/checkout@v4', 'test'],
  ['      - run: npm ci && npm test', 'test'],
  ['  build:', 'build'],
  ['    needs: test', 'build dep'],
  ['    runs-on: ubuntu-latest', 'build'],
  ['    steps:', 'build'],
  ['      - uses: actions/checkout@v4', 'build'],
  ['      - run: docker build -t app:${{ github.sha }} .', 'build'],
  ['  deploy-staging:', 'staging'],
  ['    needs: build', 'staging dep'],
  ["    if: github.ref == 'refs/heads/main'", 'staging cond'],
  ['    runs-on: ubuntu-latest', 'staging'],
  ['    environment: staging', 'staging'],
  ['    steps:', 'staging'],
  ['      - run: ./deploy.sh staging', 'staging'],
  ['  deploy-prod:', 'prod'],
  ['    needs: deploy-staging', 'prod dep'],
  ["    if: github.ref == 'refs/heads/main'", 'prod cond'],
  ['    runs-on: ubuntu-latest', 'prod'],
  ['    environment: production   # 設 required reviewers → 等人核准', 'prod approve'],
  ['    env:', 'prod'],
  ['      DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}', 'prod secret'],
  ['    steps:', 'prod'],
  ['      - run: ./deploy.sh prod', 'prod'],
]

const GITLAB = [
  ['stages: [lint, test, build, staging, production]', 'trigger dep'],
  ['default:', ''],
  ['  image: node:20', ''],
  ['lint:', 'lint'],
  ['  stage: lint', 'lint'],
  ['  script:', 'lint'],
  ['    - npm ci', 'lint'],
  ['    - npm run lint', 'lint'],
  ['test:', 'test'],
  ['  stage: test', 'test dep'],
  ['  script:', 'test'],
  ['    - npm ci', 'test'],
  ['    - npm test', 'test'],
  ['build:', 'build'],
  ['  stage: build', 'build dep'],
  ['  image: docker:27', 'build'],
  ['  services: [docker:27-dind]', 'build'],
  ['  script:', 'build'],
  ['    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .', 'build'],
  ['    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA', 'build'],
  ['deploy_staging:', 'staging'],
  ['  stage: staging', 'staging dep'],
  ['  environment: staging', 'staging'],
  ['  rules:', 'staging cond'],
  ['    - if: $CI_COMMIT_BRANCH == "main"', 'staging cond'],
  ['  script:', 'staging'],
  ['    - ./deploy.sh staging', 'staging'],
  ['deploy_prod:', 'prod'],
  ['  stage: production', 'prod dep'],
  ['  environment: production', 'prod'],
  ['  rules:', 'prod cond'],
  ['    - if: $CI_COMMIT_BRANCH == "main"', 'prod cond'],
  ['      when: manual          # 等人按下去才跑', 'prod approve'],
  ['  script:', 'prod'],
  ['    - ./deploy.sh prod      # $DEPLOY_KEY 來自 CI/CD variables', 'prod secret'],
]

const srcOf = (def) => def.map(([t]) => t).join('\n')
const linesTagged = (def, tags) => def.flatMap(([, tg], i) => (tg.split(' ').some((t) => tags.includes(t)) ? [i + 1] : []))

const MAPPING = [
  ['整條流程', 'workflow（.github/workflows/*.yml）', 'pipeline（.gitlab-ci.yml）'],
  ['一個執行單位', 'job', 'job'],
  ['job 裡的指令', 'steps: - run / - uses', 'script: - …'],
  ['跑在哪台機器', 'runner（runs-on）', 'runner（tags / image）'],
  ['什麼時候觸發', 'on: push / pull_request', 'rules: - if: …（每次 push 都建 pipeline，再由 rules 過濾）'],
  ['機密', 'secrets（${{ secrets.X }}）', 'CI/CD variables（$X，可設 masked / protected）'],
  ['job 之間傳檔', 'actions/upload-artifact', 'artifacts: paths:'],
  ['部署目標與審核', 'environment:（protection rules）', 'environment:（protected environments）'],
  ['執行順序', 'needs:（有向圖）', 'stages: 順序 + needs:（可跨 stage 提早跑）'],
]

function stageStatus(k, step, failTest, feature) {
  if (feature && k >= 3) return 'off'
  if (failTest && step >= 3) { if (k === 1) return 'failed'; if (k > 1) return 'skipped' }
  if (k === 4) return step === 5 ? 'waiting' : step >= 6 ? 'done' : 'pending'
  if (k < step - 1) return 'done'
  if (k === step - 1) return 'running'
  return 'pending'
}
const STATUS_TEXT = { pending: '等待', running: '執行中…', done: '通過', failed: '失敗', skipped: 'skipped', off: '條件不符', waiting: '等待手動核准' }

function narrative(step, failTest, feature, ci) {
  const gh = ci === 'gha'
  if (step === 0) return {
    title: feature ? 'push 到 feature/x：pipeline 一樣被觸發' : 'push 到 main：觸發 pipeline',
    text: [
      gh ? '`on: push` 沒有限制分支，所以任何分支的 push 都會建立一個 workflow run，接著把 job 排給 runner。'
         : 'GitLab 預設每次 push 都會建立 pipeline，`stages` 決定各 job 的先後順序；哪些 job 真的執行則由每個 job 的 `rules` 決定。',
      '為什麼每個分支都要跑？因為 lint 和 test 對每一次 commit 都有價值——問題越早被抓到，修起來越便宜。',
    ],
  }
  if (failTest && step === 3) return {
    title: 'test 失敗：後面全部 skipped（fail-fast）',
    text: [
      gh ? '`build` 宣告 `needs: test`，上游失敗時它根本不會啟動，UI 顯示 skipped；再下游的 deploy 也跟著連鎖 skipped。'
         : 'GitLab 一個 stage 有 job 失敗，後面的 stage 不會執行（除非該 job 標 `allow_failure: true` 或下游用 `when: always`）。',
      'commit 上會出現紅叉，Pull/Merge Request 若設了 required checks 就不能合併。這正是 CI 的價值：壞掉的東西進不了 main。',
    ],
  }
  if (feature && step === 4) return {
    title: '結束：deploy 兩階段沒有執行',
    text: [
      gh ? '`if: github.ref == \'refs/heads/main\'` 在 feature branch 上是 false，job 被標成 skipped，不佔 runner 時間。'
         : '`rules: - if: $CI_COMMIT_BRANCH == "main"` 沒有任何一條命中，這個 job 連加進 pipeline 都不會——pipeline 圖上直接看不到它。',
      '這就是「CI 每個分支都跑、CD 只有 main 才跑」的實作方式：程式碼要先合併進 main，才有機會被部署。',
    ],
  }
  const byStep = {
    1: { title: 'lint 執行中', text: ['runner 是一台乾淨的暫時機器：先 checkout 程式碼、安裝依賴、跑 linter。這裡不需要任何 secret，也是整條管線最便宜、最快的關卡。', '想省時間就對 node_modules / pip cache 做快取：鍵值通常用 lockfile 的 hash，lockfile 沒變就直接還原。'] },
    2: { title: 'test 執行中', text: [gh ? '`needs: lint` 保證 lint 通過後才啟動 test；沒有 `needs` 的 job 會平行跑。' : 'test 在第二個 stage，GitLab 會等前一個 stage 全部成功才進入。同一個 stage 的 job 之間會平行跑。', '測試通常最花時間。常見加速法：切成多個 job 平行（shard）、資料庫用 service container 起在 runner 旁邊。'] },
    3: { title: 'build：打 docker image', text: ['用 commit SHA 當 image tag，每個 build 都可追溯到原始碼版本；之後 staging 和 prod 部署的是「同一顆」image，不再重新編譯。', gh ? 'job 之間檔案不共享——image 推到 registry，或用 upload-artifact / download-artifact 傳遞產物。' : '`artifacts:` 可以把 build 產物交給後面 stage 的 job；image 則是推到 GitLab Container Registry。'] },
    4: { title: 'deploy staging（自動）', text: [gh ? '`if` 判定這是 main 分支，job 才會跑；`environment: staging` 讓 GitHub 記錄這個環境的部署歷史，並把綁在該 environment 的 secrets 注入進來。' : '`rules` 命中 main，job 執行；`environment: staging` 讓 GitLab 記錄部署歷史，並套用該環境的 protected variables。', '部署到 staging 是自動的：main 上的每個 commit 都應該能在 staging 被驗證，這是 continuous delivery 的前提。'] },
    5: { title: '等待手動核准', text: [gh ? '`environment: production` 在 repo 設定裡加了 required reviewers，job 會停在這裡，直到指定的人按下 approve。' : '`when: manual` 讓這個 job 變成一顆播放鈕，pipeline 停在 blocked 狀態，等有權限的人按下去。', '這一步就是 continuous delivery 和 continuous deployment 的分水嶺：delivery 是「隨時可上、人決定何時」，deployment 是「合併即上線」。'] },
    6: { title: 'deploy prod 完成', text: ['整條 pipeline 綠燈。部署用的金鑰只存在 secrets / CI variables，從頭到尾沒有進過 repo，也不會出現在 log（會被 mask）。', 'Protected branch 讓沒過 CI 的 code 進不了 main；protected environment 讓沒經審核的人碰不到 prod。兩道門缺一不可。'] },
  }
  return byStep[Math.min(step, 6)]
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>') }

export default function PipelineLab() {
  const [ci, setCi] = useState('gha')
  const [failTest, setFailTest] = useState(false)
  const [feature, setFeature] = useState(false)
  const total = failTest ? 4 : feature ? 5 : 7
  const { step, setStep, playing, toggle } = usePlayer(total, 1300)

  const setFail = (v) => { setFailTest(v); setStep(0) }
  const setFeat = (v) => { setFeature(v); setStep(0) }

  const def = ci === 'gha' ? GHA : GITLAB
  const src = useMemo(() => srcOf(def), [def])
  const statuses = STAGES.map((_, k) => stageStatus(k, step, failTest, feature))

  const hlTags = failTest && step === 3 ? ['test', 'dep']
    : feature && step === 4 ? ['cond']
    : step === 0 ? ['trigger']
    : step === 5 ? ['approve', 'cond']
    : [STAGES[Math.min(step - 1, 4)].key]
  const hl = linesTagged(def, hlTags)

  const n = narrative(step, failTest, feature, ci)
  const labels = failTest ? ['push', 'lint', 'test', '失敗 → fail-fast']
    : feature ? ['push feature/x', 'lint', 'test', 'build', '部署階段不執行']
    : ['push main', 'lint', 'test', 'build', 'staging', '等待核准', 'prod 上線']

  return (
    <Lab accent="green" className="cicd-lab" kicker="CI/CD LAB" title="CI/CD 管線：GitHub Actions 與 GitLab CI 對照"
         blurb="同一條 lint → test → build → deploy 的管線，左右兩家的寫法擺在一起看。按播放逐階段跑，切開關看測試失敗、feature branch 時管線怎麼反應。">
      <LabControls>
        <Seg label="平台" tinted value={ci} onChange={setCi}
             options={[{ value: 'gha', label: 'GitHub Actions' }, { value: 'gitlab', label: 'GitLab CI' }]} />
        <Toggle label="讓測試失敗" checked={failTest} onChange={setFail} />
        <Toggle label="這次是 feature branch" checked={feature} onChange={setFeat} />
        <span className="spacer" />
        <Stepper step={step} total={total} onStep={setStep} playing={playing} onPlay={toggle} labels={labels} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="管線五個階段的執行狀態" caption={feature ? 'feature branch：部署階段依條件不執行' : failTest ? '測試失敗：下游全部 skipped' : 'main 分支：staging 自動、prod 需人工核准'}>
            <PipelineSvg statuses={statuses} step={step} feature={feature} />
          </LabStage>
          <LabExplain title={n.title}>
            {n.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <LabExplain title="幾個一定要分清楚的概念">
            <p><strong>CI vs CD</strong>：CI（integration）是每次 push 都自動 lint / test / build；CD 有兩種——continuous <em>delivery</em> 是產物隨時可上線、由人按核准，continuous <em>deployment</em> 是合併即自動上線。</p>
            <p><strong>cache vs artifact</strong>：cache 是「加速用、丟了也沒關係」的依賴（node_modules）；artifact 是「這次 build 的產物」，要在 job 之間傳遞或留檔。兩者機制不同，不要混用。</p>
            <p><strong>secrets 永不進 repo</strong>：金鑰放平台的 secrets / CI variables，執行時以環境變數注入，log 中會被遮罩。任何寫進 YAML 或 code 的 token 都要當作已洩漏。</p>
          </LabExplain>
        </div>

        <div className="lab-stack">
          <Code lang="yaml" title={ci === 'gha' ? '.github/workflows/ci.yml' : '.gitlab-ci.yml'} highlight={hl} dim>{src}</Code>
          <Callout title="工作上什麼時候用">
            新專案先把 <b>lint + test</b> 跑起來就贏一半——它讓壞 code 進不了 main，成本只是一個 YAML。部署階段永遠留一道<b>手動核准</b>（environment reviewers / <code>when: manual</code>），等團隊對測試有信心再談自動上 prod。
          </Callout>
        </div>
      </LabGrid>

      <div className="dtable-wrap cicd-map">
        <table className="dtable">
          <caption>名詞對照：同一件事，兩家怎麼叫</caption>
          <thead><tr><th>概念</th><th className="th-a">GitHub Actions</th><th className="th-b">GitLab CI</th></tr></thead>
          <tbody>
            {MAPPING.map(([c, a, b]) => (
              <tr key={c}><td className="cicd-c">{c}</td><td className="src-a">{a}</td><td className="src-b">{b}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .cicd-lab .stepper { flex-wrap: wrap; row-gap: 6px; }
        .cicd-lab .stepper .count, .cicd-lab .stepper .seg-label { white-space: nowrap; }
        .cicd-map { margin-top: 18px; }
        .cicd-map td { white-space: normal; }
        .cicd-map td.cicd-c { font-family: var(--sans); color: var(--ink-2); white-space: nowrap; }
        .cicd-svg { width: 100%; }
        .cicd-svg .node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.3s ease, fill 0.3s ease, opacity 0.3s ease; }
        .cicd-svg .node.running { stroke: var(--lab-accent); stroke-width: 2; }
        .cicd-svg .node.done { stroke: var(--good); fill: color-mix(in srgb, var(--good) 12%, var(--surface-1)); }
        .cicd-svg .node.failed { stroke: var(--critical); stroke-width: 2; fill: color-mix(in srgb, var(--critical) 14%, var(--surface-1)); }
        .cicd-svg .node.waiting { stroke: var(--warning); stroke-width: 2; fill: color-mix(in srgb, var(--warning) 14%, var(--surface-1)); }
        .cicd-svg .node.skipped { stroke-dasharray: 4 3; }
        .cicd-svg .g.off, .cicd-svg .g.skipped { opacity: 0.45; }
        .cicd-svg .name { font-family: var(--mono); font-size: 12px; fill: var(--ink-1); }
        .cicd-svg .st { font-family: var(--sans); font-size: 11px; fill: var(--ink-3); }
        .cicd-svg .st.done { fill: var(--good); font-weight: 600; }
        .cicd-svg .st.failed { fill: var(--critical); font-weight: 600; }
        .cicd-svg .st.running { fill: var(--lab-accent); font-weight: 600; }
        .cicd-svg .st.waiting { fill: var(--serious); font-weight: 600; }
        .cicd-svg .edge { stroke: var(--hairline); stroke-width: 1.5; fill: none; transition: stroke 0.3s ease; }
        .cicd-svg .edge.on { stroke: var(--good); }
        .cicd-svg .edge.cut { stroke: var(--critical); stroke-dasharray: 3 3; }
        .cicd-svg .trig { fill: var(--lab-accent); }
        .cicd-svg .trig.idle { fill: var(--ink-3); }
        .cicd-svg .gate { fill: none; stroke: var(--warning); stroke-width: 1.5; }
      `}</style>
    </Lab>
  )
}

/* 管線：觸發點 + 5 個節點 + 箭頭。寬時水平排、窄（手機）時改直排，文字才讀得到 */
function PipelineSvg({ statuses, step, feature }) {
  const ref = useRef(null)
  const width = useWidth(ref, 600)
  const vertical = width < 460
  const W = vertical ? 150 : 100, H = 42, GAP = vertical ? 30 : 24
  // 每個節點的左上角；水平：沿 x 排；直排：沿 y 排
  const pos = (k) => vertical ? { x: 30, y: 44 + k * (H + GAP) } : { x: 52 + k * (W + GAP), y: 40 }
  const trig = vertical ? { cx: 30 + W / 2, cy: 14 } : { cx: 22, cy: 40 + H / 2 }
  const vb = vertical ? `0 0 320 ${44 + 5 * (H + GAP) + 6}` : '0 0 660 140'
  const done = (s) => s === 'done'
  const first = pos(0)
  const label = `管線狀態：${statuses.map((s, i) => `${STAGES[i].name} ${STATUS_TEXT[s]}`).join('、')}`
  return (
    <div ref={ref}>
      <svg className="cicd-svg" viewBox={vb} role="img" aria-label={label}>
        <defs>
          <marker id="cicd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0.5 L7 4 L0 7.5 Z" fill="var(--ink-3)" />
          </marker>
        </defs>
        {/* 觸發點 */}
        <circle cx={trig.cx} cy={trig.cy} r="8" className={`trig${step === 0 ? ' svg-pulse' : ''}`} />
        <text x={vertical ? trig.cx + 16 : 8} y={vertical ? trig.cy + 4 : trig.cy - H / 2 - 12}
              textAnchor="start" className="name">push {feature ? 'feature/x' : 'main'}</text>
        {vertical
          ? <line x1={trig.cx} y1={trig.cy + 9} x2={trig.cx} y2={first.y - 2} className={`edge${step > 0 ? ' on' : ''}`} markerEnd="url(#cicd-arrow)" />
          : <line x1={trig.cx + 9} y1={trig.cy} x2={first.x - 2} y2={trig.cy} className={`edge${step > 0 ? ' on' : ''}`} markerEnd="url(#cicd-arrow)" />}

        {STAGES.map((s, k) => {
          const { x, y } = pos(k)
          const st = statuses[k]
          const nxt = statuses[k + 1]
          const edgeCls = st === 'failed' ? 'cut' : done(st) && (nxt === 'running' || nxt === 'waiting' || done(nxt)) ? 'on' : ''
          const gate = vertical ? { x: x - 18, y: y + H / 2 - 6 } : { x: x + W / 2 - 6, y: y - 22 }
          return (
            <g key={s.key} className={`g ${st}`}>
              <rect x={x} y={y} width={W} height={H} rx="6" className={`node ${st}${st === 'running' || st === 'waiting' ? ' svg-pulse' : ''}`} />
              <text x={x + W / 2} y={y + H / 2 + 4} textAnchor="middle" className="name">{s.name}</text>
              <text x={vertical ? x + W + 12 : x + W / 2} y={vertical ? y + H / 2 + 4 : y + H + 20}
                    textAnchor={vertical ? 'start' : 'middle'} className={`st ${st}`}>{STATUS_TEXT[st]}</text>
              {k === 4 && st !== 'off' && (
                <g className="gate" aria-hidden="true">
                  <rect x={gate.x} y={gate.y} width="12" height="9" rx="1.5" />
                  <path d={`M${gate.x + 2.5} ${gate.y} v-3 a3.5 3.5 0 0 1 7 0 v3`} />
                </g>
              )}
              {k < 4 && (vertical
                ? <line x1={x + W / 2} y1={y + H + 2} x2={x + W / 2} y2={y + H + GAP - 2} className={`edge ${edgeCls}`} markerEnd="url(#cicd-arrow)" />
                : <line x1={x + W + 2} y1={y + H / 2} x2={x + W + GAP - 2} y2={y + H / 2} className={`edge ${edgeCls}`} markerEnd="url(#cicd-arrow)" />)}
            </g>
          )
        })}
        {!vertical && (
          <text x="330" y="132" textAnchor="middle" className="svg-text small">
            {feature ? 'if / rules 判定不是 main → 部署階段直接不執行' : 'staging 自動部署；prod 前面有一道人工核准（鎖頭）'}
          </text>
        )}
      </svg>
    </div>
  )
}
