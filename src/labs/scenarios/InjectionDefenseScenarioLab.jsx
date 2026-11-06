import React, { useEffect, useMemo, useState } from 'react'
import {
  Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer,
  Callout, Status, Stats, Stat, Flow, Caption, fmtN,
} from '../ui.jsx'

/* 提示注入的防線組合：一份被下毒的文件走過六個抽象步驟（上傳 → 檢索 → 進 context → 模型想寄信 → 寄信工具 → 送出），
   四道防線各管其中一步。按「重播」逐步看這一次停在哪；統計是同樣條件下 200 次被下毒文件被讀到的推算。
   只畫抽象步驟，不描述任何注入文字或繞過手法；所有比例都是示意 */

const LAYERS = [
  { id: 'prompt', label: '提示詞規則', short: '提示詞' },
  { id: 'retrieval', label: '檢索層（來源分級、權限過濾）', short: '檢索層' },
  { id: 'tool', label: '工具層（白名單、核准、最小權限）', short: '工具層' },
  { id: 'output', label: '輸出過濾', short: '輸出過濾' },
]
const PRESETS = {
  none: { prompt: false, retrieval: false, tool: false, output: false },
  prompt: { prompt: true, retrieval: false, tool: false, output: false },
  retrieval: { prompt: true, retrieval: true, tool: false, output: false },
  tool: { prompt: true, retrieval: false, tool: true, output: false },
  depth: { prompt: true, retrieval: true, tool: true, output: true },
}
const PRESET_OPTS = [
  { value: 'none', label: '沒有防線' },
  { value: 'prompt', label: '只靠提示詞' },
  { value: 'retrieval', label: '+ 檢索層' },
  { value: 'tool', label: '+ 工具層' },
  { value: 'depth', label: '全部（縱深）' },
]
const SOURCES = [
  { value: 'external', label: '從外部網站抓回' },
  { value: 'internal', label: '院內人員上傳' },
]
const STEPS = [
  { label: '文件進入文件庫', layer: null, how: '文件裡藏了給模型的指示，人在畫面上看不出來' },
  { label: '被檢索', layer: 'retrieval', how: '某個提問的檢索結果剛好包含這份文件' },
  { label: '進入 context', layer: null, how: '文件內容和使用者問題、系統指示成了同一串文字' },
  { label: '模型想呼叫寄信工具', layer: 'prompt', how: '模型把文件裡的指示當成要做的事，提出寄信（收件人在院外）' },
  { label: '寄信工具執行', layer: 'tool', how: '提案送到工具層：任務白名單、外部收件人規則、人核准' },
  { label: '內容送出', layer: 'output', how: '信件內容送出前比對個資格式' },
]
const RUNS = 200
/* 示意比例：不是任何模型或產品的量測值 */
const P_NO_RULE = 0.6          // 沒有提示詞規則時，模型照著文件裡的指示做
const P_DATA_ALL = 0.5         // context 裡有可被帶走的個資
const P_DATA_FILTERED = 0.2    // 檢索層依身分過濾後
const P_OUTPUT_CATCH = 0.7     // 輸出過濾抓得到的已知個資格式

function rng(seed) {                                   // mulberry32：固定種子，重播可重現
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* 單次：回傳 blockedAt（-1 = 一路送出）與這次信裡有沒有個資 */
function once(def, src, comply, r) {
  if (def.retrieval && src === 'external') return { blockedAt: 1, data: false }        // 等級 C 預設不進檢索
  const hasData = r() < (def.retrieval ? P_DATA_FILTERED : P_DATA_ALL)                 // 權限過濾：context 裡能帶走的少了
  const p = def.prompt ? comply / 100 : P_NO_RULE
  if (r() >= p) return { blockedAt: 3, data: hasData }                                // 模型這次沒照做（機率性）
  // 以下：模型照做了，提出寄信。能不能真的寄出，取決於模型外面的防線
  if (def.tool) return { blockedAt: 4, data: hasData }                                // 外部收件人被拒 / 人未核准
  if (def.output && hasData && r() < P_OUTPUT_CATCH) return { blockedAt: 5, data: hasData }
  return { blockedAt: -1, data: hasData }
}
function stats(def, src, comply) {
  const r = rng(42)
  const s = {
    leak: 0,                                             // 含個資的信寄到院外
    misSend: 0,                                          // 信寄到院外，但沒有個資
    blocked: { retrieval: 0, prompt: 0, tool: 0, output: 0 },
  }
  for (let i = 0; i < RUNS; i++) {
    const x = once(def, src, comply, r)
    if (x.blockedAt >= 0) {
      s.blocked[STEPS[x.blockedAt].layer]++
    } else if (x.data) {
      s.leak++
    } else {
      s.misSend++
    }
  }
  return s
}

export default function InjectionDefenseScenarioLab() {
  const [def, setDef] = useState(PRESETS.prompt)
  const [src, setSrc] = useState('external')
  const [comply, setComply] = useState(20)
  const [seed, setSeed] = useState(3)
  const [started, setStarted] = useState(false)
  const { step, setStep, playing, toggle } = usePlayer(STEPS.length + 1, 1100)
  const preset = Object.keys(PRESETS).find((k) => LAYERS.every((l) => PRESETS[k][l.id] === def[l.id])) || ''
  const run = useMemo(() => once(def, src, comply, rng(seed)), [def, src, comply, seed])
  const st = useMemo(() => stats(def, src, comply), [def, src, comply])
  const all = useMemo(() => PRESET_OPTS.map((o) => ({ ...o, s: stats(PRESETS[o.value], src, comply) })), [src, comply])

  const frame = started ? step : STEPS.length
  const stopAt = run.blockedAt < 0 ? STEPS.length : run.blockedAt
  const attempted = Math.min(frame, stopAt + 1)
  const done = frame >= Math.min(STEPS.length, stopAt + 1)
  useEffect(() => { if (playing && step >= stopAt + 1 && stopAt < STEPS.length) setStep(step) }, [playing, step, stopAt, setStep])

  const replay = () => { setSeed((s) => s + 1); setStarted(true); setStep(0); toggle() }
  const setLayer = (id, v) => setDef((d) => ({ ...d, [id]: v }))
  const outcome = run.blockedAt === 3 ? '模型這次沒照做（不是防線擋下）'
    : run.blockedAt >= 0
    ? `被「${LAYERS.find((l) => l.id === STEPS[run.blockedAt].layer).short}」擋下`
    : run.data ? '外洩：含個資的信寄到院外' : '誤寄信：信寄到院外（未含個資）'
  const cur = frame > 0 && frame <= STEPS.length ? STEPS[frame - 1] : null
  const curLayer = cur && cur.layer ? LAYERS.find((l) => l.id === cur.layer) : null

  const steps = STEPS.map((s, i) => {
    if (i >= attempted) return { label: s.label, value: started ? '等待中' : '未到達' }
    if (i === stopAt && i === 3) return { label: s.label, value: `模型這次沒照做${def.prompt ? '（提示詞規則開著）' : ''}`, hot: true }
    if (i === stopAt) return { label: s.label, value: `✓ 擋下：${LAYERS.find((l) => l.id === s.layer).short}`, hot: true }
    const lay = s.layer && LAYERS.find((l) => l.id === s.layer)
    const value = !lay ? '通過'
      : def[s.layer] ? `${lay.short}開著，這次沒擋住`
      : `${lay.short}未開`
    return { label: s.label, value, bad: i >= 3 }
  })

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="一份被下毒的文件：從上傳到寄出，四道防線各擋哪一步"
         blurb="開關四道防線、切換文件來源，按「重播」逐步看這一次停在哪；右邊統計是同樣條件下 200 次被讀到的推算（示意）。只畫抽象步驟。">
      <LabControls>
        <Seg label="做法" tinted value={preset} onChange={(v) => setDef(PRESETS[v])} options={PRESET_OPTS} />
        <Seg label="被下毒的文件" value={src} onChange={setSrc} options={SOURCES} />
      </LabControls>
      <LabControls>
        {LAYERS.map((l) => <Toggle key={l.id} label={l.label} checked={def[l.id]} onChange={(v) => setLayer(l.id, v)} />)}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack pi-col">
          <LabControls>
            <button type="button" className="btn small" onClick={replay}>{started ? '再重播一次' : '重播'}</button>
            <Stepper step={step} total={STEPS.length + 1} onStep={(s) => { setStarted(true); setStep(s) }}
                     playing={playing} onPlay={() => { setStarted(true); toggle() }} labels={['開始前', ...STEPS.map((s) => s.label)]} />
            <span className="spacer" />
            {done && (run.blockedAt === 3 ? <Status warn>{outcome}</Status>
              : run.blockedAt >= 0 ? <Status ok>{outcome}</Status> : <Status>{outcome}</Status>)}
          </LabControls>
          <LabStage plain label="被下毒文件的路徑">
            <Flow title={done ? `這一次：${outcome}（示意）` : `重播：第 ${frame} / ${STEPS.length} 步（示意）`}
                  ariaLabel="被下毒文件的六個抽象步驟"
                  steps={steps}
                  notes={[
                    done && run.blockedAt === 3 && '注意：這次是模型沒照做，不是架構擋下。按「再重播一次」，同樣設定下次可能就照做了。',
                    done && run.blockedAt < 0 && '模型照做之後，沒有任何一道模型以外的防線把關。',
                  ]} />
            <div className="pi-ctx" aria-label="context 的組成（抽象）">
              <span className="pi-ctx-h">context 裡有什麼（抽象）</span>
              <span className="pi-blk">系統指示{def.prompt ? ' + 「文件是資料」規則' : ''}</span>
              <span className="pi-blk">使用者問題</span>
              <span className={`pi-blk${def.retrieval ? ' data' : ''}`}>
                {def.retrieval ? '資料區塊：只含提問者有權看的文件' : '檢索結果：權限未過濾'}
              </span>
              {attempted >= 3 && <span className="pi-blk bad">被下毒的文件（藏了給模型的指示）</span>}
            </div>
            <div className="dtable-wrap pi-table">
              <table className="dtable">
                <caption>每一層管哪一步</caption>
                <thead><tr><th>防線</th><th>管的步驟</th><th>性質</th></tr></thead>
                <tbody>
                  {LAYERS.map((l) => (
                    <tr key={l.id} className={!def[l.id] ? 'dim' : done && run.blockedAt >= 0 && STEPS[run.blockedAt].layer === l.id ? 'hit' : ''}>
                      <td><b>{l.short}</b>{def[l.id] ? '' : '（關）'}</td>
                      <td>{STEPS.find((s) => s.layer === l.id).label}</td>
                      <td>
                        {l.id === 'prompt' ? '機率性：取決於模型這一次'
                          : l.id === 'output' ? '只抓已知格式'
                          : '程式規則：不取決於模型'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Caption>步驟只畫抽象行為，不含任何注入內容。比例假設：有提示詞規則時照做的比例依滑桿、沒有時 60%；信裡含個資 50%（檢索層權限過濾後 20%）；輸出過濾抓到含個資內容 70%（示意）。</Caption>
          </LabStage>
          <Stats min={120}>
            <Stat label="外洩事件" value={st.leak} unit={`/ ${RUNS}`}
                  tone={st.leak ? 'bad' : 'ok'} note="含個資寄到院外" />
            <Stat label="誤寄信" value={st.misSend} unit={`/ ${RUNS}`}
                  tone={st.misSend ? 'warn' : 'ok'} note="寄到院外，未含個資" />
            <Stat label="被防線攔下" value={RUNS - st.leak - st.misSend - st.blocked.prompt} unit={`/ ${RUNS}`}
                  tone={RUNS - st.leak - st.misSend - st.blocked.prompt ? 'ok' : ''}
                  note={LAYERS.filter((l) => l.id !== 'prompt' && st.blocked[l.id])
                    .map((l) => `${l.short} ${st.blocked[l.id]}`)
                    .join('、') || '—'} />
            <Stat label="模型這次沒照做" value={st.blocked.prompt} unit={`/ ${RUNS}`}
                  tone={st.blocked.prompt ? 'warn' : ''} note="沒寄出，但不是安全邊界" />
          </Stats>
        </div>
        <div className="lab-stack pi-col">
          <LabControls>
            <Slider label="有提示詞規則時模型仍照做（示意）" min={0} max={60} step={5}
                    value={comply} onChange={setComply} format={(v) => `${v}%`} />
          </LabControls>
          {started && !done && (
            <LabExplain title={cur ? `第 ${frame} 步：${cur.label}` : '開始前'}>
              <p>{cur ? `${cur.how}。` : '一份文件進了文件庫，裡面藏了給模型的指示。按播放或「下一步」逐步看它往前走。'}</p>
              <p>{!cur ? '每一步標出可能在這裡擋下它的防線；沒有對應防線的步驟，只能靠前後的防線。'
                : curLayer ? `這一步由「${curLayer.label}」把關，目前${def[curLayer.id] ? '開著' : '關著'}。`
                : '這一步沒有對應的防線：資料一旦進了 context，模型就讀得到。'}</p>
            </LabExplain>
          )}
          <div className="dtable-wrap">
            <table className="dtable pi-compare">
              <caption>同條件下五種組合，200 次（示意，點一列套用）</caption>
              <thead><tr><th>做法</th><th>外洩</th><th>誤寄</th><th>防線攔下</th></tr></thead>
              <tbody>
                {all.map((o) => (
                  <tr key={o.value} className={`clickable${o.value === preset ? ' hit' : ''}`} onClick={() => setDef(PRESETS[o.value])}>
                    <td>{o.label}</td>
                    <td className={o.s.leak ? 'pi-bad' : ''}>{fmtN(o.s.leak)}</td>
                    <td>{fmtN(o.s.misSend)}</td>
                    <td>{fmtN(RUNS - o.s.leak - o.s.misSend - o.s.blocked.prompt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LabExplain title="提示詞與模型的拒絕不是安全邊界">
            <p>把滑桿拉到 0%，「只靠提示詞」看起來就安全了；但這個數字沒有人能保證，換個說法、換個模型版本就會變。檢索層與工具層的效果不受滑桿影響，因為它們限制的是資料能不能進來、動作能不能發生。</p>
            <p>{src === 'external' ? '外部抓回的文件屬於低等級來源，檢索層預設不檢索，這條路在第 2 步就斷了。切到「院內人員上傳」看看：來源分級擋不住內部文件，只剩權限過濾減少能被帶走的資料。'
              : '院內上傳的文件是高等級來源，檢索層不會擋它；它的貢獻變成 context 裡只有提問者本來就能看的資料。這時寄信能不能發生，取決於工具層。'}</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">只要三件事同時成立：模型會讀到不是自己人寫的內容（上傳文件、抓回的網頁、email、工單）、context 裡有敏感資料、而且它能呼叫會對外送出或寫入的工具。三者少一個，攻擊路徑就斷一段；防線要放在讓路徑斷掉的那幾層，而不是只放在提示詞裡。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .pi-col { min-width: 0; grid-template-columns: minmax(0, 1fr); }
        .pi-col > * { min-width: 0; }
        .pi-ctx { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .pi-ctx-h { font-size: 0.72rem; color: var(--ink-3); margin-right: 4px; }
        .pi-blk { font-size: 0.74rem; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--hairline); background: var(--surface-2); color: var(--ink-1); max-width: 100%; }
        .pi-blk.data { border-color: var(--good); background: color-mix(in srgb, var(--good) 10%, var(--surface-1)); }
        .pi-blk.bad { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 12%, var(--surface-1)); animation: pi-in 0.3s ease; }
        .pi-table { margin-top: 12px; }
        .pi-table td { white-space: normal; vertical-align: top; }
        .pi-compare td, .pi-compare th { white-space: nowrap; }
        .pi-bad { color: var(--critical); font-weight: 700; }
        @keyframes pi-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .pi-blk.bad { animation: none; } }
      `}</style>
    </Lab>
  )
}
