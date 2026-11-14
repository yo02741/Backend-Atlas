// 程式題：領域 9（DevOps 與基礎建設）原本沒有程式題的 9 堂課，各 1 題
// 資料全部是虛構的（主機名稱、站點、費用、事故時間線都不是真實資料）；費用類的數字一律由測試傳入，題目本身不內含任何價格

// ── 測試共用的前置資料（Python） ──
const RECOVERY = `
_NEED = {"rpo_min": 60, "rto_min": 240, "survive_site_loss": True}
_PLAN = {"primary_site": "A", "backup_interval_min": 30, "backup_site": "B", "replica": None, "restore_drill_min": 180}
def _r(need=None, **kw):
    return list(review_recovery(dict(_NEED, **(need or {})), dict(_PLAN, **kw)))
`

const NET = `
_OK = {"dns": "NOERROR", "dns_ip": "10.20.0.15", "expected_ip": "10.20.0.15", "tcp": "succeeded", "tls": "ok", "http": 200}
def _d(**kw):
    return tuple(diagnose(dict(_OK, **kw)))
`

const CERT = `
_CHAIN = [
    {"subject": "sched.example.org", "issuer": "Example Issuing CA"},
    {"subject": "Example Issuing CA", "issuer": "Example Root CA"},
]
_ROOTS = {"Example Root CA"}
def _a(san=("*.example.org",), hosts=("www.example.org",), not_after="2026-12-31", chain=None, roots=None, today="2026-11-01", **kw):
    cert = {"san": list(san), "not_after": not_after, "chain": _CHAIN if chain is None else chain}
    return audit(cert, list(hosts), _ROOTS if roots is None else roots, today, **kw)
`

const LOAD = `
_LOAD = {"daily_requests": 1_200_000, "peak_hour_share": 0.18, "burst_factor": 2.0, "latency_s": 0.25,
         "db_time_s": 0.12, "cpu_per_req_s": 0.04, "cores_per_replica": 4, "db_pool": 30}
def _p(target_util=None, **kw):
    load = dict(_LOAD, **kw)
    return plan_capacity(load) if target_util is None else plan_capacity(load, target_util=target_util)
`

const HOSTING = `
_OPTS = [
    {"name": "院內機房", "data_location": "onsite", "staff_fte": 0.5, "capex": 1_800_000, "fixed_per_year": 480_000, "vcpu_per_year": 0, "egress_per_tb": 0},
    {"name": "託管機房", "data_location": "domestic", "staff_fte": 0.4, "capex": 1_800_000, "fixed_per_year": 660_000, "vcpu_per_year": 0, "egress_per_tb": 0},
    {"name": "公有雲（國內區域）", "data_location": "domestic", "staff_fte": 0.25, "capex": 0, "fixed_per_year": 150_000, "vcpu_per_year": 12_000, "egress_per_tb": 3_000},
    {"name": "公有雲（境外區域）", "data_location": "overseas", "staff_fte": 0.25, "capex": 0, "fixed_per_year": 150_000, "vcpu_per_year": 9_000, "egress_per_tb": 3_000},
]
_NEED = {"allowed_locations": ["onsite", "domestic"], "staff_fte_available": 0.5, "peak_vcpu": 128, "avg_ratio": 0.35,
         "autoscale": True, "egress_tb_month": 2, "staff_cost_year": 1_500_000}
def _c(options=None, years=None, **kw):
    need = dict(_NEED, **kw)
    opts = _OPTS if options is None else options
    return compare_hosting(opts, need) if years is None else compare_hosting(opts, need, years=years)
`

const SLO = `
_WINDOW = {"total": 2_000_000, "bad": 1_500}
def _b(slo=0.999, window=None, recent=None, **kw):
    return budget_report(slo, window or _WINDOW, recent or {"total": 60_000, "bad": 30}, **kw)
`

const INCIDENT = `
_EVENTS = [
    {"at": "2026-03-02T07:50", "kind": "started"},
    {"at": "2026-03-02T08:05", "kind": "detected"},
    {"at": "2026-03-02T08:15", "kind": "acknowledged"},
    {"at": "2026-03-02T08:26", "kind": "note"},
    {"at": "2026-03-02T08:34", "kind": "mitigated"},
    {"at": "2026-03-02T08:50", "kind": "resolved"},
]
`

const CHANGE = `
_POLICY = {"cab_score": 9, "windows": {1: (22, 24), 3: (22, 24)}, "freeze": [("2026-03-25", "2026-03-31")]}
_BASE = {"id": "CHG-0312", "type": "normal", "scope": 2, "reversibility": 1, "data_sensitivity": 2, "test_level": 1,
         "author": "dev-a", "approvers": ["lead-b"], "rollback_plan": "重新部署 v2.3.1；本次無資料庫結構變更",
         "scheduled_at": "2026-03-12T22:30"}
def _v(drop=(), **kw):
    c = dict(_BASE, **kw)
    for k in drop:
        c.pop(k, None)
    return review_change(c, _POLICY)
`

// ── 設定檔題共用（JS）：block(key) 取出某個 key 那一行與它底下縮排更深的內容（已去掉註解） ──
const K8S = String.raw`
const block = (key) => {
  const ls = source.split('\n').map((l) => l.replace(/\s+#.*$|^\s*#.*$/, ''))
  const i = ls.findIndex((l) => new RegExp('^\\s*(-\\s+)?' + key + ':').test(l))
  if (i < 0) return ''
  const indent = ls[i].search(/\S/)
  const out = [ls[i]]
  for (const l of ls.slice(i + 1)) { if (l.trim() && l.search(/\S/) <= indent) break; out.push(l) }
  return out.join('\n')
}
`

export default [
  {
    id: 'devops-glossary-1', skill: 'devops-glossary', kind: 'python', level: 1,
    title: '備份與備援方案守不守得住 RPO / RTO',
    prompt: '會議上有人說「有每日備份，也有即時複寫，所以復原沒問題」。把這句話換成可以檢查的規則：實作 `review_recovery(need, plan) -> list[str]`，回傳這份方案**沒守住**的項目。\n\n`need` 是需求：`rpo_min`（最多能遺失幾分鐘的資料）、`rto_min`（幾分鐘內要恢復服務）、`survive_site_loss`（整個站點失效時是否仍要能恢復）。\n\n`plan` 是現況：`primary_site`（主站點）、`backup_interval_min`（多久備份一次）、`backup_site`（備份放在哪個站點）、`replica`（`None`，或 `{"site": ..., "lag_min": ...}`）、`restore_drill_min`（上次演練從備份還原整套系統實際花了幾分鐘；沒演練過是 `None`）。\n\n依下面的順序檢查，有問題就把代碼放進 list：\n\n- `rpo-miss`：備份間隔大於 RPO。只看備份間隔：複寫會把誤刪的資料一起複寫過去，不能取代備份\n- `rto-unverified`：沒有演練過還原，RTO 是未知數；演練過但超過 RTO 則是 `rto-miss`（兩者只會出現一個）\n- `no-dr`：需求要求站點失效仍能恢復，但主站點以外沒有任何一份資料。異地的備份或異地的 replica 都算；同站點的 replica 只是 HA\n\n全部守住就回傳空 list。起始碼把複寫延遲當成最壞情況的資料遺失量、沒演練也當作達標，而且完全沒看站點。',
    starter: `def review_recovery(need: dict, plan: dict) -> list[str]:
    findings = []
    # TODO：這裡把複寫延遲當成最壞情況的資料遺失量——誤刪會被複寫過去，要看的是備份間隔
    replica = plan.get("replica")
    worst_loss = replica["lag_min"] if replica else plan["backup_interval_min"]
    if worst_loss > need["rpo_min"]:
        findings.append("rpo-miss")
    # TODO：沒演練過（None）目前被當成達標
    drill = plan.get("restore_drill_min") or 0
    if drill > need["rto_min"]:
        findings.append("rto-miss")
    # TODO：need["survive_site_loss"] 還沒檢查——備份與 replica 各放在哪個站點？
    return findings


NEED = {"rpo_min": 60, "rto_min": 240, "survive_site_loss": True}
PLAN = {"primary_site": "A", "backup_interval_min": 1440, "backup_site": "A",
        "replica": {"site": "A", "lag_min": 1}, "restore_drill_min": None}
print(review_recovery(NEED, PLAN))
`,
    solution: `def review_recovery(need: dict, plan: dict) -> list[str]:
    findings = []
    # RPO：誤刪會被複寫過去，最壞情況只能回到上一份備份
    if plan["backup_interval_min"] > need["rpo_min"]:
        findings.append("rpo-miss")
    # RTO：沒演練過就是未知數，不能當作達標
    drill = plan.get("restore_drill_min")
    if drill is None:
        findings.append("rto-unverified")
    elif drill > need["rto_min"]:
        findings.append("rto-miss")
    # DR：站點整個失效時，另一個地點要有資料；同站點的 replica 只是 HA
    if need["survive_site_loss"]:
        replica = plan.get("replica")
        offsite_backup = plan["backup_site"] != plan["primary_site"]
        offsite_replica = replica is not None and replica["site"] != plan["primary_site"]
        if not (offsite_backup or offsite_replica):
            findings.append("no-dr")
    return findings


NEED = {"rpo_min": 60, "rto_min": 240, "survive_site_loss": True}
PLAN = {"primary_site": "A", "backup_interval_min": 1440, "backup_site": "A",
        "replica": {"site": "A", "lag_min": 1}, "restore_drill_min": None}
print(review_recovery(NEED, PLAN))
`,
    tests: [
      { name: '每天備份一次守不住 1 小時的 RPO', code: RECOVERY + `
assert _r(backup_interval_min=1440) == ["rpo-miss"], f"每天備份、RPO 60 分鐘：預期 ['rpo-miss']，得到 {_r(backup_interval_min=1440)}"
assert _r(backup_interval_min=60) == [], "備份間隔剛好等於 RPO 算達標"
assert _r(need={"rpo_min": 1440}, backup_interval_min=1440) == [], "RPO 放寬到一天，每日備份就達標"` },
      { name: '有即時複寫也不能取代備份', code: RECOVERY + `
_got = _r(backup_interval_min=1440, replica={"site": "B", "lag_min": 1})
assert _got == ["rpo-miss"], f"複寫延遲只有 1 分鐘，但誤刪會被複寫過去，仍然是 rpo-miss；得到 {_got}"` },
      { name: '沒演練過的 RTO 是未知數，演練超時是未達標', code: RECOVERY + `
assert _r(restore_drill_min=None) == ["rto-unverified"], f"沒演練過：預期 ['rto-unverified']，得到 {_r(restore_drill_min=None)}"
assert _r(restore_drill_min=300) == ["rto-miss"], f"演練花 300 分鐘、RTO 240：預期 ['rto-miss']，得到 {_r(restore_drill_min=300)}"
assert _r(restore_drill_min=240) == [], "演練時間剛好等於 RTO 算達標"` },
      { name: '同站點的備份與 replica 不算 DR', code: RECOVERY + `
assert _r(backup_site="A") == ["no-dr"], "備份和主站點在同一處，站點失效就一起沒了"
assert _r(backup_site="A", replica={"site": "A", "lag_min": 0}) == ["no-dr"], "同站點的 replica 只是 HA，不是 DR"
assert _r(backup_site="A", replica={"site": "B", "lag_min": 5}) == [], "異地的 replica 算一份站外資料"
assert _r(need={"survive_site_loss": False}, backup_site="A") == [], "需求沒有要求站點失效仍能恢復時，不用回報 no-dr"` },
      { name: '多個問題依固定順序回報', code: RECOVERY + `
_got = _r(backup_interval_min=1440, backup_site="A", replica={"site": "A", "lag_min": 1}, restore_drill_min=None)
assert _got == ["rpo-miss", "rto-unverified", "no-dr"], f"得到 {_got}"
assert _r() == [], "全部守住時回傳空 list"` },
    ],
    hints: ['RPO 只比 `plan["backup_interval_min"]` 與 `need["rpo_min"]`，不要看 `replica["lag_min"]`。', '`restore_drill_min` 要先判斷 `is None`（未驗證），再比大小；`no-dr` 的條件是「備份不在站外」而且「沒有站外的 replica」。'],
  },
  {
    id: 'network-troubleshooting-1', skill: 'network-troubleshooting', kind: 'python', level: 2,
    title: '連不上：卡在哪一層、下一步查什麼',
    prompt: '櫃台回報 `https://sched.example.org` 打不開，值班人員依序跑了 `dig`、`nc -vz`、`curl -v`，把結果整理成 `checks`。實作 `diagnose(checks) -> tuple[str, str]`，回傳 `(卡在哪一層, 下一步)`。\n\n`checks` 的欄位：\n\n- `dns`：`dig` 的 status：`"NOERROR"`、`"NXDOMAIN"`、`"SERVFAIL"`；`dns_ip` 是解析到的 IP，`expected_ip` 是服務實際的 IP\n- `tcp`：`nc -vz` 的結果：`"succeeded"`、`"refused"`、`"timeout"`\n- `tls`：`"ok"`、`"expired"`、`"no-issuer"`（找不到簽發者）、`"name-mismatch"`\n- `http`：狀態碼（整數）\n\n前面的層沒過，後面的層根本不會發生：照 DNS → TCP → TLS → HTTP 的順序看，回報第一個沒過的層。沒跑到的檢查是 `None`；前面的層沒過時，後面的欄位就算有值也不看（可能是在另一台電腦上測的）。\n\n層的代碼：`dns`、`tcp`、`tls`、`proxy`（反向代理或負載平衡器產生的錯誤）、`app`、`ok`。\n\n下一步的代碼（哪個症狀對哪一個，依課文判斷）：\n\n- `fix-record`：確認名字有沒有打錯、記錄有沒有建、問的是不是對的那台 DNS\n- `check-resolver`：DNS 伺服器自己查不下去，查它的上游與 DNSSEC\n- `check-listener`：到主機上用 `ss -ltn` 看服務聽在哪個位址與 port\n- `check-firewall`：查防火牆規則與路由\n- `renew-cert`（續約並重新載入）、`send-chain`（補送中繼憑證）、`fix-san`（把名字列進 SAN）\n- `proxy-log`：到 proxy 看 error log，從 proxy 那台對後端重測\n- `app-log`：看應用程式 log\n- `none`：全部通過\n\n解析成功但 IP 不是預期的，也算卡在 DNS（下一步 `fix-record`）。`http` 在 400 以上、又不是 proxy 產生的那三個狀態碼時，算應用程式層。\n\n起始碼先看 HTTP 狀態碼，順序反了，幾種症狀也沒分開。',
    starter: `def diagnose(checks: dict) -> tuple[str, str]:
    # TODO：順序反了——要從 DNS 開始，一層沒過就不看後面
    status = checks.get("http")
    if status is not None and status >= 500:
        return ("app", "app-log")           # TODO：502 / 503 / 504 是誰產生的？
    if checks.get("tcp") in ("refused", "timeout"):
        return ("tcp", "check-firewall")    # TODO：refused 與 timeout 的意義不同
    if checks.get("dns") != "NOERROR":
        return ("dns", "fix-record")        # TODO：NXDOMAIN 與 SERVFAIL 也不同
    return ("ok", "none")


print(diagnose({"dns": "NOERROR", "dns_ip": "10.20.0.15", "expected_ip": "10.20.0.15",
                "tcp": "refused", "tls": None, "http": None}))
`,
    solution: `TLS_NEXT = {"expired": "renew-cert", "no-issuer": "send-chain", "name-mismatch": "fix-san"}


def diagnose(checks: dict) -> tuple[str, str]:
    # 1. DNS：名字不存在、DNS 自己查不下去、或解析到不是預期的 IP
    dns = checks.get("dns")
    if dns == "NXDOMAIN":
        return ("dns", "fix-record")
    if dns == "SERVFAIL":
        return ("dns", "check-resolver")
    if checks.get("dns_ip") != checks.get("expected_ip"):
        return ("dns", "fix-record")
    # 2. TCP：refused 是封包到了但沒人聽；timeout 是封包被丟掉或路由不通
    tcp = checks.get("tcp")
    if tcp == "refused":
        return ("tcp", "check-listener")
    if tcp == "timeout":
        return ("tcp", "check-firewall")
    # 3. TLS
    tls = checks.get("tls")
    if tls in TLS_NEXT:
        return ("tls", TLS_NEXT[tls])
    # 4. HTTP：502 / 503 / 504 是 proxy 產生的，其他錯誤才是應用程式回的
    status = checks.get("http")
    if status in (502, 503, 504):
        return ("proxy", "proxy-log")
    if status is not None and status >= 400:
        return ("app", "app-log")
    return ("ok", "none")


print(diagnose({"dns": "NOERROR", "dns_ip": "10.20.0.15", "expected_ip": "10.20.0.15",
                "tcp": "refused", "tls": None, "http": None}))
`,
    tests: [
      { name: 'NXDOMAIN 與 SERVFAIL 的下一步不同', code: NET + `
_a = _d(dns="NXDOMAIN", dns_ip=None, tcp=None, tls=None, http=None)
_b = _d(dns="SERVFAIL", dns_ip=None, tcp=None, tls=None, http=None)
assert _a == ("dns", "fix-record"), f"NXDOMAIN 是名字不存在；得到 {_a}"
assert _b == ("dns", "check-resolver"), f"SERVFAIL 是 DNS 伺服器自己查不下去；得到 {_b}"` },
      { name: '解析到非預期的 IP 也是卡在 DNS', code: NET + `
_a = _d(dns_ip="203.0.113.7")
assert _a == ("dns", "fix-record"), f"解析到的 IP 不是服務的 IP（例如問到另一台 DNS）；得到 {_a}"` },
      { name: 'refused 與 timeout 的下一步不同', code: NET + `
_a = _d(tcp="refused", tls=None, http=None)
_b = _d(tcp="timeout", tls=None, http=None)
assert _a == ("tcp", "check-listener"), f"refused：封包到了主機，但那個 port 沒有程式在聽；得到 {_a}"
assert _b == ("tcp", "check-firewall"), f"timeout：封包被丟掉或路由不通；得到 {_b}"` },
      { name: 'TLS 的三種錯誤各有對應的修法', code: NET + `
assert _d(tls="expired", http=None) == ("tls", "renew-cert")
assert _d(tls="no-issuer", http=None) == ("tls", "send-chain"), "找不到簽發者：伺服器沒送中繼憑證"
assert _d(tls="name-mismatch", http=None) == ("tls", "fix-san")` },
      { name: '502 / 503 / 504 看 proxy，其他錯誤看應用程式', code: NET + `
for _s in (502, 503, 504):
    assert _d(http=_s) == ("proxy", "proxy-log"), f"{_s} 是 proxy 產生的，要看 proxy 的 log；得到 {_d(http=_s)}"
assert _d(http=500) == ("app", "app-log"), f"500 是應用程式自己回的；得到 {_d(http=500)}"
assert _d(http=403) == ("app", "app-log"), "403 代表網路是通的，問題在應用程式的權限"` },
      { name: '前面的層沒過就不看後面；全部通過回 ok', code: NET + `
_a = _d(dns="SERVFAIL", dns_ip=None, http=200)
_b = _d(tcp="timeout", tls="ok", http=502)
_c = _d(tcp="refused", tls="expired", http=500)
assert _a == ("dns", "check-resolver"), f"DNS 沒過，後面的 200 是別處測的；得到 {_a}"
assert _b == ("tcp", "check-firewall"), f"TCP 沒過就不看 HTTP；得到 {_b}"
assert _c == ("tcp", "check-listener"), f"得到 {_c}"
assert _d() == ("ok", "none")
assert _d(http=302) == ("ok", "none"), "3xx 不是錯誤"` },
    ],
    hints: ['照 DNS → TCP → TLS → HTTP 的順序寫，每一層一發現問題就 `return`，後面的欄位自然不會被看到。', 'refused 代表主機在、port 沒人聽（`check-listener`）；timeout 多半是防火牆或路由（`check-firewall`）。502、503、504 的錯誤頁是 proxy 產生的。'],
  },
  {
    id: 'https-certificates-1', skill: 'https-certificates', kind: 'python', level: 2,
    title: '憑證健檢：名字、到期日、信任鏈',
    prompt: '實作 `audit(cert, hosts, trusted_roots, today, warn_days=30) -> dict`，檢查一張憑證撐不撐得住這幾個主機名稱。\n\n`cert` 的欄位：`san`（名稱 list）、`not_after`（到期日，`"YYYY-MM-DD"`）、`chain`（伺服器實際送出的憑證，網站憑證在最前面，每張是 `{"subject": ..., "issuer": ...}`）。`trusted_roots` 是用戶端 trust store 裡的根憑證名稱，`today` 也是 `"YYYY-MM-DD"`。\n\n回傳 dict：\n\n- `uncovered`：`hosts` 裡 SAN 涵蓋不到的名稱（照 `hosts` 的順序）。萬用字元只能在最左邊一段、只代表剛好一段；比對不分大小寫\n- `days_left`：到期日減今天的天數（過期是負數）\n- `expiry`：`days_left` 小於 0 是 `"expired"`；剩不到 `warn_days` 天是 `"expiring"`；其餘是 `"ok"`\n- `chain_ok`：`chain` 裡每一張的 `issuer` 都是下一張的 `subject`，而且最後一張的 `issuer` 在 `trusted_roots` 裡（根憑證不用送，但用戶端要認得）\n\n起始碼用字尾比對名字、只判斷有沒有過期、只要有送憑證就當作鏈完整。',
    starter: `from datetime import date


def audit(cert: dict, hosts: list[str], trusted_roots: set[str], today: str, warn_days: int = 30) -> dict:
    # TODO：字尾比對會把 a.b.example.org 也算進 *.example.org；大小寫也沒處理
    uncovered = []
    for host in hosts:
        ok = any(host == name or (name.startswith("*.") and host.endswith(name[1:])) for name in cert["san"])
        if not ok:
            uncovered.append(host)
    days_left = (date.fromisoformat(cert["not_after"]) - date.fromisoformat(today)).days
    # TODO：快到期（剩不到 warn_days 天）要回 "expiring"
    expiry = "expired" if days_left < 0 else "ok"
    # TODO：要逐張確認 issuer 接得上下一張，最後接到 trusted_roots
    chain_ok = len(cert["chain"]) > 0
    return {"uncovered": uncovered, "days_left": days_left, "expiry": expiry, "chain_ok": chain_ok}


CERT = {"san": ["*.example.org"], "not_after": "2026-11-30",
        "chain": [{"subject": "sched.example.org", "issuer": "Example Issuing CA"}]}
print(audit(CERT, ["example.org", "sched.example.org", "his.dept.example.org"], {"Example Root CA"}, "2026-11-13"))
`,
    solution: `from datetime import date


def matches(pattern: str, host: str) -> bool:
    p = pattern.lower().split(".")
    h = host.lower().split(".")
    if len(p) != len(h):              # 段數不同就不可能相符
        return False
    if p[0] == "*":
        return p[1:] == h[1:]         # * 只取代最左邊那一段
    return p == h


def audit(cert: dict, hosts: list[str], trusted_roots: set[str], today: str, warn_days: int = 30) -> dict:
    uncovered = [h for h in hosts if not any(matches(name, h) for name in cert["san"])]
    days_left = (date.fromisoformat(cert["not_after"]) - date.fromisoformat(today)).days
    if days_left < 0:
        expiry = "expired"
    elif days_left < warn_days:
        expiry = "expiring"
    else:
        expiry = "ok"
    chain = cert["chain"]
    linked = all(chain[i]["issuer"] == chain[i + 1]["subject"] for i in range(len(chain) - 1))
    chain_ok = bool(chain) and linked and chain[-1]["issuer"] in trusted_roots
    return {"uncovered": uncovered, "days_left": days_left, "expiry": expiry, "chain_ok": chain_ok}


CERT = {"san": ["*.example.org"], "not_after": "2026-11-30",
        "chain": [{"subject": "sched.example.org", "issuer": "Example Issuing CA"}]}
print(audit(CERT, ["example.org", "sched.example.org", "his.dept.example.org"], {"Example Root CA"}, "2026-11-13"))
`,
    tests: [
      { name: '萬用字元只涵蓋剛好一段（apex 與多層子網域都不算）', code: CERT + `
_got = _a(hosts=["example.org", "www.example.org", "his.dept.example.org", "api.example.org"])["uncovered"]
assert _got == ["example.org", "his.dept.example.org"], f"*.example.org 不涵蓋 apex，也不涵蓋兩段的子網域；得到 {_got}"
assert _a(san=["*.dept.example.org"], hosts=["his.dept.example.org", "dept.example.org"])["uncovered"] == ["dept.example.org"]` },
      { name: 'SAN 列了 apex 就涵蓋；比對不分大小寫', code: CERT + `
assert _a(san=["*.example.org", "example.org"], hosts=["example.org", "www.example.org"])["uncovered"] == [], "SAN 同時列 apex 與萬用字元"
assert _a(san=["Sched.Example.org"], hosts=["sched.example.ORG"])["uncovered"] == [], "主機名稱不分大小寫"
assert _a(san=["sched.example.org"], hosts=["sched.example.org", "booking.example.org"])["uncovered"] == ["booking.example.org"]
assert _a(san=["example.org"], hosts=["notexample.org"])["uncovered"] == ["notexample.org"], "名字要整段相符，不是字尾相符"` },
      { name: '到期判斷的邊界：剛好 warn_days 天還算 ok', code: CERT + `
_r30 = _a(not_after="2026-12-01", today="2026-11-01")
_r29 = _a(not_after="2026-11-30", today="2026-11-01")
assert (_r30["days_left"], _r30["expiry"]) == (30, "ok"), f"剩 30 天：得到 {_r30}"
assert (_r29["days_left"], _r29["expiry"]) == (29, "expiring"), f"剩 29 天：得到 {_r29}"
_r0 = _a(not_after="2026-11-01", today="2026-11-01")
_rx = _a(not_after="2026-10-31", today="2026-11-01")
assert (_r0["days_left"], _r0["expiry"]) == (0, "expiring"), f"到期日當天：得到 {_r0}"
assert (_rx["days_left"], _rx["expiry"]) == (-1, "expired"), f"過期一天：得到 {_rx}"
assert _a(not_after="2026-11-20", today="2026-11-01", warn_days=14)["expiry"] == "ok", "warn_days 由參數決定"` },
      { name: '漏送中繼憑證，信任鏈就接不上', code: CERT + `
assert _a()["chain_ok"] is True, "網站憑證 + 中繼憑證，中繼由受信任的根簽發"
assert _a(chain=_CHAIN[:1])["chain_ok"] is False, "只送網站憑證：它的簽發者是中繼 CA，不在 trust store 裡"
_wrong = [_CHAIN[0], {"subject": "Other Issuing CA", "issuer": "Example Root CA"}]
assert _a(chain=_wrong)["chain_ok"] is False, "送了不相干的中繼憑證，issuer 接不上"
assert _a(chain=[])["chain_ok"] is False` },
      { name: '內部 CA：用戶端沒裝根憑證就不信任', code: CERT + `
_internal = [
    {"subject": "his.example.org", "issuer": "Example Internal Issuing CA"},
    {"subject": "Example Internal Issuing CA", "issuer": "Example Internal Root CA"},
]
assert _a(chain=_internal)["chain_ok"] is False, "這台用戶端的 trust store 沒有內部根憑證"
assert _a(chain=_internal, roots={"Example Root CA", "Example Internal Root CA"})["chain_ok"] is True, "裝了內部根憑證之後就接得上"` },
    ],
    hints: ['把名字用 `.` 切成段：段數不同直接不相符；樣式第一段是 `*` 時，只比後面幾段。兩邊都先 `.lower()`。', '信任鏈：用 `range(len(chain) - 1)` 逐張比 `chain[i]["issuer"] == chain[i + 1]["subject"]`，最後再看 `chain[-1]["issuer"] in trusted_roots`。'],
  },
  {
    id: 'capacity-planning-1', skill: 'capacity-planning', kind: 'python', level: 2,
    title: '從尖峰推副本數與連線數',
    prompt: '實作 `plan_capacity(load, target_util=0.65) -> dict`，把一份流量假設換成可以拿去討論的數字。\n\n`load` 的欄位：`daily_requests`（一天的請求數）、`peak_hour_share`（尖峰小時佔全天的比例）、`burst_factor`（尖峰小時內最忙的一分鐘是該小時平均的幾倍）、`latency_s`（每個請求平均停留幾秒）、`db_time_s`（每個請求平均佔用資料庫連線幾秒）、`cpu_per_req_s`（每個請求消耗的 CPU 時間，核秒）、`cores_per_replica`（每個副本幾核）、`db_pool`（連線池上限）。\n\n回傳 dict：\n\n- `peak_rps`：尖峰每秒請求數 = 一天請求數 × 尖峰小時比例 ÷ 3600 × 突發倍數，四捨五入到小數 1 位\n- `in_flight`：同時處理中的請求數（Little\'s Law：L = λW），小數 1 位\n- `db_conns`：同時佔用的資料庫連線數，小數 1 位\n- `pool_enough`：`db_conns` 沒有超過 `db_pool` 是 `True`\n- `replicas`：需要的核心數 = 尖峰 RPS × 每請求 CPU 時間 ÷ `target_util`；除以每個副本的核心數、無條件進位得到 N（至少 1），再多準備 1 台（N+1）\n\n後面四項都用還沒四捨五入的尖峰 RPS 去算。起始碼用全天平均 RPS，也沒留使用率餘裕與 N+1。',
    starter: `import math


def plan_capacity(load: dict, target_util: float = 0.65) -> dict:
    # TODO：容量要扛的是尖峰，不是全天平均
    rps = load["daily_requests"] / 86400
    in_flight = rps * load["latency_s"]
    db_conns = rps * load["db_time_s"]
    # TODO：沒有除以目標使用率，也沒有算「壞一台之後剩下的扛不扛得住」
    replicas = math.ceil(rps * load["cpu_per_req_s"] / load["cores_per_replica"])
    return {
        "peak_rps": round(rps, 1),
        "in_flight": round(in_flight, 1),
        "db_conns": round(db_conns, 1),
        "pool_enough": db_conns <= load["db_pool"],
        "replicas": replicas,
    }


LOAD = {"daily_requests": 1_200_000, "peak_hour_share": 0.18, "burst_factor": 2.0, "latency_s": 0.25,
        "db_time_s": 0.12, "cpu_per_req_s": 0.04, "cores_per_replica": 4, "db_pool": 30}
print(plan_capacity(LOAD))
`,
    solution: `import math


def plan_capacity(load: dict, target_util: float = 0.65) -> dict:
    # 尖峰 RPS：尖峰小時的平均，再乘上小時內的突發倍數
    peak_rps = load["daily_requests"] * load["peak_hour_share"] / 3600 * load["burst_factor"]
    # Little's Law：同時存在的數量 = 到達率 × 平均停留時間
    in_flight = peak_rps * load["latency_s"]
    db_conns = peak_rps * load["db_time_s"]
    # CPU：忙碌的核心數除以目標使用率；N 台扛得住尖峰，再多準備 1 台
    cores = peak_rps * load["cpu_per_req_s"] / target_util
    n = max(1, math.ceil(cores / load["cores_per_replica"]))
    return {
        "peak_rps": round(peak_rps, 1),
        "in_flight": round(in_flight, 1),
        "db_conns": round(db_conns, 1),
        "pool_enough": db_conns <= load["db_pool"],
        "replicas": n + 1,
    }


LOAD = {"daily_requests": 1_200_000, "peak_hour_share": 0.18, "burst_factor": 2.0, "latency_s": 0.25,
        "db_time_s": 0.12, "cpu_per_req_s": 0.04, "cores_per_replica": 4, "db_pool": 30}
print(plan_capacity(LOAD))
`,
    tests: [
      { name: '尖峰 RPS 從尖峰小時與突發倍數推，不是全天平均', code: LOAD + `
_r = _p()
assert abs(_r["peak_rps"] - 120.0) < 0.05, f"預期 120.0（全天平均只有 13.9），得到 {_r['peak_rps']}"
assert abs(_p(burst_factor=1.0)["peak_rps"] - 60.0) < 0.05, "突發倍數 1 時就是尖峰小時的平均"
assert abs(_p(peak_hour_share=0.09)["peak_rps"] - 60.0) < 0.05` },
      { name: "Little's Law：同時處理中的請求與資料庫連線", code: LOAD + `
_r = _p()
assert abs(_r["in_flight"] - 30.0) < 0.05, f"120 RPS × 0.25 秒 = 30，得到 {_r['in_flight']}"
assert abs(_r["db_conns"] - 14.4) < 0.05, f"120 RPS × 0.12 秒 = 14.4，得到 {_r['db_conns']}"
assert _r["pool_enough"] is True, "14.4 條連線，連線池 30 條夠用"` },
      { name: '資料庫變慢，同樣的流量會把連線池占滿', code: LOAD + `
_r = _p(db_time_s=0.6)
assert abs(_r["db_conns"] - 72.0) < 0.05, f"每個請求佔用 0.6 秒：120 × 0.6 = 72，得到 {_r['db_conns']}"
assert _r["pool_enough"] is False, "72 條 > 連線池 30 條，請求開始排隊"
assert _p(db_pool=10)["pool_enough"] is False, "連線池只有 10 條，平常就不夠"` },
      { name: '副本數含使用率餘裕與 N+1', code: LOAD + `
_r = _p()
assert _r["replicas"] == 3, f"4.8 核 ÷ 0.65 ≈ 7.4 核 → 4 核的副本要 2 台，N+1 是 3；得到 {_r['replicas']}"
assert _p(target_util=0.5)["replicas"] == 4, "目標使用率 50%：9.6 核 → 3 台，N+1 是 4"
assert _p(cpu_per_req_s=0.2)["replicas"] == 11, f"每請求 0.2 核秒：36.9 核 → 10 台，N+1 是 11；得到 {_p(cpu_per_req_s=0.2)['replicas']}"` },
      { name: '流量再小也至少 1 台加 1 台', code: LOAD + `
assert _p(daily_requests=8640, peak_hour_share=0.1, burst_factor=1.0)["replicas"] == 2, "N 至少是 1，N+1 就是 2"
_z = _p(daily_requests=0)
assert _z["replicas"] == 2 and _z["peak_rps"] == 0 and _z["pool_enough"] is True, f"沒有流量時：得到 {_z}"` },
    ],
    hints: ['`peak_rps = daily_requests * peak_hour_share / 3600 * burst_factor`；之後的 `in_flight`、`db_conns` 都是「到達率 × 停留時間」。', '`n = max(1, math.ceil(cores / cores_per_replica))`，回傳 `n + 1`；`cores` 記得先除以 `target_util`。'],
  },
  {
    id: 'k8s-readiness-1', skill: 'k8s-readiness', kind: 'config', level: 2, file: 'deployment.yaml',
    title: '搬上 Kubernetes 之前，補齊 Deployment 的四個缺口',
    prompt: '檢驗報告查詢服務要搬上 Kubernetes。這份 Deployment 是照著原本 VM 上的做法寫的，還有四個缺口。應用程式已經提供兩個端點：`/healthz` 只回報程序活著，`/ready` 會檢查資料庫連線與暖機狀態。叢集裡已經有一個 Secret `lab-report-secrets`，裡面的 key 是 `DATABASE_URL`。\n\n修改成：\n\n- image 不用 `latest`，改用 CI 產出的 commit SHA tag `8d1e7f40`，否則不知道叢集裡跑的是哪一版，也無法回退\n- `DATABASE_URL` 從 Secret 讀（`secretKeyRef` 或 `envFrom` 的 `secretRef` 都可以），檔案裡不能留密碼\n- 加上 `readinessProbe`，打 `/ready`，準備好才收流量\n- `livenessProbe` 改打 `/healthz`：liveness 檢查資料庫的話，資料庫一抖，所有 Pod 會一起重啟\n\n副本數、port 與其他設定維持不變。',
    starter: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: lab-report
  namespace: lab
spec:
  replicas: 3
  selector:
    matchLabels: { app: lab-report }
  template:
    metadata:
      labels: { app: lab-report }
    spec:
      containers:
        - name: web
          image: registry.example.org/lab/report:latest
          ports:
            - containerPort: 8000
          env:
            - name: LOG_LEVEL
              value: "info"
            - name: DATABASE_URL
              value: "postgresql://report:S3cret-pw@db.lab.example.org:5432/report"
          livenessProbe:
            httpGet: { path: /ready, port: 8000 }
            initialDelaySeconds: 10
            periodSeconds: 10
`,
    solution: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: lab-report
  namespace: lab
spec:
  replicas: 3
  selector:
    matchLabels: { app: lab-report }
  template:
    metadata:
      labels: { app: lab-report }
    spec:
      containers:
        - name: web
          image: registry.example.org/lab/report:8d1e7f40   # commit SHA，對得回是哪一版
          ports:
            - containerPort: 8000
          env:
            - name: LOG_LEVEL
              value: "info"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: lab-report-secrets
                  key: DATABASE_URL
          readinessProbe:              # 準備好才收流量：/ready 會檢查資料庫
            httpGet: { path: /ready, port: 8000 }
            periodSeconds: 5
          livenessProbe:               # 只看程序有沒有卡死，不碰外部依賴
            httpGet: { path: /healthz, port: 8000 }
            initialDelaySeconds: 10
            periodSeconds: 10
`,
    hints: [
      '機密有兩種注入方式：單一變數用 `valueFrom:` → `secretKeyRef:`（`name` 是 Secret 名稱、`key` 是裡面的 key）；整個 Secret 一次注入用 `envFrom:` → `- secretRef: { name: lab-report-secrets }`。',
      '`readinessProbe` 與 `livenessProbe` 是容器底下同一層的兩個欄位，格式相同：`httpGet: { path: ..., port: 8000 }`。readiness 打 `/ready`，liveness 打 `/healthz`。',
    ],
    tests: [
      { name: 'image 帶明確的版本，不是 latest', code: String.raw`
const m = lines.map((l) => l.match(/^\s*(?:-\s+)?image:\s*["']?([^\s"']+)["']?\s*$/)).find(Boolean)
assert(m, '找不到 image:')
const ref = m[1]
const tag = ref.includes('@sha256:') ? 'digest' : (ref.split('/').pop().split(':')[1] || '')
assert(tag, 'image 沒有 tag，等於 latest：' + ref)
assert(tag !== 'latest', 'image 還在用 latest，不知道叢集裡跑的是哪一版：' + ref)
assert(tag === 'digest' || tag === '8d1e7f40', 'tag 要用 CI 產出的 commit SHA 8d1e7f40（或 digest），得到 ' + tag)
` },
      { name: 'DATABASE_URL 從 Secret 讀，檔案裡沒有密碼', code: K8S + String.raw`
assert(!source.includes('S3cret-pw'), '密碼還留在檔案裡（放在註解裡也不行）')
assert(!/postgres(ql)?:\/\/[^\s"'@/]*:[^\s"'@/]+@/.test(source), '檔案裡不應該有帶帳密的連線字串')
const env = block('env') + '\n' + block('envFrom')
const viaKeyRef = /name:\s*["']?DATABASE_URL["']?\s*,?\s*valueFrom:\s*\{?\s*secretKeyRef:\s*\{?[^}]{0,80}?name:\s*["']?lab-report-secrets\b/.test(env)
const viaEnvFrom = /secretRef:\s*\{?\s*name:\s*["']?lab-report-secrets\b/.test(block('envFrom'))
assert(viaKeyRef || viaEnvFrom, 'DATABASE_URL 要用 secretKeyRef（name: lab-report-secrets）或 envFrom 的 secretRef 注入')
if (viaKeyRef) assert(/secretKeyRef:\s*\{?[^}]{0,80}?key:\s*["']?DATABASE_URL\b/.test(env), 'secretKeyRef 要指定 key: DATABASE_URL')
` },
      { name: 'readinessProbe 打 /ready', code: K8S + String.raw`
const r = block('readinessProbe')
assert(r, '沒有 readinessProbe：容器一啟動就被視為 ready，還沒連上資料庫流量就進來了')
assert(/httpGet:/.test(r), 'readinessProbe 要用 httpGet')
assert(/path:\s*["']?\/ready["']?\s*(,|\}|$)/m.test(r), 'readinessProbe 的 path 要是 /ready（會檢查資料庫與暖機狀態）')
` },
      { name: 'livenessProbe 打 /healthz，不檢查資料庫', code: K8S + String.raw`
const l = block('livenessProbe')
assert(l, 'livenessProbe 不見了：程序卡死時要靠它重啟')
assert(!/path:\s*["']?\/ready\b/.test(l), 'livenessProbe 還在打 /ready：資料庫短暫不穩時，所有 Pod 會一起被重啟')
assert(/path:\s*["']?\/healthz["']?\s*(,|\}|$)/m.test(l), 'livenessProbe 的 path 要是 /healthz（只回報程序活著）')
` },
      { name: '副本數與 port 維持不變', code: K8S + String.raw`
assert(/^kind:\s*Deployment\s*$/m.test(lines.join('\n')), 'kind 要維持 Deployment')
assert(/^\s+replicas:\s*3\s*$/m.test(lines.join('\n')), 'replicas 要維持 3')
assert(/containerPort:\s*8000\b/.test(lines.join('\n')), 'containerPort 要維持 8000')
for (const k of ['readinessProbe', 'livenessProbe']) {
  const b = block(k)
  if (b) assert(/port:\s*["']?(8000|[a-z][a-z0-9-]*)["']?/.test(b), k + ' 要指定 port（8000 或具名的 port）')
}
` },
    ],
  },
  {
    id: 'hosting-models-1', skill: 'hosting-models', kind: 'python', level: 2,
    title: '幾種放法：先篩條件，再比總持有成本',
    prompt: '同一套系統有幾種放法。實作 `compare_hosting(options, need, years=5) -> dict`：先篩掉不符合條件的選項，再算剩下選項的總持有成本。所有數字都由呼叫者傳入（測試用的是虛構數字），不要把任何單價寫死在函式裡。\n\n每個 `option`：`name`、`data_location`（資料放在哪）、`staff_fte`（要投入幾個維運人力）、`capex`（一次性採購）、`fixed_per_year`（每年固定費用：電力、機櫃、維護合約或受管服務年費）、`vcpu_per_year`（每個 vCPU 每年的費用，買斷硬體的選項是 0）、`egress_per_tb`（流出流量每 TB 的費用）。\n\n`need`：`allowed_locations`（資料可以放的位置）、`staff_fte_available`（團隊能投入的維運人力）、`peak_vcpu`、`avg_ratio`（平均用量佔尖峰的比例）、`autoscale`（有沒有做自動擴縮）、`egress_tb_month`（每月流出幾 TB）、`staff_cost_year`（一個維運人力一年的成本）。\n\n規則：\n\n- 資料落地先看：`data_location` 不在 `allowed_locations` 裡就排除，原因 `"data-location"`\n- 接著看人力：`staff_fte` 超過 `staff_fte_available` 就排除，原因 `"staff"`\n- 計費的 vCPU：有做自動擴縮是 `peak_vcpu` × `avg_ratio`；沒做擴縮就是 `peak_vcpu`（開著就計費）\n- 每年費用 = `fixed_per_year` + 計費 vCPU × `vcpu_per_year` + `egress_tb_month` × 12 × `egress_per_tb` + `staff_fte` × `staff_cost_year`\n- 總持有成本 = `capex` + `years` × 每年費用，用 `round()` 取整數\n\n回傳 `{"excluded": {名稱: 原因}, "tco": {名稱: 金額}, "cheapest": 名稱}`。被排除的選項不出現在 `tco`；沒有任何選項合格時 `cheapest` 是 `None`。\n\n起始碼只比硬體與運算費用，也沒有先篩條件。',
    starter: `def compare_hosting(options: list[dict], need: dict, years: int = 5) -> dict:
    # TODO：先依資料落地與維運人力篩選，不合格的放進 excluded
    excluded = {}
    tco = {}
    for o in options:
        # TODO：只比了硬體與運算——固定費用、流量費、人力都沒算；沒做擴縮時也不該乘 avg_ratio
        compute = need["peak_vcpu"] * need["avg_ratio"] * o["vcpu_per_year"]
        tco[o["name"]] = round(o["capex"] + years * compute)
    cheapest = min(tco, key=tco.get) if tco else None
    return {"excluded": excluded, "tco": tco, "cheapest": cheapest}


# 以下數字都是虛構的，只用來試跑
OPTIONS = [
    {"name": "院內機房", "data_location": "onsite", "staff_fte": 0.5, "capex": 1_800_000,
     "fixed_per_year": 480_000, "vcpu_per_year": 0, "egress_per_tb": 0},
    {"name": "公有雲（境外區域）", "data_location": "overseas", "staff_fte": 0.25, "capex": 0,
     "fixed_per_year": 150_000, "vcpu_per_year": 9_000, "egress_per_tb": 3_000},
]
NEED = {"allowed_locations": ["onsite", "domestic"], "staff_fte_available": 0.5, "peak_vcpu": 128, "avg_ratio": 0.35,
        "autoscale": True, "egress_tb_month": 2, "staff_cost_year": 1_500_000}
print(compare_hosting(OPTIONS, NEED))
`,
    solution: `def compare_hosting(options: list[dict], need: dict, years: int = 5) -> dict:
    excluded = {}
    tco = {}
    for o in options:
        # 資料落地與法規先看，再看團隊扛不扛得動
        if o["data_location"] not in need["allowed_locations"]:
            excluded[o["name"]] = "data-location"
            continue
        if o["staff_fte"] > need["staff_fte_available"]:
            excluded[o["name"]] = "staff"
            continue
        # 沒做自動擴縮時，費用跟著「開了多少」走，也就是尖峰
        billed_vcpu = need["peak_vcpu"] * need["avg_ratio"] if need["autoscale"] else need["peak_vcpu"]
        yearly = (
            o["fixed_per_year"]
            + billed_vcpu * o["vcpu_per_year"]
            + need["egress_tb_month"] * 12 * o["egress_per_tb"]
            + o["staff_fte"] * need["staff_cost_year"]
        )
        tco[o["name"]] = round(o["capex"] + years * yearly)
    cheapest = min(tco, key=tco.get) if tco else None
    return {"excluded": excluded, "tco": tco, "cheapest": cheapest}


# 以下數字都是虛構的，只用來試跑
OPTIONS = [
    {"name": "院內機房", "data_location": "onsite", "staff_fte": 0.5, "capex": 1_800_000,
     "fixed_per_year": 480_000, "vcpu_per_year": 0, "egress_per_tb": 0},
    {"name": "公有雲（境外區域）", "data_location": "overseas", "staff_fte": 0.25, "capex": 0,
     "fixed_per_year": 150_000, "vcpu_per_year": 9_000, "egress_per_tb": 3_000},
]
NEED = {"allowed_locations": ["onsite", "domestic"], "staff_fte_available": 0.5, "peak_vcpu": 128, "avg_ratio": 0.35,
        "autoscale": True, "egress_tb_month": 2, "staff_cost_year": 1_500_000}
print(compare_hosting(OPTIONS, NEED))
`,
    tests: [
      { name: '資料落地不符的選項先排除，再便宜也不進比較', code: HOSTING + `
_r = _c()
assert _r["excluded"] == {"公有雲（境外區域）": "data-location"}, f"得到 {_r['excluded']}"
assert "公有雲（境外區域）" not in _r["tco"], "被排除的選項不該出現在 tco"
assert _r["cheapest"] == "公有雲（國內區域）", f"得到 {_r['cheapest']}"` },
      { name: '總持有成本含固定費用、流量費與人力', code: HOSTING + `
_t = _c()["tco"]
assert _t["院內機房"] == 7_950_000, f"院內機房：1,800,000 + 5 × (480,000 + 750,000)，得到 {_t['院內機房']}"
assert _t["託管機房"] == 8_100_000, f"託管機房：得到 {_t['託管機房']}"
assert _t["公有雲（國內區域）"] == 5_673_000, f"公有雲：5 × (150,000 + 44.8 × 12,000 + 2 × 12 × 3,000 + 375,000)，得到 {_t['公有雲（國內區域）']}"` },
      { name: '沒做自動擴縮，雲端依尖峰計費', code: HOSTING + `
_r = _c(autoscale=False)
assert _r["tco"]["公有雲（國內區域）"] == 10_665_000, f"開著 128 vCPU 就付 128 vCPU 的錢，得到 {_r['tco']['公有雲（國內區域）']}"
assert _r["tco"]["院內機房"] == 7_950_000, "買斷硬體的選項不受影響"
assert _r["cheapest"] == "院內機房", f"得到 {_r['cheapest']}"` },
      { name: '大量資料流出會讓結論翻過來', code: HOSTING + `
_r = _c(egress_tb_month=40)
assert _r["tco"]["公有雲（國內區域）"] == 12_513_000, f"每月流出 40 TB：得到 {_r['tco']['公有雲（國內區域）']}"
assert _r["cheapest"] == "院內機房", f"流量費超過運算費之後，最便宜的換人；得到 {_r['cheapest']}"` },
      { name: '維運人力不夠的選項也要排除；資料落地優先判斷', code: HOSTING + `
_r = _c(staff_fte_available=0.3)
assert _r["excluded"] == {"院內機房": "staff", "託管機房": "staff", "公有雲（境外區域）": "data-location"}, f"得到 {_r['excluded']}"
assert _r["cheapest"] == "公有雲（國內區域）"
_both = [{"name": "境外自建", "data_location": "overseas", "staff_fte": 2, "capex": 0, "fixed_per_year": 1, "vcpu_per_year": 1, "egress_per_tb": 1}]
assert _c(options=_both)["excluded"] == {"境外自建": "data-location"}, "兩個條件都不符時，原因記資料落地"
assert _c(staff_fte_available=0.4)["excluded"].get("託管機房") is None, "人力剛好等於需求不算超過"` },
      { name: '沒有合格選項時 cheapest 是 None；年數由參數決定', code: HOSTING + `
_r = _c(allowed_locations=[])
assert _r["tco"] == {} and _r["cheapest"] is None and len(_r["excluded"]) == 4, f"得到 {_r}"
_t3 = _c(years=3)["tco"]
assert _t3["院內機房"] == 5_490_000, f"3 年：1,800,000 + 3 × 1,230,000，得到 {_t3['院內機房']}"
assert _t3["公有雲（國內區域）"] == 3_403_800, f"3 年：得到 {_t3['公有雲（國內區域）']}"` },
    ],
    hints: ['迴圈裡先做兩個篩選（資料落地在前、人力在後），不合格就寫進 `excluded` 然後 `continue`。', '`billed_vcpu = peak_vcpu * avg_ratio if autoscale else peak_vcpu`；流量費是「每月 TB 數 × 12 × 每 TB 單價」；人力是 `staff_fte * staff_cost_year`。'],
  },
  {
    id: 'slo-error-budget-1', skill: 'slo-error-budget', kind: 'python', level: 2,
    title: '錯誤預算剩多少、燒得多快、要不要凍結上線',
    prompt: '實作 `budget_report(slo, window, recent, page_at=14.4, ticket_at=1.0, min_requests=100) -> dict`，回答兩個問題：這個視窗的錯誤預算還剩多少、現在燒得多快。\n\n`slo` 是目標（例如 `0.999`）。`window` 是滾動 30 天的統計，`recent` 是最近 1 小時的統計，兩者都是 `{"total": 請求數, "bad": 失敗請求數}`。\n\n回傳 dict：\n\n- `budget`：這個視窗允許的失敗請求數 = `total` × (1 − `slo`)，用 `round()` 取整數\n- `remaining`：預算剩餘比例 = 1 − 已用掉的比例，四捨五入到小數 4 位（超支是負數）\n- `burn_rate`：最近 1 小時的錯誤率 ÷ (1 − `slo`)，小數 1 位；`recent` 沒有請求時是 `0.0`\n- `alert`：燃燒率大於 `page_at` 是 `"page"`（呼叫 on-call）；大於 `ticket_at` 是 `"ticket"`（開工單，上班時間處理）；其餘是 `"none"`。`recent` 的請求數不到 `min_requests` 時樣本太少，一律 `"none"`\n- `freeze`：預算用完（`window` 的 `bad` 大於等於 `budget`）是 `True`：暫停新功能上線，只放行修正與穩定性變更\n\n起始碼直接對錯誤率設門檻，剩餘比例算成了已用比例，也沒有判斷要不要凍結。',
    starter: `def budget_report(slo: float, window: dict, recent: dict,
                  page_at: float = 14.4, ticket_at: float = 1.0, min_requests: int = 100) -> dict:
    budget = round(window["total"] * (1 - slo))
    # TODO：這是「已用掉」的比例，題目要的是「還剩下」的比例
    remaining = round(window["bad"] / budget, 4)
    # TODO：燃燒率要除以 (1 − slo)；沒有請求時不能除以 0；樣本太少不告警
    error_rate = recent["bad"] / max(recent["total"], 1)
    alert = "page" if error_rate > 0.01 else "none"   # 直接對錯誤率設門檻：短暫尖峰會誤報、緩慢燃燒抓不到
    return {
        "budget": budget,
        "remaining": remaining,
        "burn_rate": round(error_rate, 1),
        "alert": alert,
        "freeze": False,   # TODO：預算用完要凍結
    }


print(budget_report(0.999, {"total": 2_000_000, "bad": 1_500}, {"total": 60_000, "bad": 900}))
`,
    solution: `def budget_report(slo: float, window: dict, recent: dict,
                  page_at: float = 14.4, ticket_at: float = 1.0, min_requests: int = 100) -> dict:
    allowed = 1 - slo                                   # 錯誤預算：允許失敗的比例
    budget = round(window["total"] * allowed)
    spent = window["bad"] / (window["total"] * allowed) if window["total"] else 0.0
    # 燃燒率：相對於「剛好在視窗結束時用完」的速度
    burn = (recent["bad"] / recent["total"]) / allowed if recent["total"] else 0.0
    if recent["total"] < min_requests:
        alert = "none"                                  # 樣本太少，幾個失敗就會讓比例爆表
    elif burn > page_at:
        alert = "page"
    elif burn > ticket_at:
        alert = "ticket"
    else:
        alert = "none"
    return {
        "budget": budget,
        "remaining": round(1 - spent, 4),
        "burn_rate": round(burn, 1),
        "alert": alert,
        "freeze": window["bad"] >= budget,
    }


print(budget_report(0.999, {"total": 2_000_000, "bad": 1_500}, {"total": 60_000, "bad": 900}))
`,
    tests: [
      { name: '錯誤預算與剩餘比例', code: SLO + `
_r = _b()
assert _r["budget"] == 2000, f"200 萬個請求、SLO 99.9%：允許 2,000 個失敗，得到 {_r['budget']}"
assert abs(_r["remaining"] - 0.25) < 1e-3, f"用掉 1,500 / 2,000，剩 0.25；得到 {_r['remaining']}"
assert _r["freeze"] is False, "預算還有剩，不用凍結"
_r2 = _b(slo=0.99)
assert _r2["budget"] == 20000 and abs(_r2["remaining"] - 0.925) < 1e-3, f"SLO 99%：得到 {_r2}"` },
      { name: '燃燒率 = 錯誤率 ÷ (1 − SLO)，同樣的錯誤率在不同 SLO 下嚴重程度不同', code: SLO + `
_r = _b(recent={"total": 60_000, "bad": 900})
assert abs(_r["burn_rate"] - 15.0) < 0.05, f"錯誤率 1.5% ÷ 0.1% = 15，得到 {_r['burn_rate']}"
_r2 = _b(slo=0.99, recent={"total": 60_000, "bad": 900})
assert abs(_r2["burn_rate"] - 1.5) < 0.05, f"SLO 99% 時同樣的錯誤率只有 1.5 倍，得到 {_r2['burn_rate']}"` },
      { name: '快速燃燒呼叫 on-call，緩慢燃燒開工單', code: SLO + `
assert _b(recent={"total": 60_000, "bad": 900})["alert"] == "page", "燃燒率 15 > 14.4：立刻叫人"
assert _b(recent={"total": 60_000, "bad": 300})["alert"] == "ticket", "燃燒率 5：照這個速度 6 天用完，開工單"
assert _b(recent={"total": 60_000, "bad": 30})["alert"] == "none", "燃燒率 0.5：照這個速度視窗內用不完"
assert _b(recent={"total": 60_000, "bad": 300}, page_at=4.0)["alert"] == "page", "門檻由參數決定"
assert _b(recent={"total": 60_000, "bad": 300}, ticket_at=6.0)["alert"] == "none", "門檻由參數決定"` },
      { name: '預算用完就凍結，剩餘比例是負數', code: SLO + `
_r = _b(window={"total": 2_000_000, "bad": 2_600})
assert _r["freeze"] is True, "用掉 2,600 > 預算 2,000"
assert abs(_r["remaining"] - (-0.3)) < 1e-3, f"超支 30%：預期 -0.3，得到 {_r['remaining']}"
assert _b(window={"total": 2_000_000, "bad": 1_999})["freeze"] is False, "還剩 1 個失敗額度，尚未用完"` },
      { name: '低流量樣本不足不告警；沒有請求不會除以零', code: SLO + `
_r = _b(recent={"total": 50, "bad": 1})
assert _r["alert"] == "none", "半夜 50 個請求錯 1 個，樣本太少不告警"
assert abs(_r["burn_rate"] - 20.0) < 0.05, f"燃燒率照算：2% ÷ 0.1% = 20，得到 {_r['burn_rate']}"
_z = _b(recent={"total": 0, "bad": 0})
assert _z["burn_rate"] == 0 and _z["alert"] == "none", f"沒有請求：得到 {_z}"
assert _b(recent={"total": 50, "bad": 1}, min_requests=10)["alert"] == "page", "最低請求數由參數決定"` },
    ],
    hints: ['先算 `allowed = 1 - slo`：預算是 `total * allowed`，燃燒率是 `(bad / total) / allowed`。', '`alert` 的判斷順序：先看 `recent["total"] < min_requests`，再比 `page_at`，最後比 `ticket_at`。`freeze` 與 `alert` 是兩件事，分開算。'],
  },
  {
    id: 'incident-response-1', skill: 'incident-response', kind: 'python', level: 2,
    title: '從時間線算出 postmortem 的時間欄位',
    prompt: 'postmortem 的時間線是從事故頻道整理來的。實作 `incident_metrics(events) -> dict`，算出檢討時要看的幾段時間。\n\n`events` 是 list，每筆是 `{"at": "2026-03-02T08:05", "kind": ...}`，順序不一定照時間。`kind` 有：`started`（事後回推，問題實際開始）、`detected`（告警或有人回報）、`acknowledged`（有人確認並開始處理）、`mitigated`（使用者恢復服務）、`resolved`（宣告事故結束）、`note`（觀察與決定，不參與計算）。同一種 `kind` 有多筆時，取時間最早的一筆。\n\n回傳 dict（時間都是整數分鐘）：\n\n- `detect_min`：開始 → 偵測\n- `ack_min`：偵測 → 有人處理\n- `mitigate_min`：有人處理 → 恢復服務\n- `impact_min`：使用者受影響多久，也就是開始 → 恢復服務（不是算到宣告結束）\n- `longest_phase`：`"detect"`、`"ack"`、`"mitigate"` 三段裡最長的一段，一樣長時取較前面的；改善項目要先補這一段\n- `missing`：`started`、`detected`、`acknowledged`、`mitigated` 之中時間線缺少的（照這個順序）\n\n缺少里程碑時，用到它的欄位是 `None`，`longest_phase` 也是 `None`。\n\n起始碼假設每種事件只有一筆，影響時間算到了宣告結束，缺里程碑時也會直接出錯。',
    starter: `from datetime import datetime


def incident_metrics(events: list[dict]) -> dict:
    # TODO：同一種 kind 有多筆時要取最早的；這裡是後面的蓋掉前面的
    at = {e["kind"]: datetime.fromisoformat(e["at"]) for e in events}

    def gap(a, b):
        # TODO：缺少里程碑時要回 None，而不是 KeyError
        return int((at[b] - at[a]).total_seconds() // 60)

    return {
        "detect_min": gap("started", "detected"),
        "ack_min": gap("detected", "acknowledged"),
        "mitigate_min": gap("acknowledged", "mitigated"),
        "impact_min": gap("started", "resolved"),   # TODO：使用者是在哪個時間點恢復服務的？
        "longest_phase": "mitigate",                # TODO：比較三段，找出最長的
        "missing": [],                              # TODO
    }


EVENTS = [
    {"at": "2026-03-02T07:50", "kind": "started"},
    {"at": "2026-03-02T08:05", "kind": "detected"},
    {"at": "2026-03-02T08:15", "kind": "acknowledged"},
    {"at": "2026-03-02T08:34", "kind": "mitigated"},
    {"at": "2026-03-02T08:50", "kind": "resolved"},
]
print(incident_metrics(EVENTS))
`,
    solution: `from datetime import datetime

REQUIRED = ["started", "detected", "acknowledged", "mitigated"]


def incident_metrics(events: list[dict]) -> dict:
    # 每種里程碑取最早的一筆（例如告警先響、後來才有人回報）
    first = {}
    for e in events:
        at = datetime.fromisoformat(e["at"])
        if e["kind"] not in first or at < first[e["kind"]]:
            first[e["kind"]] = at

    def gap(a, b):
        if a not in first or b not in first:
            return None
        return int((first[b] - first[a]).total_seconds() // 60)

    phases = {
        "detect": gap("started", "detected"),
        "ack": gap("detected", "acknowledged"),
        "mitigate": gap("acknowledged", "mitigated"),
    }
    missing = [k for k in REQUIRED if k not in first]
    # max 遇到一樣大的值會回傳先出現的那個，剛好是較前面的階段
    longest = max(phases, key=phases.get) if not missing else None
    return {
        "detect_min": phases["detect"],
        "ack_min": phases["ack"],
        "mitigate_min": phases["mitigate"],
        "impact_min": gap("started", "mitigated"),   # 使用者恢復服務就不再受影響
        "longest_phase": longest,
        "missing": missing,
    }


EVENTS = [
    {"at": "2026-03-02T07:50", "kind": "started"},
    {"at": "2026-03-02T08:05", "kind": "detected"},
    {"at": "2026-03-02T08:15", "kind": "acknowledged"},
    {"at": "2026-03-02T08:34", "kind": "mitigated"},
    {"at": "2026-03-02T08:50", "kind": "resolved"},
]
print(incident_metrics(EVENTS))
`,
    tests: [
      { name: '偵測、確認、處理三段時間', code: INCIDENT + `
_r = incident_metrics(_EVENTS)
assert (_r["detect_min"], _r["ack_min"], _r["mitigate_min"]) == (15, 10, 19), f"預期 (15, 10, 19)，得到 {(_r['detect_min'], _r['ack_min'], _r['mitigate_min'])}"
assert _r["missing"] == []` },
      { name: '影響時間算到使用者恢復服務，不是宣告結束', code: INCIDENT + `
_r = incident_metrics(_EVENTS)
assert _r["impact_min"] == 44, f"07:50 → 08:34 是 44 分鐘（算到 08:50 宣告結束會變成 60），得到 {_r['impact_min']}"` },
      { name: '同一種事件有多筆時取最早的，輸入順序不影響', code: INCIDENT + `
_ev = [
    {"at": "2026-03-02T08:34", "kind": "mitigated"},
    {"at": "2026-03-02T08:15", "kind": "detected"},
    {"at": "2026-03-02T08:15", "kind": "acknowledged"},
    {"at": "2026-03-02T08:05", "kind": "detected"},
    {"at": "2026-03-02T08:40", "kind": "note"},
    {"at": "2026-03-02T07:50", "kind": "started"},
    {"at": "2026-03-02T08:20", "kind": "acknowledged"},
]
_r = incident_metrics(_ev)
assert _r["detect_min"] == 15, f"08:05 的告警比 08:15 的回報早，偵測時間算到 08:05；得到 {_r['detect_min']}"
assert (_r["ack_min"], _r["mitigate_min"], _r["impact_min"]) == (10, 19, 44), f"得到 {_r}"
assert _r["missing"] == [], "resolved 與 note 不是必要的里程碑"` },
      { name: '跨午夜的事故', code: `
_ev = [
    {"at": "2026-03-02T23:40", "kind": "started"},
    {"at": "2026-03-02T23:55", "kind": "detected"},
    {"at": "2026-03-03T00:05", "kind": "acknowledged"},
    {"at": "2026-03-03T01:10", "kind": "mitigated"},
]
_r = incident_metrics(_ev)
assert (_r["detect_min"], _r["ack_min"], _r["mitigate_min"], _r["impact_min"]) == (15, 10, 65, 90), f"得到 {_r}"
assert _r["longest_phase"] == "mitigate"` },
      { name: '最長的階段決定改善項目先補哪裡', code: INCIDENT + `
assert incident_metrics(_EVENTS)["longest_phase"] == "mitigate", "15 / 10 / 19 分鐘：處理最久"
_slow = [
    {"at": "2026-03-02T07:50", "kind": "started"},
    {"at": "2026-03-02T08:30", "kind": "detected"},
    {"at": "2026-03-02T08:35", "kind": "acknowledged"},
    {"at": "2026-03-02T08:50", "kind": "mitigated"},
]
assert incident_metrics(_slow)["longest_phase"] == "detect", "40 分鐘才偵測到：改善空間在偵測，不在修復"
_tie = [
    {"at": "2026-03-02T08:00", "kind": "started"},
    {"at": "2026-03-02T08:05", "kind": "detected"},
    {"at": "2026-03-02T08:25", "kind": "acknowledged"},
    {"at": "2026-03-02T08:45", "kind": "mitigated"},
]
assert incident_metrics(_tie)["longest_phase"] == "ack", "ack 與 mitigate 都是 20 分鐘時取較前面的"` },
      { name: '缺少里程碑時列出 missing，相關欄位是 None', code: `
_ev = [
    {"at": "2026-03-02T07:50", "kind": "started"},
    {"at": "2026-03-02T08:05", "kind": "detected"},
    {"at": "2026-03-02T08:34", "kind": "mitigated"},
    {"at": "2026-03-02T08:50", "kind": "resolved"},
]
_r = incident_metrics(_ev)
assert _r["missing"] == ["acknowledged"], f"沒有人記下誰在什麼時候接手；得到 {_r['missing']}"
assert _r["detect_min"] == 15 and _r["impact_min"] == 44, "不缺的欄位照常計算"
assert _r["ack_min"] is None and _r["mitigate_min"] is None and _r["longest_phase"] is None, f"得到 {_r}"
_e = incident_metrics([])
assert _e["missing"] == ["started", "detected", "acknowledged", "mitigated"] and _e["impact_min"] is None, f"得到 {_e}"` },
    ],
    hints: ['先掃一遍 `events`，用 dict 記下每種 `kind` 最早的時間：`if kind not in first or at < first[kind]`。', '`gap(a, b)` 在任一個里程碑不存在時回 `None`。三段放進 dict 後用 `max(phases, key=phases.get)`，一樣長時會回傳先放進去的那一段。'],
  },
  {
    id: 'change-management-1', skill: 'change-management', kind: 'python', level: 2,
    title: '變更單送審前：審核層級與缺漏檢查',
    prompt: '實作 `review_change(c, policy) -> dict`，在變更單送審前自動檢查。\n\n變更單 `c`：`type`（`"standard"`、`"normal"`、`"emergency"`）、四個風險因素 `scope`、`reversibility`、`data_sensitivity`、`test_level`（各 1–3 分）、`author`、`approvers`（list）、`scheduled_at`（例如 `"2026-03-12T22:30"`），以及可能沒填的 `rollback_plan`、`cab_meeting`、`post_review_due`。\n\n`policy`：`cab_score`（風險分數達到這個值就要進變更審查會議）、`windows`（維護時段，`{weekday: (開始小時, 結束小時)}`，weekday 用 Python 的編號、週一是 0，結束小時不含）、`freeze`（凍結期，`[(起日, 迄日)]`，格式 `"YYYY-MM-DD"`，頭尾都算）。\n\n回傳 `{"risk_score": ..., "approval": ..., "problems": [...]}`：\n\n- `risk_score`：四個因素相加，分級看的是這個分數，不是申請人自己勾的等級\n- `approval`：標準變更是 `"pre-approved"`；緊急變更是 `"on-call-manager"`；一般變更的分數達到 `cab_score` 是 `"cab"`，否則 `"tech-lead"`\n\n`problems` 依下面的順序放代碼：\n\n- `no-rollback-plan`：不是標準變更，卻沒有回復計畫（空字串也算沒有）\n- `self-approval`：不是標準變更，而作者以外沒有任何核准人\n- `no-cab-record`：審核層級是 `cab`，卻沒有 `cab_meeting`\n- `outside-window`：一般變更排定的時間不在維護時段\n- `in-freeze`：一般變更排定的日期落在凍結期\n- `no-post-review`：緊急變更沒有設定事後審查期限\n\n起始碼採用申請人自己填的風險等級，也只檢查了回復計畫。',
    starter: `from datetime import datetime


def review_change(c: dict, policy: dict) -> dict:
    score = c["scope"] + c["reversibility"] + c["data_sensitivity"] + c["test_level"]
    # TODO：審核層級要看變更類型與風險分數，不是申請人自己填的 risk
    approval = "cab" if c.get("risk") == "high" else "tech-lead"
    problems = []
    if not c.get("rollback_plan"):          # TODO：標準變更已預先核准，不用逐案附回復計畫
        problems.append("no-rollback-plan")
    # TODO：職責分離、CAB 紀錄、維護時段、凍結期、緊急變更的事後審查都還沒檢查
    return {"risk_score": score, "approval": approval, "problems": problems}


POLICY = {"cab_score": 9, "windows": {1: (22, 24), 3: (22, 24)}, "freeze": [("2026-03-25", "2026-03-31")]}
CHANGE = {"id": "CHG-0312", "type": "normal", "scope": 3, "reversibility": 3, "data_sensitivity": 2, "test_level": 1,
          "author": "dev-a", "approvers": ["dev-a"], "rollback_plan": "", "scheduled_at": "2026-03-12T14:00"}
print(review_change(CHANGE, POLICY))
`,
    solution: `from datetime import datetime


def review_change(c: dict, policy: dict) -> dict:
    score = c["scope"] + c["reversibility"] + c["data_sensitivity"] + c["test_level"]
    if c["type"] == "standard":
        approval = "pre-approved"            # 事先核准過一次，照標準作業程序執行
    elif c["type"] == "emergency":
        approval = "on-call-manager"         # 即時核准，事後補完整審查
    else:
        approval = "cab" if score >= policy["cab_score"] else "tech-lead"

    problems = []
    if c["type"] != "standard":
        if not c.get("rollback_plan"):
            problems.append("no-rollback-plan")
        # 職責分離：作者以外至少要有一位核准人
        if not [a for a in c.get("approvers", []) if a != c["author"]]:
            problems.append("self-approval")
    if approval == "cab" and not c.get("cab_meeting"):
        problems.append("no-cab-record")
    if c["type"] == "normal":
        ts = datetime.fromisoformat(c["scheduled_at"])
        window = policy["windows"].get(ts.weekday())
        if window is None or not (window[0] <= ts.hour < window[1]):
            problems.append("outside-window")
        day = ts.date().isoformat()
        if any(start <= day <= end for start, end in policy["freeze"]):
            problems.append("in-freeze")
    if c["type"] == "emergency" and not c.get("post_review_due"):
        problems.append("no-post-review")
    return {"risk_score": score, "approval": approval, "problems": problems}


POLICY = {"cab_score": 9, "windows": {1: (22, 24), 3: (22, 24)}, "freeze": [("2026-03-25", "2026-03-31")]}
CHANGE = {"id": "CHG-0312", "type": "normal", "scope": 3, "reversibility": 3, "data_sensitivity": 2, "test_level": 1,
          "author": "dev-a", "approvers": ["dev-a"], "rollback_plan": "", "scheduled_at": "2026-03-12T14:00"}
print(review_change(CHANGE, POLICY))
`,
    tests: [
      { name: '審核層級看變更類型與風險分數', code: CHANGE + `
_r = _v()
assert (_r["risk_score"], _r["approval"], _r["problems"]) == (6, "tech-lead", []), f"低風險的一般變更：得到 {_r}"
assert _v(scope=3, reversibility=3, cab_meeting="2026-03-10 CAB")["approval"] == "cab", "分數 9 達到門檻，要進變更審查會議"
assert _v(scope=3, reversibility=2)["approval"] == "tech-lead", "分數 8 還沒到門檻"
assert _v(type="standard")["approval"] == "pre-approved"
assert _v(type="emergency", post_review_due="2026-03-16")["approval"] == "on-call-manager"
assert _v(risk="high")["approval"] == "tech-lead", "申請人自己填的 risk 不算數，看的是四個因素的分數"` },
      { name: '回復計畫與職責分離', code: CHANGE + `
assert _v(rollback_plan="")["problems"] == ["no-rollback-plan"], "空字串等於沒有回復計畫"
assert _v(drop=["rollback_plan"])["problems"] == ["no-rollback-plan"]
assert _v(approvers=["dev-a"])["problems"] == ["self-approval"], "作者不能核准自己的變更"
assert _v(approvers=[])["problems"] == ["self-approval"], "沒有任何核准人也不行"
assert _v(approvers=["dev-a", "lead-b"])["problems"] == [], "作者以外還有一位核准人就可以"
assert _v(type="standard", drop=["rollback_plan"], approvers=[])["problems"] == [], "標準變更已預先核准，不用逐案檢查這兩項"` },
      { name: '高風險的一般變更要有變更審查會議紀錄', code: CHANGE + `
_r = _v(scope=3, reversibility=3)
assert _r["approval"] == "cab" and _r["problems"] == ["no-cab-record"], f"得到 {_r}"
assert _v(scope=3, reversibility=3, cab_meeting="2026-03-10 CAB")["problems"] == []
assert _v(type="emergency", scope=3, reversibility=3, post_review_due="2026-03-16")["problems"] == [], "緊急變更走即時核准，不等會議"` },
      { name: '維護時段與凍結期只限制一般變更', code: CHANGE + `
assert _v(scheduled_at="2026-03-12T14:00")["problems"] == ["outside-window"], "週四下午不在維護時段"
assert _v(scheduled_at="2026-03-13T22:30")["problems"] == ["outside-window"], "週五沒有維護時段"
assert _v(scheduled_at="2026-03-12T22:00")["problems"] == [], "22:00 整在時段內"
assert _v(scheduled_at="2026-03-10T23:59")["problems"] == [], "週二 23:59 仍在時段內"
assert _v(scheduled_at="2026-03-26T22:30")["problems"] == ["in-freeze"], "在維護時段內，但落在凍結期"
assert _v(scheduled_at="2026-03-31T22:30")["problems"] == ["in-freeze"], "凍結期最後一天也算"
assert _v(scheduled_at="2026-03-25T10:00")["problems"] == ["outside-window", "in-freeze"]
assert _v(type="emergency", scheduled_at="2026-03-25T10:00", post_review_due="2026-03-27")["problems"] == [], "緊急變更不受時段與凍結期限制"
assert _v(type="standard", scheduled_at="2026-03-25T10:00")["problems"] == []` },
      { name: '緊急變更要設定事後審查期限', code: CHANGE + `
assert _v(type="emergency")["problems"] == ["no-post-review"], "先做後補件：沒有期限，緊急通道會變成後門"
assert _v(type="emergency", approvers=["dev-a"], rollback_plan="")["problems"] == ["no-rollback-plan", "self-approval", "no-post-review"]
assert _v(post_review_due=None)["problems"] == [], "一般變更不需要事後審查期限"` },
      { name: '多個問題依固定順序回報', code: CHANGE + `
_r = _v(scope=3, reversibility=3, approvers=["dev-a"], rollback_plan="", scheduled_at="2026-03-27T14:00")
assert _r["risk_score"] == 9 and _r["approval"] == "cab", f"得到 {_r}"
assert _r["problems"] == ["no-rollback-plan", "self-approval", "no-cab-record", "outside-window", "in-freeze"], f"得到 {_r['problems']}"` },
    ],
    hints: ['先決定 `approval`：`standard` 與 `emergency` 直接對應，只有 `normal` 才比 `risk_score >= policy["cab_score"]`。', '`ts = datetime.fromisoformat(c["scheduled_at"])`；維護時段查 `policy["windows"].get(ts.weekday())`，再比 `開始 <= ts.hour < 結束`。日期用 `ts.date().isoformat()` 就能和凍結期的字串直接比大小。'],
  },
]
