import React, { useEffect, useState } from 'react'
import { Lab, LabControls, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status } from './ui.jsx'

/* ============================================================
   JWT 解剖：三段、簽章、竄改偵測
   - 真的用 WebCrypto 算 HMAC-SHA256，改任何一個字元簽章就對不上
   - 「竄改」只改 payload 段、沿用舊簽章；「不同 secret」模擬伺服器拿錯鑰匙
   ============================================================ */

const HEADER = { alg: 'HS256', typ: 'JWT' }
const enc = new TextEncoder()

function b64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const encJson = (obj) => b64url(enc.encode(JSON.stringify(obj)))

async function hmacB64url(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return b64url(new Uint8Array(sig))
}

const fmtTime = (sec) => new Date(sec * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const fmtExp = (v) => (v < 0 ? `${v} 分（已過期）` : v === 0 ? '現在' : `+${v} 分`)

export default function JwtLab() {
  const subtleOk = typeof globalThis.crypto?.subtle?.sign === 'function'
  const [sub, setSub] = useState('user_42')
  const [role, setRole] = useState('user')
  const [expMin, setExpMin] = useState(30)
  const [secret, setSecret] = useState('dev-secret-change-me')
  const [tamper, setTamper] = useState(false)
  const [wrongSecret, setWrongSecret] = useState(false)
  const [iat] = useState(() => Math.floor(Date.now() / 1000))
  const [sigs, setSigs] = useState({ sig: '', expected: '', err: '' })

  const payload = { sub, role, iat, exp: iat + expMin * 60 }
  const sent = tamper ? { ...payload, role: 'admin' } : payload      // 伺服器實際收到的 payload
  const h64 = encJson(HEADER)
  const p64 = encJson(payload)                                       // 簽章是對這一份算的
  const s64 = encJson(sent)
  const serverSecret = wrongSecret ? 'prod-secret-only-server-knows' : secret

  useEffect(() => {
    if (!subtleOk) return
    if (!secret) { setSigs({ sig: '', expected: '', err: 'secret 不可為空——HMAC 需要一把金鑰。' }); return }
    let alive = true
    Promise.all([hmacB64url(secret, `${h64}.${p64}`), hmacB64url(serverSecret, `${h64}.${s64}`)])
      .then(([sig, expected]) => { if (alive) setSigs({ sig, expected, err: '' }) })
      .catch((e) => { if (alive) setSigs({ sig: '', expected: '', err: `簽章計算失敗：${e.message || e}` }) })
    return () => { alive = false }
  }, [subtleOk, secret, serverSecret, h64, p64, s64])

  const sigOk = !!sigs.sig && sigs.sig === sigs.expected
  const expired = sent.exp * 1000 <= Date.now()
  const accepted = sigOk && !expired
  const changed = tamper && payload.role !== sent.role
  const tamperNoop = tamper && !changed

  const ex = explain({ err: subtleOk ? sigs.err : '這個環境沒有 crypto.subtle，無法計算 HMAC。', changed, tamperNoop, wrongSecret, expired, sigOk })

  return (
    <Lab accent="orange" kicker="AUTH LAB" title="JWT 解剖：三段、簽章、竄改偵測"
         blurb="這裡的簽章是真的用瀏覽器 WebCrypto 算出來的 HMAC-SHA256。改 payload、換 secret、拉過期時間，看三段 token 與伺服器判定怎麼跟著變。">
      <LabControls>
        <label className="jwt-field"><span>sub</span>
          <input value={sub} maxLength={24} style={{ width: 150 }} onChange={(e) => setSub(e.target.value)} spellCheck={false} /></label>
        <Seg label="role" tinted value={role} onChange={setRole}
             options={[{ value: 'user', label: 'user' }, { value: 'admin', label: 'admin' }]} />
        <Slider label="exp 距現在" min={-10} max={60} value={expMin} onChange={setExpMin} format={fmtExp} />
        <label className="jwt-field"><span>secret</span>
          <input value={secret} maxLength={40} onChange={(e) => setSecret(e.target.value)} spellCheck={false} /></label>
        <span className="spacer" />
        <Toggle label="竄改 payload（role 改 admin，不重簽）" checked={tamper} onChange={setTamper} />
        <Toggle label="伺服器用不同的 secret 驗證" checked={wrongSecret} onChange={setWrongSecret} />
      </LabControls>

      <div className="jwt-grid">
        <div className="jwt-stage"><LabStage label="JWT 三段與解碼結果">
          {!subtleOk && (
            <Callout tone="warn" title="這個環境沒有 crypto.subtle">
              WebCrypto 只在安全情境（HTTPS 或 localhost）提供。下面仍會顯示 header 與 payload 的 base64url 編碼，但簽章無法計算。
            </Callout>
          )}
          <div className="jwt-token" aria-label="token">
            <span className="jwt-h">{h64}</span><i>.</i>
            <span className="jwt-p">{s64}</span><i>.</i>
            <span className="jwt-s">{sigs.sig || (subtleOk && !sigs.err ? '計算中…' : '（無法計算）')}</span>
          </div>

          <div className="jwt-verdict">
            {sigOk ? <Status ok>簽章有效</Status> : <Status>簽章無效</Status>}
            {expired ? <Status warn>已過期</Status> : <Status ok>時效內</Status>}
            <span className={`jwt-final ${accepted ? 'ok' : 'bad'}`}>伺服器判定：{accepted ? '接受' : '拒絕'}</span>
          </div>
          {sigs.err && <p className="jwt-err">{sigs.err}</p>}

          <div className="jwt-panels">
            <section className="jwt-panel h">
              <header>HEADER <span>base64url → JSON</span></header>
              <pre>{JSON.stringify(HEADER, null, 2)}</pre>
              <p>alg 說「用什麼演算法驗」——但伺服器不能信它，要用自己設定的白名單。</p>
            </section>
            <section className="jwt-panel p">
              <header>PAYLOAD <span>base64url → JSON（claims）</span></header>
              <pre>{'{\n'}
                {'  "sub": '}<b>"{sent.sub}"</b>{',\n'}
                {'  "role": '}{changed ? <mark>"{sent.role}"</mark> : <b>"{sent.role}"</b>}{',\n'}
                {'  "iat": '}<b>{sent.iat}</b>{',  '}<i>{fmtTime(sent.iat)}</i>{'\n'}
                {'  "exp": '}<b>{sent.exp}</b>{'   '}<i>{fmtTime(sent.exp)}{expired ? '（已過）' : ''}</i>{'\n}'}
              </pre>
              <p>{changed ? '標記處是被改過的欄位：任何人都改得了這段，只是簽章會對不上。' : '誰拿到 token 都能解出這段——這不是加密，只是編碼。'}</p>
            </section>
            <section className="jwt-panel s">
              <header>SIGNATURE <span>HMAC-SHA256</span></header>
              <pre>{'HMAC_SHA256(\n  base64url(header) + "." +\n  base64url(payload),\n  secret\n) → base64url'}</pre>
              {subtleOk && !sigs.err && (
                <p>
                  伺服器重算得到 <code className="jwt-sig-cmp">{sigs.expected.slice(0, 14)}…</code>，
                  token 裡是 <code className="jwt-sig-cmp">{(sigs.sig || '').slice(0, 14)}…</code>
                  → {sigOk ? '相同' : '不同'}。
                </p>
              )}
            </section>
          </div>
        </LabStage></div>

        <div className="jwt-explain">
          <LabExplain title={ex.title}>{ex.text.map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
        </div>
        <div className="jwt-six">
          <LabExplain title="JWT 該知道的六件事">
            <p><strong>base64url 不是加密。</strong>任何人（包括使用者自己）都能解開 payload，所以別放密碼、身分證字號或內部 ID 以外的敏感資料。</p>
            <p><strong>簽章保證完整性，不是機密性。</strong>它證明「內容沒被改、是持有 secret 的人簽的」，僅此而已。</p>
            <p><strong>時間 claims：</strong><code>iat</code> 簽發時間、<code>exp</code> 過期時間、<code>nbf</code> 生效時間，都是 Unix 秒數。伺服器要各自檢查，並容許幾十秒的時鐘誤差。</p>
            <p><strong>放哪：</strong>httpOnly cookie 讓 JS 讀不到（XSS 偷不走）但要處理 CSRF（SameSite）；<code>Authorization: Bearer</code> 由前端自己帶，跨網域與行動 App 方便，但 XSS 一旦發生就能偷。</p>
            <p><strong>refresh token：</strong>access token 短命（分鐘級），過期用 refresh token 換新的；refresh token 存在伺服器端可撤銷，這是「無狀態」與「能登出」之間的折衷。</p>
            <p><strong><code>alg: none</code> 攻擊：</strong>早期函式庫看到 header 寫 <code>"alg":"none"</code> 就跳過驗簽。伺服器必須鎖死接受的演算法，永遠不看 header 決定怎麼驗。</p>
          </LabExplain>
        </div>
        <div className="jwt-callout">
          <Callout title="工作上什麼時候用">
            適合<b>無狀態驗證</b>（API 不用每次查 session 表，好水平擴展）與<b>跨服務傳遞身分</b>（gateway 驗一次，內部服務信 claims）。
            代價是「發出去就收不回」：要立刻踢人或登出，得靠短 exp + refresh token 或黑名單。
            單一應用、需要隨時讓登入失效的後台，傳統 session（伺服器存狀態、可即時作廢）反而更簡單。
          </Callout>
        </div>
      </div>

      <style>{`
        .jwt-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(220px, 2fr); gap: 14px 18px; align-items: start;
          grid-template-areas: 'stage explain' 'six callout'; }
        .jwt-stage { grid-area: stage; min-width: 0; } .jwt-explain { grid-area: explain; } .jwt-six { grid-area: six; } .jwt-callout { grid-area: callout; }
        @media (max-width: 760px) { .jwt-grid { grid-template-columns: 1fr; grid-template-areas: 'stage' 'explain' 'callout' 'six'; } }
        .jwt-field { display: inline-flex; flex-direction: column; gap: 4px; }
        .jwt-field span { font-size: 0.78rem; color: var(--ink-3); font-weight: 600; letter-spacing: 0.04em; }
        .jwt-field input { font-family: var(--mono); font-size: 0.82rem; padding: 5px 8px; width: 200px; max-width: 100%;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-1); color: var(--ink-1); }
        .jwt-field input:focus-visible { outline: 2px solid var(--lab-accent); outline-offset: 1px; }
        .jwt-token { font-family: var(--mono); font-size: 0.8rem; line-height: 1.6; word-break: break-all; overflow-wrap: anywhere; }
        .jwt-token i { color: var(--ink-3); font-style: normal; padding: 0 1px; }
        .jwt-token span { transition: color 0.2s ease; }
        .jwt-h { color: var(--c-red); }
        .jwt-p { color: var(--c-violet); }
        .jwt-s { color: var(--c-aqua); }
        .jwt-verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 12px 0 14px; }
        .jwt-final { font-size: 0.82rem; font-weight: 700; color: var(--ink-2); }
        .jwt-final.ok { color: var(--good); }
        .jwt-final.bad { color: var(--critical); }
        .jwt-err { font-size: 0.8rem; color: var(--critical); margin-bottom: 10px; }
        .jwt-panels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 640px) { .jwt-panels { grid-template-columns: 1fr; } }
        .jwt-panel { --tone: var(--ink-3); border: 1px solid var(--hairline); border-top: 3px solid var(--tone); border-radius: var(--radius);
          background: var(--surface-1); padding: 8px 10px 10px; min-width: 0; display: grid; gap: 6px; align-content: start; }
        .jwt-panel.h { --tone: var(--c-red); } .jwt-panel.p { --tone: var(--c-violet); } .jwt-panel.s { --tone: var(--c-aqua); }
        .jwt-panel header { font-size: 0.7rem; letter-spacing: 0.12em; font-weight: 700; color: var(--tone); display: flex; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
        .jwt-panel header span { color: var(--ink-3); letter-spacing: 0.02em; font-weight: 500; }
        .jwt-panel pre { font-family: var(--mono); font-size: 0.74rem; line-height: 1.55; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
        .jwt-panel pre b { color: var(--ink-1); font-weight: 500; }
        .jwt-panel pre i { color: var(--ink-3); font-style: normal; font-size: 0.68rem; }
        .jwt-panel pre mark { background: color-mix(in srgb, var(--c-red) 22%, transparent); color: var(--c-red); font-weight: 700; border-radius: 2px; padding: 0 2px; }
        .jwt-panel p { font-size: 0.76rem; color: var(--ink-3); line-height: 1.5; }
        .jwt-sig-cmp { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-1); background: var(--surface-2); padding: 0 4px; border-radius: 2px; }
      `}</style>
    </Lab>
  )
}

function explain({ err, changed, tamperNoop, wrongSecret, expired, sigOk }) {
  if (err) return {
    title: '簽章算不出來',
    text: [err, 'HMAC 是「金鑰 + 訊息 → 固定長度摘要」，沒有金鑰就沒有簽章可言。'],
  }
  if (tamperNoop) return {
    title: '竄改開了，但 role 本來就是 admin——位元組沒變，簽章當然還對',
    text: ['簽章比對的是「位元組是否一模一樣」，不是「有沒有人動過」。改成一樣的值等於沒改，所以伺服器仍判定簽章有效。', '把 role 切回 user 再開竄改，就能看到簽章對不上的樣子。'],
  }
  if (changed && wrongSecret) return {
    title: '既被竄改、secret 又不同：兩個理由都讓簽章無效',
    text: ['伺服器拿另一把 secret 對「被改過的 header.payload」重算 HMAC，得到的值和 token 第三段完全不同——不管是哪個原因，結果都是拒絕。', '簽章失敗時伺服器通常不會（也不該）告訴 client 是哪個原因，避免給攻擊者線索。'],
  }
  if (changed) return {
    title: '竄改被抓到：payload 變了，簽章對不上',
    text: ['攻擊者把 role 改成 admin 再 base64url 編回去，第二段變了；但第三段簽章是對「舊的 header.payload」算的。', '伺服器用自己的 secret 對收到的前兩段重算 HMAC，和第三段一比不相等 → 拒絕。JWT 防的是「被改」，不是「被看」。'],
  }
  if (wrongSecret) return {
    title: 'secret 不同，簽章對不上',
    text: ['同一份 token，伺服器用另一把 secret 重算，得到完全不同的 HMAC。HS256 是對稱簽章：簽的人和驗的人共用同一把 secret。', '這也是跨服務時的痛點——每個服務都要拿到 secret，外洩一處等於人人都能簽發。多服務環境常改用 RS256 / ES256：私鑰簽、公鑰驗，公鑰可以放心公開。'],
  }
  if (expired) return {
    title: '簽章沒問題，但已過期：驗簽和驗 claims 是兩步',
    text: ['簽章有效只證明內容沒被改。exp 是 payload 裡的一個數字，伺服器要另外拿「現在時間」比對——過期的 token 簽章依然有效。', '所以驗證流程永遠是：先驗簽章（內容可信嗎），再驗 claims（exp、nbf、aud、iss 對不對）。缺任何一步都是漏洞。'],
  }
  return {
    title: sigOk ? '簽章有效：三段各司其職' : '正在計算簽章…',
    text: ['第一段 header 說用哪個演算法；第二段 payload 放 claims（sub、role、iat、exp）；第三段是對「前兩段的 base64url 字串」用 secret 算出的 HMAC-SHA256。', '改動前兩段的任何一個字元，第三段就對不上——試試把 sub 改一個字母，看簽章整串換掉。'],
  }
}
