import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, useWidth } from './ui.jsx'

/* ============================================================
   編碼、雜湊、加密：密碼該怎麼存
   - 同一個密碼即時跑三種處理：Base64（可逆）/ SHA-256（單向但快）/ PBKDF2 加鹽慢雜湊（實際量測耗時）
   - 「兩個使用者同密碼」開關：看哪些結果會撞在一起
   - 破解速度數量級示意圖（對數尺度）
   ============================================================ */

const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null
const enc = new TextEncoder()
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const randomHex = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return toHex(a) }
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)))
const b64 = (s) => btoa(String.fromCharCode(...enc.encode(s)))
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))

async function sha256Hex(text) { return toHex(await subtle.digest('SHA-256', enc.encode(text))) }
async function pbkdf2(text, saltHex, iterations) {
  const key = await subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits'])
  const t0 = performance.now()
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256)
  return { hex: toHex(bits), ms: performance.now() - t0 }
}

const FOCUS = {
  b64: {
    label: '編碼', title: 'Base64 是編碼，不是安全機制',
    text: ['編碼的目的是**換一種表示法**（讓二進位資料能塞進只接受文字的地方），任何人都能無條件解回來——按「解回來」就是證明。它沒有金鑰、沒有祕密。', '在資料庫或設定檔裡看到 Base64 過的密碼、token，安全性和明文一模一樣；只是多了一層讓人誤以為有保護的假象。'],
  },
  sha: {
    label: '雜湊', title: '雜湊是單向的：只能驗證，不能取回',
    text: ['雜湊把任意長度的輸入壓成固定長度的指紋，設計上無法反推。登入時把使用者輸入的密碼再雜湊一次、比對指紋即可——系統**從頭到尾不需要知道原密碼**。', '但 SHA-256 是為「快」設計的（檔案校驗、簽章）：一張 GPU 每秒能算數十億次。攻擊者拿到指紋後只要用字典逐一猜，而且沒有 salt 時，同一個密碼的指紋全世界都一樣——查表（彩虹表）就破了。'],
  },
  kdf: {
    label: '加鹽慢雜湊', title: 'salt 打敗查表，work factor 打敗暴力',
    text: ['salt 是每位使用者各自的隨機值，和密碼一起雜湊、明文存在旁邊。它不是祕密——它的工作是讓**同一個密碼在每個帳號產生不同的指紋**，預先算好的表沒用，攻擊者也不能一次猜對全部使用者。', 'iterations（work factor）讓每次計算刻意變慢：對登入的使用者是幾十毫秒，對要猜十億次的攻擊者是幾十年。硬體變快就把參數調高，舊帳號在下次登入時重算。實務上用 argon2id 或 bcrypt（吃記憶體，GPU 更難平行化）；瀏覽器內建只有 PBKDF2，所以這裡拿它示範。'],
  },
  enc: {
    label: '那加密呢？', title: '密碼永遠不加密——加密是給「要拿回來」的資料用的',
    text: ['加密是可逆的：有金鑰就能解回明文。把密碼加密存起來，等於整個系統的安全押在一把金鑰上——金鑰外洩（設定檔進了 git、備份被拿走）就全部明文。密碼只需要「驗證」，所以用雜湊，根本沒有金鑰可以漏。', '加密用在真的需要拿回原值的地方：傳輸中的資料用 TLS（HTTPS）、靜態資料用磁碟／欄位加密（信用卡號、身分證字號），而且金鑰要放在 KMS 這種獨立的地方，不跟資料同處。'],
  },
}
const FOCUS_ORDER = ['b64', 'sha', 'kdf', 'enc']

export default function HashingLab() {
  const [pw, setPw] = useState('hunter2')
  const [iters, setIters] = useState(100000)
  const [saltA, setSaltA] = useState(() => randomHex(16))
  const [saltB] = useState(() => randomHex(16))
  const [two, setTwo] = useState(false)
  const [decoded, setDecoded] = useState(false)
  const [focus, setFocus] = useState('b64')
  const [out, setOut] = useState({ sha: '', kdfA: '', msA: 0, kdfB: '', msB: 0, busy: !!subtle, error: '' })

  useEffect(() => {
    if (!subtle) return
    let live = true
    setOut((o) => ({ ...o, busy: true }))
    const t = setTimeout(async () => {
      try {
        const sha = await sha256Hex(pw)
        const a = await pbkdf2(pw, saltA, iters)
        const b = two ? await pbkdf2(pw, saltB, iters) : { hex: '', ms: 0 }
        if (live) setOut({ sha, kdfA: a.hex, msA: a.ms, kdfB: b.hex, msB: b.ms, busy: false, error: '' })
      } catch (e) { if (live) setOut((o) => ({ ...o, busy: false, error: e.message })) }
    }, 180)
    return () => { live = false; clearTimeout(t) }
  }, [pw, saltA, saltB, iters, two])

  const encoded = b64(pw)
  const f = FOCUS[focus]
  const ms = out.msA
  const perSec = ms > 0 ? Math.round(1000 / ms) : null
  const noCrypto = <p className="hsh-nocrypto">此環境沒有 <code>crypto.subtle</code>（需要 HTTPS 或 localhost），無法在瀏覽器裡計算雜湊。</p>

  return (
    <Lab className="hsh" accent="red" kicker="SECURITY LAB" title="編碼、雜湊、加密：密碼該怎麼存"
         blurb="改一改密碼，看同一個輸入經過 Base64、SHA-256、加鹽 PBKDF2 各變成什麼。打開「兩個使用者用同一組密碼」看哪些結果會撞在一起；拉動 iterations 感受「慢」是刻意設計的。">
      <LabControls>
        <label className="hsh-pw">
          <span className="seg-label">密碼</span>
          <input className="hsh-pw-input" value={pw} onChange={(e) => setPw(e.target.value)} spellCheck={false} aria-label="密碼" />
        </label>
        <Slider label="PBKDF2 iterations" min={1000} max={600000} step={1000} value={iters} onChange={setIters} format={(v) => v.toLocaleString()} />
        <Toggle label="兩個使用者用同一組密碼" checked={two} onChange={setTwo} />
        <span className="spacer" />
        <Seg label="說明" tinted value={focus} onChange={setFocus} options={FOCUS_ORDER.map((k) => ({ value: k, label: FOCUS[k].label }))} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <div className="hsh-cards">
            <Card k="b64" title="Base64 編碼" on={focus === 'b64'} onFocus={setFocus} verdict={<Status>可逆：不是安全機制</Status>}>
              <Row who="A" value={encoded} />
              {two && <Row who="B" value={encoded} same />}
              <div className="hsh-actions">
                <button type="button" className="btn ghost small" onClick={() => setDecoded((v) => !v)}>{decoded ? '收起' : '解回來'}</button>
                {decoded && <span className="hsh-decoded">atob() → <code>{unb64(encoded)}</code></span>}
              </div>
            </Card>

            <Card k="sha" title="SHA-256 雜湊" on={focus === 'sha'} onFocus={setFocus} verdict={<Status warn>單向，但太快</Status>}>
              {!subtle ? noCrypto : <>
                <Row who="A" value={out.sha} busy={out.busy && !out.sha} />
                {two && <Row who="B" value={out.sha} same />}
                <p className="hsh-meta">沒有 salt：同密碼 → 同指紋（全世界都一樣）</p>
              </>}
            </Card>

            <Card k="kdf" title="加鹽慢雜湊（PBKDF2-SHA256）" on={focus === 'kdf'} onFocus={setFocus} verdict={<Status ok>加鹽＋刻意變慢</Status>}>
              {!subtle ? noCrypto : <>
                <div className="hsh-salt"><span className="tag">salt A</span><code>{saltA}</code><button type="button" className="btn ghost small" onClick={() => setSaltA(randomHex(16))}>換一個 salt</button></div>
                <Row who="A" value={out.kdfA} busy={out.busy} />
                {two && <>
                  <div className="hsh-salt"><span className="tag">salt B</span><code>{saltB}</code></div>
                  <Row who="B" value={out.kdfB} busy={out.busy} diff />
                </>}
                <p className="hsh-meta">{iters.toLocaleString()} 次 iterations · 實測 <b>{out.busy ? '計算中…' : `${ms.toFixed(1)} ms`}</b>{out.error && ` · ${out.error}`}</p>
              </>}
            </Card>
          </div>

          <LabStage plain>
            <SpeedChart perSec={perSec} iters={iters} />
          </LabStage>
        </div>

        <div className="lab-stack">
          <LabExplain title={f.title}>
            {f.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
            {two && focus !== 'enc' && <p><strong>同密碼的兩位使用者：</strong>Base64 與 SHA-256 的結果一模一樣——攻擊者破一個就等於破全部，還能直接看出「這兩個人密碼相同」；PBKDF2 因為 salt 不同，兩個指紋毫無關聯。</p>}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            存密碼一律用框架內建的 password hasher（Django 的 <code>make_password</code>、Rails 的 <code>has_secure_password</code>、Node 的 <code>argon2</code> / <code>bcrypt</code> 套件），它們幫你處理 salt、參數與升級。
            <b>別自己發明</b>：自己拼 SHA-256 + salt、自己選 iterations，幾乎一定比預設弱。忘記密碼是「重設」，永遠不是「寄回原密碼」——存得對就寄不出來。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .hsh .slider { min-width: 250px; }
        .hsh .lab-grid > * { min-width: 0; }
        .hsh-pw { display: inline-flex; align-items: center; gap: 10px; }
        .hsh-pw-input { font-family: var(--mono); font-size: 0.86rem; color: var(--ink-1); background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 6px 10px; width: 160px; }
        .hsh-pw-input:focus { outline: 2px solid var(--lab-accent); outline-offset: 1px; border-color: transparent; }
        .hsh-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
        @media (max-width: 900px) { .hsh-cards { grid-template-columns: 1fr; } }
        .hsh-card { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); padding: 12px 14px; display: grid; gap: 8px; cursor: pointer; transition: border-color 0.2s ease, box-shadow 0.2s ease; text-align: left; font: inherit; color: inherit; }
        .hsh-card.on { border-color: var(--lab-accent); box-shadow: inset 0 3px 0 var(--lab-accent); }
        .hsh-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
        .hsh-card-head b { font-size: 0.9rem; color: var(--ink-1); }
        .hsh-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; }
        .hsh-who { font-family: var(--mono); font-size: 0.68rem; font-weight: 700; color: var(--ink-3); border: 1px solid var(--hairline); border-radius: 3px; padding: 1px 6px; margin-top: 3px; }
        .hsh-out { font-family: var(--mono); font-size: 0.74rem; line-height: 1.5; color: var(--ink-1); word-break: break-all; background: var(--surface-2); border-radius: 3px; padding: 5px 8px; min-height: 1.8em; transition: background 0.3s ease; }
        .hsh-out.same { background: color-mix(in srgb, var(--critical) 16%, var(--surface-2)); }
        .hsh-out.diff { background: color-mix(in srgb, var(--good) 14%, var(--surface-2)); }
        .hsh-out.busy { color: var(--ink-3); font-style: italic; }
        .hsh-cmp { grid-column: 2; font-size: 0.74rem; font-weight: 700; }
        .hsh-cmp.same { color: var(--critical); } .hsh-cmp.diff { color: var(--good); }
        .hsh-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.8rem; color: var(--ink-2); }
        .hsh-decoded code { font-family: var(--mono); color: var(--ink-1); background: var(--surface-2); padding: 1px 6px; border-radius: 3px; }
        .hsh-salt { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.74rem; }
        .hsh-salt code { font-family: var(--mono); color: var(--ink-2); word-break: break-all; }
        .hsh-meta { font-size: 0.76rem; color: var(--ink-3); } .hsh-meta b { color: var(--ink-1); font-family: var(--mono); }
        .hsh-nocrypto { font-size: 0.8rem; color: var(--serious); } .hsh-nocrypto code { font-family: var(--mono); }
        .hsh-bar { transition: width 0.4s ease; }
        .hsh-axis { stroke: var(--hairline); stroke-width: 1; }
        .hsh-note { font-size: 0.76rem; color: var(--ink-3); text-align: center; margin-top: 6px; }
        .hsh-note b { color: var(--ink-1); font-family: var(--mono); }
      `}</style>
    </Lab>
  )
}

function md(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function Card({ k, title, verdict, on, onFocus, children }) {
  return (
    <div className={`hsh-card${on ? ' on' : ''}`} onClick={() => onFocus(k)} title="點一下切換右側說明">
      <div className="hsh-card-head"><b>{title}</b>{verdict}</div>
      {children}
    </div>
  )
}

function Row({ who, value, same, diff, busy }) {
  return (
    <div className="hsh-row">
      <span className="hsh-who">{who}</span>
      <code className={`hsh-out${same ? ' same' : diff ? ' diff' : ''}${busy ? ' busy' : ''}`}>{busy ? '計算中…' : value || '（空字串）'}</code>
      {same && <span className="hsh-cmp same">✕ 與 A 完全相同——撞出一個就撞出全部</span>}
      {diff && <span className="hsh-cmp diff">✓ 與 A 不同——salt 不同，指紋就不同</span>}
    </div>
  )
}

/* 破解速度數量級（對數尺度、示意）：兩根細條、直接標籤 */
const BARS = [
  { label: '快雜湊（SHA-256，一張 GPU）', v: 1e10, tip: '≈ 100 億次／秒', tone: 'var(--critical)' },
  { label: '慢雜湊（PBKDF2 / bcrypt / argon2）', v: 5e3, tip: '≈ 數千次／秒', tone: 'var(--good)' },
]
const TICKS = [[0, '1'], [3, '1 千'], [6, '100 萬'], [9, '10 億']]
function SpeedChart({ perSec, iters }) {
  const ref = useRef(null)
  const w = useWidth(ref, 640)
  const W = Math.max(320, w)
  const narrow = W < 520
  const x0 = narrow ? 8 : 230
  const x1 = W - 100
  const px = (x1 - x0) / 10.5
  const rowH = narrow ? 44 : 30
  const top = 22
  const H = top + BARS.length * rowH + 26
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="破解速度數量級示意圖：快雜湊每秒約百億次，慢雜湊每秒約數千次">
        <text x={x0} y="12" className="svg-text small">每秒可嘗試的密碼數（對數尺度・示意）</text>
        {TICKS.map(([d, t]) => (
          <g key={d}>
            <line x1={x0 + d * px} x2={x0 + d * px} y1={top} y2={H - 22} className="hsh-axis" />
            <text x={x0 + d * px} y={H - 8} textAnchor="middle" className="svg-text small">{t}</text>
          </g>
        ))}
        {BARS.map((b, i) => {
          const y = top + i * rowH + (narrow ? 18 : 8)
          const wdt = Math.log10(b.v) * px
          return (
            <g key={b.label}>
              <title>{b.label}：{b.tip}</title>
              {narrow
                ? <text x={x0} y={y - 5} className="svg-text small">{b.label}</text>
                : <text x={x0 - 10} y={y + 10} textAnchor="end" className="svg-text small">{b.label}</text>}
              <path className="hsh-bar" d={`M${x0} ${y} h${wdt - 4} q4 0 4 4 v6 q0 4 -4 4 h${-(wdt - 4)} z`} fill={b.tone} />
              <text x={x0 + wdt + 8} y={y + 11} className="svg-text">{b.tip}</text>
            </g>
          )
        })}
      </svg>
      <p className="hsh-note">你的瀏覽器單執行緒 PBKDF2（{iters.toLocaleString()} 次）：{perSec ? <>每秒約 <b>{perSec.toLocaleString()}</b> 次</> : '量測中…'}——GPU 叢集會再快幾個數量級，所以參數要留餘裕。</p>
    </div>
  )
}
