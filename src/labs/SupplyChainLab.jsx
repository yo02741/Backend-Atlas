import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Callout, Stats, Stat } from './ui.jsx'

/* ============================================================
   依賴與供應鏈安全：一個依賴出問題時，哪一道防線攔得住
   - 一棵示意的依賴樹（shop-api → 直接依賴 → 間接依賴）＋四種事件 × 五道防線
   - 按「安裝依賴」逐步播放：解析版本 → 來源與雜湊 → 漏洞掃描 → 安裝
   - 所有套件名稱、版本、漏洞編號、服務名稱都是虛構的（示意）
   ============================================================ */

const TREE = [
  { name: 'shop-api', ver: '1.8.0', depth: 0, kind: '應用程式' },
  { name: 'webkit-lite', ver: '3.2.0', depth: 1, kind: '直接' },
  { name: 'fastlib', ver: '2.1.4', range: '^2.1.0', depth: 2, kind: '間接' },
  { name: 'tinyparse', ver: '1.0.9', depth: 2, kind: '間接' },
  { name: 'dbdriver-x', ver: '5.0.1', depth: 1, kind: '直接' },
  { name: 'poolman', ver: '0.8.2', range: '^0.8.0', depth: 2, kind: '間接' },
  { name: 'logfmt-z', ver: '1.4.0', depth: 1, kind: '直接' },
]
const FAKE = { name: 'fast1ib', ver: '0.0.3', range: '剛加進宣告', depth: 1, kind: '直接・新增' }
const ALL = ['shop-api', 'billing-worker', 'notify-svc']
const USED_BY = { fastlib: ['shop-api', 'notify-svc'], tinyparse: ['shop-api', 'billing-worker'], fast1ib: ['shop-api'], poolman: ALL }

const EVENTS = {
  vuln: { label: '間接依賴被發現漏洞', pkg: 'tinyparse', bad: '有漏洞的版本上線', ok: '建置被擋下', chip: '已安裝（有已知漏洞）',
    short: '有漏洞',
    blurb: 'webkit-lite 帶進來的間接依賴 tinyparse 1.0.9 被公布了一個漏洞（DEMO-2026-0001）。版本沒有變、檔案沒有被換，問題出在「我以為的東西本身」。',
    works: '攔得住的是**漏洞掃描**：拿確切的版本去比對漏洞資料庫。lock 檔、鎖定安裝、延遲採用、限制來源都不會攔，它們只會忠實地把同一個版本裝回來。SBOM 回答的是下一個問題：還有哪些服務也在用它。' },
  takeover: { label: '套件被接管、發布惡意新版', pkg: 'fastlib', bad: '惡意版本被裝進來', ok: '惡意版本沒有裝進來', chip: '已安裝（惡意版本）',
    short: '被接管',
    blurb: 'fastlib 維護者的帳號被接管，昨天發布了 2.1.5，安裝腳本會讀取環境變數並送到外部伺服器。專案的依賴宣告寫的是範圍 `^2.1.0`。',
    works: '攔得住的是 **lock 檔＋CI 鎖定安裝**（不重新解析，就不會選到新版）與延遲採用（新版本先等幾天）。漏洞掃描通常來不及，剛發布的惡意版本還沒有紀錄；限制來源也沒用，名稱與來源都是對的。' },
  typo: { label: '名稱相近的假套件', pkg: 'fast1ib', bad: '假套件被裝進來', ok: '假套件沒有裝進來', chip: '已安裝（假套件）',
    short: '假套件',
    blurb: '有人新增依賴時把 `fastlib` 打成 `fast1ib`（第五個字元是數字 1），這叫 typosquatting。公開套件庫上確實有這個名稱，是兩天前才發布的假套件。',
    works: '攔得住的是**限制套件來源**（允許清單裡沒有這個名稱）；延遲採用只在假套件還很新時有效。lock 檔與鎖定安裝攔不住：lock 檔防的是「之後裝到不一樣的東西」，不防第一次就鎖進惡意版本。新增依賴的那一刻才是審查點。' },
  nolock: { label: 'lock 檔沒進版控', pkg: 'poolman', bad: '每次裝到不同版本', ok: '每次裝到相同版本', chip: '已安裝（和上週五不同）',
    short: '沒 lock 檔',
    blurb: 'poolman 的宣告是範圍 `^0.8.0`，解析結果沒有被記錄下來。上週五裝到 0.8.2；週末發布了 0.8.3（不是惡意版本），今天同一個 commit 裝到的就不一樣了。',
    works: '解法是 **lock 檔提交進版控，而且 CI 用鎖定安裝**，兩個都要。只有 lock 檔、CI 卻重新解析，裝到的仍然不是 lock 檔的版本。延遲採用只是把變動延後幾天。' },
}
const ORDER = ['vuln', 'takeover', 'typo', 'nolock']
const STAGES = ['解析版本', '來源與雜湊', '漏洞掃描', '安裝']
const BADGE = { block: '攔下', bad: '出事', warn: '注意', good: 'OK', skip: '略過', '': '通過' }
const SKIP = ['skip', '前面已經停下，沒有走到這一步。']
const NO_SCAN = ['', '沒有掃描。']
/* 防線 × 事件：1 攔得住、2 有條件或只是延後、0 攔不住（欄位順序同 ORDER） */
const MATRIX = [
  ['lock 檔＋CI 鎖定安裝', [0, 1, 0, 1]],
  ['漏洞掃描', [1, 0, 0, 0]],
  ['延遲採用新版本', [0, 1, 2, 2]],
  ['限制套件來源', [0, 0, 1, 0]],
]
const MARK = ['—', '✓', '△']

/* 依事件與防線推出四個階段各發生什麼：回傳 { st: [[tone, text] × 4], outcome, by, ver } */
function simulate(ev, d) {
  const locked = d.lock && d.ci
  if (d.ci && !d.lock) {
    return { outcome: 'fail', by: 'CI 鎖定安裝（沒有 lock 檔可照）', ver: null,
      st: [['block', '鎖定安裝要照 lock 檔裝，repo 裡卻沒有 lock 檔 → 安裝直接失敗。至少不會悄悄裝到別的版本；把 lock 檔提交進版控才是解法。'], SKIP, SKIP, SKIP] }
  }
  const how = locked ? '照 lock 檔安裝' : d.lock ? 'lock 檔在 repo 裡，但 CI 沒用鎖定安裝，重新解析了版本範圍' : '沒有 lock 檔，CI 重新解析版本範圍'
  const src = d.registry ? '套件名稱在允許清單內，從指定的來源下載。' : '沒有限制來源，直接從公開套件庫下載。'
  const hash = locked ? '下載後算出的 SHA-256 與 lock 檔記錄的相符。' : '沒有照 lock 檔安裝，沒有雜湊可以比對。'

  if (ev === 'vuln') {
    return { outcome: d.scan ? 'blocked' : 'bad', by: d.scan ? '漏洞掃描' : null, ver: '1.0.9', st: [
      ['', `${how}，得到 tinyparse 1.0.9。webkit-lite 3.2.0 指定的就是這一版，怎麼解析都一樣。`],
      ['', `${src}${hash}檔案就是原本那個檔案，沒有被換過。`],
      d.scan ? ['block', '拿版本去比對漏洞資料庫：DEMO-2026-0001（高風險）影響 1.0.0 以上、1.0.12 之前的 tinyparse，1.0.9 落在範圍內，而且已經有修正版 → 讓建置失敗。'] : ['', '沒有掃描，沒有人知道 1.0.9 有公開的漏洞。'],
      d.scan ? ['skip', '建置停在掃描。修正方式是把 webkit-lite 升到改用 tinyparse 1.0.12 的版本；已經上線的服務在重新部署之前，跑的仍是 1.0.9。']
        : ['bad', 'tinyparse 1.0.9 照常裝進來、照常部署。lock 檔與雜湊回答的是「我裝的是不是我以為的東西」，不是「我以為的東西本身有沒有問題」。'],
    ] }
  }
  if (ev === 'takeover') {
    const by = locked ? 'lock 檔＋CI 鎖定安裝' : d.delay ? '延遲採用新版本' : null
    const ver = by ? '2.1.4' : '2.1.5'
    return { outcome: by ? 'blocked' : 'bad', by, ver, st: [
      locked ? ['block', '照 lock 檔安裝：fastlib 2.1.4。昨天發布的 2.1.5 不在 lock 檔裡，不會被選中。']
        : d.delay ? ['block', `${how}。2.1.5 發布才 1 天，還在 7 天的觀察期內，被排除在外 → 選到 2.1.4。惡意版本通常在這段時間內被發現並下架。`]
        : ['warn', `${how}：\`^2.1.0\` 解析到最新的 2.1.5（昨天發布）。`],
      ['', `${src}${hash}${by ? '' : '套件名稱與來源都是對的，有問題的是新版本的內容。'}`],
      !d.scan ? NO_SCAN : ['', by ? 'fastlib 2.1.4 沒有已知漏洞，掃描通過。' : '漏洞資料庫還沒有 fastlib 2.1.5 的紀錄，掃描通過。剛發布的惡意版本通常還沒被回報。'],
      by ? ['good', '裝進來的是 fastlib 2.1.4，和上一次建置相同。']
        : ['bad', 'fastlib 2.1.5 裝進來，安裝腳本在 CI 裡執行，讀得到環境變數（裡面有部署用的金鑰）。沒有人改過任何一行程式碼。'],
    ] }
  }
  if (ev === 'typo') {
    if (d.delay) {
      return { outcome: 'blocked', by: '延遲採用新版本', ver: null, st: [
        ['block', 'fast1ib 唯一的版本 0.0.3 發布才 2 天，還在觀察期內 → 解析不到可用的版本，安裝失敗。假套件若已經存在一段時間，這一道就攔不住。'], SKIP, SKIP, SKIP] }
    }
    const s1 = ['', locked ? '照 lock 檔安裝：fast1ib 0.0.3。lock 檔是新增依賴的人重新產生的，假套件連同雜湊一起被鎖了進去。' : `${how}：fast1ib 解析到 0.0.3。`]
    if (d.registry) {
      return { outcome: 'blocked', by: '限制套件來源', ver: null, st: [s1, ['block', 'fast1ib 不在允許清單內，指定的來源沒有這個名稱 → 下載被拒，安裝失敗。'], SKIP, SKIP] }
    }
    return { outcome: 'bad', by: null, ver: '0.0.3', st: [s1,
      ['', `公開套件庫上確實有 fast1ib 這個名稱，下載成功。${locked ? 'SHA-256 與 lock 檔相符：lock 檔忠實地鎖住了假套件。' : ''}`],
      !d.scan ? NO_SCAN : ['', '漏洞資料庫比對的是已知漏洞；fast1ib 還沒被回報，掃描通過。'],
      ['bad', 'fast1ib 0.0.3 裝進來，和其他依賴一樣，在程式的權限下執行。'],
    ] }
  }
  // nolock：版本飄移
  const later = !locked && d.delay
  const ver = locked || later ? '0.8.2' : '0.8.3'
  return { outcome: locked ? 'blocked' : later ? 'later' : 'bad', by: locked ? 'lock 檔＋CI 鎖定安裝' : null, ver, st: [
    locked ? ['block', '照 lock 檔安裝：poolman 0.8.2。週末發布的 0.8.3 不在 lock 檔裡；每一次、每一台機器裝到的都相同。']
      : later ? ['warn', `${how}。0.8.3 還在觀察期內，這次仍然選到 0.8.2。`]
      : ['warn', `${how}：\`^0.8.0\` 上週五解析到 0.8.2，今天解析到 0.8.3。`],
    ['', `${src}${hash}`],
    !d.scan ? NO_SCAN : ['', `poolman ${ver} 沒有已知漏洞，掃描通過。版本不固定不是漏洞，掃描看不到這件事。`],
    locked ? ['good', '裝進來的是 poolman 0.8.2，建置可以重現。']
      : later ? ['warn', '這次和上週五相同，但只是延後：宣告寫的仍是範圍，觀察期一過，同一個 commit 又會裝到不同的版本。']
      : ['bad', '同一個 commit，上週五與今天的建置內容不同。出問題時分不出是程式碼還是依賴造成的，也重現不了當時的環境。'],
  ] }
}

export default function SupplyChainLab() {
  const [ev, setEv] = useState('takeover')
  const [d, setD] = useState({ lock: false, ci: false, scan: false, delay: false, registry: false, sbom: false })
  const { step, setStep, playing, toggle } = usePlayer(5, 1500)
  const on = (k) => (v) => setD((s) => ({ ...s, [k]: v }))

  const E = EVENTS[ev]
  const res = simulate(ev, d)
  const blockAt = res.st.findIndex((s) => s[0] === 'block')
  const done = step === 4
  const users = USED_BY[E.pkg]
  const inSbom = ev === 'typo' && res.outcome !== 'bad' ? [] : users   // 假套件沒裝進來，產物裡就沒有它
  const affected = ev === 'vuln' || res.outcome === 'bad' || res.outcome === 'later' ? users.length : 0
  const result = { bad: [E.bad, 'bad'], blocked: [E.ok, 'ok'], fail: ['安裝失敗', 'warn'], later: ['這次相同，只是延後', 'warn'] }[res.outcome]
  const chip = step === 0 ? ['', '待安裝'] : blockAt >= 0 && step > blockAt ? ['ok', `攔下：${res.by}`] : !done ? ['', '安裝中…']
    : res.outcome === 'bad' ? ['bad', E.chip] : res.outcome === 'later' ? ['warn', '已安裝（這次沒變）'] : ['ok', '已安裝']

  const rows = ev === 'typo' ? [...TREE, FAKE] : TREE
  const isLast = (i) => { for (let j = i + 1; j < rows.length; j++) { if (rows[j].depth < rows[i].depth) return true; if (rows[j].depth === rows[i].depth) return false } return true }
  const parentLast = (i) => { for (let j = i - 1; j >= 0; j--) if (rows[j].depth === 1) return isLast(j); return true }
  const prefix = (i) => (rows[i].depth === 0 ? '' : (rows[i].depth === 2 ? (parentLast(i) ? '   ' : '│  ') : '') + (isLast(i) ? '└─ ' : '├─ '))

  return (
    <Lab className="sc" accent="red" kicker="SECURITY LAB" title="供應鏈：一個依賴出問題時，哪一道防線攔得住"
         blurb="自己寫的程式碼只佔最終執行內容的一小部分，其餘來自依賴，而且都在同樣的權限下執行。各種事件下 CI 裝進了什麼、在哪一道防線被攔下。">
      <LabControls>
        <Seg label="事件" tinted value={ev} onChange={(v) => { setEv(v); setStep(0) }} options={ORDER.map((k) => ({ value: k, label: EVENTS[k].label }))} />
        <Toggle label="lock 檔進版控（版本＋雜湊）" checked={d.lock} onChange={on('lock')} />
        <Toggle label="CI 用鎖定安裝" checked={d.ci} onChange={on('ci')} />
        <Toggle label="漏洞掃描" checked={d.scan} onChange={on('scan')} />
        <Toggle label="延遲採用新版本" checked={d.delay} onChange={on('delay')} />
        <Toggle label="限制套件來源" checked={d.registry} onChange={on('registry')} />
        <Toggle label="建置時產生 SBOM" checked={d.sbom} onChange={on('sbom')} />
        <span className="spacer" />
        <button type="button" className="btn small sc-run" onClick={() => { setStep(0); toggle() }}>安裝依賴</button>
        <Stepper step={step} total={5} onStep={setStep} playing={playing} onPlay={toggle} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="shop-api 的依賴樹與這次安裝的過程" caption="套件、版本、漏洞編號與服務名稱全部虛構（示意）">
            <div className="sc-head">依賴樹（shop-api）</div>
            <ul className="sc-tree">
              {rows.map((r, i) => {
                const hot = r.name === E.pkg
                const ver = !hot ? r.ver : step === 0 ? (r.range || r.ver) : (res.ver || '—')
                const verBad = hot && step > 0 && res.outcome === 'bad'
                return (
                  <li key={r.name} className={`sc-row${hot ? ' hot' : ''}`}>
                    <span className="sc-name"><i aria-hidden="true">{prefix(i)}</i>{r.name}</span>
                    <span className={`sc-ver${verBad ? ' bad' : ''}`}>{ver}</span>
                    <span className="tag">{r.kind}</span>
                    {hot && <span className={`sc-chip ${chip[0]}`}>{chip[1]}</span>}
                  </li>
                )
              })}
            </ul>

            <div className="sc-head">這次安裝（CI）</div>
            <ol className="sc-steps">
              {STAGES.map((name, i) => {
                const shown = step > i
                const [tone, text] = res.st[i]
                return (
                  <li key={name} className={`sc-step${shown ? ` ${tone || 'pass'}` : ' todo'}${step === i + 1 ? ' now' : ''}`}>
                    <span className="sc-badge">{shown ? BADGE[tone] : i + 1}</span>
                    <span className="sc-text"><b>{name}</b>{shown ? <Md>{`　${text}`}</Md> : <span className="muted">　尚未執行</span>}</span>
                  </li>
                )
              })}
            </ol>
          </LabStage>

          <Stats min={150} className="sc-stats">
            <Stat label="這次安裝的結果" value={result[0]} tone={result[1]} note={done ? '' : '尚未安裝'} />
            <Stat label="被攔下的位置" value={res.by || '沒有攔下'} tone={res.by ? '' : 'bad'} note={res.by && blockAt >= 0 ? `在「${STAGES[blockAt]}」這一步` : ''} />
            <Stat label="受影響的服務數" value={`${affected} / ${ALL.length}`} tone={affected ? (res.by || res.outcome === 'later' ? 'warn' : 'bad') : 'ok'}
                  note={ev === 'vuln' ? (res.by ? '已上線的要升級後重新部署' : '沒有人知道') : affected ? '假設每個服務的防線都相同' : `沒有服務裝到${ev === 'nolock' ? '不同的版本' : '它'}`} />
            <Stat label={`SBOM：哪些服務用到 ${E.pkg}？`} value={d.sbom ? '答得出來' : '答不出來'} tone={d.sbom ? 'ok' : 'warn'}
                  note={d.sbom ? `搜尋每個產物的 SBOM：${inSbom.join('、') || '沒有服務用到'}` : `沒有清單，要逐一檢查 ${ALL.length} 個服務`} />
          </Stats>
        </div>

        <div className="lab-stack">
          <LabExplain title={E.label}>
            <p><Md>{E.blurb}</Md></p>
            <p><Md>{E.works}</Md></p>
            <p>可以把防線分成兩個問題：lock 檔與雜湊回答「我裝的是不是我以為的東西」，漏洞掃描與審查回答「我以為的東西本身有沒有問題」。SBOM 不攔任何東西，它的價值在事後查詢。</p>
          </LabExplain>
          <div className="dtable-wrap">
            <table className="dtable sc-matrix">
              <caption>哪一道防線攔得住哪一種事件</caption>
              <thead><tr><th>防線</th>{ORDER.map((k) => <th key={k} className={k === ev ? 'cur' : ''}>{EVENTS[k].short}</th>)}</tr></thead>
              <tbody>
                {MATRIX.map(([name, cells]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    {cells.map((c, i) => <td key={i} className={`sc-m${c}${ORDER[i] === ev ? ' cur' : ''}`}>{MARK[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sc-foot">△：延遲採用只在假套件還很新時有效；對沒有 lock 檔的版本變動只是延後。沒有哪一道防線涵蓋全部四種事件。</p>
          <Callout title="什麼時候會踩到">
            依賴宣告寫的是範圍、lock 檔沒提交，CI 每次重新解析；CI 有 lock 檔，Dockerfile 裡卻用沒鎖定的指令安裝；工具產生的 lock 檔 diff 很長，在 PR 裡被略過；新增依賴時從搜尋結果複製名稱，沒有核對拼寫與來源；漏洞掃描每次都有幾十項、沒有分級，大家開始忽略。
          </Callout>
          <Callout tone="good" title="CI 的嚴格模式長這樣">
            <code>uv sync --locked</code>、<code>npm ci</code>、<code>pnpm install --frozen-lockfile</code>、<code>pip install --require-hashes</code>：照 lock 檔安裝，和宣告不一致就失敗，而不是悄悄更新。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .sc-run { background: var(--lab-accent); border-color: var(--lab-accent); }
        .sc-head { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-3); margin-bottom: 6px; }
        .sc-tree { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 2px; }
        .sc-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; padding: 3px 8px; border-radius: var(--radius); border: 1px solid transparent; font-family: var(--mono); font-size: 0.8rem; color: var(--ink-1); transition: background 0.25s ease, border-color 0.25s ease; }
        .sc-row.hot { background: color-mix(in srgb, var(--lab-accent) 8%, transparent); border-color: color-mix(in srgb, var(--lab-accent) 45%, var(--hairline)); }
        .sc-name { white-space: pre; } .sc-name i { font-style: normal; color: var(--ink-3); }
        .sc-row.hot .sc-name { font-weight: 700; }
        .sc-ver { color: var(--ink-2); transition: color 0.25s ease; } .sc-ver.bad { color: var(--critical); font-weight: 700; }
        .sc-chip { margin-left: auto; font-family: var(--sans); font-size: 0.72rem; font-weight: 700; padding: 1px 9px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--ink-3); }
        .sc-chip.ok { color: var(--good); border-color: color-mix(in srgb, var(--good) 50%, transparent); }
        .sc-chip.bad { color: var(--critical); border-color: color-mix(in srgb, var(--critical) 50%, transparent); }
        .sc-chip.warn { color: var(--serious); border-color: color-mix(in srgb, var(--serious) 50%, transparent); }
        .sc-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        .sc-step { display: flex; gap: 10px; align-items: baseline; padding: 6px 8px; border-radius: var(--radius); border: 1px solid transparent; font-size: 0.82rem; line-height: 1.55; color: var(--ink-2); transition: opacity 0.25s ease, border-color 0.25s ease; }
        .sc-step.todo { opacity: 0.5; } .sc-step.skip { opacity: 0.7; }
        .sc-step.now { border-color: var(--hairline); background: var(--surface-1); }
        .sc-step b { color: var(--ink-1); }
        .sc-step code { font-family: var(--mono); font-size: 0.9em; background: var(--surface-2); padding: 0 4px; border-radius: 2px; color: var(--ink-1); }
        .sc-badge { flex-shrink: 0; min-width: 3.2em; text-align: center; font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--hairline); color: var(--ink-3); background: var(--surface-1); }
        .sc-step.block .sc-badge, .sc-step.good .sc-badge { color: var(--good); border-color: color-mix(in srgb, var(--good) 50%, transparent); }
        .sc-step.bad .sc-badge { color: var(--critical); border-color: color-mix(in srgb, var(--critical) 50%, transparent); }
        .sc-step.warn .sc-badge { color: var(--serious); border-color: color-mix(in srgb, var(--serious) 50%, transparent); }
        .sc-text { min-width: 0; overflow-wrap: anywhere; }
        .sc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .sc-matrix { font-family: var(--sans); }
        .sc-matrix th:not(:first-child), .sc-matrix td:not(:first-child) { text-align: center; transition: background 0.25s ease; }
        .sc-matrix .cur { background: color-mix(in srgb, var(--lab-accent) 12%, transparent); }
        .sc-matrix th.cur { color: var(--ink-1); }
        .sc-matrix .sc-m1 { color: var(--good); font-weight: 700; } .sc-matrix .sc-m2 { color: var(--serious); font-weight: 700; } .sc-matrix .sc-m0 { color: var(--ink-3); }
        .sc-foot { font-size: 0.74rem; color: var(--ink-3); line-height: 1.6; }
        .sc-stats .lab-stat .v { font-family: var(--sans); font-size: 0.95rem; line-height: 1.4; }
        .sc .callout code { font-family: var(--mono); font-size: 0.86em; }
      `}</style>
    </Lab>
  )
}

function Md({ children }) {
  return String(children).split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, i) => (
    s[0] === '`' ? <code key={i}>{s.slice(1, -1)}</code> : s.startsWith('**') ? <strong key={i}>{s.slice(2, -2)}</strong> : s))
}
