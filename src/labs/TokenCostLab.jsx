import React, { useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Status, Stats, Stat, Flow, Caption, useWidth, fmtN } from './ui.jsx'

/* ============================================================
   FinOps：一個 agent 工作流一個月花多少 token 的錢
   - 單價由使用者自己填（每百萬 input / output token、快取命中折扣）；預設是明顯的示意數字
   - 每次請求 = context（系統提示詞 + 對話/資料）送進去 + 回答送出來
   - 三種做法：全部重送 / prompt 快取（命中的部分打折）/ 限制 context 並摘要
   不含任何真實供應商的價格；快取寫入的額外費用、免費額度、折扣方案都略過
   ============================================================ */

const TRIM_KEEP = 0.35      // 摘要法：對話/資料部分只留最近 35%
const SUMMARY_TOKENS = 300  // 加一段摘要
const APPROACHES = {
  resend: { label: '全部重送 context', color: 'var(--c-red)' },
  cache: { label: '用 prompt 快取', color: 'var(--c-blue)' },
  trim: { label: '限制長度並摘要', color: 'var(--c-green)' },
}

const num = (s) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) && v >= 0 ? v : NaN }
const money = (v) => (v >= 1000 ? `$${fmtN(Math.round(v))}` : v >= 1 ? `$${v.toFixed(2)}` : v > 0 ? `$${+v.toPrecision(3)}` : '$0')
const ktok = (t) => (t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : fmtN(Math.round(t)))

/* 算一種做法：回傳每次請求的 token 組成與成本 */
function calc(mode, p) {
  const sys = p.ctx * (p.sysShare / 100)          // 每次都一樣的那段：系統提示詞、工具定義、固定範例
  const dyn = p.ctx - sys                         // 對話歷史、查回來的資料
  let full = sys + dyn, cached = 0, out = p.out
  if (mode === 'cache') { cached = sys * (p.hit / 100); full = p.ctx - cached }
  if (mode === 'trim') { full = sys + dyn * TRIM_KEEP + SUMMARY_TOKENS; cached = 0 }
  const fullCost = (full * p.pin) / 1e6
  const cacheCost = (cached * p.pin * (1 - p.discount / 100)) / 1e6
  const inCost = fullCost + cacheCost
  const outCost = (out * p.pout) / 1e6
  const perReq = inCost + outCost
  const reqs = p.perDay * p.days
  return { full, cached, out, inTokens: full + cached, fullCost, cacheCost, inCost, outCost, perReq, monthly: perReq * reqs, reqs, inShare: perReq ? inCost / perReq : 0 }
}

export default function TokenCostLab() {
  /* 單價：字串 state，讓使用者可以清空重填 */
  const [pinStr, setPin] = useState('1.00')
  const [poutStr, setPout] = useState('5.00')
  const [discStr, setDisc] = useState('90')
  const [perDay, setPerDay] = useState(800)
  const [ctx, setCtx] = useState(12000)
  const [out, setOut] = useState(600)
  const [sysShare, setSysShare] = useState(60)
  const [hit, setHit] = useState(80)
  const [days, setDays] = useState(22)
  const [mode, setMode] = useState('resend')
  /* 一鍵回到示意預設：價格清空後想重來時用 */
  const resetPrices = () => { setPin('1.00'); setPout('5.00'); setDisc('90') }
  const clearPrices = () => { setPin(''); setPout(''); setDisc('') }

  /* 空字串或非數字 → NaN：提示使用者，計算時先當 0 */
  const pin = num(pinStr), pout = num(poutStr), discount = num(discStr)
  const bad = [Number.isNaN(pin) && '輸入單價', Number.isNaN(pout) && '輸出單價', (Number.isNaN(discount) || discount > 100) && '折扣（0–100）'].filter(Boolean)
  const p = { pin: pin || 0, pout: pout || 0, discount: Number.isNaN(discount) ? 0 : Math.min(100, discount), perDay, ctx, out, sysShare, hit, days }
  const all = useMemo(() => Object.fromEntries(Object.keys(APPROACHES).map((k) => [k, calc(k, p)])), [pin, pout, discount, perDay, ctx, out, sysShare, hit, days])
  const cur = all[mode]
  const base = all.resend
  const saving = base.monthly ? 1 - cur.monthly / base.monthly : 0
  const box = useRef(null)
  const narrow = useWidth(box, 600) < 460
  /* 敏感度：單項變動後每月成本變多少（用目前選的做法） */
  const sens = [
    ['請求數 ×2', { perDay: perDay * 2 }], ['context ×2', { ctx: ctx * 2 }], ['輸出 ×2', { out: out * 2 }],
    ['輸出單價 ×2', { pout: p.pout * 2 }],
    ['快取命中率 −20 點', { hit: Math.max(0, hit - 20) }],
    ['固定段 +20 點', { sysShare: Math.min(95, sysShare + 20) }],
    ['工作天數 → 30 天', { days: 30 }],
  ].map(([label, d]) => ({ label, v: calc(mode, { ...p, ...d }).monthly }))
  const maxMonthly = Math.max(...Object.values(all).map((a) => a.monthly), 1e-9)

  const lines = [
    `每次請求送進去 ${ktok(ctx)} token：固定段 ${ktok(ctx * sysShare / 100)}（${sysShare}%）+ 變動段 ${ktok(ctx * (1 - sysShare / 100))}`,
    mode === 'resend' ? `全部用原價：${ktok(cur.full)} × $${p.pin}/M = ${money(cur.inCost)}`
      : mode === 'cache' ? `固定段 × 命中率 ${hit}% = ${ktok(cur.cached)} 打 ${100 - p.discount}% 折 → ${money(cur.cached * p.pin * (1 - p.discount / 100) / 1e6)}；其餘 ${ktok(cur.full)} 原價 ${money(cur.full * p.pin / 1e6)}`
      : `固定段 ${ktok(ctx * sysShare / 100)} + 變動段只留 ${TRIM_KEEP * 100}% = ${ktok(ctx * (1 - sysShare / 100) * TRIM_KEEP)} + 摘要 ${SUMMARY_TOKENS} = ${ktok(cur.full)} → ${money(cur.inCost)}`,
    `輸出 ${ktok(out)} × $${p.pout}/M = ${money(cur.outCost)}；每次請求合計 ${money(cur.perReq)}`,
    `× 每天 ${fmtN(perDay)} 次 × ${days} 個工作天 = ${fmtN(cur.reqs)} 次 → 每月 ${money(cur.monthly)}`,
  ]

  const EX = {
    resend: ['全部重送：每一次都付整份 context 的錢', [
      `agent 每轉一圈都把系統提示詞、工具定義、對話歷史整包送回去。這份 context 有 ${sysShare}% 是每次完全一樣的內容，但按 token 計費時它每次都算原價。`,
      '這是最容易算、也最容易失控的形態：context 隨對話變長，每一輪的費用也跟著變高；流量翻倍、帳單翻倍以上。先把這個數字算出來，才有東西可以優化。',
    ]],
    cache: ['prompt 快取：重複的那段打折', [
      `把每次相同的前綴（系統提示詞、工具定義）標成可快取；命中時這段用折扣價計算。這裡命中率 ${hit}%、折扣 ${p.discount}%，每月從 ${money(base.monthly)} 變成 ${money(cur.monthly)}（省 ${Math.round(saving * 100)}%）。`,
      '限制：快取只對「完全相同的前綴」有效，固定內容要放在最前面、動態內容放後面；命中率取決於請求間隔與前綴是否真的一字不差。實際方案通常還有寫入快取的費用，這裡略過。',
    ]],
    trim: ['限制長度並摘要：少送就是少付', [
      `對話歷史與查回來的資料只留最近 ${TRIM_KEEP * 100}%，前面的壓成一段約 ${SUMMARY_TOKENS} token 的摘要。輸入 token 從 ${ktok(base.inTokens)} 降到 ${ktok(cur.inTokens)}。`,
      '代價是資訊損失：摘要可能漏掉後面需要的細節，任務品質要用評測集確認。它和快取不衝突，實務上常兩個一起做：固定段快取、變動段摘要。',
    ]],
  }[mode]

  return (
    <Lab accent="yellow" kicker="FINOPS LAB" title="FinOps：一個 agent 工作流一個月花多少"
         blurb="先填你自己拿到的單價（每百萬 token），再拉請求數、context 長度、輸出長度，看一個月的帳單怎麼組成；切換三種做法，看快取與摘要各省在哪裡。">
      <LabControls>
        <div className="tc-prices" role="group" aria-label="單價輸入">
          <label>每百萬輸入 token<input value={pinStr} onChange={(e) => setPin(e.target.value)} inputMode="decimal" placeholder="填單價" aria-label="每百萬輸入 token 單價" /></label>
          <label>每百萬輸出 token<input value={poutStr} onChange={(e) => setPout(e.target.value)} inputMode="decimal" placeholder="填單價" aria-label="每百萬輸出 token 單價" /></label>
          <label>快取命中折扣 %<input value={discStr} onChange={(e) => setDisc(e.target.value)} inputMode="numeric" placeholder="0–100" aria-label="快取命中折扣百分比" /></label>
          <span className="tc-hint">預設值為示意，請換成實際報價</span>
        </div>
        <button type="button" className="btn ghost small" onClick={clearPrices}>清空單價</button>
        <button type="button" className="btn ghost small" onClick={resetPrices}>回到示意值</button>
        {bad.length > 0 && <Status warn>看不懂：{bad.join('、')}，先當 0 算</Status>}
      </LabControls>
      <LabControls>
        <Slider label="每天的請求數" min={10} max={5000} step={10} value={perDay} onChange={setPerDay} format={(v) => `${fmtN(v)} 次`} />
        <Slider label="每次請求的 context" min={500} max={60000} step={500} value={ctx} onChange={setCtx} format={(v) => `${ktok(v)} tok`} />
        <Slider label="輸出長度" min={50} max={4000} step={50} value={out} onChange={setOut} format={(v) => `${ktok(v)} tok`} />
        <Slider label="每次都一樣的固定段" min={0} max={95} step={5} value={sysShare} onChange={setSysShare} format={(v) => `${v}%`} />
        <Slider label="快取命中率" min={0} max={100} step={5} value={hit} onChange={setHit} format={(v) => `${v}%`} />
        <Slider label="工作天數" min={1} max={31} value={days} onChange={setDays} format={(v) => `${v} 天`} />
      </LabControls>
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={Object.entries(APPROACHES).map(([k, a]) => ({ value: k, label: a.label }))} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="三種做法的每月成本" caption="長條 = 每月成本；深色段 = 輸入原價、半透明段 = 快取命中（折扣價）、淺色段 = 輸出。點長條可切換做法。">
            <div ref={box}><BarSvg all={all} mode={mode} max={maxMonthly} onPick={setMode} narrow={narrow} /></div>
          </LabStage>
          <Stats min={140}>
            <Stat label="每月成本" value={money(cur.monthly)} tone={mode !== 'resend' && saving > 0 ? 'ok' : ''} note={mode === 'resend' ? `${fmtN(cur.reqs)} 次請求` : `比全部重送省 ${Math.round(saving * 100)}%`} />
            <Stat label="每次請求" value={money(cur.perReq)} note={`輸入 ${money(cur.inCost)} + 輸出 ${money(cur.outCost)}`} />
            <Stat label="輸入 vs 輸出" value={`${Math.round(cur.inShare * 100)}% / ${Math.round((1 - cur.inShare) * 100)}%`} note={cur.inShare > 0.7 ? '帳單被 context 吃掉' : '輸出占比不小'} />
            <Stat label="每次送進去的 token" value={ktok(cur.inTokens)} note={cur.cached ? `其中 ${ktok(cur.cached)} 命中快取` : `輸出 ${ktok(cur.out)}`} />
          </Stats>
          <Flow title="一次請求的錢花在哪（目前做法）" ariaLabel="一次請求的成本組成"
                steps={[
                  { label: '原價輸入', value: `${ktok(cur.full)} → ${money(cur.fullCost)}`, hot: cur.fullCost >= Math.max(cur.cacheCost, cur.outCost) },
                  { label: '快取命中', value: cur.cached ? `${ktok(cur.cached)} → ${money(cur.cacheCost)}` : '沒有' },
                  { label: '輸出', value: `${ktok(out)} → ${money(cur.outCost)}`, hot: cur.outCost > cur.fullCost },
                  { label: '× 每月請求', value: `${fmtN(cur.reqs)} 次 = ${money(cur.monthly)}` },
                ]} />
          <div className="tc-math" aria-label="算式">
            {lines.map((l, i) => <div key={i}><span className="k">{i + 1}</span><span>{l}</span></div>)}
          </div>
          <div className="dtable-wrap">
            <table className="dtable">
              <caption>三種做法並排（同一組單價與流量）</caption>
              <thead><tr><th>做法</th><th>每次輸入 tok</th><th>每次請求</th><th>每月</th><th>vs 全部重送</th></tr></thead>
              <tbody>
                {Object.entries(APPROACHES).map(([k, a]) => (
                  <tr key={k} className={`clickable${k === mode ? ' hit' : ''}`} onClick={() => setMode(k)}>
                    <td>{a.label}</td><td>{ktok(all[k].inTokens)}</td><td>{money(all[k].perReq)}</td><td>{money(all[k].monthly)}</td>
                    <td>{k === 'resend' ? '—' : `−${Math.round((1 - all[k].monthly / (base.monthly || 1)) * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <div className="dtable-wrap">
            <table className="dtable">
              <caption>哪個旋鈕最有感：單項變動後的每月成本（{APPROACHES[mode].label}）</caption>
              <thead><tr><th>變動</th><th>每月</th><th>變化</th></tr></thead>
              <tbody>
                {sens.map((r) => (
                  <tr key={r.label}><td>{r.label}</td><td>{money(r.v)}</td><td>{cur.monthly ? `${r.v >= cur.monthly ? '+' : ''}${Math.round((r.v / cur.monthly - 1) * 100)}%` : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <LabExplain title={EX[0]}>{EX[1].map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <LabExplain title="計費結構：為什麼 token 帳單和機器帳單不一樣">
            <p>雲端機器按「開著多久」算錢，token 按「送了多少、回了多少」算錢，而且輸入與輸出單價不同。所以同樣的流量，context 長一倍、費用就接近一倍；而一個「順便把整份文件塞進去」的設計，上線後才會在帳單上現形。</p>
            <p>先把每次請求拆成固定段、變動段、輸出三塊，分別乘上單價，再乘請求數——這張算式就是這個工作流的成本模型，之後所有優化都在這張算式上動手。</p>
          </LabExplain>
          <LabExplain title="agent 的「一次請求」常常不只一次">
            <p>使用者眼中的一個任務，agent 可能繞好幾圈：每圈呼叫一次模型、每圈都把越來越長的 context 重送一次。所以「每天請求數」要算的是<strong>模型呼叫次數</strong>，不是使用者按了幾次送出。</p>
            <p>估成本時先量「平均每個任務幾次呼叫、每次 context 多長」，再乘上任務量；只拿單次呼叫去估，常常差好幾倍。</p>
            <p>輸出單價通常比輸入高，但 agent 的輸出往往短、context 很長，帳單多半是輸入占大頭——看「輸入 vs 輸出」占比決定先從哪邊下手。</p>
          </LabExplain>
          <Callout title="看得見 → 分攤 → 優化">
            <b>看得見</b>：每個請求記下 input / output / cached token 數與呼叫的功能，不然月底只有一個總數。<b>分攤</b>：用這些標籤把費用歸到功能、團隊或客戶，才知道是誰在花。<b>優化</b>：有了數字再動手——先快取固定段、再限制 context、最後才談換模型或降流量。順序顛倒就是在猜。
          </Callout>
        </div>
      </LabGrid>
      <Caption>單價與折扣皆由上方輸入決定，預設值僅為示意；未計快取寫入費用、免費額度與批次折扣，實際帳單以供應商的計費說明為準。</Caption>

      <style>{`
        .tc-prices { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: flex-end; }
        .tc-prices label { display: grid; gap: 3px; font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.03em; }
        .tc-prices input { font-family: var(--mono); font-size: 0.86rem; color: var(--ink-1); background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 5px 8px; width: 96px; }
        .tc-prices input:focus { outline: 2px solid var(--lab-accent); outline-offset: 1px; border-color: transparent; }
        .tc-hint { font-size: 0.72rem; color: var(--ink-3); padding-bottom: 6px; }
        .tc-math { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); display: grid; gap: 4px; border-left: 3px solid var(--lab-accent); padding-left: 10px; }
        .tc-math div { display: flex; gap: 8px; align-items: baseline; }
        .tc-math div > span:last-child { min-width: 0; overflow-wrap: anywhere; }
        .tc-math .k { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--surface-2); color: var(--ink-3); font-size: 0.64rem; display: inline-flex; align-items: center; justify-content: center; }
        .tc-bars { width: 100%; }
        .tc-bars .lbl { font-family: var(--sans); font-size: 13px; fill: var(--ink-1); }
        .tc-bars .lbl.dim { fill: var(--ink-3); }
        .tc-bars .val { font-family: var(--mono); font-size: 13px; font-weight: 700; fill: var(--ink-1); }
        .tc-bars .seg-in { fill: var(--c); transition: width 0.35s ease, x 0.35s ease; }
        .tc-bars .seg-cache { fill: var(--c); opacity: 0.45; transition: width 0.35s ease, x 0.35s ease; }
        .tc-bars .seg-out { fill: var(--c); opacity: 0.25; transition: width 0.35s ease, x 0.35s ease; }
        .tc-bars .track { fill: none; stroke: var(--hairline); stroke-dasharray: 3 3; }
        .tc-bars .pick { fill: transparent; cursor: pointer; }
        .tc-bars .ring { fill: none; stroke: var(--lab-accent); stroke-width: 1.5; }
        .tc-bars .grid { stroke: var(--hairline); }
        .tc-bars .key { font-family: var(--sans); font-size: 11px; fill: var(--ink-3); }
        @media (prefers-reduced-motion: reduce) { .tc-bars .seg-in, .tc-bars .seg-cache, .tc-bars .seg-out { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 三條水平堆疊長條：輸入原價 / 快取命中 / 輸出。寬度依每月成本與最大值的比例。 */
function BarSvg({ all, mode, max, onPick, narrow }) {
  const W = narrow ? 320 : 560, L = narrow ? 4 : 150, R = narrow ? 74 : 86, ROW = narrow ? 56 : 44, TOP = 14
  const keys = Object.keys(APPROACHES)
  const H = TOP + keys.length * ROW + (narrow ? 8 : 24)
  const span = W - L - R
  const scale = span / max
  return (
    <svg className="tc-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`三種做法每月成本比較，目前選 ${APPROACHES[mode].label}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={L + span * f} x2={L + span * f} y1={TOP} y2={TOP + keys.length * ROW} className="grid" />)}
      {keys.map((k, i) => {
        const a = all[k], y = TOP + i * ROW + (narrow ? 20 : 6), h = narrow ? 24 : ROW - 16
        const wFull = a.fullCost * a.reqs * scale, wCache = a.cacheCost * a.reqs * scale, wOut = a.outCost * a.reqs * scale
        const on = k === mode
        return (
          <g key={k} style={{ '--c': APPROACHES[k].color }}>
            <text x={narrow ? L : L - 10} y={narrow ? y - 6 : y + h / 2 + 4} textAnchor={narrow ? 'start' : 'end'} className={`lbl${on ? '' : ' dim'}`}>{APPROACHES[k].label}</text>
            <rect x={L} y={y} width={span} height={h} className="track" rx="3" />
            <rect x={L} y={y} width={Math.max(0, wFull)} height={h} className="seg-in" />
            <rect x={L + wFull} y={y} width={Math.max(0, wCache)} height={h} className="seg-cache" />
            <rect x={L + wFull + wCache} y={y} width={Math.max(0, wOut)} height={h} className="seg-out" />
            {on && <rect x={L - 2} y={y - 2} width={span + 4} height={h + 4} rx="4" className="ring" />}
            <text x={W - R + 8} y={y + h / 2 + 4} className="val">{money(a.monthly)}</text>
            <rect x={0} y={y - 6} width={W} height={ROW} className="pick" onClick={() => onPick(k)} />
          </g>
        )
      })}
      {!narrow && <text x={L} y={H - 6} className="key">深色 = 輸入原價 · 半透明 = 快取命中 · 淺色 = 輸出（寬度 = 占最大那條的比例）</text>}
    </svg>
  )
}
