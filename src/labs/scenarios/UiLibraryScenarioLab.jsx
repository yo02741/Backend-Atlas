import React, { useEffect, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Status, Stats, Stat, Caption, Code } from '../ui.jsx'

/* 元件來源情境模擬器，兩個實驗：
   ① 工作量與 bundle：三種做法並排，設計稿差距與需要的元件改變後，各自要花多少人週、打包多大。全部是示意的估算模型。
   ② 升級一個大版本：一個虛構的元件庫「kit」從 v2 升到 v3，內部 class 改名。三種寫樣式的方式各自剩下多少設計稿的樣子。
      這部分的 CSS 真的套在畫面上，失效也是真的失效。 */

const APPROACHES = [
  { value: 'self', label: '自己做' },
  { value: 'library', label: '元件庫' },
  { value: 'headless', label: 'headless' },
]
const COMPS = [
  { name: '按鈕', behave: 0.3, look: 0.3, kb: 0.5, basic: true },
  { name: '輸入框', behave: 0.3, look: 0.3, kb: 0.8, basic: true },
  { name: 'Dialog', behave: 0.6, look: 0.5, kb: 1.5, basic: true },
  { name: 'Tabs', behave: 1, look: 0.4, kb: 1.5 },
  { name: 'Toast', behave: 1, look: 0.4, kb: 2 },
  { name: 'Combobox', behave: 3, look: 0.7, kb: 4 },
  { name: 'Date picker', behave: 4, look: 1, kb: 8 },
  { name: '資料表格', behave: 4, look: 1.2, kb: 6, noHeadless: true },
]
/* 人週（示意）：行為與無障礙、外觀、五年內的升級 */
function effort(a, comps, gap) {
  const k = comps.length
  const sum = (f) => comps.reduce((s, c) => s + f(c), 0)
  if (a === 'self') return { behave: sum((c) => c.behave * 1.3), look: sum((c) => c.look), upgrade: 0.1 * k }
  if (a === 'headless') return { behave: sum((c) => (c.noHeadless ? 1.5 : 0.3)), look: sum((c) => c.look), upgrade: 0.3 + 0.1 * k }
  return { behave: 0.2 * k, look: 0.5 + sum((c) => c.look * gap * 1.6), upgrade: 0.5 + k * gap * 0.8 }
}
/* gzip 後的 KB（示意） */
function bundles(comps) {
  const sum = comps.reduce((s, c) => s + c.kb, 0)
  return [
    { a: 'self', label: '自己做', v: sum },
    { a: 'library', label: '元件庫：整套註冊', v: 320 },
    { a: 'library', label: '元件庫：按需引入', v: 30 + sum * 2.5 },
    { a: 'headless', label: 'headless', v: 12 + sum * 1.3 },
  ]
}
const SEGS = [{ k: 'behave', label: '行為與無障礙', cls: 'b' }, { k: 'look', label: '外觀', cls: 'l' }, { k: 'upgrade', label: '五年內的升級', cls: 'u' }]

const EX1 = {
  self: { title: '自己做：外觀最自由，時間花在鍵盤與 ARIA', body: ['「行為與無障礙」那段是自己做的主要成本：Combobox、Date picker、資料表格的按鍵規則、焦點移動、螢幕閱讀器的朗讀，每個瀏覽器都要測。', '元件切到「只要按鈕、輸入框、Dialog」：原生 <button> 與 <dialog> 已經處理大部分行為，自己做的成本和 headless 差不多，bundle 最小。'] },
  library: { title: '元件庫：外觀接近預設時最快，差距越大越貴', body: ['行為與無障礙現成，起步最快。把「設計稿與預設外觀的差距」往右拉：覆寫的工越來越多，五年內的升級也跟著貴，因為大版本升級時最先壞的就是覆寫內部 class 的樣式（實驗 ②）。', '整套註冊會把沒用到的元件也打包；按需引入只帶用到的元件與樣式。'] },
  headless: { title: 'headless：行為現成，外觀自己寫', body: ['Dialog、Combobox、Date picker 的鍵盤與 ARIA 由元件處理，外觀用專案的 token 自己寫，差距滑桿對它沒有影響。', '資料表格不在 headless 元件庫裡，要搭 TanStack Table 這類 headless 表格或自己做，那一項的成本比較高。'] },
}

export default function UiLibraryScenarioLab() {
  const [exp, setExp] = useState('effort')
  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="元件從哪裡來：要花多少工、升級時剩下什麼"
         blurb="① 三種做法並排估工作量與 bundle；② 元件庫升一個大版本，三種寫樣式的方式各自的下場。">
      <LabControls>
        <Seg tinted value={exp} onChange={setExp} options={[{ value: 'effort', label: '① 工作量與 bundle' }, { value: 'upgrade', label: '② 升級一個大版本' }]} />
      </LabControls>
      {exp === 'effort' ? <Effort /> : <Upgrade />}
      <style>{`
        .uil-bars { display: grid; gap: 10px; }
        .uil-bar { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr) 4.6rem; gap: 10px; align-items: center; font-size: 0.8rem; color: var(--ink-2); padding: 4px 6px; border-radius: 8px; border: 1.5px solid transparent; }
        .uil-bar.cur { border-color: var(--line); background: var(--surface-1); box-shadow: 3px 3px 0 var(--shade); color: var(--ink-1); font-weight: 700; }
        .uil-track { display: flex; height: 20px; border-radius: 4px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--hairline); }
        .uil-track i { display: block; height: 100%; transition: width 0.35s ease; }
        .uil-track i.b { background: var(--st-blue); } .uil-track i.l { background: var(--st-violet); } .uil-track i.u { background: var(--st-red); } .uil-track i.k { background: var(--st-yellow); }
        .uil-v { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
        .uil-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.74rem; color: var(--ink-3); margin-top: 8px; }
        .uil-legend i { display: inline-block; width: 10px; height: 10px; border: 1px solid var(--line); border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
        .uil-h { font-size: 0.74rem; letter-spacing: 0.08em; color: var(--ink-2); margin: 14px 0 8px; font-weight: 700; }
        .uil-cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 560px) { .uil-cmp { grid-template-columns: 1fr; } .uil-bar { grid-template-columns: 5.2rem minmax(0, 1fr) 4.2rem; } }
        .uil-pane { border: 1px dashed var(--hairline); border-radius: 10px; padding: 12px; display: grid; gap: 10px; align-content: start; background: var(--page); transition: opacity 0.25s ease; }
        .uil-pane h5 { margin: 0; font-size: 0.74rem; letter-spacing: 0.08em; color: var(--ink-3); display: flex; justify-content: space-between; gap: 8px; }
        .uil-pane input { font: inherit; font-size: 0.84rem; border: 0; outline: 0; background: transparent; color: var(--ink-1); width: 100%; min-width: 0; }
        .uil-pane.fade { opacity: 0.35; }
        /* 設計稿與 headless：自己的 class */
        .uil-mine-field { border: var(--bw) solid var(--line); border-radius: 10px; box-shadow: 3px 3px 0 var(--shade); background: var(--surface-1); padding: 6px 10px; font-size: 0.84rem; color: var(--ink-1); }
        .uil-mine-btn { justify-self: start; font: inherit; font-size: 0.86rem; font-weight: 800; color: var(--on-sticker); background: var(--st-mint); border: var(--bw) solid var(--line); border-radius: 10px; box-shadow: 3px 3px 0 var(--shade); padding: 6px 16px; }
        /* 虛構元件庫 kit 的預設樣式：v2 與 v3 都讀同一組公開變數 */
        .uil-kit { --kit-primary: var(--c-blue); --kit-radius: 4px; --kit-border: var(--ink-3); --kit-shadow: none; }
        .uil-kit .kit-input__wrapper, .uil-kit .kit-field__control, .uil-kit .kit-select__trigger, .uil-kit .kit-select__control { border: 1px solid var(--kit-border); border-radius: var(--kit-radius); box-shadow: var(--kit-shadow); background: var(--surface-1); padding: 6px 10px; font-size: 0.84rem; color: var(--ink-1); }
        .uil-kit .kit-button--primary, .uil-kit .kit-btn--primary { justify-self: start; font: inherit; font-size: 0.86rem; color: var(--surface-1); background: var(--kit-primary); border: 0; border-radius: var(--kit-radius); box-shadow: var(--kit-shadow); padding: 7px 16px; }
        /* 主題變數：只改得到 kit 公開的部分 */
        .uil-vars { --kit-primary: var(--st-mint); --kit-radius: 10px; --kit-border: var(--line); --kit-shadow: 3px 3px 0 var(--shade); }
        /* 覆寫內部 class：只寫給 v2 的結構 */
        .uil-ov .kit-input__wrapper, .uil-ov .kit-select__trigger { border: var(--bw) solid var(--line); border-radius: 10px; box-shadow: 3px 3px 0 var(--shade); }
        .uil-ov .kit-button--primary { background: var(--st-mint); border: var(--bw) solid var(--line); border-radius: 10px; box-shadow: 3px 3px 0 var(--shade); }
        .uil-ov .kit-button__inner { color: var(--on-sticker); font-weight: 800; }
        .uil-match { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.8rem; }
        .uil-match li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface-1); }
        @media (prefers-reduced-motion: reduce) { .uil-track i, .uil-pane { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* ① 工作量與 bundle */
function Effort() {
  const [a, setA] = useState('library')
  const [gap, setGap] = useState(70)
  const [set, setSet] = useState('full')
  const comps = set === 'full' ? COMPS : COMPS.filter((c) => c.basic)
  const rows = APPROACHES.map((x) => { const e = effort(x.value, comps, gap / 100); return { ...x, e, total: e.behave + e.look + e.upgrade } })
  const max = Math.max(...rows.map((r) => r.total), 1)
  const bs = bundles(comps)
  const bmax = Math.max(...bs.map((b) => b.v))
  const cur = rows.find((r) => r.value === a)
  const best = rows.reduce((m, r) => (r.total < m.total ? r : m))
  const ex = EX1[a]
  return (
    <LabGrid variant="wide">
      <div className="lab-stack">
        <LabControls>
          <Seg label="做法" tinted value={a} onChange={setA} options={APPROACHES} />
          <Seg label="需要的元件" value={set} onChange={setSet} options={[{ value: 'full', label: '完整後台（8 種）' }, { value: 'basic', label: '只要按鈕、輸入框、Dialog' }]} />
          <Slider label="設計稿與預設外觀的差距" min={0} max={100} step={10} value={gap} onChange={setGap} format={(v) => `${v}%`} />
        </LabControls>
        <LabStage label="三種做法的工作量">
          <p className="uil-h" style={{ marginTop: 0 }}>做完 {comps.map((c) => c.name).join('、')}（人週，示意）</p>
          <div className="uil-bars">
            {rows.map((r) => (
              <div key={r.value} className={`uil-bar ${r.value === a ? 'cur' : ''}`}>
                <span>{r.label}</span>
                <div className="uil-track" role="img" aria-label={`${r.label}：行為 ${r.e.behave.toFixed(1)}、外觀 ${r.e.look.toFixed(1)}、升級 ${r.e.upgrade.toFixed(1)} 人週`}>
                  {SEGS.map((s) => <i key={s.k} className={s.cls} style={{ width: `${(r.e[s.k] / max) * 100}%` }} />)}
                </div>
                <span className="uil-v">{r.total.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <div className="uil-legend">{SEGS.map((s) => <span key={s.k}><i style={{ background: `var(--st-${s.cls === 'b' ? 'blue' : s.cls === 'l' ? 'violet' : 'red'})` }} />{s.label}</span>)}</div>
          <p className="uil-h">打包進去的元件程式（KB，gzip，示意）</p>
          <div className="uil-bars">
            {bs.map((b) => (
              <div key={b.label} className={`uil-bar ${b.a === a ? 'cur' : ''}`}>
                <span>{b.label}</span>
                <div className="uil-track" role="img" aria-label={`${b.label} 約 ${Math.round(b.v)} KB`}><i className="k" style={{ width: `${Math.max(1, (b.v / bmax) * 100)}%` }} /></div>
                <span className="uil-v">{Math.round(b.v)}</span>
              </div>
            ))}
          </div>
        </LabStage>
        <Caption>估算模型與 KB 數都是示意；實際以團隊的速度、設計稿，以及 vite build 後的 bundle 分析為準</Caption>
      </div>
      <div className="lab-stack">
        <Stats min={120}>
          <Stat label={`${cur.label}：合計`} value={cur.total.toFixed(1)} unit="人週" tone={cur === best ? 'ok' : cur.total > best.total * 1.8 ? 'bad' : 'warn'} note={cur === best ? '三者最少' : `最少：${best.label} ${best.total.toFixed(1)}`} />
          <Stat label="其中行為與無障礙" value={cur.e.behave.toFixed(1)} unit="人週" />
          <Stat label="其中外觀" value={cur.e.look.toFixed(1)} unit="人週" tone={a === 'library' && gap >= 60 ? 'warn' : ''} />
          <Stat label="其中五年內的升級" value={cur.e.upgrade.toFixed(1)} unit="人週" tone={cur.e.upgrade > 4 ? 'warn' : ''} />
        </Stats>
        <LabExplain title={ex.title}>{ex.body.map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
        <Callout title="什麼時候會踩到">設計稿出來之後才選元件庫，或專案跑了兩年要升大版本的時候。前者讓每個畫面都在跟預設樣式拉扯，後者讓一次升級變成全站的視覺回歸測試。</Callout>
      </div>
    </LabGrid>
  )
}

/* ② 升級一個大版本：虛構元件庫 kit 從 v2 到 v3，內部 class 改名 */
const METHODS = [
  { value: 'ov', label: '元件庫＋覆寫內部 class' },
  { value: 'vars', label: '元件庫＋主題變數' },
  { value: 'headless', label: 'headless＋自己的 class' },
]
const CSS = {
  ov: `/* 照設計稿：覆寫 kit 的內部結構 */
.kit-input__wrapper,
.kit-select__trigger { border: 2.5px solid; border-radius: 10px; }
.kit-button--primary { background: mint; }
.kit-button__inner { color: ink; font-weight: 800; }`,
  vars: `/* 只改 kit 文件寫明的變數 */
:root {
  --kit-primary: mint;
  --kit-radius: 10px;
  --kit-border: ink;
  --kit-shadow: 3px 3px 0 ink;
}
/* 邊框粗細、按鈕文字顏色沒有對應的變數 */`,
  headless: `/* 自己的 class，元件只給行為 */
.field { border: 2.5px solid; border-radius: 10px; }
.btn-primary { background: mint; color: ink; }`,
}
const MATCH = {
  ov: { v2: ['一致', '一致', '一致'], v3: ['回到預設', '回到預設', '回到預設'] },
  vars: { v2: ['接近：邊框只有 1px', '接近：邊框只有 1px', '接近：文字顏色與粗細改不到'], v3: ['接近：邊框只有 1px', '接近：邊框只有 1px', '接近：文字顏色與粗細改不到'] },
  headless: { v2: ['一致', '一致', '一致'], v3: ['一致', '一致', '一致'] },
}
const EX2 = {
  ov: { title: '覆寫內部 class：升級前照設計稿，升級後回到預設', body: ['.kit-input__wrapper 這類名稱是元件的內部結構，不是公開的 API。v3 改了 DOM 與 class 名稱，選擇器對不到任何元素，樣式靜靜失效，Console 不會有任何訊息。', '升級說明通常列出 props 與事件的變更，內部 class 改名不一定會寫；要靠視覺回歸測試（截圖比對）才抓得到。'] },
  vars: { title: '主題變數：升級不會壞，但只改得到它開放的部分', body: ['--kit-primary、--kit-radius 是元件庫文件寫明的變數，v3 照樣讀，升級前後外觀一樣。', '設計稿要的粗框與加粗的深色按鈕文字，kit 沒有開放對應的變數，只能做到「接近」。設計稿和預設差越多，越會想回頭覆寫內部 class。'] },
  headless: { title: 'headless：樣式是自己的 class，升級動不到', body: ['DOM 與 class 是自己寫的，元件只提供行為與 ARIA。升級時要照升級說明改的是元件的 API（props、子元件名稱），外觀不受影響。', '代價在一開始：每個元件的外觀都要自己寫一次。'] },
}

function Upgrade() {
  const [m, setM] = useState('ov')
  const [v3, setV3] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!busy) return; const t = setTimeout(() => setBusy(false), 450); return () => clearTimeout(t) }, [busy])
  const upgrade = () => { setBusy(true); setV3((x) => !x) }
  const ver = v3 ? 'v3' : 'v2'
  const res = MATCH[m][ver]
  const same = res.filter((r) => r === '一致').length
  const broken = m === 'ov' && v3 ? 3 : 0
  const ex = EX2[m]
  const lib = m !== 'headless'
  return (
    <LabGrid variant="wide">
      <div className="lab-stack">
        <LabControls>
          <Seg label="樣式的寫法" tinted value={m} onChange={(x) => { setM(x); setV3(false) }} options={METHODS} />
          <span className="spacer" />
          <button type="button" className="btn small" onClick={upgrade} disabled={busy}>{v3 ? '退回 kit v2' : '升級到 kit v3'}</button>
          {v3 ? <Status warn>kit v3：內部 class 改名</Status> : <Status ok>kit v2</Status>}
        </LabControls>
        <div className="uil-cmp">
          <div className="uil-pane">
            <h5><span>設計稿</span></h5>
            <div className="uil-mine-field">病歷號或姓名</div>
            <div className="uil-mine-field">家醫科 ▾</div>
            <span className="uil-mine-btn">掛號</span>
          </div>
          <div className={`uil-pane ${lib ? 'uil-kit' : ''} ${m === 'vars' ? 'uil-vars' : ''} ${m === 'ov' ? 'uil-ov' : ''} ${busy ? 'fade' : ''}`}>
            <h5><span>實際畫面</span><span>{lib ? `kit ${ver}` : `headless ${ver}`}</span></h5>
            {!lib ? (<>
              <div className="uil-mine-field"><input aria-label="病歷號或姓名" placeholder="病歷號或姓名" /></div>
              <div className="uil-mine-field">家醫科 ▾</div>
              <button type="button" className="uil-mine-btn">掛號</button>
            </>) : !v3 ? (<>
              <div className="kit-input__wrapper"><input className="kit-input__inner" aria-label="病歷號或姓名" placeholder="病歷號或姓名" /></div>
              <div className="kit-select__trigger">家醫科 ▾</div>
              <button type="button" className="kit-button kit-button--primary"><span className="kit-button__inner">掛號</span></button>
            </>) : (<>
              <div className="kit-field__control"><input className="kit-field__input" aria-label="病歷號或姓名" placeholder="病歷號或姓名" /></div>
              <div className="kit-select__control">家醫科 ▾</div>
              <button type="button" className="kit-btn kit-btn--primary">掛號</button>
            </>)}
          </div>
        </div>
        <Code lang="css" title={m === 'headless' ? 'components.css' : broken ? 'theme.css：標出的規則在 v3 對不到元素' : 'theme.css'} highlight={broken ? [2, 3, 4, 5] : []} dim={!!broken}>{CSS[m]}</Code>
        <Caption>kit 是虛構的元件庫；上面的 CSS 是示意的縮寫，實際套用的規則用站上的色彩 token</Caption>
      </div>
      <div className="lab-stack">
        <Stats min={120}>
          <Stat label="和設計稿一致" value={`${same} / 3`} tone={same === 3 ? 'ok' : same === 0 ? 'bad' : 'warn'} />
          <Stat label="失效的樣式規則" value={broken} unit="條" tone={broken ? 'bad' : 'ok'} note={broken ? '選擇器對不到元素' : ''} />
        </Stats>
        <ul className="uil-match" aria-label="三個元件與設計稿比對">
          {['輸入框', '選單', '主要按鈕'].map((n, i) => <li key={n}><span>{n}</span><span>{res[i] === '一致' ? <Status ok>一致</Status> : res[i] === '回到預設' ? <Status>回到預設</Status> : <Status warn>{res[i]}</Status>}</span></li>)}
        </ul>
        <LabExplain title={ex.title}>{ex.body.map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
        <Callout title="什麼時候會踩到">元件庫升版之後。覆寫的樣式失效不會報錯，要靠截圖比對或逐頁目視才發現；上線後使用者回報「按鈕怎麼變藍色」，多半是這種。</Callout>
      </div>
    </LabGrid>
  )
}
