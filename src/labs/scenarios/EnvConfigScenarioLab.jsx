import React, { useEffect, useState } from 'react'
import { Lab, LabControls, LabGrid, LabExplain, Seg, Toggle, Slider, Callout, Status, Stats, Stat, Flow, Caption, Code, useTicker, Measure } from '../ui.jsx'

/* 多環境設定情境模擬器：同一條 CI → 測試 → 預備 → 正式 → 合作醫院的部署線，三種放設定的方法。
   ① 跑一次部署：每個環境跑的是哪一份建置、SSO 連到哪裡、CSP 有沒有擋下設定
   ② 正式環境臨時關掉線上掛號：每一步要幾分鐘
   ③ 瀏覽器在每個環境收到的設定長什麼樣子
   ④ 讀設定的程式遇到字串 'false'、設定沒載入時會怎樣
   每個做法有一個常見的漏洞可以切換（只建一次、沒設 no-cache、寫成 inline script）。分鐘數是示意。 */

/* 說明文字裡的 `程式碼` 轉成 <code> */
const ic = (s) => String(s).split(/`([^`]+)`/).map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))

const ENVS = [
  { id: 'test', name: '測試', sso: 'sso-test.example', csp: false, booking: true },
  { id: 'staging', name: '預備', sso: 'sso-staging.example', csp: true, booking: true },
  { id: 'prod', name: '正式', sso: 'sso.example', csp: true, booking: true },
  { id: 'north', name: '北區合作醫院', sso: 'sso.north.example', csp: true, booking: false },
]
const HASH = { test: 'a1f3', staging: '7c2e', prod: 'e95b', north: '3d08' }
const OPTS = [
  { value: 'build-time', label: '建置時（VITE_）' },
  { value: 'config-js', label: '執行時：config.js' },
  { value: 'server-inject', label: '執行時：伺服器注入' },
]
const FIX = {
  'build-time': '每個環境各建一次（關掉＝只建一次推上每個環境）',
  'config-js': 'config.js 設 Cache-Control: no-cache',
  'server-inject': '寫成 JSON 資料區塊（關掉＝inline script）',
}

/* 某個環境部署後的結果 */
function deployed(opt, fix, env) {
  if (opt === 'build-time') {
    const hash = fix ? HASH[env.id] : HASH.test
    const sso = fix ? env.sso : ENVS[0].sso
    return { hash, sso, ok: sso === env.sso, note: sso === env.sso ? '' : '連到測試的 SSO' }
  }
  if (opt === 'server-inject' && !fix && env.csp) return { hash: HASH.test, sso: '（設定沒載入）', ok: false, note: 'CSP 擋下 inline script' }
  return { hash: HASH.test, sso: env.sso, ok: true, note: '' }
}
function flagSteps(opt, fix, build) {
  if (opt === 'build-time') return [
    ['改 .env.production：VITE_ONLINE_BOOKING=false', 1],
    ['CI 重新建置、部署', build],
    ['使用者下一次載入頁面才拿到新的 bundle', 0],
  ]
  if (opt === 'config-js') return [
    ['改 ConfigMap 裡的 config.js', 1],
    ['kubelet 把新內容同步進 Pod 的檔案', 1],
    fix ? ['使用者下一次載入：no-cache，瀏覽器向伺服器確認後拿到新檔', 0] : ['瀏覽器快取的舊 config.js 要等 max-age=600 到期', 10],
  ]
  return [
    ['改 ConfigMap 的環境變數', 1],
    ['kubectl rollout restart，新 Pod 接手', 2],
    ['使用者下一次載入 index.html（no-cache）', 0],
  ]
}
function received(opt, fix, env) {
  const cfg = `{ envName: "${env.name}", ssoUrl: "https://${env.sso}/authorize", onlineBooking: ${env.booking} }`
  if (opt === 'build-time') {
    const src = fix ? env : ENVS[0]
    return { lang: 'js', title: `dist/assets/index-${fix ? HASH[env.id] : HASH.test}.js（節錄）`, code: `// 建置時被換成字串常數（vite build --mode ${fix ? env.id : 'test'}）
const SSO_URL = "https://${src.sso}/authorize"
const ONLINE_BOOKING = "${src.booking}"      // 字串：'false' 也是 truthy` }
  }
  if (opt === 'config-js') return { lang: 'http', title: 'GET /config.js', code: `HTTP/1.1 200 OK
Content-Type: text/javascript
Cache-Control: ${fix ? 'no-cache' : 'max-age=600'}

window.__CLINIC_CONFIG__ = ${cfg}` }
  const json = JSON.stringify({ envName: env.name, ssoUrl: `https://${env.sso}/authorize`, onlineBooking: env.booking })
  if (fix) return { lang: 'html', title: 'GET /index.html（檢視原始碼，節錄）', code: `<script type="application/json" id="clinic-config">${json}</script>
<script type="module" src="/assets/index-${HASH.test}.js"></script>` }
  return { lang: 'html', title: 'GET /index.html（檢視原始碼，節錄）', code: `<script>window.__CLINIC_CONFIG__ = ${cfg}</script>
<script type="module" src="/assets/index-${HASH.test}.js"></script>${env.csp ? `

// Console（Content-Security-Policy: script-src 'self'）：
// Executing inline script violates the following Content Security Policy
// directive 'script-src 'self''. … The action has been blocked.` : ''}` }
}

/* ④ 讀設定的程式：正式環境關掉開關之後按鈕還在不在、設定沒載入時畫面會怎樣 */
const READERS = [
  { value: 'naive', label: '直接讀' },
  { value: 'guarded', label: '集中讀取、給預設值' },
]
function readerCode(opt, reader) {
  if (opt === 'build-time') return reader === 'naive'
    ? `if (import.meta.env.VITE_ONLINE_BOOKING) showBookingButton()`
    : `if (import.meta.env.VITE_ONLINE_BOOKING === 'true') showBookingButton()   // 值一律是字串`
  const src = opt === 'config-js' ? 'window.__CLINIC_CONFIG__' : "JSON.parse(document.getElementById('clinic-config').textContent)"
  return reader === 'naive'
    ? `const cfg = ${src}\nconst ssoUrl = cfg.ssoUrl\nif (cfg.onlineBooking) showBookingButton()`
    : `let raw\ntry { raw = ${src} } catch { raw = undefined }   // 讀不到、不是 JSON\nconst { cfg, warnings } = readConfig(raw)            // 缺欄位給預設值，並在 Console 警告\nconst on = cfg.onlineBooking === true || cfg.onlineBooking === 'true'\nif (on) showBookingButton()`
}
function readResult(opt, reader, asString, missing) {
  const runtime = opt !== 'build-time'
  if (runtime && missing) {
    if (reader === 'guarded') return { boot: { tone: 'warn', text: 'Console 警告「找不到設定，使用預設值」；登入按鈕停用，其他畫面照常' }, booking: { tone: 'ok', text: '預設是關閉，按鈕不顯示' } }
    const err = opt === 'config-js'
      ? "TypeError: Cannot read properties of undefined (reading 'ssoUrl')"
      : `SyntaxError: Unexpected token '_', "__CLINIC_CONFIG__" is not valid JSON`
    return { boot: { tone: 'bad', text: `${err}：App 沒有掛載，白畫面` }, booking: null }
  }
  const isString = !runtime || asString
  const stuck = reader === 'naive' && isString
  return {
    boot: { tone: 'ok', text: '正常啟動' },
    booking: stuck ? { tone: 'bad', text: "讀到字串 'false'，if 判斷成立，按鈕還在" } : { tone: 'ok', text: '按鈕不顯示' },
  }
}
function ReadLine({ label, v }) {
  return <li><span>{label}</span>{v ? <b className={`ec-${v.tone}`}>{v.tone === 'ok' ? '✓' : v.tone === 'warn' ? '!' : '✕'} {v.text}</b> : <b className="muted">（App 沒有啟動）</b>}</li>
}
function ReadCheck({ opt }) {
  const [reader, setReader] = useState('naive')
  const [asString, setAsString] = useState(true)
  const [missing, setMissing] = useState(false)
  const runtime = opt !== 'build-time'
  const r = readResult(opt, reader, asString, missing)
  return (
    <div className="ec-read">
      <h5>讀設定的程式：正式環境把線上掛號關掉之後</h5>
      <LabControls>
        <Seg label="讀法" value={reader} onChange={setReader} options={READERS} />
        {runtime && <Toggle label="設定裡把 false 寫成字串 'false'" checked={asString} onChange={setAsString} />}
        {runtime && <Toggle label={opt === 'config-js' ? 'config.js 沒載入（404）' : '伺服器沒有替換佔位字串'} checked={missing} onChange={setMissing} />}
      </LabControls>
      <Code lang="js" title="src/main.js（節錄）">{readerCode(opt, reader)}</Code>
      <ul>
        <ReadLine label="啟動" v={r.boot} />
        <ReadLine label="線上掛號按鈕" v={r.booking} />
      </ul>
      {!runtime && <p className="ec-note">{ic('建置時的值不會缺檔，會缺的是變數本身：少了 `VITE_` 前綴，讀到的就是 undefined。`.env` 寫 `false`，進來一律是字串。')}</p>}
    </div>
  )
}

const EXPLAIN = {
  'build-time': { title: '建置時：值跟著 bundle 走', body: ['`import.meta.env.VITE_SSO_URL` 在建置的那一刻變成字串常數。只建一次再推到每個環境，預備、正式與合作醫院全都連到測試的 SSO；每個環境各建一次才對，但正式跑的就不是測試過的那一份（雜湊不同）。', '合作醫院不跑我們的 CI，只能請我們替它建一份；改一個開關也要重跑整條建置。'] },
  'config-js': { title: 'config.js：同一份建置，各環境送自己的設定', body: ['每個環境的雜湊都一樣，差別只在伺服器送的 `config.js`。合作醫院換一個檔就好，改開關不用重建。', '沒設 `no-cache` 時，瀏覽器可能拿著快取的舊檔到 max-age 到期；託管與 CDN 的預設快取各家不同，這裡用 10 分鐘示意。'] },
  'server-inject': { title: '伺服器注入：設定在 HTML 裡，不多一個請求', body: ['送 `index.html` 的伺服器把設定寫進頁面，可以依網域或每個請求決定，首頁不多一個請求。', '寫成 `<script>window.__CLINIC_CONFIG__ = …</script>`，在 `script-src \'self\'` 的環境會被 CSP 擋下，程式讀到 undefined。改成 `type="application/json"` 的資料區塊：瀏覽器不執行它，CSP 不擋，前端用 `JSON.parse` 讀。'] },
}

export default function EnvConfigScenarioLab() {
  const [opt, setOpt] = useState('config-js')
  const [fixes, setFixes] = useState({ 'build-time': false, 'config-js': false, 'server-inject': false })
  const [build, setBuild] = useState(15)
  const [envId, setEnvId] = useState('prod')
  const [deploying, setDeploying] = useState(false)
  const [dTick, resetD] = useTicker(deploying, 650)
  const [flagging, setFlagging] = useState(false)
  const [fTick, resetF] = useTicker(flagging, 650)
  useEffect(() => { if (dTick >= ENVS.length) setDeploying(false) }, [dTick])
  useEffect(() => { if (fTick >= 3) setFlagging(false) }, [fTick])
  useEffect(() => { setDeploying(false); setFlagging(false) }, [opt])

  const fix = fixes[opt]
  const stage = deploying ? dTick : ENVS.length            // 已經部署到第幾個環境
  const results = ENVS.map((e) => deployed(opt, fix, e))
  const builds = opt === 'build-time' && fix ? ENVS.length : 1
  const okCount = results.filter((r) => r.ok).length
  const prodTested = results[2].hash === HASH.test
  const steps = flagSteps(opt, fix, build)
  const total = steps.reduce((a, s) => a + s[1], 0)
  const shownSteps = flagging ? Math.min(steps.length, fTick + 1) : steps.length
  const env = ENVS.find((e) => e.id === envId)
  const rec = received(opt, fix, env)
  const cspOk = !(opt === 'server-inject' && !fix)
  const ex = EXPLAIN[opt]

  const flowSteps = [
    { label: 'CI 建置', value: builds > 1 ? `建 ${builds} 次` : `建 1 次 · ${HASH.test}`, hot: deploying && stage === 0 },
    ...ENVS.map((e, i) => {
      const r = results[i]
      if (i + 1 > stage) return { label: e.name, value: '（還沒部署）' }
      return { label: e.name, value: `${r.hash} · ${r.sso}${r.ok ? ' ✓' : ' ✕'}`, bad: !r.ok, hot: deploying && stage === i + 1 }
    }),
  ]
  const notes = [
    results.find((r) => !r.ok)?.note && `✕ ${results.filter((r) => !r.ok).length} 個環境：${results.find((r) => !r.ok).note}`,
    opt === 'build-time' && fix && '正式跑的 e95b 不是測試驗證過的 a1f3；北區醫院要我們替它建一份',
  ]

  return (
    <Lab accent="magenta" kicker="SCENARIO LAB" title="同一條部署線，三種放設定的方法：連到哪裡、改一個值要多久、瀏覽器看到什麼"
         blurb="測試 → 預備 → 正式 → 合作醫院；預備以後的環境都有 CSP script-src 'self'（分鐘數是示意）。">
      <LabControls>
        <Seg label="做法" tinted value={opt} onChange={setOpt} options={OPTS} />
        <Toggle label={FIX[opt]} checked={fix} onChange={(v) => setFixes((f) => ({ ...f, [opt]: v }))} />
        {opt === 'build-time' && <Slider label="建置 + 部署" min={5} max={40} value={build} onChange={setBuild} format={(v) => `${v} 分鐘`} />}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={() => { resetD(); setDeploying(true) }} disabled={deploying}>{deploying ? '部署中…' : '▶ 跑一次 CI 與部署'}</button>
            <button type="button" className="btn ghost small" onClick={() => { resetF(); setFlagging(true) }} disabled={flagging}>正式環境臨時關掉線上掛號</button>
          </LabControls>
          <Flow title="每個環境跑的建置（雜湊）與 SSO" steps={flowSteps} notes={notes} />
          <div className="ec-flag" aria-label="關掉線上掛號的步驟">
            <h5>正式環境關掉線上掛號</h5>
            <ol>
              {steps.slice(0, shownSteps).map(([label, m], i) => (
                <li key={i}><span>{label}</span><b>{m ? `+${m} 分` : '—'}</b></li>
              ))}
            </ol>
            {shownSteps === steps.length && (total <= 5
              ? <Status ok>約 {total} 分鐘生效</Status>
              : <Status>約 {total} 分鐘才生效，超過 5 分鐘</Status>)}
            {opt === 'build-time' && !fix && shownSteps === steps.length && <p className="ec-note">只建一次的話，這份建置推到每個環境：測試與預備也會一起關掉。</p>}
            <p className="ec-note">三種做法都一樣：已經開著的頁面要重新整理才會拿到新的值。</p>
          </div>
          <div className="ec-recv">
            <Seg label="瀏覽器收到的設定" value={envId} onChange={setEnvId} options={ENVS.map((e) => ({ value: e.id, label: e.name }))} />
            <Code lang={rec.lang} title={rec.title}>{rec.code}</Code>
          </div>
          <ReadCheck key={opt} opt={opt} />
          <Stats min={128}>
            <Stat label="建置次數" value={builds} />
            <Stat label="正式跑的是測試過的那份" value={prodTested ? '是' : '否'} tone={prodTested ? 'ok' : 'warn'} />
            <Stat label="設定正確的環境" value={`${okCount} / ${ENVS.length}`} tone={okCount === ENVS.length ? 'ok' : 'bad'} />
            <Stat label="關掉功能要多久" value={<Measure kind="set" value={total} unit="分" />} tone={total <= 5 ? 'ok' : 'bad'} />
            <Stat label="首頁多的請求" value={opt === 'config-js' ? 1 : 0} note={opt === 'config-js' ? '同步的 config.js' : ''} />
            <Stat label="CSP script-src 'self'" value={cspOk ? '通過' : '擋下'} tone={cspOk ? 'ok' : 'bad'} />
          </Stats>
          <Caption>kubelet 同步 ConfigMap 通常在一分鐘左右，取決於同步週期與快取；rollout 的時間依映像與探針而定（示意）。</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{ic(p)}</p>)}</LabExplain>
          <LabExplain title="三種做法都公開">
            <p>{ic('bundle、`config.js`、`index.html` 都是送到瀏覽器的檔案，切換上面的環境就看得到內容。地圖金鑰、OAuth 的 client secret 不能放進任何一種；需要金鑰的服務由後端代為呼叫。')}</p>
          </LabExplain>
          <Callout title="什麼時候會踩到">「測試過的映像推到正式」的第一天：正式環境的登入把人導去測試的 SSO。另一種是改了正式環境的開關，一部分使用者十分鐘後還看得到舊功能，因為 config.js 被快取了。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .ec-flag { border: var(--bw) solid var(--line); border-radius: 12px; background: var(--surface-1); box-shadow: 4px 4px 0 var(--shade); padding: 10px 14px; display: grid; gap: 8px; }
        .ec-flag h5 { font-size: 0.82rem; color: var(--ink-1); }
        .ec-flag ol { list-style: none; display: grid; gap: 4px; counter-reset: ec; }
        .ec-flag li { counter-increment: ec; display: flex; justify-content: space-between; gap: 10px; font-size: 0.8rem; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: 6px; animation: ec-in 0.3s ease-out both; }
        .ec-flag li span::before { content: counter(ec) '. '; color: var(--ink-3); font-family: var(--mono); }
        .ec-flag li b { font-family: var(--mono); white-space: nowrap; }
        @keyframes ec-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .ec-flag li { animation: none; } }
        .ec-note { font-size: 0.76rem; color: var(--ink-3); }
        .ec-recv { display: grid; gap: 8px; min-width: 0; }
        .ec-read { border: 2px solid var(--line); border-radius: 12px; background: var(--surface-1); padding: 10px 14px; display: grid; gap: 4px; min-width: 0; }
        .ec-read h5 { font-size: 0.82rem; color: var(--ink-1); }
        .ec-read .lab-controls { margin: 6px 0 8px; }
        .ec-read ul { list-style: none; display: grid; gap: 4px; margin-top: 8px; }
        .ec-read li { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: 8px; font-size: 0.8rem; align-items: baseline; }
        .ec-read li > span { color: var(--ink-3); }
        .ec-read li b { font-weight: 600; overflow-wrap: anywhere; }
        .ec-ok { color: var(--good); }
        .ec-warn { color: var(--serious); }
        .ec-bad { color: var(--critical); }
      `}</style>
    </Lab>
  )
}
