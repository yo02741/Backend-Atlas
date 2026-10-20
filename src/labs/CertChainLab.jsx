import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, Status } from './ui.jsx'

/* ============================================================
   憑證鏈驗證：伺服器憑證 → 中繼 CA → 根 CA ＋ 用戶端信任清單
   - 狀況：正常 / 缺中繼 / 網域不符（含萬用字元）/ 過期 / 自簽 / 院內 CA 未安裝根
   - Stepper：比對網域 → 有效期 → 找簽發者 → 信任的根 → 結果
   ============================================================ */

const CASES = {
  ok: '正常', missing: '缺中繼憑證', name: '網域不符', expired: '過期', self: '自簽', internal: '院內 CA',
}
const STEPS = ['比對網域', '檢查有效期', '往上找簽發者', '找到信任的根', '結果']
const NOW = '2026-10-20'
const DN = {
  le: "C = US, O = Let's Encrypt, CN = R11", isrg: 'C = US, O = Internet Security Research Group, CN = ISRG Root X1',
  hi: 'C = TW, O = Example Hospital, CN = Example Hospital Issuing CA', hr: 'C = TW, O = Example Hospital, CN = Example Hospital Root CA',
}
const STORE = ['ISRG Root X1', 'DigiCert Global Root G2', 'GlobalSign Root R3', 'USERTrust RSA CA']

function sanMatch(san, host) {
  if (!san.startsWith('*.')) return san === host
  const label = host.endsWith(san.slice(1)) ? host.slice(0, host.length - san.length + 1) : ''
  return label !== '' && !label.includes('.')   // * 只代表剛好一層
}
const osl = (d, t) => { const [m, day, y] = d.split(' '); return `${m} ${day.padStart(2, ' ')} ${t} ${y} GMT` }

/* 依狀況組出三張卡、四項檢查與錯誤訊息 */
function evaluate(cs, host, san, installed) {
  const inn = cs === 'internal'
  const leaf = { name: host, cn: cs === 'name' ? san : host, san: cs === 'name' ? [san] : [host], issuer: cs === 'self' ? `${host}（自己）` : inn ? '院內 Issuing CA' : 'R11',
    from: cs === 'expired' ? 'Jul 13 2026' : 'Aug 21 2026', to: cs === 'expired' ? 'Oct 11 2026' : 'Nov 19 2026' }
  const mid = cs === 'self' ? null : { name: inn ? '院內 Issuing CA' : 'R11', issuer: inn ? '院內 Root CA' : 'ISRG Root X1', from: inn ? 'Jan 1 2024' : 'Mar 13 2024', to: inn ? 'Jan 1 2029' : 'Mar 12 2027', sent: cs !== 'missing' }
  const root = cs === 'self' ? null : { name: inn ? '院內 Root CA' : 'ISRG Root X1', from: inn ? 'Jan 1 2024' : 'Jun 4 2015', to: inn ? 'Jan 1 2044' : 'Jun 4 2035', trusted: !inn || installed, reach: cs !== 'missing' }
  const dom = sanMatch(leaf.san[0], host)
  const checks = [
    dom ? ['ok', `SAN 有 ${leaf.san[0]}，涵蓋 ${host}`] : ['bad', `SAN 只有 ${leaf.san[0]}，不涵蓋 ${host}`],
    cs === 'expired' ? ['bad', `伺服器憑證 notAfter = Oct 11 2026，已過期（假設今天是 ${NOW}）`] : ['ok', cs === 'self' ? '這張憑證在效期內' : '鏈上每一張都在效期內'],
    cs === 'missing' ? ['bad', '需要 R11 的憑證來驗簽章，但伺服器沒送、本機也沒有']
      : cs === 'self' ? ['note', 'issuer 就是自己：鏈只有這一張，沒有上一層']
        : ['ok', `${leaf.issuer} 簽了伺服器憑證、${mid.issuer} 簽了 ${mid.name}，簽章都驗得過`],
    cs === 'missing' ? ['skip', '鏈在上一步斷了，到不了根']
      : cs === 'self' ? ['bad', '這張自簽憑證不在信任清單裡']
        : root.trusted ? ['ok', `${root.name} 在信任清單裡`] : ['bad', `${root.name} 不在這台用戶端的信任清單裡`],
  ]
  const fail = checks.findIndex((c) => c[0] === 'bad')
  const kind = fail < 0 ? 'ok' : fail === 0 ? 'name' : fail === 1 ? 'expired' : fail === 2 ? 'missing' : cs
  return { leaf, mid, root, checks, fail, kind }
}

function errors(kind, host, san) {
  const v = 'certificate verify failed: '
  if (kind === 'ok') return [['瀏覽器', '正常顯示（鎖頭）', true], ['curl', '正常取得回應', true], ['Python requests', '正常', true], ['Node.js', '正常', true]]
  if (kind === 'missing') return [
    ['瀏覽器', '可能正常顯示（快取的中繼憑證或 AIA 自動補抓）；補不到時 NET::ERR_CERT_AUTHORITY_INVALID', 'maybe'],
    ['curl', 'curl: (60) SSL certificate problem: unable to get local issuer certificate'],
    ['Python requests', `[SSL: CERTIFICATE_VERIFY_FAILED] ${v}unable to get local issuer certificate`],
    ['Node.js', 'Error: unable to verify the first certificate']]
  if (kind === 'name') return [
    ['瀏覽器', 'NET::ERR_CERT_COMMON_NAME_INVALID'],
    ['curl', `curl: (60) SSL: no alternative certificate subject name matches target host name '${host}'`],
    ['Python requests', `[SSL: CERTIFICATE_VERIFY_FAILED] ${v}Hostname mismatch, certificate is not valid for '${host}'.`],
    ['Node.js', `Hostname/IP does not match certificate's altnames: Host: ${host}. is not in the cert's altnames: DNS:${san}`]]
  if (kind === 'expired') return [['瀏覽器', 'NET::ERR_CERT_DATE_INVALID'], ['curl', 'curl: (60) SSL certificate problem: certificate has expired'],
    ['Python requests', `[SSL: CERTIFICATE_VERIFY_FAILED] ${v}certificate has expired`], ['Node.js', 'Error: certificate has expired']]
  if (kind === 'self') return [['瀏覽器', 'NET::ERR_CERT_AUTHORITY_INVALID'], ['curl', 'curl: (60) SSL certificate problem: self-signed certificate'],
    ['Python requests', `[SSL: CERTIFICATE_VERIFY_FAILED] ${v}self-signed certificate`], ['Node.js', 'Error: self-signed certificate']]
  return [['瀏覽器', 'NET::ERR_CERT_AUTHORITY_INVALID'], ['curl', 'curl: (60) SSL certificate problem: unable to get local issuer certificate'],
    ['Python requests', `[SSL: CERTIFICATE_VERIFY_FAILED] ${v}unable to get local issuer certificate`], ['Node.js', 'Error: unable to get local issuer certificate']]
}

function sClient(cs, host, r, installed) {
  const head = `$ openssl s_client -connect ${host}:443 -showcerts`
  const inn = cs === 'internal'
  const mid = inn ? DN.hi : DN.le, top = inn ? DN.hr : DN.isrg
  const chain = (withMid) => `---\nCertificate chain\n 0 s:CN = ${r.leaf.cn}\n   i:${cs === 'self' ? `CN = ${host}` : mid}\n-----BEGIN CERTIFICATE-----\n（略）${withMid ? `\n 1 s:${mid}\n   i:${top}` : ''}\n---`
  if (cs === 'missing') return `${head}\ndepth=0 CN = ${host}\nverify error:num=20:unable to get local issuer certificate\nverify return:1\ndepth=0 CN = ${host}\nverify error:num=21:unable to verify the first certificate\nverify return:1\n${chain(false)}\nVerify return code: 21 (unable to verify the first certificate)`
  if (cs === 'self') return `${head}\ndepth=0 CN = ${host}\nverify error:num=18:self-signed certificate\nverify return:1\n${chain(false)}\nVerify return code: 18 (self-signed certificate)`
  if (inn && !installed) return `${head}\ndepth=1 ${DN.hi}\nverify error:num=20:unable to get local issuer certificate\nverify return:1\n${chain(true)}\nVerify return code: 20 (unable to get local issuer certificate)`
  const ok = `depth=2 ${top}\nverify return:1\ndepth=1 ${mid}\nverify return:1\ndepth=0 CN = ${r.leaf.cn}`
  if (cs === 'expired') return `${head}\n${ok}\nverify error:num=10:certificate has expired\nnotAfter=Oct 11 23:59:59 2026 GMT\nverify return:1\n${chain(true)}\nVerify return code: 10 (certificate has expired)`
  const pre = inn ? `# 指定院內根憑證：加上 -CAfile hospital-root.pem\n${head} -CAfile hospital-root.pem` : head
  const base = `${pre}\n${ok}\nverify return:1\n${chain(true)}\nVerify return code: 0 (ok)`
  if (cs !== 'name' || r.fail < 0) return base
  return `${base}\n# s_client 預設不比對主機名稱！要加 -verify_hostname：\n$ openssl s_client -connect ${host}:443 -verify_hostname ${host}\nverify error:num=62:hostname mismatch\nVerify return code: 62 (hostname mismatch)`
}

function x509(cs, host, r) {
  const issuer = cs === 'self' ? `CN = ${host}` : cs === 'internal' ? DN.hi : DN.le
  return `$ openssl s_client -connect ${host}:443 </dev/null 2>/dev/null \\
    | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
subject=CN = ${r.leaf.cn}
issuer=${issuer}
notBefore=${osl(r.leaf.from, '00:00:00')}
notAfter=${osl(r.leaf.to, '23:59:59')}
X509v3 Subject Alternative Name:
    DNS:${r.leaf.san[0]}`
}

const STEP_TEXT = [
  '用戶端先確認這張憑證是不是發給「我要連的這個名稱」。比對的是 SAN（subjectAltName）清單，現代瀏覽器已不看 CN。萬用字元 *.example.org 只代表「剛好一層」子網域：不涵蓋 example.org 本身，也不涵蓋 a.b.example.org。',
  '每張憑證都有 notBefore／notAfter，鏈上任何一張不在效期內都不行。用戶端拿自己的時鐘比，所以電腦時間錯了也會出現同樣的錯誤。',
  '伺服器憑證是中繼 CA 簽的，用戶端要有中繼 CA 的憑證才能驗這個簽章。中繼憑證應該由伺服器在 TLS 握手時一起送出（設定 fullchain）；根憑證不需要送。',
  '一路往上，最後必須接到用戶端信任清單（作業系統或瀏覽器內建的根憑證）裡的某一張。根憑證是自己簽自己，信不信任它，只看它在不在清單裡。',
]
const FIX = {
  ok: '四項檢查都通過，TLS 握手完成，之後的 HTTP 內容都走加密通道。',
  missing: '伺服器只送了自己的憑證。部分瀏覽器可能因為快取過同一張中繼憑證、或依憑證裡的 AIA 網址自動下載補上，所以照樣打得開；但 curl 與多數程式語言的用戶端不會補抓，直接失敗。「瀏覽器打得開」不代表設定正確。修法：伺服器改用 fullchain（伺服器憑證＋中繼憑證）。',
  name: '憑證本身有效，但不是發給這個名稱的。修法：重新申請包含這個名稱的憑證；萬用字元憑證通常會同時列 example.org 與 *.example.org，因為 * 不涵蓋裸網域。',
  expired: '鏈的其他部分都沒問題，只有效期不過。修法：換新憑證並設定自動續期與到期告警。不要用 curl -k 或 verify=False 繞過，那等於關掉身分驗證。',
  self: '自簽憑證沒有任何 CA 背書，只有手動把它加進信任清單的用戶端才會接受。適合本機開發；對外服務請用公開 CA 簽發的憑證。',
  internal: '鏈本身完整，只是這台用戶端不認識院內的根憑證。修法是把院內根憑證安裝到呼叫端，而不是關掉驗證：作業系統信任清單、curl --cacert、Python 的 REQUESTS_CA_BUNDLE、Node 的 NODE_EXTRA_CA_CERTS。',
}

export default function CertChainLab() {
  const [cs, setCs] = useState('missing')
  const [san, setSan] = useState('www.example.org')
  const [host, setHost] = useState('api.example.org')
  const [installed, setInstalled] = useState(false)
  const [tab, setTab] = useState('s_client')
  const { step, setStep, playing, toggle } = usePlayer(5, 1500)
  const h = cs === 'name' ? host : 'api.example.org'
  const r = evaluate(cs, h, san, installed)
  const errs = errors(r.kind, h, san)
  const at = (i) => step === i
  const choose = (v) => { setCs(v); setStep(0) }

  return (
    <Lab accent="green" className="cc" kicker="HTTPS LAB" title="憑證鏈驗證：用戶端到底在檢查什麼"
         blurb="伺服器憑證由中繼 CA 簽發、中繼 CA 由根 CA 簽發，根 CA 必須在用戶端的信任清單裡。切換各種壞掉的狀況，逐步看驗證卡在哪一關、瀏覽器與 curl 各自報什麼錯。">
      <LabControls>
        <Seg label="狀況" tinted value={cs} onChange={choose} options={Object.entries(CASES).map(([value, label]) => ({ value, label }))} />
      </LabControls>
      {(cs === 'name' || cs === 'internal') && (
        <LabControls>
          {cs === 'name' && <>
            <Seg label="憑證 SAN" mono value={san} onChange={(v) => { setSan(v); setStep(0) }} options={['www.example.org', '*.example.org'].map((v) => ({ value: v, label: v }))} />
            <Seg label="連線到" mono value={host} onChange={(v) => { setHost(v); setStep(0) }} options={['api.example.org', 'example.org', 'a.b.example.org'].map((v) => ({ value: v, label: v }))} />
          </>}
          {cs === 'internal' && <Toggle label="用戶端已安裝院內根憑證" checked={installed} onChange={setInstalled} />}
        </LabControls>
      )}
      <LabControls>
        <Stepper step={step} total={5} onStep={setStep} playing={playing} onPlay={toggle} labels={STEPS} />
      </LabControls>

      <LabStage label="憑證鏈與信任清單">
        <div className="cc-chain">
          <div className="cc-zone"><span>伺服器在 TLS 握手時送出</span></div>
          <div className="cc-zone local"><span>用戶端本機</span></div>
          <Card kind="伺服器憑證" title={r.leaf.cn} sub={`連線到 ${h}`} rows={[['SAN', r.leaf.san.join(', '), at(0), r.checks[0][0]], ['有效期', `${r.leaf.from} – ${r.leaf.to}`, at(1), cs === 'expired' ? 'bad' : 'ok'], ['簽發者', r.leaf.issuer, at(2), r.checks[2][0]]]} />
          <Arrow on={at(2)} broken={cs === 'missing' || cs === 'self'} />
          {r.mid ? (r.mid.sent
            ? <Card kind="中繼 CA" title={r.mid.name} rows={[['有效期', `${r.mid.from} – ${r.mid.to}`, at(1), 'ok'], ['簽發者', r.mid.issuer, at(2), 'ok']]} />
            : <Ghost kind="中繼 CA" text={`${r.mid.name}：伺服器沒送`} bad={step >= 2} />)
            : <Ghost kind="中繼 CA" text="（沒有：自簽憑證）" />}
          <Arrow on={at(2) || at(3)} broken={cs === 'missing' || cs === 'self' || (cs === 'internal' && !installed)} />
          {r.root ? (r.root.reach && !r.root.trusted
            ? <Ghost kind="根 CA" text={`${r.root.name}：這台用戶端沒有`} bad={step >= 3} />
            : r.root.reach
            ? <Card kind="根 CA" title={r.root.name} sub="自己簽自己" rows={[['有效期', `${r.root.from} – ${r.root.to}`, at(1), 'ok'], ['信任清單', '有', at(3), 'ok']]} />
            : <Ghost kind="根 CA" text={`${r.root.name}：到不了`} />)
            : <Ghost kind="根 CA" text="（沒有）" />}
        </div>
        <div className={`cc-store${at(3) ? ' on' : ''}`}>
          <b>用戶端信任清單</b>
          {STORE.map((s) => <span key={s} className={`cc-chip${r.root?.reach && r.root.name === s ? ' hit' : ''}`}>{s}</span>)}
          {cs === 'internal' && <span className={`cc-chip ${installed ? 'hit' : 'miss'}`}>院內 Root CA{installed ? '' : '（未安裝）'}</span>}
          <span className="cc-chip more">…（數十到上百張）</span>
        </div>
      </LabStage>

      <LabGrid variant="even">
        <div className="lab-stack">
          <ol className="cc-checks">
            {STEPS.slice(0, 4).map((s, i) => {
              const [st, txt] = r.checks[i]
              const shown = i <= step
              return (
                <li key={s} className={`${shown ? st : 'pending'}${at(i) ? ' now' : ''}`} onClick={() => setStep(i)}>
                  <span className="cc-ic" aria-hidden="true">{!shown ? '·' : st === 'ok' ? '✓' : st === 'bad' ? '✕' : st === 'skip' ? '–' : 'i'}</span>
                  <b>{s}</b><span>{shown ? txt : '待檢查'}</span>
                </li>
              )
            })}
          </ol>
          <LabExplain title={`${step + 1}. ${STEPS[step]}`}>
            {step < 4 ? <p>{STEP_TEXT[step]}</p> : <p>第一個失敗的檢查決定錯誤訊息。{FIX[r.kind]}</p>}
            {step < 4 && <p><strong>這個狀況：</strong>{r.checks[step][1]}。</p>}
          </LabExplain>
        </div>

        <div className="lab-stack">
          <div className="dtable-wrap">
            <table className={`dtable cc-err${step === 4 ? ' on' : ''}`}>
              <caption><span>結果</span>{r.kind === 'ok' ? <Status ok>驗證通過</Status> : <Status>驗證失敗：{STEPS[r.fail]}</Status>}</caption>
              <tbody>
                {errs.map(([who, msg, good]) => (
                  <tr key={who}><td className="cc-who">{who}</td><td className={good === true ? 'ok' : good === 'maybe' ? 'maybe' : 'bad'}>{msg}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Seg mono value={tab} onChange={setTab} options={[{ value: 's_client', label: 's_client -showcerts' }, { value: 'x509', label: 'x509 -noout' }]} />
          {tab === 's_client'
            ? <Code lang="bash" title="看伺服器送了哪些憑證、驗證結果">{sClient(cs, h, r, installed)}</Code>
            : <Code lang="bash" title="看伺服器憑證的名稱與效期">{x509(cs, h, r)}</Code>}
          <Callout title="實際用在哪裡">
            部署 HTTPS 時 <b>ssl_certificate 要指向 fullchain</b>，部署完用 <code>openssl s_client</code> 看 <code>Verify return code</code> 與 Certificate chain 有幾張；憑證到期要有監控。
            呼叫內部服務遇到憑證錯誤，正確做法是安裝或指定院內根憑證，而不是關掉驗證。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .cc .seg-group { flex-wrap: wrap; }
        .cc-chain { display: grid; grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr) 22px minmax(0, 1fr); gap: 8px 4px; align-items: stretch; }
        .cc-zone { grid-column: 1 / 4; border-top: 2px solid var(--c-teal); font-size: 0.7rem; color: var(--c-teal); padding-top: 2px; text-align: center; }
        .cc-zone.local { grid-column: 5; border-color: var(--c-brown); color: var(--c-brown); }
        .cc-card { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 9px; min-width: 0; font-size: 0.74rem; animation: cc-in 0.3s ease-out both; }
        .cc-card.ghost { border-style: dashed; color: var(--ink-3); display: grid; align-content: center; text-align: center; background: transparent; }
        .cc-card.ghost.bad { border-color: var(--critical); color: var(--critical); }
        .cc-kind { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-3); }
        .cc-title { font-family: var(--mono); font-weight: 700; color: var(--ink-1); overflow-wrap: anywhere; margin: 2px 0; }
        .cc-sub { font-size: 0.66rem; color: var(--ink-3); }
        .cc-row { margin-top: 4px; padding: 2px 4px; border-radius: 3px; transition: background 0.25s ease; overflow-wrap: anywhere; }
        .cc-row i { font-style: normal; display: block; font-size: 0.64rem; color: var(--ink-3); }
        .cc-row span { font-family: var(--mono); color: var(--ink-1); }
        .cc-row.on { background: color-mix(in srgb, var(--lab-accent) 16%, transparent); }
        .cc-row.on.bad { background: color-mix(in srgb, var(--critical) 16%, transparent); }
        .cc-row.on.bad span { color: var(--critical); }
        .cc-arrow { display: grid; place-items: center; color: var(--ink-3); font-size: 1rem; transition: color 0.25s ease; }
        .cc-arrow.on { color: var(--lab-accent); }
        .cc-arrow.broken { color: var(--critical); }
        .cc-store { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.74rem; border: 1px solid var(--hairline); border-radius: var(--radius); padding: 8px; transition: border-color 0.25s ease; }
        .cc-store.on { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .cc-store b { color: var(--ink-2); margin-right: 4px; }
        .cc-chip { font-family: var(--mono); font-size: 0.68rem; padding: 1px 6px; border: 1px solid var(--hairline); border-radius: 3px; color: var(--ink-2); }
        .cc-chip.hit { border-color: var(--good); color: var(--good); font-weight: 700; }
        .cc-chip.miss { border-style: dashed; border-color: var(--critical); color: var(--critical); }
        .cc-chip.more { border: none; color: var(--ink-3); }
        .cc-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        .cc-checks li { display: grid; grid-template-columns: 22px 92px minmax(0, 1fr); gap: 6px; align-items: baseline; font-size: 0.8rem; color: var(--ink-2); padding: 6px 8px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); cursor: pointer; transition: border-color 0.25s ease, opacity 0.25s ease; }
        .cc-checks li.pending { opacity: 0.5; }
        .cc-checks li.now { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .cc-checks b { color: var(--ink-1); font-size: 0.78rem; }
        .cc-ic { font-family: var(--mono); font-weight: 700; text-align: center; }
        .cc-checks li.ok .cc-ic { color: var(--good); } .cc-checks li.bad .cc-ic, .cc-checks li.bad span:last-child { color: var(--critical); }
        .cc-checks li.note .cc-ic { color: var(--c-slate); } .cc-checks li.skip .cc-ic { color: var(--ink-3); }
        .cc-err caption { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .cc-err caption > * { white-space: nowrap; }
        .cc .lab-grid { margin-top: 16px; }
        .cc-err td { white-space: normal; overflow-wrap: anywhere; font-size: 0.72rem; vertical-align: top; }
        .cc-err td.cc-who { font-family: var(--sans); color: var(--ink-3); white-space: nowrap; }
        .cc-err td.bad { color: var(--critical); } .cc-err td.ok { color: var(--good); } .cc-err td.maybe { color: var(--serious); }
        .cc-err.on { box-shadow: 0 0 0 2px var(--lab-accent); }
        .cc .code .ln { white-space: pre-wrap; overflow-wrap: anywhere; padding-left: calc(2.16em + 12px); text-indent: calc(-2.16em - 12px); }
        .cc .callout code { font-family: var(--mono); font-size: 0.9em; }
        @keyframes cc-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @media (max-width: 560px) {
          .cc-chain { grid-template-columns: minmax(0, 1fr); }
          .cc-zone { display: none; }
          .cc-arrow { transform: rotate(90deg); height: 16px; }
          .cc-err tr, .cc-err td { display: block; }
          .cc-err td.cc-who { border-bottom: none; padding-bottom: 0; }
        }
        @media (prefers-reduced-motion: reduce) { .cc-card { animation: none; } }
      `}</style>
    </Lab>
  )
}

function Card({ kind, title, sub, rows }) {
  return (
    <div className="cc-card">
      <div className="cc-kind">{kind}</div>
      <div className="cc-title">{title}</div>
      {sub && <div className="cc-sub">{sub}</div>}
      {rows.map(([k, v, on, st]) => (
        <div key={k} className={`cc-row${on ? ' on' : ''} ${st}`}><i>{k}</i><span>{v}</span></div>
      ))}
    </div>
  )
}

function Ghost({ kind, text, bad }) {
  return <div className={`cc-card ghost${bad ? ' bad' : ''}`}><div className="cc-kind">{kind}</div><div>{text}</div></div>
}

function Arrow({ on, broken }) {
  return (
    <div className={`cc-arrow${on ? ' on' : ''}${broken && on ? ' broken' : ''}`}>
      <svg viewBox="0 0 22 22" width="22" height="22" role="img" aria-label={broken ? '簽發關係斷掉' : '由右邊這張簽發'}>
        <path d="M3 11 H17 M12 6 L17 11 L12 16" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={broken ? '3 3' : 'none'} />
      </svg>
    </div>
  )
}
