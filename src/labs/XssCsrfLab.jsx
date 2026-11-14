import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, Status, Stats, Stat, useWidth } from './ui.jsx'

/* ============================================================
   XSS 與 CSRF：兩種攻擊各擋在哪一層
   - XSS：留言板 / 暱稱欄把輸入放進 HTML。左邊是伺服器送出的 HTML，右邊是瀏覽器怎麼解讀；
     防線：依情境跳脫 → CSP → HttpOnly（只讓 cookie 帶不走）
   - CSRF：惡意網站替已登入的使用者送出轉帳表單，逐步播放 cookie 有沒有被帶上、伺服器在哪一步拒絕；
     防線：SameSite → 檢查 Origin → CSRF token
   - 範例只用課文的兩個教科書輸入；網域、cookie 值、收款人都是虛構的
   ============================================================ */

const CSP = "script-src 'self'; object-src 'none'; base-uri 'none'"
const CTX = {
  body: {
    label: 'HTML 內文', head: '<h2>商品留言</h2>', tpl: '<p>{{ comment }}</p>', input: '好用！<script>alert(1)</script>',
    raw: '<p>好用！<script>alert(1)</script></p>', esc: '<p>好用！&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    parsed: '伺服器端模板把留言原樣放進 HTML，瀏覽器分不出哪些字元來自模板、哪些來自使用者，把它解析成一個 `<script>` 元素。',
    asText: '模板把 `<`、`>`、`&` 換成 HTML 實體（`&lt;` 等），瀏覽器解析時只看到一段文字，原樣顯示在留言裡。',
    cspMsg: 'Refused to execute inline script because it violates the following Content Security Policy directive: "script-src \'self\'" …',
  },
  attr: {
    label: 'HTML 屬性值', head: '<h2>修改暱稱</h2>', tpl: '<input value="{{ name }}">', input: '" autofocus onfocus="alert(1)',
    raw: '<input value="" autofocus onfocus="alert(1)">', esc: '<input value="&quot; autofocus onfocus=&quot;alert(1)">',
    parsed: '輸入裡的引號提前結束了屬性值，後面的 `autofocus` 與 `onfocus` 變成輸入框自己的屬性，頁面一載入就觸發。',
    asText: '屬性值加了引號，值裡的 `"` 也被換成 `&quot;`，引號沒辦法提前結束屬性值，整串輸入只是輸入框裡的文字。',
    cspMsg: 'Refused to execute inline event handler because it violates the following Content Security Policy directive: "script-src \'self\'" …',
  },
}
const XSS = {
  text: { status: '被當成文字', ok: true, title: '被當成文字：資料沒有變成標記', by: '依情境跳脫',
    more: '跳脫要**依情境**：內文處理 `<`、`>`、`&`，屬性值還要加引號並跳脫引號。這是主要防線；CSP 與 HttpOnly 這次都沒有派上用場。' },
  csp: { status: '被 CSP 擋下', ok: true, title: '跳脫漏掉了，但 CSP 不讓它執行', by: 'CSP',
    more: "回應帶了 `Content-Security-Policy: script-src 'self'`：只執行同源的 script 檔，inline script 預設被擋，瀏覽器拒絕執行並在主控台留下訊息。CSP 是跳脫漏掉時的最後一道，不能取代跳脫；寫了 `'unsafe-inline'` 就幾乎失去防 XSS 的效果。" },
  nocookie: { status: '腳本跑了，但讀不到 cookie', title: '腳本跑了，只是讀不到 cookie',
    more: '`HttpOnly` 讓 `document.cookie` 看不到 session cookie，攻擊者偷不走它、無法在自己的機器上冒用。但 script 就在受害者的頁面裡，從這裡發出的請求，瀏覽器照樣附上這個 cookie。HttpOnly 限制的是「cookie 被帶走」，不是「XSS 能造成的傷害」。' },
  run: { status: '被當成腳本執行', title: '資料被當成程式碼執行',
    more: '`alert(1)` 只是證明「能執行任意 JavaScript」的教科書寫法。之後每個打開這個頁面的人，瀏覽器都會執行它，而且是在受害者的頁面裡、用受害者的登入狀態。' },
}

export default function XssCsrfLab() {
  const [scen, setScen] = useState('xss')
  const [ctx, setCtx] = useState('body')
  const [def, setDef] = useState({ escape: false, csp: false, httpOnly: false, token: false, origin: false })
  const [sameSite, setSameSite] = useState('None')
  const { step, setStep, playing, toggle } = usePlayer(5, 1600)
  const ref = useRef(null)
  const W = Math.max(300, useWidth(ref, 640) - 38)
  const on = (k) => (v) => setDef((d) => ({ ...d, [k]: v }))

  // ---- XSS：依序看哪一道先生效 ----
  const c = CTX[ctx]
  const kind = def.escape ? 'text' : def.csp ? 'csp' : def.httpOnly ? 'nocookie' : 'run'
  const x = XSS[kind]
  const html = ['HTTP/1.1 200 OK', 'Content-Type: text/html; charset=utf-8', ...(def.csp ? [`Content-Security-Policy: ${CSP}`] : []), '', c.head, def.escape ? c.esc : c.raw]
  const consoleLines = {
    text: [['muted', '（沒有任何腳本執行）']],
    csp: [['err', c.cspMsg]],
    nocookie: [['warn', 'alert(1) 執行了'], ['muted', 'document.cookie → ""（sid 是 HttpOnly，看不到）'], ['err', '這個頁面發出的請求，瀏覽器照樣附上 sid']],
    run: [['warn', 'alert(1) 執行了'], ['err', 'document.cookie → "sid=k8Jf2…"（讀得到，帶得走）']],
  }[kind]

  // ---- CSRF：SameSite 在瀏覽器端決定帶不帶 cookie，其餘兩道在伺服器端 ----
  const sent = sameSite === 'None'
  const by = !sent ? `SameSite=${sameSite}` : def.origin ? '檢查 Origin' : def.token ? 'CSRF token' : null
  const backups = [sent ? null : def.origin && '檢查 Origin', (!sent || def.origin) && def.token && 'CSRF token'].filter(Boolean)
  const resp = !sent ? { code: '401 未登入', short: '沒有 cookie → 當成未登入' }
    : def.origin ? { code: '403 拒絕', short: 'Origin 不在允許清單 → 拒絕' }
    : def.token ? { code: '403 拒絕', short: '表單沒有 csrf_token → 拒絕' }
    : { code: '200 轉帳完成', short: '認得 cookie → 執行轉帳' }
  const req = ['POST /transfer HTTP/1.1', 'Host: bank.example', 'Origin: https://evil.example.net', ...(sent ? ['Cookie: sid=k8Jf2…'] : []), 'Content-Type: application/x-www-form-urlencoded', '', 'to=mallory&amount=1000']
  const reqHl = step < 3 ? [] : !sent ? [] : def.origin ? [3] : def.token ? [req.length] : [4]
  const csrfText = [
    ['使用者已經登入銀行', `瀏覽器存著 \`bank.example\` 的 session cookie（\`SameSite=${sameSite}\`）。使用者沒有登出，在另一個分頁打開了 \`evil.example.net\`。`],
    ['惡意網頁自動送出表單', '頁面裡有一個自動送出的表單，目標是 `POST https://bank.example/transfer`。使用者什麼都沒按。攻擊者的程式是在**別的網站**的頁面裡執行，讀不到銀行頁面的任何內容，只能送出請求。'],
    ['瀏覽器決定要不要附上 cookie', sameSite === 'None' ? '`SameSite=None`：跨站請求一律帶 cookie。CSRF 利用的就是「瀏覽器會自動附上 cookie」。'
      : sameSite === 'Lax' ? '`SameSite=Lax`：只有「頂層導覽的 GET」（點連結）會帶；跨站的 POST 表單不帶。請求照樣送到銀行，只是沒有 cookie。'
      : '`SameSite=Strict`：跨站一律不帶。代價是從外部連結點進來時也不帶，使用者會看起來像沒登入。'],
    ['伺服器檢查這個請求', !sent ? `請求裡沒有 session cookie，伺服器認不出是誰，當成未登入處理。${backups.length ? `就算 cookie 被帶上，後面還有別的防線（${backups.join('、')}）會擋。` : ''}`
      : def.origin ? '瀏覽器在 POST 請求上附了 `Origin: https://evil.example.net`，網頁裡的 JavaScript 無法偽造它。伺服器比對允許清單，不在裡面就拒絕。'
      : def.token ? '改狀態的請求必須帶和 session 綁定的 `csrf_token`。外部網站讀不到銀行頁面的內容（同源政策），拿不到 token；表單裡沒有這個欄位，伺服器比對失敗。'
      : 'cookie 有效，請求裡也沒有任何攻擊者無法得知或無法偽造的值。伺服器看到的就是使用者本人的操作。'],
    by ? ['請求被拒，帳戶沒有變動', `擋下它的是 **${by}**。${backups.length ? `排在後面的防線（${backups.join('、')}）這次沒有輪到。` : '目前只有這一道；實務上會疊起來用。'}`]
      : ['轉帳被執行了', '惡意網站讀不到回應（只能送出請求），但錢已經轉出去。CSRF 成立的三個條件都滿足：瀏覽器自動附上憑證、請求的效果有價值、請求裡沒有攻擊者無法偽造的值。'],
  ]
  const [title, text] = scen === 'xss' ? [x.title, null] : csrfText[step]
  const send = () => { setStep(0); toggle() }

  return (
    <Lab className="xc" accent="red" kicker="SECURITY LAB" title="XSS 與 CSRF：兩種攻擊各擋在哪一層"
         blurb="XSS 是攻擊者的程式在你的網站頁面裡執行；CSRF 是別的網站借用瀏覽器自動附上的 cookie 送出請求。機制相反，防線也不同。切換情境，一道一道打開防線，看它在哪一層生效、哪些防線根本不相干。">
      <LabControls>
        <Seg label="情境" tinted value={scen} onChange={setScen}
             options={[{ value: 'xss', label: 'XSS：頁面顯示使用者輸入' }, { value: 'csrf', label: 'CSRF：別的網站替你送出轉帳表單' }]} />
        {scen === 'xss' ? <>
          <Seg label="輸出位置" value={ctx} onChange={setCtx} options={Object.keys(CTX).map((k) => ({ value: k, label: CTX[k].label }))} />
          <Toggle label="輸出時依情境跳脫" checked={def.escape} onChange={on('escape')} />
          <Toggle label="CSP" checked={def.csp} onChange={on('csp')} />
        </> : <>
          <Seg label="SameSite" mono value={sameSite} onChange={setSameSite} options={['Lax', 'Strict', 'None'].map((v) => ({ value: v, label: v }))} />
          <Toggle label="CSRF token" checked={def.token} onChange={on('token')} />
          <Toggle label="檢查 Origin" checked={def.origin} onChange={on('origin')} />
        </>}
        <Toggle label="HttpOnly cookie" checked={def.httpOnly} onChange={on('httpOnly')} />
        {scen === 'csrf' && <>
          <span className="spacer" />
          <button type="button" className="btn small xc-send" onClick={send}>送出跨站請求</button>
          <Stepper step={step} total={5} onStep={setStep} playing={playing} onPlay={toggle} />
        </>}
      </LabControls>

      <div ref={ref}>
        {scen === 'xss' ? (
          <LabGrid variant="even">
            <div className="lab-stack">
              <Code lang="http" title="伺服器送出的 HTML" highlight={[html.length]}>{html.join('\n')}</Code>
              <p className="xc-tpl">模板 <code>{c.tpl}</code>　輸入 <code>{c.input}</code></p>
            </div>
            <LabStage label="瀏覽器怎麼解讀這份 HTML">
              <div className="xc-browser">
                <div className="xc-bar"><i /><i /><i /><span>https://shop.example.com/products/42</span></div>
                <div className="xc-page">
                  {ctx === 'body' ? <>
                    <b>商品留言</b>
                    <p>{def.escape ? c.input : <>好用！<span className="xc-node">script 元素（畫面上看不到）</span></>}</p>
                  </> : <>
                    <b>修改暱稱</b>
                    <span className={`xc-input${def.escape ? '' : ' focus'}`}>{def.escape ? c.input : ''}</span>
                    {!def.escape && <span className="xc-node">輸入框多了 autofocus、onfocus 兩個屬性</span>}
                  </>}
                </div>
                <div className="xc-console">
                  <b>CONSOLE</b>
                  {consoleLines.map(([k, t], i) => <span key={i} className={k}>{t}</span>)}
                </div>
              </div>
              <div className="xc-verdict">
                <span className="seg-label">瀏覽器的解讀</span>
                {x.ok ? <Status ok>{x.status}</Status> : <Status>{x.status}</Status>}
                <span className="muted">cookie <code>sid</code>：{def.httpOnly ? '有 HttpOnly' : '沒有 HttpOnly'}</span>
              </div>
            </LabStage>
          </LabGrid>
        ) : (
          <LabStage label="惡意網站、瀏覽器、銀行之間的跨站請求" caption="網域、cookie 值與收款人都是虛構的（示意）">
            <CsrfDiagram W={W} step={step} sameSite={sameSite} sent={sent} blocked={!!by} resp={resp} />
          </LabStage>
        )}
      </div>

      <Stats min={200} className="xc-stats">
        {scen === 'xss' ? <>
          <Stat label="這次的結果" value={x.ok ? '被擋下' : '腳本執行'} tone={x.ok ? 'ok' : 'bad'}
                note={{ text: '顯示成一段文字', csp: '瀏覽器拒絕執行', nocookie: '讀不到 cookie，仍能用受害者的身分發請求', run: '在受害者的頁面裡，也讀得到 cookie' }[kind]} />
          <Stat label="是哪一道擋下的" value={x.by || '沒有擋下'} tone={x.by ? '' : 'bad'}
                note={kind === 'nocookie' ? 'HttpOnly 只讓 cookie 帶不走，擋不住執行' : kind === 'run' ? '三道都沒開' : kind === 'text' ? '後面兩道沒有輪到' : '跳脫才是主要防線'} />
          <Stat label="對這個情境沒有作用" value="SameSite、CSRF token、檢查 Origin" note="script 在你的頁面裡：同源請求照常帶 cookie，也讀得到頁面上的 token" />
        </> : <>
          <Stat label="這次請求的結果" value={by ? '被擋' : '轉帳成功'} tone={by ? 'ok' : 'bad'} note={by ? resp.short : '伺服器分不出這不是本人送的'} />
          <Stat label="是哪一道擋下的" value={by || '沒有擋下'} tone={by ? '' : 'bad'}
                note={by ? (backups.length ? `後面還有：${backups.join('、')}` : '只有這一道') : 'SameSite=None，也沒有 token 與 Origin 檢查'} />
          <Stat label="對這個情境沒有作用" value="HttpOnly、輸出跳脫、CSP"
                note={`${def.httpOnly ? 'HttpOnly 開著也一樣：' : ''}cookie 沒有被讀走，是瀏覽器自動附上的`} />
        </>}
      </Stats>

      <LabGrid variant="even">
        <div className="lab-stack">
          {scen === 'csrf' && <Code lang="http" title={sent ? '銀行收到的請求' : '銀行收到的請求（沒有 Cookie 標頭）'} highlight={reqHl} dim>{req.join('\n')}</Code>}
          <LabExplain title={title}>
            {scen === 'xss' ? <>
              <p><Md>{def.escape ? c.asText : c.parsed}</Md></p>
              <p><Md>{x.more}</Md></p>
            </> : <p><Md>{text}</Md></p>}
            {scen === 'csrf' && step === 0 && <p>按「送出跨站請求」逐步播放；防線可以隨時開關，結果會跟著變。</p>}
          </LabExplain>
        </div>
        <Callout title="什麼時候會真的踩到">
          <b>XSS</b>：模板用了 safe 過濾器、<code>Markup()</code> 或 React 的 <code>dangerouslySetInnerHTML</code>，關掉了自動跳脫；屬性值沒加引號；為了消除主控台訊息，在 CSP 加上 <code>'unsafe-inline'</code>。<br />
          <b>CSRF</b>：用 cookie 認人，框架卻沒有內建 CSRF middleware（FastAPI 這類 API 框架要自己補）；cookie 設成 <code>SameSite=None</code>；用 GET 改狀態——<code>Lax</code> 允許頂層 GET 帶 cookie。<br />
          有 XSS 時 CSRF 防護基本上失效：script 在你的頁面裡，可以先讀出 CSRF token 再送請求。常見的組合是 <code>SameSite=Lax; Secure; HttpOnly</code>、改狀態只用非 GET 方法、伺服器檢查 Origin，表單型網站再加 CSRF token。
        </Callout>
      </LabGrid>

      <style>{`
        .xc .lab-grid { margin-top: 14px; }
        .xc-send { background: var(--lab-accent); border-color: var(--lab-accent); }
        .xc-tpl { font-size: 0.76rem; color: var(--ink-3); line-height: 1.8; }
        .xc-tpl code, .xc-verdict code { font-family: var(--mono); color: var(--ink-1); background: var(--surface-2); padding: 1px 6px; border-radius: 3px; overflow-wrap: anywhere; }
        .xc-browser { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); overflow: hidden; }
        .xc-bar { display: flex; align-items: center; gap: 5px; padding: 6px 10px; border-bottom: 1px solid var(--hairline); background: var(--surface-2); font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
        .xc-bar i { width: 8px; height: 8px; border-radius: 50%; background: var(--hairline); flex-shrink: 0; }
        .xc-bar span { margin-left: 6px; min-width: 0; overflow-wrap: anywhere; }
        .xc-page { display: grid; gap: 8px; justify-items: start; padding: 12px 14px; min-height: 96px; align-content: start; font-size: 0.86rem; color: var(--ink-1); overflow-wrap: anywhere; }
        .xc-node { display: inline-block; font-size: 0.72rem; font-weight: 600; color: var(--critical); border: 1px dashed color-mix(in srgb, var(--critical) 55%, transparent); border-radius: 3px; padding: 1px 7px; }
        .xc-input { display: block; width: 100%; min-height: 2.3em; padding: 6px 10px; font-family: var(--mono); font-size: 0.8rem; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); transition: box-shadow 0.2s ease; }
        .xc-input.focus { box-shadow: 0 0 0 2px var(--critical); }
        .xc-console { display: grid; gap: 4px; padding: 8px 12px 10px; border-top: 1px solid var(--hairline); background: var(--surface-2); font-family: var(--mono); font-size: 0.74rem; line-height: 1.5; color: var(--ink-2); overflow-wrap: anywhere; }
        .xc-console b { font-size: 0.64rem; letter-spacing: 0.1em; color: var(--ink-3); }
        .xc-console .err { color: var(--critical); } .xc-console .warn { color: var(--serious); } .xc-console .muted { color: var(--ink-3); }
        .xc-verdict { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: 12px; font-size: 0.78rem; }
        .xc-stats .lab-stat .v { font-size: 0.95rem; font-family: var(--sans); line-height: 1.4; }
        .xc-box { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease; }
        .xc-box.on { stroke: var(--lab-accent); stroke-width: 2; }
        .xc-arrow line { stroke: var(--hairline); stroke-width: 2; transition: stroke 0.25s ease; }
        .xc-arrow polygon { fill: var(--hairline); transition: fill 0.25s ease; }
        .xc-arrow text { opacity: 0; transition: opacity 0.25s ease; }
        .xc-arrow.on text, .xc-arrow.ok text, .xc-arrow.bad text { opacity: 1; }
        .xc-arrow.on line { stroke: var(--lab-accent); } .xc-arrow.on polygon { fill: var(--lab-accent); }
        .xc-arrow.ok line { stroke: var(--good); } .xc-arrow.ok polygon { fill: var(--good); }
        .xc-arrow.bad line { stroke: var(--critical); } .xc-arrow.bad polygon { fill: var(--critical); }
        .xc-strong { font-weight: 700; }
      `}</style>
    </Lab>
  )
}

/* 三個節點：寬版橫排、窄版直排（viewBox 寬度 = 容器寬度，文字不會被縮小） */
function CsrfDiagram({ W, step, sameSite, sent, blocked, resp }) {
  const wide = W >= 600
  const bw = wide ? 190 : W - 12, bh = 78, gap = wide ? (W - 3 * bw - 12) / 2 : 56
  const at = (i) => (wide ? { x: 6 + i * (bw + gap), y: 8 } : { x: 6, y: 6 + i * (bh + gap) })
  const H = wide ? bh + 18 : 3 * bh + 2 * gap + 12
  const nodes = [
    { t: '惡意網站', s: 'evil.example.net', d: '頁面裡有自動送出的表單', on: step === 1 },
    { t: '使用者的瀏覽器', s: `sid · SameSite=${sameSite}`, d: step >= 2 ? (sent ? '跨站請求：附上 cookie' : '跨站請求：不附 cookie') : '已登入 bank.example', on: step === 2 },
    { t: '銀行', s: 'bank.example', d: step >= 3 ? resp.short : '靠 session cookie 認人', on: step >= 3 },
  ]
  // 第 i 段請求（往右 / 往下）與最後的回應（往左 / 往上）
  const seg = (i, back) => {
    const a = at(i), b = at(i + 1)
    if (wide) { const y = a.y + (back ? 56 : 26); return back ? [b.x - 5, y, a.x + bw + 5, y] : [a.x + bw + 5, y, b.x - 5, y] }
    const x = back ? W - 34 : 34
    return back ? [x, b.y - 5, x, a.y + bh + 5] : [x, a.y + bh + 5, x, b.y - 5]
  }
  const arrows = [
    { p: seg(0), cls: step >= 1 ? 'on' : '', label: '表單自動送出' },
    { p: seg(1), cls: step >= 3 ? 'on' : '', label: sent ? 'POST ＋ cookie' : 'POST，沒帶 cookie' },
    { p: seg(1, true), cls: step >= 4 ? (blocked ? 'ok' : 'bad') : '', label: resp.code, back: true },
  ]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`跨站請求示意：惡意網站讓瀏覽器對銀行送出 POST，${sent ? '帶著' : '沒帶'} cookie，結果 ${resp.code}`}>
      {arrows.map(({ p: [x1, y1, x2, y2], cls, label, back }, i) => {
        const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1)
        const head = wide ? `${x2},${y2} ${x2 - 8 * dx},${y2 - 5} ${x2 - 8 * dx},${y2 + 5}` : `${x2},${y2} ${x2 - 5},${y2 - 8 * dy} ${x2 + 5},${y2 - 8 * dy}`
        return (
          <g key={i} className={`xc-arrow ${cls}`}>
            <line x1={x1} y1={y1} x2={x2 - 6 * dx} y2={y2 - 6 * dy} />
            <polygon points={head} />
            {wide ? <text x={(x1 + x2) / 2} y={y1 - 7} textAnchor="middle" className="svg-text">{label}</text>
              : <text x={back ? x1 - 9 : x1 + 9} y={(y1 + y2) / 2 + 4} textAnchor={back ? 'end' : 'start'} className="svg-text">{label}</text>}
          </g>
        )
      })}
      {nodes.map((n, i) => {
        const { x, y } = at(i)
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={bh} rx="4" className={`xc-box${n.on ? ' on' : ''}`} />
            <text x={x + 12} y={y + 22} className="svg-text xc-strong">{n.t}</text>
            <text x={x + 12} y={y + 42} className="svg-mono">{n.s}</text>
            <text x={x + 12} y={y + 62} className="svg-text small">{n.d}</text>
          </g>
        )
      })}
    </svg>
  )
}

/* `code` 與 **粗體** 轉成 React 節點（不走 innerHTML，文字裡的 <script> 只會是文字） */
function Md({ children }) {
  return String(children).split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, i) => (
    s[0] === '`' ? <code key={i}>{s.slice(1, -1)}</code> : s.startsWith('**') ? <strong key={i}>{s.slice(2, -2)}</strong> : s))
}
