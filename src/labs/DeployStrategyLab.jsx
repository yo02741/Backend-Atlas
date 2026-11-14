import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Callout, Status, Stats, Stat, LineChart, Caption, useWidth, fmtN } from './ui.jsx'

/* ============================================================
   部署策略與資料庫遷移：rolling / blue-green / canary 三種換版方式
   - 每個策略是一串「格」：這一格有幾個新舊實例、新版拿到多少流量、持續幾分鐘
   - 錯誤率 = 舊版流量 ×（舊版碰到不相容的 schema 就全錯）+ 新版流量 ×（新版有 bug 時 30%）
   - schema 變更照課文的例子：customers.name → full_name；migration 在部署新版之前跑
   所有時間、比例都是示意，用來比較三種策略的形狀，不是任何工具的預設值
   ============================================================ */

const N = 6            // 實例數
const BUG = 30         // 新版有 bug：打到新版的請求有 30% 失敗
const BASE = 0.2       // 平常的錯誤率（%）
const RPM = 1000       // 每分鐘請求數
const XMAX = 32        // 圖表畫 32 分鐘

const STRATS = {
  rolling: { label: 'rolling', detect: 6, detectNote: '整體錯誤率的告警', rollback: '約 6 分鐘', rollbackNote: '再一次 rolling', extra: '少', extraNote: '不需要額外的整套資源' },
  bluegreen: { label: 'blue-green', detect: 2, detectNote: '全部流量都打到新版', rollback: '秒級', rollbackNote: '流量入口切回 blue', extra: '兩倍', extraNote: `切換期間多 ${N} 個實例` },
  canary: { label: 'canary', detect: 3, detectNote: '新舊版本的指標比較', rollback: '秒級', rollbackNote: '把比例調回 0%', extra: '少', extraNote: '先多起 1 個實例' },
}

/* 一格：k 代號、lb 短標籤、dur 分鐘、nu / ol 新舊實例數、share 新版流量比例、idle 哪一邊啟動了但沒接流量、back 回滾中 */
function buildFrames(st, bug, mig) {
  const r1 = { k: 'r1', lb: '第 1 批', dur: 3, nu: 2, ol: 4, share: 1 / 3 }, r2 = { k: 'r2', lb: '第 2 批', dur: 3, nu: 4, ol: 2, share: 2 / 3 }
  const g1 = { k: 'g1', lb: 'green 部署好', dur: 5, nu: N, ol: N, share: 0, idle: 'new' }
  const body = {
    rolling: bug
      ? [r1, r2, { ...r2, k: 'rb1', lb: '告警 → 開始回滾', back: true }, { ...r1, k: 'rb2', lb: '回滾中', back: true }, { k: 'rb3', lb: '回滾完成', dur: 3, nu: 0, ol: N, share: 0, back: true }]
      : [r1, r2, { k: 'r3', lb: '第 3 批 · 完成', dur: 3, nu: N, ol: 0, share: 1 }],
    bluegreen: bug
      ? [g1, { k: 'g2', lb: '切換流量', dur: 2, nu: N, ol: N, share: 1, idle: 'old' }, { ...g1, k: 'gb', lb: '切回 blue', dur: 3, back: true }]
      : [g1, { k: 'g2', lb: '切換流量', dur: 5, nu: N, ol: N, share: 1, idle: 'old' }, { k: 'g3', lb: '回收 blue', dur: 3, nu: N, ol: 0, share: 1 }],
    canary: bug
      ? [{ k: 'c5', lb: 'canary 5%', dur: 3, nu: 1, ol: N, share: 0.05 }, { k: 'cb', lb: '指標攔下 → 0%', dur: 3, nu: 1, ol: N, share: 0, idle: 'new', back: true }]
      : [{ k: 'c5', lb: 'canary 5%', dur: 10, nu: 1, ol: N, share: 0.05 }, { k: 'c25', lb: '25%', dur: 10, nu: 2, ol: 5, share: 0.25 }, { k: 'c50', lb: '50%', dur: 5, nu: 3, ol: 3, share: 0.5 }, { k: 'c100', lb: '100% · 完成', dur: 3, nu: N, ol: 0, share: 1 }],
  }[st]
  const all = [{ k: 'pre', lb: '部署前', dur: 2, nu: 0, ol: N, share: 0 }, ...(mig ? [{ k: 'mig', lb: '跑 migration', dur: 1, nu: 0, ol: N, share: 0 }] : []), ...body]
  let t = 0
  return all.map((f, i) => {
    const migrated = !!mig && i >= 1
    const oldBroken = mig === 'rename' && migrated          // 欄位已改名，舊版查 name 會失敗
    const err = (1 - f.share) * (oldBroken ? 100 : BASE) + f.share * (bug ? BUG : BASE)
    const out = { ...f, t, migrated, oldBroken, err }
    t += f.dur
    return out
  })
}

const pct = (v) => (v >= 10 ? Math.round(v) : +v.toFixed(1))
const md = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>')

/* 每一格的說明：[標題, 段落…]，依策略、bug、migration 寫法組出來 */
function explain(f, { st, bug, mig }) {
  const brk = f.oldBroken, share = pct(f.share * 100)
  const stillBroken = brk && `還在接流量的 ${f.ol} 個舊版實例查 \`name\` 都得到 \`ERROR: column "name" does not exist\`：約 ${pct((1 - f.share) * 100)}% 的請求失敗。`
  const compat = mig === 'expand' && 'v1 只用 `name`、v2 寫入兩欄並讀 `name`：正在跑的兩個版本都跟當下的 schema 相容。'
  const noWayBack = '欄位已經叫 `full_name`，回滾到 v1 會再壞一次。上一版跟目前的 schema 不相容時，回滾不再是可行的選項，只能往前修；照 expand–contract 拆，才能一直保有回滾這條路。'
  const T = {
    pre: ['部署前：6 個實例都是舊版 v1', [
      { rolling: 'rolling 讓新版的實例一批批起來、通過 readiness 後接流量，舊版一批批下線。不需要額外的整套資源，但過程中新舊版本同時服務。',
        bluegreen: 'blue-green 準備兩套完整環境：blue 是目前的正式版，green 是新版。green 部署好、驗證完，才把流量入口一次切過去。',
        canary: 'canary 讓新版先接一小部分流量，和同一時段的舊版（baseline）比較錯誤率與延遲，沒問題再逐步放大。' }[st],
      mig === 'rename' ? '這版把 `customers.name` 直接改名成 `full_name`，新版程式改用 `full_name`；migration 在部署新版之前跑。'
        : mig === 'expand' ? '這版要把 `name` 換成 `full_name`，照 expand–contract 拆開：這次只新增欄位，新版寫入兩欄、讀 `name`。' : '',
    ]],
    mig: mig === 'rename' ? ['跑 migration：欄位改名，舊版立刻報錯', [
      '`ALTER TABLE customers RENAME COLUMN name TO full_name` 執行完，正在服務的 6 個實例都還是 v1，查 `name` 得到 `ERROR: column "name" does not exist`。新版一個都還沒上線，請求全部失敗。',
      '反過來「先部署再跑 migration」也一樣：新版先上線時，`full_name` 還不存在。' + (st === 'bluegreen' ? 'blue 和 green 共用同一個資料庫，blue-green 沒有解決 migration 的問題。' : '部署期間新舊版本一定會同時存在，這個變更讓兩個版本不可能同時正常運作。'),
    ]] : ['跑 migration（expand）：新增 full_name，舊版不受影響', [
      '只新增一個可為空的欄位，`name` 還在，v1 照常運作。expand 類的 migration 在部署新版之前跑：舊版不受影響，新版需要它。',
      '刪除 `name`（contract）不在這次部署裡：要等所有舊版下線、過了回滾窗口之後才做。',
    ]],
    r1: ['第 1 批：2 個新版、4 個舊版同時服務', ['第 1 批新版通過 readiness 後開始接流量，大約三分之一的請求打到 v2。同一個使用者的連續請求可能先打到新版、再打到舊版。', bug && 'readiness 檢查的是「能不能接請求」，有 bug 的新版照樣通過，rolling 會繼續往下換。', stillBroken, compat]],
    r2: ['第 2 批：4 個新版、2 個舊版', ['再換一批，三分之二的請求打到 v2。', bug && '錯誤率跟著新版的比例一路升高；rolling 本身不比較新舊版本的指標，要靠整體錯誤率的告警才會發現。', stillBroken, compat]],
    r3: ['第 3 批：舊版全部下線', ['只剩 v2 在服務，新舊並存的這幾分鐘結束。', brk && '改名造成的錯誤到這一刻才完全消失。之後如果想回滾到 v1，會再壞一次：欄位已經叫 `full_name` 了。', mig === 'expand' && '`name` 欄位還留著，所以回滾到 v1 仍然可行。之後的部署再改讀 `full_name`、停止寫舊欄，最後才刪除 `name`。']],
    rb1: ['告警響了：開始回滾，但回滾也是一次 rolling', ['整體錯誤率觸發告警時，已經有三分之二的流量打到有 bug 的新版。回滾要先等 v1 的實例起來、通過 readiness，才換得掉 v2；這段時間新版照樣在接流量。', stillBroken]],
    rb2: ['回滾中：換回第 1 批', ['一批一批換回 v1，錯誤率跟著新版的比例往下掉。回滾和部署一樣要時間。', stillBroken]],
    rb3: brk ? ['回滾完成，但 v1 全部在報錯', [noWayBack]] : ['回滾完成：回到 v1', ['從第 1 批上線到完全換回舊版，大約 12 分鐘都有請求打到有 bug 的新版。預設應該先回滾、再修。']],
    g1: ['green 部署好：兩套同時存在，流量還在 blue', ['green 的 6 個實例已經啟動、做完 smoke test，但還沒接任何使用者流量。這段期間要兩倍的運算資源。', bug && '這個 bug 只在真實流量下才出現，smoke test 沒有抓到。', brk && 'blue 還在接全部流量，也全部在報錯。', compat]],
    g2: ['切換流量入口：100% 到 green', ['在負載平衡器把流量一次切到 green，切換幾乎是瞬間的（用 DNS 切換時，快取會依 TTL 繼續連到舊位址一段時間）。blue 先留著，出事就切回去。', bug && '所有流量同時打到有 bug 的新版：受影響的比例最大，告警也響得最快。', brk && '切到 green 之後錯誤消失，但 blue 查不到 `name`，已經不能當退路了。']],
    g3: ['觀察期過後：回收 blue', ['確定不會回滾後才釋放 blue 的資源；在那之前，回滾都只是把流量入口切回去。', mig === 'expand' && '`name` 欄位還在，blue 留著的期間隨時切得回去。']],
    gb: brk ? ['流量切回 blue，但 blue 全部在報錯', [noWayBack]] : ['發現問題：流量切回 blue', ['blue 還留著，切回去是秒級的事。受影響的是「切換到發現」這 2 分鐘內的全部請求。']],
    c5: ['canary 5%：新版先接一小部分流量', ['流量入口依比例把 5% 的請求分給新版，其餘留在舊版（baseline）。觀察期內分別看新舊版本的錯誤率與延遲；樣本不夠時不做結論。', bug && `新版的錯誤率是 ${BUG}%，但只有 5% 的請求碰得到它。`, brk && '95% 的流量還在舊版，全部報錯；baseline 自己壞掉時，新舊比較也失去參考價值。', compat]],
    c25: ['放量到 25%', ['新版的指標和 baseline 沒有明顯差異，進到下一級。每一級之後都等一段觀察期。', stillBroken, compat]],
    c50: ['放量到 50%', ['新舊各接一半。整個觀察期新舊版本都同時存在，比 rolling 的並存時間更長，所以 schema 一樣要跟兩個版本相容。', stillBroken]],
    c100: ['100%：全部換成新版', ['舊版下線，部署完成。canary 花的時間最久，換到的是每一級都有機會在影響擴大前停下來。', brk && '改名造成的錯誤到這一刻才消失，而且已經回不去 v1。']],
    cb: brk ? ['把比例調回 0%，但舊版全部在報錯', ['baseline 全部報錯時，自動比較看不出新版比較差；這裡假設值班的人看到整體錯誤率後手動把比例調回 0%。', noWayBack]]
      : ['指標變差：放量前被攔下，流量切回 0%', ['canary 的錯誤率比 baseline 高超過 1 個百分點，樣本數也夠了，自動判斷停止放量、把比例調回 0%。只有那 5% 流量裡的一部分請求受影響。', '比較的對象是同一時段的舊版，不是固定門檻：流量尖峰、外部依賴變慢會同時影響兩邊。']],
  }[f.k]
  return [T[0], T[1].filter(Boolean)]
}

const COMPARE = [
  ['新舊版同時存在', '是，數分鐘', '切換瞬間之外否', '是，整個觀察期'],
  ['額外資源', '少', '兩倍', '少'],
  ['回滾速度', '再一次 rolling', '秒級切回', '把比例調回 0'],
  ['需要的基礎', 'readiness probe', '流量切換點', '分流與分版本指標'],
  ['對資料庫相容性的要求', '有', '有（共用資料庫）', '有'],
]

export default function DeployStrategyLab() {
  const [st, setSt] = useState('rolling')
  const [bug, setBug] = useState(false)
  const [schema, setSchema] = useState(false)
  const [migKind, setMigKind] = useState('rename')
  const mig = schema ? migKind : null
  const frames = buildFrames(st, bug, mig)
  const { step, setStep, playing, toggle } = usePlayer(frames.length, 1700)
  const change = (fn) => (v) => { fn(v); setStep(0) }

  const i = Math.min(step, frames.length - 1), f = frames[i], S = STRATS[st], last = i === frames.length - 1
  const backIdx = frames.findIndex((x) => x.back)
  const series = Array.from({ length: XMAX + 1 }, (_, m) => [...frames].reverse().find((x) => x.t <= m).err)
  const extraFail = frames.slice(0, i + 1).reduce((a, x) => a + x.dur * RPM * (x.err - BASE) / 100, 0)
  const anyBroken = frames.some((x) => x.oldBroken)
  const serving = f.share > 0 && f.share < 1 ? 2 : 1
  const [title, paras] = explain(f, { st, bug, mig })
  const box = useRef(null)
  const cw = Math.max(300, Math.min(640, useWidth(box, 560) - 20))

  const cols = !f.migrated ? ['name'] : mig === 'rename' ? ['full_name'] : ['name', 'full_name']
  const needs = { v1: ['name'], v2: mig === 'rename' ? ['full_name'] : ['name', 'full_name'] }
  const running = [f.ol > 0 && 'v1', f.nu > 0 && 'v2'].filter(Boolean)
  const compatible = (v) => needs[v].every((c) => cols.includes(c))
  const oldErr = f.oldBroken && f.ol > 0 && f.share < 1 && f.idle !== 'old'   // 舊版真的在接流量、真的在報錯
  const errNote = oldErr ? `舊版 ${pct((1 - f.share) * 100)}% 流量全部報錯${bug && f.share > 0 ? '，加上新版的 bug' : ''}`
    : bug && f.share > 0 ? `新版 ${pct(f.share * 100)}% 流量 × ${BUG}%` : '和平常一樣'

  return (
    <Lab accent="green" className="dps-lab" kicker="CI/CD LAB" title="部署策略：rolling、blue-green、canary 怎麼換版"
         blurb="6 個實例從舊版換成新版時流量怎麼分；新版有 bug 時受影響的請求與回滾速度，含 schema 變更時舊版碰到新 schema 會不會壞。">
      <LabControls>
        <Seg label="策略" tinted value={st} onChange={change(setSt)} options={Object.entries(STRATS).map(([k, s]) => ({ value: k, label: s.label }))} />
        <Toggle label="新版有 bug（錯誤率高）" checked={bug} onChange={change(setBug)} />
        <Toggle label="這版含資料庫 schema 變更" checked={schema} onChange={change(setSchema)} />
        {schema && <Seg label="migration 寫法" value={migKind} onChange={change(setMigKind)} options={[{ value: 'rename', label: '直接改欄位名' }, { value: 'expand', label: 'expand–contract' }]} />}
      </LabControls>
      <LabControls>
        <button type="button" className="btn small" onClick={toggle}>{playing ? '❚❚ 暫停' : last ? '↺ 重新部署' : i === 0 ? '▶ 開始部署' : '▶ 繼續部署'}</button>
        <Stepper step={i} total={frames.length} onStep={setStep} labels={frames.map((x) => x.lb)} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack" ref={box}>
          <LabStage label="實例與流量分配" caption={`藍 = 舊版 v1、橘 = 新版 v2；虛線框 = 已啟動但沒接流量；紅框 = 正在報錯的實例（${N} 個實例、每分鐘 ${fmtN(RPM)} 個請求，示意）`}>
            <Fleet f={f} st={st} bug={bug} />
            {schema && (
              <div className={`dps-db${running.every(compatible) ? '' : ' bad'}`}>
                <span className="h">資料庫（新舊版共用）</span>
                <span><code>customers</code> 的欄位：{cols.map((c) => <code key={c} className="col">{c}</code>)}</span>
                <span className="vs">{running.map((v) => {
                  const txt = `${v} 需要 ${needs[v].join('、')}`
                  return compatible(v) ? <Status key={v} ok>{txt}</Status> : <Status key={v}>{txt}</Status>
                })}</span>
                {oldErr && <code className="err">ERROR: column "name" does not exist</code>}
              </div>
            )}
          </LabStage>
          <Stats min={130}>
            <Stat label="同時在線的版本數" value={serving} unit="個" note={f.idle ? `${f.idle === 'new' ? 'v2' : 'v1'} 已啟動、沒接流量` : serving === 2 ? 'v1 與 v2 都在接流量' : `只有 ${f.share === 1 ? 'v2' : 'v1'}`} tone={serving === 2 ? 'warn' : ''} />
            <Stat label="受影響請求比例" value={`${pct(f.err)}%`} note={errNote} tone={f.err > 5 ? 'bad' : f.err > 1 ? 'warn' : 'ok'} />
            <Stat label="多出來的失敗請求" value={fmtN(Math.round(extraFail))} unit="個" note="部署開始累計到這一步" tone={extraFail > 500 ? 'bad' : extraFail > 20 ? 'warn' : ''} />
            <Stat label="多久發現 bug" value={bug ? `約 ${S.detect} 分鐘` : '—'} note={bug ? S.detectNote : '打開「新版有 bug」'} />
            <Stat label="回滾時間" value={S.rollback} note={anyBroken ? '回得去，但舊版會再壞' : S.rollbackNote} tone={anyBroken ? 'bad' : ''} />
            <Stat label="額外資源" value={S.extra} note={S.extraNote} tone={st === 'bluegreen' ? 'warn' : ''} />
          </Stats>
          <LineChart width={cw} height={Math.round(cw * (cw < 420 ? 0.5 : 0.34))} title={`部署期間的錯誤率 · 這一步 ${pct(f.err)}%`} xMax={XMAX} yMax={anyBroken ? 100 : 40}
                     upto={last ? XMAX : frames[i + 1].t} xTicks={[0, 8, 16, 24]} fmtX={(m) => `${m} 分`} fmtY={(v) => `${Math.round(v)}%`}
                     mark={bug && i >= backIdx ? frames[backIdx].t : null}
                     series={[{ key: 'err', label: '錯誤率', color: 'var(--critical)', values: series }]}
                     ariaLabel={`部署期間的錯誤率，目前這一步 ${pct(f.err)}%`} />
          <Caption>直線 = 發現問題、開始回滾的時間點。時間、比例、發現速度都是示意：實際數字取決於實例數、readiness 時間、觀察期與告警設定。</Caption>
        </div>

        <div className="lab-stack">
          <LabExplain title={title}>{paras.map((t, k) => <p key={k} dangerouslySetInnerHTML={{ __html: md(t) }} />)}</LabExplain>
          <LabExplain title="沒有一種策略能免除 schema 相容性">
            <p>規則只有一條：<strong>任何時刻正在跑的所有版本，都要能跟當下的 schema 一起運作</strong>。資料庫通常只有一個，三種策略的新舊版本都共用它。</p>
            <p>expand–contract 把一個破壞性的變更拆成幾個各自相容的步驟：先擴張（新增欄位、雙寫、回填），等所有舊版本都消失、確定不會回滾之後，再收縮（刪除舊欄位）。</p>
          </LabExplain>
          <Callout title="什麼時候會踩到">
            第一次在部署裡改欄位名稱或刪欄位；實例變多、rolling 拉長到十幾分鐘，新舊並存的時間跟著變長；想回滾時才發現上一版已經讀不懂現在的 schema。流量小的服務做 canary，5% 只有幾個請求，看不出差別，要拉長觀察時間，或直接用較大的比例。
          </Callout>
        </div>
      </LabGrid>

      <div className="dtable-wrap dps-cmp">
        <table className="dtable">
          <caption>三種策略比一比</caption>
          <thead><tr><th></th>{Object.entries(STRATS).map(([k, s]) => <th key={k} className={k === st ? 'cur' : ''}>{s.label}</th>)}</tr></thead>
          <tbody>{COMPARE.map(([h, ...cells]) => (
            <tr key={h}><td className="h">{h}</td>{cells.map((c, k) => <td key={k} className={Object.keys(STRATS)[k] === st ? 'cur' : ''}>{c}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>

      <style>{`
        .dps-lab .stepper { flex-wrap: wrap; row-gap: 6px; }
        .dps-lab .stepper .count, .dps-lab .stepper .seg-label { white-space: nowrap; }
        .dps-svg { width: 100%; }
        .dps-svg .tf { transition: width 0.45s ease, x 0.45s ease; }
        .dps-svg .tf.old, .dps-svg .cell.old rect { fill: color-mix(in srgb, var(--c-blue) 22%, var(--surface-1)); stroke: var(--c-blue); }
        .dps-svg .tf.new, .dps-svg .cell.new rect { fill: color-mix(in srgb, var(--c-orange) 26%, var(--surface-1)); stroke: var(--c-orange); }
        .dps-svg .cell rect { stroke-width: 1.8; transition: fill 0.4s ease, stroke 0.4s ease, opacity 0.4s ease; }
        .dps-svg .cell.none rect { fill: none; stroke: var(--hairline); stroke-dasharray: 3 4; }
        .dps-svg .cell.idle rect { stroke-dasharray: 5 4; opacity: 0.55; }
        .dps-svg .cell.bad rect { stroke: var(--critical); stroke-width: 2.6; }
        .dps-svg .cell.bug rect { stroke: var(--serious); stroke-width: 2.6; stroke-dasharray: 6 3; }
        .dps-svg .v { font-family: var(--mono); font-size: 13px; font-weight: 700; fill: var(--ink-1); }
        .dps-svg .s { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-2); }
        .dps-svg .cell.bad .s { fill: var(--critical); font-weight: 700; }
        .dps-svg .cell.bug .s { fill: var(--serious); font-weight: 700; }
        .dps-svg .lbl { font-family: var(--sans); font-size: 12px; font-weight: 600; fill: var(--ink-1); }
        .dps-svg .sm { font-family: var(--sans); font-size: 11px; fill: var(--ink-2); }
        .dps-db { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 12px; padding: 8px 12px; border: 1px solid var(--hairline); border-left: 3px solid var(--good); border-radius: var(--radius); background: var(--surface-1); font-size: 0.82rem; color: var(--ink-2); }
        .dps-db.bad { border-left-color: var(--critical); }
        .dps-db .h { font-weight: 700; color: var(--ink-1); }
        .dps-db code { font-family: var(--mono); font-size: 0.78rem; background: var(--surface-2); padding: 1px 6px; border-radius: 3px; color: var(--ink-1); }
        .dps-db code.col { margin-left: 4px; }
        .dps-db code.err { color: var(--critical); overflow-wrap: anywhere; }
        .dps-db .vs { display: inline-flex; flex-wrap: wrap; gap: 6px; }
        .dps-cmp { margin-top: 18px; }
        .dps-cmp td { white-space: normal; font-family: var(--sans); }
        .dps-cmp td.h { color: var(--ink-2); white-space: nowrap; }
        .dps-cmp .cur { background: color-mix(in srgb, var(--lab-accent) 12%, transparent); color: var(--ink-1); font-weight: 600; }
        @media (prefers-reduced-motion: reduce) { .dps-svg .tf, .dps-svg .cell rect { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 舞台：上面一條流量分配條，下面是實例方塊。rolling 原地換（一排）；blue-green、canary 新舊各一排 */
function Fleet({ f, st, bug }) {
  const ref = useRef(null)
  const narrow = useWidth(ref, 600) < 480
  const W = narrow ? 340 : 600, S = narrow ? 44 : 56, G = narrow ? 8 : 12
  const x0 = (W - (N * S + (N - 1) * G)) / 2, barW = W - 20, nw = barW * f.share
  const cell = (v, on) => ({ v, idle: !on, bad: on && v === 'old' && f.oldBroken, bug: on && v === 'new' && bug })
  const oldOn = f.idle !== 'old' && f.share < 1, newOn = f.idle !== 'new' && f.share > 0
  const names = st === 'bluegreen' ? ['blue · 舊版 v1', 'green · 新版 v2'] : ['舊版 v1（baseline）', '新版 v2（canary）']
  const rows = st === 'rolling'
    ? [{ label: `${N} 個實例，原地一批批換`, cells: Array.from({ length: N }, (_, k) => (k < f.nu ? cell('new', newOn) : cell('old', oldOn))) }]
    : [{ label: names[0], cells: Array.from({ length: N }, (_, k) => (k < f.ol ? cell('old', oldOn) : null)) },
       { label: names[1], cells: Array.from({ length: N }, (_, k) => (k < f.nu ? cell('new', newOn) : null)) }]
  const RH = 22 + S + 10, top = 74, H = top + rows.length * RH
  const badN = rows.flatMap((r) => r.cells).filter((c) => c && c.bad).length
  return (
    <div ref={ref}>
      <svg className="dps-svg" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`流量分配：舊版 ${pct((1 - f.share) * 100)}%、新版 ${pct(f.share * 100)}%；${f.ol} 個舊版實例、${f.nu} 個新版實例${badN ? `，其中 ${badN} 個舊版實例在報錯` : ''}`}>
        <text x="10" y="14" className="lbl">流量入口：請求怎麼分</text>
        <rect x="10" y="22" width={barW - nw} height="20" rx="3" className="tf old" />
        <rect x={10 + barW - nw} y="22" width={nw} height="20" rx="3" className="tf new" />
        <text x="10" y="58" className="sm">舊版 v1　{pct((1 - f.share) * 100)}%</text>
        <text x={W - 10} y="58" textAnchor="end" className="sm">新版 v2　{pct(f.share * 100)}%</text>
        {rows.map((r, ri) => (
          <g key={ri}>
            <text x={x0} y={top + ri * RH + 12} className="lbl">{r.label}</text>
            {r.cells.map((c, k) => {
              const x = x0 + k * (S + G), y = top + ri * RH + 20
              const cls = !c ? 'none' : `${c.v}${c.idle ? ' idle' : ''}${c.bad ? ' bad' : c.bug ? ' bug' : ''}`
              return (
                <g key={k} className={`cell ${cls}`}>
                  <rect x={x} y={y} width={S} height={S} rx="6" className={c && c.bad ? 'svg-pulse' : ''} />
                  {c && <text x={x + S / 2} y={y + S / 2 - 2} textAnchor="middle" className="v">{c.v === 'old' ? 'v1' : 'v2'}</text>}
                  {c && <text x={x + S / 2} y={y + S - 8} textAnchor="middle" className="s">{c.bad ? '報錯' : c.bug ? '有 bug' : c.idle ? '待命' : '服務中'}</text>}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}
