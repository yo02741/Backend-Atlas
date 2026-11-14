import React, { useEffect, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Callout, Status } from './ui.jsx'

/* ============================================================
   密碼學工具箱：四種工具各解決什麼
   - 雜湊 / HMAC / AES-GCM / 簽章，全部用瀏覽器的 crypto.subtle 真的計算
   - 上半是發送方算出來的東西，下半是接收方拿到的東西與驗證結果；
     竄改訊息、竄改輸出、換金鑰、重用 nonce 都作用在「接收方拿到的」那一份
   - 金鑰每次載入隨機產生、只存在這個分頁；訊息是虛構的
   ============================================================ */

const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null
const enc = new TextEncoder(), dec = new TextDecoder()
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
const rand = (n) => crypto.getRandomValues(new Uint8Array(n))
const flip = (buf) => { const a = new Uint8Array(buf).slice(); a[0] ^= 1; return a }   // 複製一份，改掉第一個位元組
const M2 = '{"event":"refund","order_id":2002}'   // nonce 示範用的第二筆訊息
const ECDSA = { name: 'ECDSA', hash: 'SHA-256' }

/* 把訊息改一個字：有數字就把最後一個數字加一，否則換掉最後一個字 */
function tamperText(s) {
  const ch = Array.from(s)
  let i = ch.length - 1
  for (let j = ch.length - 1; j >= 0; j--) if (/\d/.test(ch[j])) { i = j; break }
  if (i < 0) return { pre: '', ch: 'x', post: '' }
  const n = /\d/.test(ch[i]) ? String((Number(ch[i]) + 1) % 10) : ch[i] === 'x' ? 'y' : 'x'
  return { pre: ch.slice(0, i).join(''), ch: n, post: ch.slice(i + 1).join('') }
}

async function makeKeys() {
  const one = async () => {
    const h = rand(32), a = rand(32)
    const ec = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    return {
      hmac: await subtle.importKey('raw', h, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
      aes: await subtle.importKey('raw', a, 'AES-GCM', false, ['encrypt', 'decrypt']),
      ec, id: { hmac: hex(h).slice(0, 8), aes: hex(a).slice(0, 8), sig: hex(await subtle.exportKey('raw', ec.publicKey)).slice(2, 10) },
    }
  }
  return { a: await one(), b: await one() }
}

const TOOLS = {
  hash: { label: '雜湊', algo: 'SHA-256', out: '摘要', key: '不需要金鑰', props: [0, 1, 0, 0], pass: '摘要相符', fail: '雜湊對不上',
    title: '雜湊：這份資料有沒有變？',
    text: ['雜湊把任意長度的輸入變成固定長度的摘要：從摘要推不回輸入，訊息只改一個字，摘要就完全不同。接收方把收到的訊息再算一次，和收到的摘要比對。',
      '雜湊沒有金鑰，**任何人都能算**。把訊息和它的 SHA-256 放在同一個地方，攻擊者改了訊息也能順手改摘要；所以摘要只在「本身從可信的管道取得」時有意義，例如 lock 檔裡記錄的套件雜湊。'] },
  hmac: { label: 'HMAC', algo: 'HMAC-SHA-256', out: 'HMAC', key: '共享 secret', props: [0, 1, 1, 0], pass: 'HMAC 驗證通過', fail: 'HMAC 驗證失敗',
    title: 'HMAC：是不是持有 secret 的人產生、且沒被改？',
    text: ['金鑰在兩層雜湊都參與，沒有 secret 就算不出對的值，所以它同時回答完整性與來源。webhook 簽章、簽名 cookie、JWT HS256 都是這個用法。',
      '限制：雙方持有同一把 secret，接收方也能偽造。多個服務只需要「驗證」而不該能「簽發」時，用非對稱簽章。'] },
  aes: { label: '對稱加密', algo: 'AES-GCM', out: '密文＋tag', key: '雙方同一把金鑰', props: [1, 1, 2, 0], pass: '解密成功', fail: 'GCM 解密失敗',
    title: 'AES-GCM：讓沒有金鑰的人看不到內容',
    text: ['AES-GCM 是 AEAD：一次給出機密性（看不到內容）與完整性（改過就解不開）。輸出是與明文等長的密文加上 16 bytes 的 tag；nonce 不是秘密，和密文存在一起。',
      '解密失敗時 WebCrypto 只拋出 `OperationError`：密文或 tag 被改、金鑰不對、nonce 不對，都是同一個錯誤，GCM 不會告訴你是哪一個。'] },
  sig: { label: '簽章', algo: 'ECDSA P-256', out: '簽章', key: '私鑰簽、公鑰驗', props: [0, 1, 1, 1], pass: '簽章驗證通過', fail: '簽章驗證失敗',
    title: '簽章：私鑰簽，任何人用公鑰驗',
    text: ['簽發者用私鑰簽，任何人用公鑰驗。公鑰外洩沒有影響，只拿到公鑰的人也簽不出合法的簽章——這是它比 HMAC 多出來的性質。JWT RS256／ES256、TLS 憑證鏈都是這個用法。',
      '簽章不提供機密性，訊息本身是明文。「用私鑰加密」不是正確的說法，程式裡分清楚呼叫的是 `sign`／`verify` 還是 `encrypt`／`decrypt`。'] },
}
const ORDER = ['hash', 'hmac', 'aes', 'sig']
const COLS = ['機密性', '完整性', '來源驗證', '不可否認']
const MARK = ['—', '✓', '△']

export default function CryptoLab() {
  const [tool, setTool] = useState('hash')
  const [msg, setMsg] = useState('{"event":"order.paid","order_id":1001}')
  const [t, setT] = useState({ msg: false, out: false, key: false, reuse: false, recalc: false })
  const [keys, setKeys] = useState(null)
  const [gen, setGen] = useState(0)
  const [sent, setSent] = useState(null)
  const [recv, setRecv] = useState(null)
  const on = (k) => (v) => setT((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    if (!subtle) return
    let live = true
    makeKeys().then((k) => { if (live) setKeys(k) }).catch((e) => { if (live) setSent({ error: e.message }) })
    return () => { live = false }
  }, [gen])

  // 發送方：用自己的金鑰算出輸出（輸入稍微停一下再算，避免每個按鍵都重算）
  useEffect(() => {
    if (!subtle || !keys) return
    let live = true
    const timer = setTimeout(async () => {
      try {
        const m = enc.encode(msg), k = keys.a
        let s
        if (tool === 'hash') s = { out: await subtle.digest('SHA-256', m) }
        else if (tool === 'hmac') s = { out: await subtle.sign('HMAC', k.hmac, m) }
        else if (tool === 'sig') s = { out: await subtle.sign(ECDSA, k.ec.privateKey, m) }
        else {
          const nonce = rand(12), nonce2 = t.reuse ? nonce : rand(12), m2 = enc.encode(M2)
          const out = await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k.aes, m)
          const c1 = new Uint8Array(out), c2 = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce2 }, k.aes, m2))
          // 只看得到密文的人：c1 ⊕ c2 ⊕ 已知的 m1 → 如果金鑰流相同，得到的就是 m2
          const n = Math.min(m.length, m2.length)
          const rec = Uint8Array.from({ length: n }, (_, i) => c1[i] ^ c2[i] ^ m[i])
          s = { out, nonce, nonce2, c2, n, reuse: t.reuse, leaked: n > 0 && rec.every((b, i) => b === m2[i]), rec: dec.decode(rec), recHex: hex(rec) }
        }
        if (live) setSent({ tool, msg, keys, ...s })
      } catch (e) { if (live) setSent({ tool, msg, error: e.message }) }
    }, 120)
    return () => { live = false; clearTimeout(timer) }
  }, [msg, tool, keys, t.reuse])

  // 接收方：拿到的訊息 / 輸出可能被改過，金鑰也可能不是同一把
  useEffect(() => {
    if (!subtle || !sent || sent.error || sent.tool !== tool) return
    let live = true
    ;(async () => {
      const k = t.key ? sent.keys.b : sent.keys.a
      const changed = tool !== 'aes' && (t.msg || (tool === 'hash' && t.recalc))
      const tm = changed ? tamperText(sent.msg) : null
      const m = enc.encode(tm ? tm.pre + tm.ch + tm.post : sent.msg)
      let out = t.out ? flip(sent.out) : new Uint8Array(sent.out)
      let ok = false, detail = ''
      try {
        if (tool === 'hash') {
          const d = new Uint8Array(await subtle.digest('SHA-256', m))
          if (t.recalc) out = d
          detail = hex(d); ok = detail === hex(out)
        } else if (tool === 'hmac') ok = await subtle.verify('HMAC', k.hmac, out, m)
        else if (tool === 'sig') ok = await subtle.verify(ECDSA, k.ec.publicKey, out, m)
        else { detail = dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: sent.nonce }, k.aes, out)); ok = true }
      } catch (e) { detail = e.name }
      if (live) setRecv({ tool, tm, out, ok, detail, flipped: t.out && !(tool === 'hash' && t.recalc) })
    })()
    return () => { live = false }
  }, [sent, tool, t.msg, t.out, t.key, t.recalc])

  const T = TOOLS[tool]
  const ready = sent && recv && sent.tool === tool && recv.tool === tool && !sent.error
  const forged = ready && tool === 'hash' && recv.ok && recv.tm
  const why = ready && !recv.ok ? [recv.tm && '訊息被改了一個字', recv.flipped && `${T.out}被改了一個位元組`, tool !== 'hash' && t.key && '驗證用的不是對應的那把金鑰'].filter(Boolean) : []
  const keyName = (k) => (tool === 'sig' ? `公鑰 ${k.id.sig}…` : `${tool === 'hmac' ? 'secret' : '金鑰'} ${k.id[tool]}…`)

  return (
    <Lab className="cr" accent="red" kicker="SECURITY LAB" title="密碼學工具箱：四種工具各解決什麼"
         blurb="雜湊、HMAC、對稱加密、簽章各自只回答一種問題。改一改訊息，看瀏覽器用 crypto.subtle 真的算出來的結果；再竄改訊息、竄改輸出、換一把金鑰，看接收方的驗證怎麼變。">
      <LabControls>
        <Seg label="工具" tinted value={tool} onChange={setTool} options={ORDER.map((k) => ({ value: k, label: TOOLS[k].label, title: TOOLS[k].algo }))} />
        <label className="cr-msg">
          <span className="seg-label">訊息</span>
          <input className="cr-input" value={msg} onChange={(e) => setMsg(e.target.value)} spellCheck={false} aria-label="訊息" />
        </label>
        {tool !== 'aes' && <Toggle label="竄改訊息一個字" checked={t.msg} onChange={on('msg')} />}
        <Toggle label="竄改輸出一個位元組" checked={t.out} onChange={on('out')} />
        {tool === 'hash' && <Toggle label="攻擊者連摘要一起重算" checked={t.recalc} onChange={on('recalc')} />}
        {tool !== 'hash' && <Toggle label="換一把金鑰來驗" checked={t.key} onChange={on('key')} />}
        {tool === 'aes' && <Toggle label="重複使用同一個 nonce" checked={t.reuse} onChange={on('reuse')} />}
        {tool !== 'hash' && <button type="button" className="btn ghost small" onClick={() => setGen((g) => g + 1)}>重新產生金鑰</button>}
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label={`${T.algo} 的計算結果與驗證`}>
            {!subtle ? (
              <p className="cr-nocrypto">此環境沒有 <code>crypto.subtle</code>（需要 HTTPS 或 localhost），無法在瀏覽器裡計算。下方的對照表與說明仍然適用。</p>
            ) : !ready ? (
              <p className="cr-busy">{sent?.error ? `計算失敗：${sent.error}` : '計算中…'}</p>
            ) : (
              <div className="cr-flow">
                <div className="cr-side">
                  <div className="cr-side-head"><b>發送方</b><span className="tag">{T.algo}</span></div>
                  <Field k="訊息">{sent.msg || '（空字串）'}</Field>
                  {tool !== 'hash' && <Field k="金鑰">{tool === 'sig' ? `私鑰（不離開發送方）· 公鑰 ${sent.keys.a.id.sig}…` : keyName(sent.keys.a)}<i>　示範用，只存在這個分頁</i></Field>}
                  {tool === 'aes' && <Field k="nonce">{hex(sent.nonce)}</Field>}
                  <Field k={T.out}>{hex(sent.out)}</Field>
                  {tool === 'sig' && <p className="cr-meta">ECDSA 每次簽章都用新的隨機值，同一則訊息的簽章每次都不同，但都驗得過。</p>}
                </div>
                <div className="cr-arrow" aria-hidden="true">↓ 傳給接收方（途中可能被改）</div>
                <div className={`cr-side ${recv.ok && !forged ? 'ok' : 'bad'}`}>
                  <div className="cr-side-head"><b>接收方</b>
                    {forged ? <Status warn>摘要對得上，但訊息已被改</Status> : recv.ok ? <Status ok>{T.pass}</Status> : <Status>{T.fail}{tool === 'aes' ? `（${recv.detail}）` : ''}</Status>}
                  </div>
                  {tool !== 'aes' && <Field k="收到的訊息">{recv.tm ? <>{recv.tm.pre}<mark>{recv.tm.ch}</mark>{recv.tm.post}</> : sent.msg || '（空字串）'}</Field>}
                  <Field k={`收到的${T.out}`}>{recv.flipped ? <><mark>{hex(recv.out).slice(0, 2)}</mark>{hex(recv.out).slice(2)}</> : hex(recv.out)}</Field>
                  {tool !== 'hash' && <Field k="驗證用的金鑰">{t.key ? <mark>{keyName(sent.keys.b)}</mark> : keyName(sent.keys.a)}</Field>}
                  {tool === 'hash' && <Field k="重算的摘要">{recv.detail}</Field>}
                  {tool === 'aes' && <Field k="解密結果">{recv.ok ? recv.detail : '（沒有輸出：tag 驗證失敗，不會吐出任何明文）'}</Field>}
                </div>
                {tool === 'aes' && (
                  <div className={`cr-side ${sent.reuse ? 'bad' : ''}`}>
                    <div className="cr-side-head"><b>同一把金鑰加密第二筆訊息</b>{sent.reuse ? <Status>nonce 重複</Status> : <Status ok>新的 nonce</Status>}</div>
                    <Field k="nonce">{sent.reuse ? <mark>{hex(sent.nonce2)}</mark> : hex(sent.nonce2)}</Field>
                    <Field k="密文＋tag">{hex(sent.c2)}</Field>
                    <Field k="c1 ⊕ c2 ⊕ m1">{sent.leaked ? <mark>{sent.rec}</mark> : sent.n ? `${sent.recHex.slice(0, 40)}…（亂碼，看不出第二筆的內容）` : '（第一筆訊息是空的，沒有可以對照的位元組）'}</Field>
                    <p className="cr-meta">c1、c2 是兩筆密文，m1 是已知的第一筆明文。{sent.leaked && `沒有金鑰，就還原出第二筆的前 ${sent.n} bytes；兩筆都照常解得開，看不出任何異狀。`}</p>
                  </div>
                )}
              </div>
            )}
          </LabStage>

          <div className="dtable-wrap">
            <table className="dtable cr-table">
              <caption>四種工具各提供什麼</caption>
              <thead><tr><th>工具</th>{COLS.map((h) => <th key={h}>{h}</th>)}<th>金鑰</th></tr></thead>
              <tbody>
                {ORDER.map((k) => (
                  <tr key={k} className={`clickable${k === tool ? ' hit' : ''}`} onClick={() => setTool(k)}>
                    <td>{TOOLS[k].label}<span className="muted">　{TOOLS[k].algo}</span></td>
                    {TOOLS[k].props.map((p, i) => <td key={i} className={`cr-p${p}`}>{MARK[p]}</td>)}
                    <td>{TOOLS[k].key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cr-meta">△：解得開代表密文出自持有同一把金鑰的人，但雙方都有金鑰，分不出是哪一方。雜湊的完整性只在摘要本身來自可信的管道時成立。</p>
        </div>

        <div className="lab-stack">
          <LabExplain title={T.title}>
            {T.text.map((s, i) => <p key={i}><Md>{s}</Md></p>)}
            {why.length > 0 && <p><strong>這次驗證失敗：</strong>{why.join('、')}。{tool === 'aes' ? '只要有一項不對，tag 驗證就失敗。' : '任何一項不對，驗證都不會通過。'}</p>}
            {forged && <p><strong>摘要對得上，可是訊息已經被改了：</strong>攻擊者改完訊息，自己重算了一份摘要。雜湊回答不了「是誰算的」——這就是它沒有來源驗證的意思。</p>}
          </LabExplain>
          {tool === 'aes' && t.reuse && (
            <Callout tone="warn" title="同一把金鑰下，nonce 絕不能重複">
              GCM 內部用 CTR 模式：同一組金鑰與 nonce 產生<b>同一條金鑰流</b>，兩筆密文 XOR 起來，金鑰流相消，剩下兩筆明文的 XOR。知道其中一筆明文，就能直接還原另一筆。更糟的是，nonce 重複也會洩露 GCM 驗證用的內部值，讓攻擊者能偽造 tag。每次加密都用 CSPRNG 產生新的 12 bytes nonce。
            </Callout>
          )}
          <Callout title="常見誤用">
            <b>把雜湊當加密</b>：雜湊推不回輸入，但也沒有金鑰；email 這類可能值有限的欄位，SHA-256 可以被字典反查。<br />
            <b>把 base64 當加密</b>：base64 是編碼，任何人都能解回來。<br />
            <b>自己發明演算法</b>：<code>SHA-256(secret + body)</code> 看起來像簽章，卻有 length extension 問題，該用 HMAC。選高階、難以誤用的 API：WebCrypto、libsodium、Python 的 <code>cryptography</code> 套件、雲端 KMS。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .cr-msg { display: inline-flex; align-items: center; gap: 10px; flex: 1 1 260px; min-width: 0; max-width: 420px; }
        .cr-input { flex: 1; min-width: 0; font-family: var(--mono); font-size: 0.82rem; color: var(--ink-1); background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 6px 10px; }
        .cr-input:focus { outline: 2px solid var(--lab-accent); outline-offset: 1px; border-color: transparent; }
        .cr-flow { display: grid; gap: 8px; }
        .cr-side { display: grid; gap: 7px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); transition: border-color 0.25s ease, box-shadow 0.25s ease; }
        .cr-side.ok { border-color: color-mix(in srgb, var(--good) 55%, var(--hairline)); box-shadow: inset 3px 0 0 var(--good); }
        .cr-side.bad { border-color: color-mix(in srgb, var(--critical) 55%, var(--hairline)); box-shadow: inset 3px 0 0 var(--critical); }
        .cr-side-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 0.86rem; color: var(--ink-1); }
        .cr-field { display: grid; grid-template-columns: 9.5em minmax(0, 1fr); gap: 8px; align-items: start; font-size: 0.74rem; }
        .cr-field > span { color: var(--ink-3); font-weight: 600; padding-top: 4px; }
        .cr-field > code { font-family: var(--mono); line-height: 1.5; color: var(--ink-1); background: var(--surface-2); border-radius: 3px; padding: 4px 8px; overflow-wrap: anywhere; word-break: break-all; }
        .cr-field i { font-family: var(--sans); font-style: normal; color: var(--ink-3); }
        .cr-field mark { background: color-mix(in srgb, var(--critical) 26%, transparent); color: var(--ink-1); border-radius: 2px; padding: 0 1px; font-weight: 700; }
        @media (max-width: 480px) { .cr-field { grid-template-columns: minmax(0, 1fr); gap: 2px; } .cr-field > span { padding-top: 0; } }
        .cr-arrow { font-size: 0.74rem; color: var(--ink-3); text-align: center; }
        .cr-meta { font-size: 0.74rem; color: var(--ink-3); line-height: 1.6; }
        .cr-busy { font-size: 0.82rem; color: var(--ink-3); font-style: italic; }
        .cr-nocrypto { font-size: 0.84rem; color: var(--serious); line-height: 1.7; } .cr-nocrypto code { font-family: var(--mono); }
        .cr-table td, .cr-table th { text-align: center; } .cr-table td:first-child, .cr-table th:first-child { text-align: left; }
        .cr-table .muted { font-size: 0.68rem; }
        .cr-table .cr-p1 { color: var(--good); font-weight: 700; } .cr-table .cr-p2 { color: var(--serious); font-weight: 700; } .cr-table .cr-p0 { color: var(--ink-3); }
      `}</style>
    </Lab>
  )
}

function Field({ k, children }) {
  return <div className="cr-field"><span>{k}</span><code>{children}</code></div>
}

function Md({ children }) {
  return String(children).split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, i) => (
    s[0] === '`' ? <code key={i}>{s.slice(1, -1)}</code> : s.startsWith('**') ? <strong key={i}>{s.slice(2, -2)}</strong> : s))
}
