import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Code, Callout, Status, useWidth, useTicker, useReducedMotion } from './ui.jsx'

/* ============================================================
   網路通不通，壞在哪一層
   - 舞台：使用者電腦 → DNS → 公司防火牆 → 路由 → 伺服器防火牆 → LB → TLS → app 的路徑，
     請求一跳一跳往前走，停在壞掉的那一層（寬版橫向、手機直向）
   - 右側：dig / nc / curl 在這個故障下的輸出（節錄關鍵行）
   ============================================================ */

const NODES = [
  { label: '使用者電腦', sub: '10.0.0.5' },
  { label: 'DNS', sub: '名稱 → IP' },
  { label: '公司防火牆', sub: '／proxy' },
  { label: '網際網路', sub: '或內網路由' },
  { label: '伺服器防火牆', sub: 'security group' },
  { label: '負載平衡', sub: ':443' },
  { label: 'TLS', sub: '憑證' },
  { label: '應用程式', sub: ':8000' },
]
const IP = '203.0.113.25'
const HOST = 'app.example.org'
const DIG_OK = `$ dig ${HOST} +short\n${IP}`
const NC_OK = `$ nc -vz ${HOST} 443\nConnection to ${HOST} (${IP}) 443 port [tcp/https] succeeded!`
const TRY = `$ curl -v https://${HOST}/\n* Host ${HOST}:443 was resolved.\n*   Trying ${IP}:443...`
const CONN = `${TRY}\n* Connected to ${HOST} (${IP}) port 443`
const TLS_OK = `${CONN}\n* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384\n*  subject: CN=${HOST}\n*  SSL certificate verify ok.\n> GET / HTTP/1.1\n> Host: ${HOST}`
const timeoutNc = (ip) => `$ nc -vz ${HOST} 443\n# 游標停住，約兩分鐘後才失敗\nnc: connect to ${HOST} (${ip}) port 443 (tcp) failed: Connection timed out`
const timeoutCurl = (ip) => `$ curl -v https://${HOST}/\n*   Trying ${ip}:443...\n# 一樣卡住，沒有任何回應\n* connect to ${ip} port 443 failed: Connection timed out`

const FAULTS = {
  ok: {
    label: '正常', stop: 7, kind: 'ok', marks: { 1: ['ok', IP], 7: ['ok', '200 OK'] }, browser: '頁面正常顯示',
    dig: DIG_OK, nc: NC_OK, curl: `${TLS_OK}\n< HTTP/1.1 200 OK\n< Content-Type: text/html; charset=utf-8`,
    title: '一路通到應用程式',
    text: ['DNS 給出 IP、TCP 連得上 443、TLS 憑證驗證通過、LB 把請求轉給 :8000 的程式，回 200。', '排查時就是照這個順序一層層確認：先 dig，再 nc，最後 curl -v。哪一個指令第一個失敗，壞的就在那一層附近。'],
  },
  nx: {
    label: 'DNS 查不到', stop: 1, kind: 'dns', marks: { 1: ['bad', 'NXDOMAIN'] }, browser: 'DNS_PROBE_FINISHED_NXDOMAIN',
    dig: `$ dig ${HOST} +short\n# 沒有任何輸出\n$ dig ${HOST} | grep status\n;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 41821`,
    nc: `$ nc -vz ${HOST} 443\nnc: getaddrinfo for host "${HOST}" port 443: Name or service not known`,
    curl: `$ curl -v https://${HOST}/\n* Could not resolve host: ${HOST}\ncurl: (6) Could not resolve host: ${HOST}`,
    title: 'DNS 查不到：連第一步都沒出門',
    text: ['NXDOMAIN 是 DNS 明確回答「這個名稱不存在」。curl 的 Could not resolve host、nc 的 getaddrinfo 錯誤都在說同一件事：還沒送出任何封包就失敗了，跟防火牆、伺服器都無關。', '常見原因：拼錯網域、DNS 紀錄還沒建、內部網域只在公司 DNS 查得到（在家或 VPN 沒連上時查不到）。'],
  },
  stale: {
    label: 'DNS 指到舊 IP', stop: 3, kind: 'timeout', marks: { 1: ['bad', '回舊 IP'], 3: ['bad', '舊主機沒回應'] }, browser: 'ERR_CONNECTION_TIMED_OUT',
    dig: `$ dig ${HOST} +short\n203.0.113.10\n# 預期應該是 ${IP}（新主機）`,
    nc: timeoutNc('203.0.113.10'), curl: timeoutCurl('203.0.113.10'),
    title: 'DNS 指到舊 IP：錯誤長得像網路問題',
    text: ['症狀是逾時，看起來像防火牆擋了；但 dig 回的 IP 不是新主機的。請求被送到已經下線的舊機器，所以沒人回應。', '判斷方法：把 dig 結果和預期 IP 比對，並注意 curl 的 Trying 那行連的是哪個 IP。剛改過 DNS 時，舊紀錄可能還在 TTL 快取期間內，作業系統與瀏覽器也各有快取。'],
  },
  drop: {
    label: '防火牆 DROP', stop: 4, kind: 'timeout', marks: { 1: ['ok', IP], 4: ['bad', 'DROP：無回應'] }, browser: 'ERR_CONNECTION_TIMED_OUT',
    dig: DIG_OK, nc: timeoutNc(IP), curl: timeoutCurl(IP),
    title: '防火牆丟封包：timeout',
    text: ['DROP 規則把 SYN 默默丟掉、不回任何東西，用戶端只能一直重送直到放棄，所以是「等很久才失敗」的 Connection timed out。', 'timeout 只告訴你「封包有去無回」，不告訴你是誰丟的：可能是伺服器的 security group、公司防火牆擋出站，或路由根本不通。換一個網路（例如手機熱點）再試一次，可以分辨是公司端還是伺服器端。'],
  },
  refused: {
    label: 'port 沒人聽', stop: 5, kind: 'refused', marks: { 1: ['ok', IP], 5: ['bad', ':443 回 RST'] }, browser: 'ERR_CONNECTION_REFUSED',
    dig: DIG_OK,
    nc: `$ nc -vz ${HOST} 443\nnc: connect to ${HOST} (${IP}) port 443 (tcp) failed: Connection refused`,
    curl: `${TRY}\n* connect to ${IP} port 443 failed: Connection refused\ncurl: (7) Failed to connect to ${HOST} port 443 after 3 ms: Couldn't connect to server`,
    title: 'Connection refused：主機到了，但沒人在聽',
    text: ['refused 幾乎是立刻失敗：封包確實到了那台主機，主機回 RST 說「這個 port 沒有程式在聽」。所以網路路徑是通的，問題在服務本身：程式沒啟動、聽錯 port，或只聽 127.0.0.1。', '在伺服器上用 ss -ltnp 看哪些 port 有人在聽。防火牆若設成 REJECT（而不是 DROP），用戶端也會看到 refused。'],
  },
  expired: {
    label: '憑證過期', stop: 6, kind: 'tls', marks: { 1: ['ok', IP], 6: ['bad', '憑證過期'] }, browser: 'NET::ERR_CERT_DATE_INVALID',
    dig: DIG_OK, nc: NC_OK,
    curl: `${CONN}\n* TLSv1.3 (OUT), TLS handshake, Client hello (1):\n* TLSv1.3 (IN), TLS handshake, Certificate (11):\n* SSL certificate problem: certificate has expired\ncurl: (60) SSL certificate problem: certificate has expired`,
    title: '憑證過期：TCP 通了，卡在 TLS',
    text: ['nc 成功代表 TCP 層完全正常；curl 已經 Connected，是在 TLS 握手驗證憑證時放棄。錯誤訊息裡有 SSL / certificate 字樣，就是 TLS 這層。', '別用 curl -k 繞過了事——那等於關掉身分驗證。修法是換新憑證，並設定自動續期與到期告警。'],
  },
  name: {
    label: '憑證網域不符', stop: 6, kind: 'tls', marks: { 1: ['ok', IP], 6: ['bad', '名稱不符'] }, browser: 'NET::ERR_CERT_COMMON_NAME_INVALID',
    dig: DIG_OK, nc: NC_OK,
    curl: `${CONN}\n* Server certificate:\n*  subject: CN=www.example.org\n*  subjectAltName does not match ${HOST}\n* SSL: no alternative certificate subject name matches target host name '${HOST}'\ncurl: (60) SSL: no alternative certificate subject name matches target host name '${HOST}'`,
    title: '憑證網域不符：憑證是別人的名字',
    text: ['伺服器出示的憑證有效，但 subjectAltName 裡沒有你連的這個名稱。常見於新加子網域忘了加進憑證、LB 掛錯憑證，或直接用 IP 連線。', '同樣是 TCP 通、TLS 失敗；訊息關鍵字是 subject name / host name，跟「過期」分得出來。'],
  },
  bad502: {
    label: '後端掛了 502', stop: 7, kind: 'http', marks: { 1: ['ok', IP], 5: ['warn', '回 502'], 7: ['bad', '沒有回應'] }, browser: '502 Bad Gateway 錯誤頁',
    dig: DIG_OK, nc: NC_OK, curl: `${TLS_OK}\n< HTTP/1.1 502 Bad Gateway\n< Content-Type: text/html`,
    title: '502：LB 活著，後面的程式沒回應',
    text: ['有拿到 HTTP 狀態碼，代表 DNS、TCP、TLS 全部正常——回 502 的是負載平衡，不是你的程式。它想轉給 :8000，但連不上或收到無效回應。', '查 LB 的 target 健康檢查與應用程式的日誌：程式是否當掉、重啟中、聽錯 port。'],
  },
  slow504: {
    label: '後端太慢 504', stop: 7, kind: 'http', marks: { 1: ['ok', IP], 5: ['warn', '回 504'], 7: ['bad', '處理太久'] }, browser: '504 Gateway Timeout 錯誤頁',
    dig: DIG_OK, nc: NC_OK, curl: `${TLS_OK}\n# 這裡停了約 60 秒（LB 的逾時設定）\n< HTTP/1.1 504 Gateway Timeout\n< Content-Type: text/html`,
    title: '504：程式有在跑，但太慢',
    text: ['LB 把請求轉給程式後，等到自己的逾時上限還沒拿到回應，只好回 504。程式通常還活著，只是卡在慢查詢、外部 API 或鎖。', '502 與 504 都是 LB 產生的回應；差別在「連不上／回應壞掉」與「等太久」。找出慢的那段，或把長工作改成背景任務，不要只把逾時調大。'],
  },
}
const KEYS = Object.keys(FAULTS)
const CLUE = { ok: '—', dns: 'Could not resolve host', timeout: 'Connection timed out', refused: 'Connection refused', tls: 'SSL …', http: 'HTTP 狀態碼' }
const LAYER = { ok: '—', dns: 'DNS', timeout: '網路路徑／防火牆', refused: '主機上的服務', tls: 'TLS 憑證', http: 'LB 後面的應用程式' }

export default function NetPathLab() {
  const [fault, setFault] = useState('drop')
  const [run, setRun] = useState(true)
  const [tick, resetTick] = useTicker(run, 380)
  const reduced = useReducedMotion()
  const f = FAULTS[fault]
  const hop = reduced ? f.stop : Math.min(tick, f.stop)
  const done = hop >= f.stop
  useEffect(() => { if (tick >= f.stop) setRun(false) }, [tick, f.stop])
  const replay = () => { resetTick(); setRun(true) }
  const choose = (k) => { setFault(k); replay() }

  return (
    <Lab accent="aqua" className="np" kicker="NETWORK LAB" title="網路通不通，壞在哪一層"
         blurb="選一種故障，看請求一跳一跳往前走、停在哪一層，以及 dig、nc、curl 在這個情況下真正會印出什麼。">
      <LabControls>
        <Seg label="故障" tinted value={fault} onChange={choose} options={KEYS.map((k) => ({ value: k, label: FAULTS[k].label }))} />
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={replay}>重送請求</button>
      </LabControls>

      <LabStage label="請求路徑" caption={`請求：https://${HOST}/（LB 收 443，轉給程式的 8000）`}>
        <PathSvg f={f} hop={hop} />
        <div className={`np-result${done ? ' on' : ''}`}>
          {done && (f.kind === 'ok' ? <Status ok>連線成功</Status> : f.kind === 'http' ? <Status warn>拿到錯誤頁</Status> : <Status>連線失敗</Status>)}
          <span>瀏覽器看到：<b>{done ? f.browser : '…'}</b></span>
        </div>
      </LabStage>

      <LabGrid variant="even">
        <div className="lab-stack">
          <Code lang="bash" title="① DNS：dig">{f.dig}</Code>
          <Code lang="bash" title="② TCP：nc -vz">{f.nc}</Code>
          <Code lang="bash" title="③ TLS + HTTP：curl -v（節錄）">{f.curl}</Code>
          <p className="np-note">輸出依工具版本略有差異（例如新版 curl 結尾寫 Couldn't connect to server），重點看關鍵字。IP 為文件範例位址。</p>
        </div>
        <div className="lab-stack">
          <LabExplain title={f.title}>
            {f.text.map((t, i) => <p key={i}>{t}</p>)}
          </LabExplain>
          <div className="np-vs">
            <div className={f.kind === 'timeout' ? 'on' : ''}>
              <b>timeout（逾時）</b>
              <span>等很久才失敗。封包有去無回：被防火牆 DROP、路由不通，或 IP 根本不對。</span>
            </div>
            <div className={f.kind === 'refused' ? 'on' : ''}>
              <b>refused（拒絕）</b>
              <span>立刻失敗。封包到了主機，主機回 RST：那個 port 沒程式在聽（或防火牆 REJECT）。</span>
            </div>
          </div>
          <div className="dtable-wrap">
            <table className="dtable np-tbl">
              <caption>從錯誤訊息判斷層級（點一列切換）</caption>
              <thead><tr><th>故障</th><th>關鍵字</th><th>看哪一層</th></tr></thead>
              <tbody>
                {KEYS.filter((k) => k !== 'ok').map((k) => (
                  <tr key={k} className={`clickable${k === fault ? ' hit' : ''}`} onClick={() => choose(k)}>
                    <td>{FAULTS[k].label}</td>
                    <td>{k === 'stale' ? '逾時＋dig IP 不對' : k === 'name' ? 'subject name' : k === 'expired' ? 'has expired' : k.startsWith('bad') ? '502' : k.startsWith('slow') ? '504' : CLUE[FAULTS[k].kind]}</td>
                    <td>{k === 'stale' ? 'DNS' : LAYER[FAULTS[k].kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Callout title="實際用在哪裡">
            新服務上線後「連不到」、換了機器或 DNS 後部分使用者打不開、要請網管開防火牆之前——先自己跑一輪 <b>dig → nc → curl -v</b>，把「卡在哪一層、看到哪一句錯誤」貼給對方，比「網站壞了」有用得多。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .np .seg-group { flex-wrap: wrap; }
        .np .lab-grid { margin-top: 16px; }
        .np-node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease, fill 0.25s ease, opacity 0.25s ease; }
        .np-node.pass { stroke: var(--good); }
        .np-node.bad { stroke: var(--critical); stroke-width: 2.5; fill: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); }
        .np-node.warn { stroke: var(--serious); stroke-width: 2.5; fill: color-mix(in srgb, var(--serious) 10%, var(--surface-1)); }
        .np-g { transition: opacity 0.25s ease; }
        .np-g.future { opacity: 0.4; }
        .np-lbl { font-family: var(--sans); font-size: 12px; font-weight: 600; fill: var(--ink-1); }
        .np-sub { font-family: var(--mono); font-size: 10px; fill: var(--ink-3); }
        .np-mark { font-family: var(--mono); font-size: 10.5px; font-weight: 700; }
        .np-mark.ok { fill: var(--good); } .np-mark.bad { fill: var(--critical); } .np-mark.warn { fill: var(--serious); }
        .np-wire { stroke: var(--hairline); stroke-width: 2; stroke-dasharray: 4 4; }
        .np-done { stroke: var(--lab-accent); stroke-width: 2.5; transition: all 0.35s ease; }
        .np-dot { fill: var(--lab-accent); transition: transform 0.35s ease; }
        .np-dot.bad { fill: var(--critical); }
        .np-result { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; font-size: 0.86rem; color: var(--ink-2); min-height: 28px; }
        .np-result b { font-family: var(--mono); color: var(--ink-1); }
        .np-note { font-size: 0.76rem; color: var(--ink-3); line-height: 1.6; }
        .np-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .np-vs > div { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; font-size: 0.8rem; color: var(--ink-2); line-height: 1.55; transition: border-color 0.25s ease, box-shadow 0.25s ease; }
        .np-vs > div.on { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .np-vs b { display: block; color: var(--ink-1); font-size: 0.84rem; margin-bottom: 2px; }
        .np-tbl td:first-child { font-family: var(--sans); }
        .np-tbl th, .np-tbl td { white-space: normal; }
        .np .code .ln { white-space: pre-wrap; overflow-wrap: anywhere; padding-left: calc(2.16em + 12px); text-indent: calc(-2.16em - 12px); }
        @media (max-width: 480px) { .np-vs { grid-template-columns: 1fr; } }
      `}</style>
    </Lab>
  )
}

/* 路徑圖：寬度夠就橫排，手機改直排（viewBox = 實際寬度，文字不會被縮小） */
function PathSvg({ f, hop }) {
  const ref = useRef(null)
  const w = useWidth(ref, 900)
  const W = Math.max(300, w)
  const horiz = W >= 720
  const n = NODES.length
  const sp = horiz ? (W - 8) / n : 52
  const bw = horiz ? sp - 12 : Math.min(150, W * 0.46)
  const H = horiz ? 124 : 24 + n * sp
  const pos = (i) => horiz ? { x: 4 + sp * i + sp / 2, y: 62 } : { x: 28 + bw / 2, y: 30 + sp * i }
  const wire = (i) => horiz ? { x: pos(i).x, y: 22 } : { x: 12, y: pos(i).y }
  const d = wire(hop)
  const stopped = hop >= f.stop && f.kind !== 'ok'
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`請求路徑：停在第 ${hop + 1} 層 ${NODES[hop].label}`}>
        <line x1={wire(0).x} y1={wire(0).y} x2={wire(n - 1).x} y2={wire(n - 1).y} className="np-wire" />
        <line x1={wire(0).x} y1={wire(0).y} x2={d.x} y2={d.y} className="np-done" />
        {NODES.map((node, i) => {
          const p = pos(i)
          const m = i <= hop ? f.marks[i] : null
          const state = m && m[0] !== 'ok' ? m[0] : i < hop || (i === hop && f.kind === 'ok') ? 'pass' : ''
          return (
            <g key={i} className={`np-g${i > hop ? ' future' : ''}`}>
              {!horiz && <line x1={12} y1={p.y} x2={p.x - bw / 2} y2={p.y} className="np-wire" />}
              <rect x={p.x - bw / 2} y={p.y - 21} width={bw} height="42" rx="4" className={`np-node ${state}`} />
              <text x={p.x} y={p.y - 3} textAnchor="middle" className="np-lbl">{node.label}</text>
              <text x={p.x} y={p.y + 12} textAnchor="middle" className="np-sub">{node.sub}</text>
              {m && <text x={horiz ? p.x : p.x + bw / 2 + 8} y={horiz ? p.y + 38 : p.y + 4} textAnchor={horiz ? 'middle' : 'start'} className={`np-mark ${m[0]}`}>{m[0] === 'bad' ? '✕ ' : m[0] === 'warn' ? '↩ ' : '✓ '}{m[1]}</text>}
            </g>
          )
        })}
        <circle r="6" className={`np-dot${stopped ? ' bad' : ''}`} style={{ transform: `translate(${d.x}px, ${d.y}px)` }} />
      </svg>
    </div>
  )
}
