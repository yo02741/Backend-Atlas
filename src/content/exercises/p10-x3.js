// 程式題：p10-x3（領域 10、11 的安全與知識課，以及領域 1、2 的基礎課）
// Python 在瀏覽器裡的 Pyodide 執行（只有標準函式庫）；JS 在 Worker 裡執行。資料全部虛構。
export default [
  {
    id: 'identity-gateway-1', skill: 'identity-gateway', kind: 'python', level: 2,
    title: "工具端只信任閘道簽過的身分標頭",
    prompt: "內部工具放在身分閘道後面。閘道完成登入後，在轉送的請求加上五個標頭：`X-Gateway-User`、`X-Gateway-Groups`（逗號分隔）、`X-Gateway-Actor`（`user` 代表本人操作，`agent:<名稱>` 代表某人授權的 agent）、`X-Gateway-Timestamp`（整數秒），以及 `X-Gateway-Signature`：對前四個值算出的 HMAC，算法是已寫好的 `sign()`。\n\n實作工具端的 `check_request(headers, peer_ip, required_group, now) -> (status, body)`，依下面的順序檢查：\n\n- `peer_ip` 不在 `GATEWAY_IPS` → `(401, {\"error\": \"not_from_gateway\"})`。繞過閘道直接連進來的請求，標頭寫得再完整也不收\n- 五個閘道標頭缺任何一個 → `(401, {\"error\": \"missing_identity\"})`。標頭名稱不分大小寫\n- 簽章不符 → `(401, {\"error\": \"bad_signature\"})`，比對用 `hmac.compare_digest`\n- `now - 時間戳 > MAX_AGE` → `(401, {\"error\": \"stale\"})`\n- 群組不含 `required_group` → `(403, {\"error\": \"forbidden\"})`。群組名稱要完全相同，前後空白去掉\n- 全部通過 → `(200, {\"user\": ..., \"groups\": [...], \"actor\": ...})`\n\n用戶端自己帶的 `X-User` **一律不看**：身分只來自簽章正確的閘道標頭。",
    starter: String.raw`import hashlib
import hmac

# 閘道與工具共用的簽章金鑰（示範用的假值；正式環境由 secret manager 發給兩邊）
GATEWAY_KEY = ("gw-" + "demo-" + "signing-key").encode()
GATEWAY_IPS = {"10.0.0.5", "10.0.0.6"}      # 只有閘道會從這些位址連進來
MAX_AGE = 60                                  # 簽章的有效秒數


def sign(user, groups, actor, ts):
    """閘道端的簽章（已寫好，不用改）：對四個欄位做 HMAC-SHA256，回傳十六進位字串。"""
    msg = f"{user}\n{groups}\n{actor}\n{ts}".encode()
    return hmac.new(GATEWAY_KEY, msg, hashlib.sha256).hexdigest()


def check_request(headers, peer_ip, required_group, now):
    # TODO：現在直接相信 X-User——任何能直連這個工具的人都能自己填
    user = headers.get("X-User")
    if not user:
        return 401, {"error": "missing_identity"}
    return 200, {"user": user, "groups": [], "actor": "user"}


# 試跑：一個沒經過閘道、自己填 X-User 的請求，應該要被拒絕
print(check_request({"X-User": "alice"}, "203.0.113.9", "eng", now=1000))
`,
    solution: String.raw`import hashlib
import hmac

# 閘道與工具共用的簽章金鑰（示範用的假值；正式環境由 secret manager 發給兩邊）
GATEWAY_KEY = ("gw-" + "demo-" + "signing-key").encode()
GATEWAY_IPS = {"10.0.0.5", "10.0.0.6"}      # 只有閘道會從這些位址連進來
MAX_AGE = 60                                  # 簽章的有效秒數

REQUIRED = ["x-gateway-user", "x-gateway-groups", "x-gateway-actor", "x-gateway-timestamp", "x-gateway-signature"]


def sign(user, groups, actor, ts):
    """閘道端的簽章（已寫好，不用改）：對四個欄位做 HMAC-SHA256，回傳十六進位字串。"""
    msg = f"{user}\n{groups}\n{actor}\n{ts}".encode()
    return hmac.new(GATEWAY_KEY, msg, hashlib.sha256).hexdigest()


def check_request(headers, peer_ip, required_group, now):
    # 1. 網路來源：不是從閘道連進來的，標頭一概不看
    if peer_ip not in GATEWAY_IPS:
        return 401, {"error": "not_from_gateway"}
    # 2. 只讀閘道標頭（名稱不分大小寫）；X-User 這類用戶端自己帶的標頭不讀
    h = {k.lower(): v for k, v in headers.items()}
    if any(name not in h for name in REQUIRED):
        return 401, {"error": "missing_identity"}
    user, groups, actor, ts = (h[name] for name in REQUIRED[:4])
    # 3. 簽章：四個欄位任何一個被改過都對不上
    if not hmac.compare_digest(sign(user, groups, actor, ts), str(h["x-gateway-signature"])):
        return 401, {"error": "bad_signature"}
    # 4. 簽章對了才相信時間戳，再看有沒有過期
    if now - int(ts) > MAX_AGE:
        return 401, {"error": "stale"}
    # 5. 授權：群組完全比對
    group_list = [g.strip() for g in groups.split(",") if g.strip()]
    if required_group not in group_list:
        return 403, {"error": "forbidden"}
    return 200, {"user": user, "groups": group_list, "actor": actor}


# 試跑：一個沒經過閘道、自己填 X-User 的請求，應該要被拒絕
print(check_request({"X-User": "alice"}, "203.0.113.9", "eng", now=1000))
`,
    tests: [
      { name: "正常請求：閘道簽過的身分通過，群組拆成清單，actor 保留", code: String.raw`def _hdr(user, groups, actor, ts):
    return {"X-Gateway-User": user, "X-Gateway-Groups": groups, "X-Gateway-Actor": actor,
            "X-Gateway-Timestamp": str(ts), "X-Gateway-Signature": sign(user, groups, actor, ts)}
_r = check_request(_hdr("alice", "eng, ops", "user", 1000), "10.0.0.5", "ops", now=1010)
assert _r == (200, {"user": "alice", "groups": ["eng", "ops"], "actor": "user"}), _r
_r = check_request(_hdr("alice", "eng", "agent:deploy-bot", 1000), "10.0.0.6", "eng", now=1060)
assert _r == (200, {"user": "alice", "groups": ["eng"], "actor": "agent:deploy-bot"}), f"剛好 MAX_AGE 秒還有效，而且 actor 要原樣帶出：{_r}"
_lower = {k.lower(): v for k, v in _hdr("bob", "eng", "user", 1000).items()}
assert check_request(_lower, "10.0.0.5", "eng", now=1000)[0] == 200, "標頭名稱不分大小寫"` },
      { name: "X-User 不算身分：只帶 X-User 是 401；和閘道標頭同時出現時以閘道標頭為準", code: String.raw`_r = check_request({"X-User": "alice"}, "10.0.0.5", "eng", now=1000)
assert _r == (401, {"error": "missing_identity"}), _r
_h = {"X-Gateway-User": "bob", "X-Gateway-Groups": "eng", "X-Gateway-Actor": "user",
      "X-Gateway-Timestamp": "1000", "X-Gateway-Signature": sign("bob", "eng", "user", 1000), "X-User": "admin"}
_r = check_request(_h, "10.0.0.5", "eng", now=1000)
assert _r[0] == 200 and _r[1]["user"] == "bob", f"身分要來自閘道標頭，不是 X-User：{_r}"
_h2 = dict(_h)
del _h2["X-Gateway-Signature"]
assert check_request(_h2, "10.0.0.5", "eng", now=1000) == (401, {"error": "missing_identity"}), "少了簽章標頭"` },
      { name: "繞過閘道直連：就算標頭與簽章都正確也拒絕", code: String.raw`_h = {"X-Gateway-User": "alice", "X-Gateway-Groups": "eng", "X-Gateway-Actor": "user",
      "X-Gateway-Timestamp": "1000", "X-Gateway-Signature": sign("alice", "eng", "user", 1000)}
assert check_request(_h, "10.0.0.5", "eng", now=1000)[0] == 200
_r = check_request(_h, "10.0.3.17", "eng", now=1000)
assert _r == (401, {"error": "not_from_gateway"}), _r
assert check_request({}, "203.0.113.9", "eng", now=1000) == (401, {"error": "not_from_gateway"}), "來源檢查排在最前面"` },
      { name: "標頭被改過：多加群組、agent 改成本人、換使用者，簽章都對不上", code: String.raw`_base = {"X-Gateway-User": "alice", "X-Gateway-Groups": "eng", "X-Gateway-Actor": "agent:deploy-bot",
         "X-Gateway-Timestamp": "1000", "X-Gateway-Signature": sign("alice", "eng", "agent:deploy-bot", 1000)}
for _k, _v in [("X-Gateway-Groups", "eng,admin"), ("X-Gateway-Actor", "user"), ("X-Gateway-User", "carol"), ("X-Gateway-Timestamp", "5000")]:
    _h = dict(_base)
    _h[_k] = _v
    _r = check_request(_h, "10.0.0.5", "eng", now=1000)
    assert _r == (401, {"error": "bad_signature"}), f"改了 {_k} 之後：{_r}"` },
      { name: "簽章過期：超過 MAX_AGE 秒是 stale", code: String.raw`_h = {"X-Gateway-User": "alice", "X-Gateway-Groups": "eng", "X-Gateway-Actor": "user",
      "X-Gateway-Timestamp": "1000", "X-Gateway-Signature": sign("alice", "eng", "user", 1000)}
assert check_request(_h, "10.0.0.5", "eng", now=1000 + MAX_AGE)[0] == 200
_r = check_request(_h, "10.0.0.5", "eng", now=1000 + MAX_AGE + 1)
assert _r == (401, {"error": "stale"}), _r` },
      { name: "群組不符是 403；群組名稱完全比對，不是子字串", code: String.raw`def _req(groups, need):
    _h = {"X-Gateway-User": "dana", "X-Gateway-Groups": groups, "X-Gateway-Actor": "user",
          "X-Gateway-Timestamp": "1000", "X-Gateway-Signature": sign("dana", groups, "user", 1000)}
    return check_request(_h, "10.0.0.5", need, now=1000)
assert _req("eng", "ops") == (403, {"error": "forbidden"}), _req("eng", "ops")
assert _req("eng-admin", "eng") == (403, {"error": "forbidden"}), "eng-admin 不等於 eng"
assert _req("eng-admin", "admin") == (403, {"error": "forbidden"}), "不能用子字串比對"
assert _req("", "eng") == (403, {"error": "forbidden"}), "沒有任何群組"
assert _req("ops,eng", "eng")[0] == 200` },
    ],
    hints: [
      "先把標頭名稱全部轉小寫再查：`h = {k.lower(): v for k, v in headers.items()}`。`X-User` 完全不要讀。",
      "用 `sign(user, groups, actor, ts)` 重算一次，再用 `hmac.compare_digest` 和 `X-Gateway-Signature` 比對。",
      "群組先 `split(\",\")` 再逐一 `strip()`，用「在不在清單裡」判斷，不要用子字串比對。",
    ],
  },
  {
    id: 'cli-token-storage-1', skill: 'cli-token-storage', kind: 'python', level: 2,
    title: "檢查 CLI 的 token 存放：設定檔、檔案權限、環境變數",
    prompt: "實作 `audit_storage(config, mode, env, has_keyring)`，檢查一個 CLI 把 token 放在哪裡，回傳排序過的 `(問題代碼, 位置)` 清單。\n\n- `config`：設定檔解析後的 dict，可能有巢狀 dict\n- `mode`：設定檔的權限數字，例如 `0o644`\n- `env`：agent 執行環境的環境變數（dict）\n- `has_keyring`：這台機器有沒有作業系統 keyring\n\n`token_kind(value)` 已寫好：回傳 `\"refresh\"`（長效）、`\"access\"`（短效）或 `None`。`keyring:` 開頭的值只是「去 keyring 拿」的參照，不是 token。\n\n規則：\n\n- **有 keyring**：設定檔裡的任何 token（不分種類、不分第幾層）→ `(\"plaintext_token\", 路徑)`，路徑用 `.` 連接，例如 `auth.refresh_token`\n- **沒有 keyring**（SSH 主機、容器）：存檔是降級方案，短效的 access token 可以留，refresh token → `(\"long_lived_in_file\", 路徑)`\n- 設定檔裡有任何 token，而且群組或其他人有任何讀、寫、執行權限（只有擁有者能存取的 `0o600`、`0o400` 沒問題）→ `(\"loose_permissions\", 四位八進位字串)`，例如 `\"0644\"`。檔案裡沒有 token 時不檢查權限\n- `env` 裡值是 refresh token 的變數 → `(\"long_lived_in_env\", 變數名稱)`：agent 執行的每個子程序都會繼承它\n\n沒有問題時回傳 `[]`。",
    starter: String.raw`def token_kind(value):
    """已寫好，不用改：判斷一個值是哪一種 token。回傳 "refresh"（長效）、"access"（短效）或 None。"""
    if not isinstance(value, str):
        return None
    if value.startswith("rt_") and len(value) >= 12:
        return "refresh"
    if value.startswith("at_") and len(value) >= 12:
        return "access"
    if value.startswith("eyJ") and value.count(".") == 2:      # JWT 形狀的 access token
        return "access"
    return None


def audit_storage(config, mode, env, has_keyring):
    findings = []
    # TODO：只看了最上層；沒分有沒有 keyring、沒看檔案權限、沒看環境變數
    for key, value in config.items():
        if token_kind(value):
            findings.append(("plaintext_token", key))
    return sorted(findings)


# 試跑：假 token 用字串串接組出來
_rt = "rt_" + "Q2hlY2tPdXQ" * 2
config = {
    "endpoint": "https://api.example.com",
    "auth": {"refresh_token": _rt},
}
print(audit_storage(config, 0o644, {"ATLAS_REFRESH_TOKEN": _rt, "LANG": "zh_TW.UTF-8"}, has_keyring=True))
# 預期 [('long_lived_in_env', 'ATLAS_REFRESH_TOKEN'), ('loose_permissions', '0644'), ('plaintext_token', 'auth.refresh_token')]
`,
    solution: String.raw`def token_kind(value):
    """已寫好，不用改：判斷一個值是哪一種 token。回傳 "refresh"（長效）、"access"（短效）或 None。"""
    if not isinstance(value, str):
        return None
    if value.startswith("rt_") and len(value) >= 12:
        return "refresh"
    if value.startswith("at_") and len(value) >= 12:
        return "access"
    if value.startswith("eyJ") and value.count(".") == 2:      # JWT 形狀的 access token
        return "access"
    return None


def _walk(node, path=""):
    """走訪巢狀 dict，產生 (路徑, token 種類)。"""
    for key, value in node.items():
        here = f"{path}.{key}" if path else str(key)
        if isinstance(value, dict):
            yield from _walk(value, here)
        elif token_kind(value):
            yield here, token_kind(value)


def audit_storage(config, mode, env, has_keyring):
    findings = []
    tokens = list(_walk(config))
    for path, kind in tokens:
        if has_keyring:
            findings.append(("plaintext_token", path))          # 有 keyring 就不該落在檔案裡
        elif kind == "refresh":
            findings.append(("long_lived_in_file", path))       # 降級方案只留短效的
    if tokens and mode & 0o077:                                  # 群組或其他人有任何權限
        findings.append(("loose_permissions", format(mode, "04o")))
    for name, value in env.items():
        if token_kind(value) == "refresh":                       # 每個子程序都會繼承
            findings.append(("long_lived_in_env", name))
    return sorted(findings)


# 試跑：假 token 用字串串接組出來
_rt = "rt_" + "Q2hlY2tPdXQ" * 2
config = {
    "endpoint": "https://api.example.com",
    "auth": {"refresh_token": _rt},
}
print(audit_storage(config, 0o644, {"ATLAS_REFRESH_TOKEN": _rt, "LANG": "zh_TW.UTF-8"}, has_keyring=True))
# 預期 [('long_lived_in_env', 'ATLAS_REFRESH_TOKEN'), ('loose_permissions', '0644'), ('plaintext_token', 'auth.refresh_token')]
`,
    tests: [
      { name: "有 keyring：設定檔裡的 token 不分種類、不分第幾層都要列出", code: String.raw`_rt = "rt_" + "Q2hlY2tPdXQ" * 2
_at = "at_" + "c2hvcnRsaXZlZA" * 2
_jwt = "eyJ" + "hbGciOiJFUzI1NiJ9" + "." + "eyJzdWIiOiJ1XzQ4MjEifQ" + "." + "c2ln"
_cfg = {"endpoint": "https://api.example.com", "access_token": _at,
        "auth": {"refresh_token": _rt, "profiles": {"staging": {"token": _jwt}}}}
_r = audit_storage(_cfg, 0o600, {}, has_keyring=True)
assert _r == [("plaintext_token", "access_token"), ("plaintext_token", "auth.profiles.staging.token"),
              ("plaintext_token", "auth.refresh_token")], _r` },
      { name: "設定檔只記 keyring 參照：沒有 token，權限再寬也不算問題", code: String.raw`_cfg = {"endpoint": "https://api.example.com", "auth": {"refresh_token": "keyring:atlas-cli/alice@example.com"},
        "timeout": 30, "retries": None, "name": "rt", "region": "at_tpe"}
assert audit_storage(_cfg, 0o644, {}, has_keyring=True) == [], audit_storage(_cfg, 0o644, {}, has_keyring=True)
assert audit_storage({}, 0o666, {}, has_keyring=False) == []` },
      { name: "沒有 keyring 的降級：0600 加上只存 access token 可以；refresh token 不行", code: String.raw`_rt = "rt_" + "Q2hlY2tPdXQ" * 2
_at = "at_" + "c2hvcnRsaXZlZA" * 2
assert audit_storage({"access_token": _at}, 0o600, {}, has_keyring=False) == [], "短效 token 存成 0600 的檔案是可接受的降級"
_r = audit_storage({"access_token": _at, "auth": {"refresh_token": _rt}}, 0o600, {}, has_keyring=False)
assert _r == [("long_lived_in_file", "auth.refresh_token")], _r` },
      { name: "檔案權限：有 token 的檔案，群組或其他人有任何權限就列出", code: String.raw`_at = "at_" + "c2hvcnRsaXZlZA" * 2
for _mode, _want in [(0o600, []), (0o400, []), (0o640, [("loose_permissions", "0640")]),
                     (0o604, [("loose_permissions", "0604")]), (0o644, [("loose_permissions", "0644")]),
                     (0o700, [])]:
    _r = audit_storage({"access_token": _at}, _mode, {}, has_keyring=False)
    assert _r == _want, f"mode={oct(_mode)}：{_r}"` },
      { name: "環境變數：只有長效的 refresh token 要列出", code: String.raw`_rt = "rt_" + "Q2hlY2tPdXQ" * 2
_at = "at_" + "c2hvcnRsaXZlZA" * 2
_env = {"ATLAS_REFRESH_TOKEN": _rt, "ATLAS_ACCESS_TOKEN": _at, "LANG": "zh_TW.UTF-8", "CI": "true", "BACKUP_TOKEN": _rt}
_r = audit_storage({}, 0o600, _env, has_keyring=True)
assert _r == [("long_lived_in_env", "ATLAS_REFRESH_TOKEN"), ("long_lived_in_env", "BACKUP_TOKEN")], _r` },
      { name: "綜合：三種問題同時出現，結果依代碼與位置排序", code: String.raw`_rt = "rt_" + "Q2hlY2tPdXQ" * 2
_cfg = {"endpoint": "https://api.example.com", "auth": {"refresh_token": _rt}}
_r = audit_storage(_cfg, 0o644, {"ATLAS_REFRESH_TOKEN": _rt, "LANG": "zh_TW.UTF-8"}, has_keyring=True)
assert _r == [("long_lived_in_env", "ATLAS_REFRESH_TOKEN"), ("loose_permissions", "0644"),
              ("plaintext_token", "auth.refresh_token")], _r` },
    ],
    hints: [
      "寫一個遞迴的走訪函式：值是 dict 就帶著 `路徑 + \".\" + 鍵` 往下走，否則用 `token_kind(value)` 判斷。",
      "群組與其他人的權限是最後兩個八進位數字：`mode & 0o077` 不是 0 就代表過寬。輸出用 `format(mode, \"04o\")`。",
      "有 keyring 時兩種 token 都算 `plaintext_token`；沒有 keyring 時只有 refresh token 算 `long_lived_in_file`。",
    ],
  },
  {
    id: 'key-scope-lifetime-1', skill: 'key-scope-lifetime', kind: 'python', level: 2,
    title: "金鑰清冊稽核：沒有期限、範圍過大、該輪替、太久沒用",
    prompt: "實作 `audit_keys(keys, today)`，稽核一份 API key 清冊，回傳 `{\"no_expiry\": [...], \"too_broad\": [...], \"rotate\": [...], \"unused\": [...]}`。每個清單放金鑰的 `id`、依字串排序；同一把金鑰可以出現在多個清單；四個鍵都要有。\n\n每把金鑰是 dict：`id`、`scopes`（list）、`resource`（字串，`None` 代表不限資源）、`created`、`expires`、`last_used`（`datetime.date`，後兩個可能是 `None`）、`revoked`（bool）。\n\n**不再有效的金鑰不列入任何清單**：已撤銷，或已到期（`expires <= today`）。其他金鑰依三個控制面檢查：\n\n- `no_expiry`（壽命）：沒有到期日，或到期日比建立日晚超過 `MAX_LIFETIME_DAYS` 天\n- `too_broad`（範圍）：`resource` 是 `None`，或 `scopes` 裡有 `*`、有以 `:admin` 結尾的項目\n- `rotate`（壽命）：`ROTATE_WITHIN_DAYS` 天內到期（含剛好第 7 天）\n- `unused`（可觀測）：最後使用日距今超過 `UNUSED_DAYS` 天；從沒用過的金鑰改從建立日起算",
    starter: String.raw`from datetime import date

MAX_LIFETIME_DAYS = 365     # 壽命上限：到期日最晚是建立後一年
ROTATE_WITHIN_DAYS = 7      # 幾天內到期就該輪替
UNUSED_DAYS = 90            # 超過這麼多天沒用，列出來給建立者確認


def audit_keys(keys, today):
    report = {"no_expiry": [], "too_broad": [], "rotate": [], "unused": []}
    for k in keys:
        # TODO：已撤銷或已到期的要跳過；壽命上限、範圍、輪替、起算日都還沒處理
        if k["expires"] is None:
            report["no_expiry"].append(k["id"])
        if k["last_used"] is None:
            report["unused"].append(k["id"])
    return report


today = date(2026, 10, 20)
keys = [
    {"id": "k_8f3k2m", "scopes": ["deploy:write"], "resource": "project:site",
     "created": date(2026, 4, 3), "expires": date(2026, 10, 25), "last_used": date(2026, 10, 20), "revoked": False},
    {"id": "k_m2c9aa", "scopes": ["team:admin"], "resource": None,
     "created": date(2025, 1, 10), "expires": None, "last_used": None, "revoked": False},
]
print(audit_keys(keys, today))
# 預期 {'no_expiry': ['k_m2c9aa'], 'too_broad': ['k_m2c9aa'], 'rotate': ['k_8f3k2m'], 'unused': ['k_m2c9aa']}
`,
    solution: String.raw`from datetime import date

MAX_LIFETIME_DAYS = 365     # 壽命上限：到期日最晚是建立後一年
ROTATE_WITHIN_DAYS = 7      # 幾天內到期就該輪替
UNUSED_DAYS = 90            # 超過這麼多天沒用，列出來給建立者確認


def audit_keys(keys, today):
    report = {"no_expiry": [], "too_broad": [], "rotate": [], "unused": []}
    for k in keys:
        expires = k["expires"]
        # 已撤銷或已到期：這把金鑰不能用了，不需要再檢查
        if k["revoked"] or (expires is not None and expires <= today):
            continue
        # 壽命：一定要有到期日，而且不能超過上限
        if expires is None or (expires - k["created"]).days > MAX_LIFETIME_DAYS:
            report["no_expiry"].append(k["id"])
        # 範圍：不限資源、萬用 scope、管理員 scope
        if k["resource"] is None or any(s == "*" or s.endswith(":admin") for s in k["scopes"]):
            report["too_broad"].append(k["id"])
        # 壽命：快到期的先輪替（先建新的、確認舊的沒人用、再撤銷舊的）
        if expires is not None and (expires - today).days <= ROTATE_WITHIN_DAYS:
            report["rotate"].append(k["id"])
        # 可觀測：最後使用時間；從沒用過就從建立日起算
        last = k["last_used"] or k["created"]
        if (today - last).days > UNUSED_DAYS:
            report["unused"].append(k["id"])
    return {name: sorted(ids) for name, ids in report.items()}


today = date(2026, 10, 20)
keys = [
    {"id": "k_8f3k2m", "scopes": ["deploy:write"], "resource": "project:site",
     "created": date(2026, 4, 3), "expires": date(2026, 10, 25), "last_used": date(2026, 10, 20), "revoked": False},
    {"id": "k_m2c9aa", "scopes": ["team:admin"], "resource": None,
     "created": date(2025, 1, 10), "expires": None, "last_used": None, "revoked": False},
]
print(audit_keys(keys, today))
# 預期 {'no_expiry': ['k_m2c9aa'], 'too_broad': ['k_m2c9aa'], 'rotate': ['k_8f3k2m'], 'unused': ['k_m2c9aa']}
`,
    tests: [
      { name: "壽命：沒有到期日、或超過一年上限的都列進 no_expiry（剛好 365 天不算）", code: String.raw`_t = date(2026, 10, 20)
def _k(id, **kw):
    base = {"id": id, "scopes": ["deploy:write"], "resource": "project:site", "created": date(2026, 9, 1),
            "expires": date(2026, 12, 1), "last_used": date(2026, 10, 19), "revoked": False}
    base.update(kw)
    return base
_keys = [_k("k_none", expires=None),
         _k("k_365", created=date(2026, 6, 1), expires=date(2027, 6, 1)),
         _k("k_366", created=date(2026, 6, 1), expires=date(2027, 6, 2)),
         _k("k_10y", created=date(2026, 6, 1), expires=date(2036, 6, 1)),
         _k("k_ok")]
_r = audit_keys(_keys, _t)
assert _r["no_expiry"] == ["k_10y", "k_366", "k_none"], _r["no_expiry"]
assert _r["too_broad"] == [] and _r["rotate"] == [] and _r["unused"] == [], _r` },
      { name: "範圍：不限資源、萬用 scope、管理員 scope 都算過大", code: String.raw`_t = date(2026, 10, 20)
def _k(id, **kw):
    base = {"id": id, "scopes": ["deploy:write"], "resource": "project:site", "created": date(2026, 9, 1),
            "expires": date(2026, 12, 1), "last_used": date(2026, 10, 19), "revoked": False}
    base.update(kw)
    return base
_keys = [_k("k_res", resource=None), _k("k_star", scopes=["*"]), _k("k_admin", scopes=["deploy:read", "team:admin"]),
         _k("k_read", scopes=["reports:read"]), _k("k_administer", scopes=["admin:read"])]
_r = audit_keys(_keys, _t)
assert _r["too_broad"] == ["k_admin", "k_res", "k_star"], _r["too_broad"]` },
      { name: "輪替：7 天內到期要列出（含第 7 天，不含第 8 天）", code: String.raw`_t = date(2026, 10, 20)
def _k(id, **kw):
    base = {"id": id, "scopes": ["deploy:write"], "resource": "project:site", "created": date(2026, 9, 1),
            "expires": date(2026, 12, 1), "last_used": date(2026, 10, 19), "revoked": False}
    base.update(kw)
    return base
_keys = [_k("k_d1", expires=date(2026, 10, 21)), _k("k_d7", expires=date(2026, 10, 27)),
         _k("k_d8", expires=date(2026, 10, 28)), _k("k_none", expires=None)]
_r = audit_keys(_keys, _t)
assert _r["rotate"] == ["k_d1", "k_d7"], _r["rotate"]` },
      { name: "太久沒用：超過 90 天才算；從沒用過的從建立日起算", code: String.raw`_t = date(2026, 10, 20)
def _k(id, **kw):
    base = {"id": id, "scopes": ["deploy:write"], "resource": "project:site", "created": date(2026, 1, 5),
            "expires": date(2026, 12, 1), "last_used": date(2026, 10, 19), "revoked": False}
    base.update(kw)
    return base
_keys = [_k("k_90", last_used=date(2026, 7, 22)), _k("k_91", last_used=date(2026, 7, 21)),
         _k("k_new_never", created=date(2026, 10, 1), last_used=None),
         _k("k_old_never", created=date(2026, 3, 1), last_used=None)]
_r = audit_keys(_keys, _t)
assert _r["unused"] == ["k_91", "k_old_never"], _r["unused"]` },
      { name: "已撤銷、已到期（含今天到期）的金鑰不列入任何清單", code: String.raw`_t = date(2026, 10, 20)
_bad = {"scopes": ["*"], "resource": None, "created": date(2020, 1, 1), "last_used": None}
_keys = [dict(_bad, id="k_revoked", expires=None, revoked=True),
         dict(_bad, id="k_expired", expires=date(2026, 10, 1), revoked=False),
         dict(_bad, id="k_today", expires=date(2026, 10, 20), revoked=False)]
_r = audit_keys(_keys, _t)
assert _r == {"no_expiry": [], "too_broad": [], "rotate": [], "unused": []}, _r
assert audit_keys([], _t) == {"no_expiry": [], "too_broad": [], "rotate": [], "unused": []}` },
      { name: "綜合：同一把金鑰可以出現在多個清單，各清單依 id 排序", code: String.raw`_t = date(2026, 10, 20)
_keys = [
    {"id": "k_q71zx0", "scopes": ["reports:read"], "resource": "project:bi",
     "created": date(2026, 6, 22), "expires": date(2026, 12, 19), "last_used": date(2026, 7, 12), "revoked": False},
    {"id": "k_m2c9aa", "scopes": ["team:admin"], "resource": None,
     "created": date(2025, 1, 10), "expires": None, "last_used": None, "revoked": False},
    {"id": "k_8f3k2m", "scopes": ["deploy:write"], "resource": "project:site",
     "created": date(2026, 4, 3), "expires": date(2026, 10, 25), "last_used": date(2026, 10, 20), "revoked": False},
    {"id": "k_a00001", "scopes": ["billing:admin"], "resource": "team:core",
     "created": date(2026, 10, 1), "expires": date(2026, 10, 22), "last_used": None, "revoked": False},
]
_r = audit_keys(_keys, _t)
assert _r == {"no_expiry": ["k_m2c9aa"], "too_broad": ["k_a00001", "k_m2c9aa"],
              "rotate": ["k_8f3k2m", "k_a00001"], "unused": ["k_m2c9aa", "k_q71zx0"]}, _r` },
    ],
    hints: [
      "先跳過不再有效的金鑰：`revoked` 為真，或 `expires` 不是 None 且 `expires <= today`。",
      "兩個日期相減得到 `timedelta`，用 `.days` 取天數：`(k[\"expires\"] - k[\"created\"]).days > MAX_LIFETIME_DAYS`。",
      "`unused` 的起算日是 `k[\"last_used\"] or k[\"created\"]`；四個清單最後各自 `sorted()`。",
    ],
  },
  {
    id: 'owasp-mcp-top10-1', skill: 'owasp-mcp-top10', kind: 'js', level: 2,
    title: "把 MCP 部署的觀察對到 MCP01–MCP10 與該補的控制",
    prompt: "盤點一個 MCP 部署後得到一串結構化的觀察。實作 `classify(observations)`：把每筆觀察對到 OWASP MCP Top 10 的項目，回傳 `{ server, id, control }` 的陣列，`control` 取自已寫好的 `CONTROLS[id]`。\n\n觀察有五種 `type`，各自的判斷：\n\n- `credential`（`inline`、`ttlHours`、`granted`、`used`）：`inline` 為 true（機密值直接寫在設定檔）或 `ttlHours` 是 `null`（長效）→ `MCP01`；`granted` 裡有 `used` 沒用到的 scope → `MCP02`\n- `package`（`version`、`registered`）：`version` 是空字串、`latest`，或和登錄的版本不同 → `MCP04`；`registered` 是 `null`（不在內部登錄上）→ `MCP09`\n- `transport`（`url`、`auth`、`perUserAuthz`）：沒走 `https://`、沒驗證呼叫者身分、或沒有依實際使用者做授權，任一成立 → `MCP07`（只回報一筆）\n- `tool`（`hash`、`approvedHash`、`usesShell`、`highImpact`、`needsApproval`）：描述雜湊和核准時不同 → `MCP03`；參數會拼進 shell → `MCP05`；高影響動作不需要人核准 → `MCP06`\n- `runtime`（`auditLog`、`contextFields`、`neededFields`）：沒有工具呼叫紀錄 → `MCP08`；放進 context 的欄位超出任務需要的 → `MCP10`\n\n結果依 `observations` 的順序；同一筆觀察命中多項時依編號由小到大。沒有問題的觀察不產生結果。不認得的 `type` 丟 `Error`。",
    starter: String.raw`// 每個項目對應的控制（文字固定，直接取用）
const CONTROLS = {
  MCP01: '憑證用 secret 參照與短效 token，由執行層注入，不進 context',
  MCP02: '每個 server 各自一組最小權限的憑證，沒用到的 scope 收回',
  MCP03: '鎖定工具描述的雜湊，變更就停用並重新核准',
  MCP04: '鎖版本與完整性雜湊，從內部登錄安裝',
  MCP05: '不經 shell、用參數陣列，參數在 server 端驗證',
  MCP06: '高影響動作要人核准，核准畫面顯示完整參數',
  MCP07: '遠端 server 驗證呼叫者身分與授權，並走 TLS',
  MCP08: '每次 tools/call 記一筆結構化的稽核紀錄',
  MCP09: '只允許內部登錄上的 server，定期掃描設定檔與端點',
  MCP10: 'context 只放任務需要的欄位，敏感欄位遮罩',
}

function classify(observations) {
  const findings = []
  for (const o of observations) {
    // TODO：目前只認得兩種情況，其他 type 與其他項目都還沒處理
    if (o.type === 'credential' && o.inline) findings.push({ server: o.server, id: 'MCP01', control: CONTROLS.MCP01 })
    if (o.type === 'package' && o.version === 'latest') findings.push({ server: o.server, id: 'MCP04', control: CONTROLS.MCP04 })
  }
  return findings
}

// 試跑：課文開頭那份設定檔盤點出來的幾筆觀察
const observations = [
  { type: 'credential', server: 'github', inline: true, ttlHours: null, granted: ['repo:read', 'repo:write'], used: ['repo:read'] },
  { type: 'package', server: 'handy-search', version: '', registered: null },
  { type: 'transport', server: 'orders-db', url: 'http://10.0.3.17:8080/mcp', auth: false, perUserAuthz: false },
]
for (const f of classify(observations)) console.log(f.id, f.server.padEnd(13), f.control)
`,
    solution: String.raw`// 每個項目對應的控制（文字固定，直接取用）
const CONTROLS = {
  MCP01: '憑證用 secret 參照與短效 token，由執行層注入，不進 context',
  MCP02: '每個 server 各自一組最小權限的憑證，沒用到的 scope 收回',
  MCP03: '鎖定工具描述的雜湊，變更就停用並重新核准',
  MCP04: '鎖版本與完整性雜湊，從內部登錄安裝',
  MCP05: '不經 shell、用參數陣列，參數在 server 端驗證',
  MCP06: '高影響動作要人核准，核准畫面顯示完整參數',
  MCP07: '遠端 server 驗證呼叫者身分與授權，並走 TLS',
  MCP08: '每次 tools/call 記一筆結構化的稽核紀錄',
  MCP09: '只允許內部登錄上的 server，定期掃描設定檔與端點',
  MCP10: 'context 只放任務需要的欄位，敏感欄位遮罩',
}

// 每種觀察各自的規則：回傳命中的項目編號
const RULES = {
  credential: (o) => [
    (o.inline || o.ttlHours === null) && 'MCP01',                      // 寫死或長效
    o.granted.some((s) => !o.used.includes(s)) && 'MCP02',             // 給了卻沒用到的權限
  ],
  package: (o) => [
    (!o.version || o.version === 'latest' || (o.registered !== null && o.version !== o.registered)) && 'MCP04',
    o.registered === null && 'MCP09',                                  // 影子 server
  ],
  transport: (o) => [
    (!o.url.startsWith('https://') || !o.auth || !o.perUserAuthz) && 'MCP07',
  ],
  tool: (o) => [
    o.hash !== o.approvedHash && 'MCP03',                              // 核准後描述被換掉
    o.usesShell && 'MCP05',
    o.highImpact && !o.needsApproval && 'MCP06',
  ],
  runtime: (o) => [
    !o.auditLog && 'MCP08',
    o.contextFields.some((f) => !o.neededFields.includes(f)) && 'MCP10',
  ],
}

function classify(observations) {
  const findings = []
  for (const o of observations) {
    const rule = RULES[o.type]
    if (!rule) throw new Error('不認得的觀察類型：' + o.type)
    for (const id of rule(o).filter(Boolean).sort()) {
      findings.push({ server: o.server, id, control: CONTROLS[id] })
    }
  }
  return findings
}

// 試跑：課文開頭那份設定檔盤點出來的幾筆觀察
const observations = [
  { type: 'credential', server: 'github', inline: true, ttlHours: null, granted: ['repo:read', 'repo:write'], used: ['repo:read'] },
  { type: 'package', server: 'handy-search', version: '', registered: null },
  { type: 'transport', server: 'orders-db', url: 'http://10.0.3.17:8080/mcp', auth: false, perUserAuthz: false },
]
for (const f of classify(observations)) console.log(f.id, f.server.padEnd(13), f.control)
`,
    tests: [
      { name: "憑證：寫死或長效是 MCP01，給了沒用到的 scope 是 MCP02", code: String.raw`const ids = (obs) => classify(obs).map((f) => f.id)
const base = { type: 'credential', server: 'github', inline: false, ttlHours: 1, granted: ['repo:read'], used: ['repo:read'] }
assertEqual(ids([base]), [], 'secret 參照、短效、範圍剛好')
assertEqual(ids([{ ...base, inline: true }]), ['MCP01'], '機密值寫在設定檔')
assertEqual(ids([{ ...base, ttlHours: null }]), ['MCP01'], '沒有期限的長效 token')
assertEqual(ids([{ ...base, granted: ['repo:read', 'repo:write', 'admin:org'] }]), ['MCP02'], '權限範圍蔓延')
assertEqual(ids([{ ...base, inline: true, ttlHours: null, granted: ['repo:read', 'repo:write'] }]), ['MCP01', 'MCP02'], '兩項都命中')
assertEqual(ids([{ ...base, granted: [], used: [] }]), [], '沒有任何 scope')` },
      { name: "套件：沒鎖版本或與登錄不符是 MCP04，不在登錄上是 MCP09", code: String.raw`const ids = (obs) => classify(obs).map((f) => f.id)
const pkg = (version, registered) => ({ type: 'package', server: 'docs', version, registered })
assertEqual(ids([pkg('1.4.2', '1.4.2')]), [], '版本鎖定且與登錄相同')
assertEqual(ids([pkg('latest', '1.4.2')]), ['MCP04'], 'latest')
assertEqual(ids([pkg('', '1.4.2')]), ['MCP04'], '沒寫版本')
assertEqual(ids([pkg('1.5.0', '1.4.2')]), ['MCP04'], '與登錄的版本不同')
assertEqual(ids([pkg('0.1.0', null)]), ['MCP09'], '鎖了版本但不在登錄上')
assertEqual(ids([pkg('', null)]), ['MCP04', 'MCP09'], '沒鎖版本又不在登錄上')` },
      { name: "傳輸：沒走 TLS、沒驗證身分、沒依使用者授權，任一成立就是一筆 MCP07", code: String.raw`const ids = (obs) => classify(obs).map((f) => f.id)
const t = { type: 'transport', server: 'orders-db', url: 'https://orders-mcp.internal.example/mcp', auth: true, perUserAuthz: true }
assertEqual(ids([t]), [])
assertEqual(ids([{ ...t, url: 'http://10.0.3.17:8080/mcp' }]), ['MCP07'], '明文 HTTP')
assertEqual(ids([{ ...t, auth: false }]), ['MCP07'], '沒驗證呼叫者')
assertEqual(ids([{ ...t, perUserAuthz: false }]), ['MCP07'], 'server 拿自己的高權限替任何人辦事')
assertEqual(ids([{ ...t, url: 'http://10.0.3.17:8080/mcp', auth: false, perUserAuthz: false }]), ['MCP07'], '三個理由只回報一筆')` },
      { name: "工具：描述雜湊不同是 MCP03，拼進 shell 是 MCP05，高影響動作沒人核准是 MCP06", code: String.raw`const ids = (obs) => classify(obs).map((f) => f.id)
const tool = { type: 'tool', server: 'convert', tool: 'convert_image', hash: 'a1f3', approvedHash: 'a1f3', usesShell: false, highImpact: false, needsApproval: false }
assertEqual(ids([tool]), [])
assertEqual(ids([{ ...tool, hash: 'b9e4' }]), ['MCP03'], '核准後描述變了')
assertEqual(ids([{ ...tool, usesShell: true }]), ['MCP05'])
assertEqual(ids([{ ...tool, highImpact: true }]), ['MCP06'], '高影響動作沒有人核准')
assertEqual(ids([{ ...tool, highImpact: true, needsApproval: true }]), [], '有人核准就不算')
assertEqual(ids([{ ...tool, hash: 'b9e4', usesShell: true, highImpact: true }]), ['MCP03', 'MCP05', 'MCP06'])` },
      { name: "執行期：沒有呼叫紀錄是 MCP08，context 放了任務不需要的欄位是 MCP10", code: String.raw`const ids = (obs) => classify(obs).map((f) => f.id)
const rt = { type: 'runtime', server: 'support-agent', auditLog: true, contextFields: ['ticket_id', 'subject'], neededFields: ['ticket_id', 'subject', 'status'] }
assertEqual(ids([rt]), [])
assertEqual(ids([{ ...rt, auditLog: false }]), ['MCP08'])
assertEqual(ids([{ ...rt, contextFields: ['ticket_id', 'subject', 'national_id', 'address'] }]), ['MCP10'], '過度分享')
assertEqual(ids([{ ...rt, auditLog: false, contextFields: ['national_id'] }]), ['MCP08', 'MCP10'])` },
      { name: "綜合：順序照 observations，control 取自 CONTROLS；不認得的 type 丟 Error", code: String.raw`const obs = [
  { type: 'runtime', server: 'support-agent', auditLog: false, contextFields: ['ticket_id'], neededFields: ['ticket_id'] },
  { type: 'package', server: 'handy-search', version: '', registered: null },
  { type: 'credential', server: 'docs', inline: false, ttlHours: 1, granted: ['docs:read'], used: ['docs:read'] },
  { type: 'credential', server: 'github', inline: true, ttlHours: null, granted: ['repo:read', 'repo:write'], used: ['repo:read'] },
]
assertEqual(classify(obs), [
  { server: 'support-agent', id: 'MCP08', control: CONTROLS.MCP08 },
  { server: 'handy-search', id: 'MCP04', control: CONTROLS.MCP04 },
  { server: 'handy-search', id: 'MCP09', control: CONTROLS.MCP09 },
  { server: 'github', id: 'MCP01', control: CONTROLS.MCP01 },
  { server: 'github', id: 'MCP02', control: CONTROLS.MCP02 },
])
assertEqual(classify([]), [])
let threw = false
try { classify([{ type: 'firewall', server: 'x' }]) } catch (e) { threw = e instanceof Error }
assert(threw, '不認得的 type 要丟 Error')` },
    ],
    hints: [
      "每種 `type` 寫一個小函式，回傳命中的編號陣列；最後統一 `sort()` 再轉成 `{ server, id, control: CONTROLS[id] }`。",
      "MCP02 與 MCP10 是同一種比較：`granted.some((s) => !used.includes(s))`、`contextFields.some((f) => !neededFields.includes(f))`。",
      "MCP07 有三個理由（沒走 `https://`、`auth` 為 false、`perUserAuthz` 為 false），命中幾個都只回報一筆。",
    ],
  },
  {
    id: 'tool-poisoning-1', skill: 'tool-poisoning', kind: 'python', level: 2,
    title: "工具定義的指紋與鎖版本比對：rug pull、未核准、下架、同名衝突",
    prompt: "MCP client 每次連線都會重新拿到工具清單。實作載入前的兩個函式：\n\n`fingerprint(tool) -> str`：對工具的 `name`、`description`、`inputSchema` 三個欄位做穩定序列化，回傳 SHA-256 的十六進位字串。\n\n- 序列化固定用 `json.dumps(三個欄位組成的 dict, sort_keys=True, ensure_ascii=False, separators=(\",\", \":\"))`，再以 UTF-8 編碼\n- 鍵的順序不同、內容相同，指紋要一樣；`inputSchema` 裡任何一處改動（多一個參數、改參數說明）指紋都要變\n- 其他欄位（例如 server 自己宣稱的 `annotations`）不算進指紋\n\n`check_tools(tools, lock) -> dict`：`tools` 是這次 `tools/list` 拿到的清單，`lock` 是核准時存下的 `{名稱: 指紋}`。回傳五個依名稱排序的清單：\n\n- `ok`：指紋和核准時相同，只有這些可以載入\n- `changed`：名稱在 `lock` 裡但指紋不同（核准後被改過，rug pull）\n- `unapproved`：不在 `lock` 裡\n- `removed`：`lock` 裡有、這次清單沒有\n- `conflict`：同一個名稱在清單裡出現兩次以上（分不出哪一個是核准的那個）。這種名稱只列在 `conflict`，不再列進其他清單",
    starter: String.raw`import hashlib
import json


def fingerprint(tool):
    # TODO：只算了 description——schema 多一個參數、改參數說明都不會被發現
    return hashlib.sha256(tool["description"].encode("utf-8")).hexdigest()


def check_tools(tools, lock):
    result = {"ok": [], "changed": [], "unapproved": [], "removed": [], "conflict": []}
    # TODO：未核准、下架、同名衝突都還沒處理
    for tool in tools:
        if lock.get(tool["name"]) == fingerprint(tool):
            result["ok"].append(tool["name"])
        else:
            result["changed"].append(tool["name"])
    return result


approved = {
    "name": "add",
    "description": "Adds two numbers.",
    "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]},
}
lock = {"add": fingerprint(approved)}                 # 核准時存下來

# 之後重新連線拿到的版本：描述多了一段，schema 多了一個參數（內容用佔位文字表示）
reloaded = {
    "name": "add",
    "description": "Adds two numbers.\n[示範佔位：新加入、寫給模型看的段落]",
    "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}, "note": {"type": "string"}}, "required": ["a", "b"]},
}
print(check_tools([approved], lock))
print(check_tools([reloaded], lock))
`,
    solution: String.raw`import hashlib
import json
from collections import Counter


def fingerprint(tool):
    # 指紋涵蓋模型會讀到的全部內容：名稱、描述、完整 schema（含每個參數自己的說明）
    payload = {"name": tool["name"], "description": tool["description"], "inputSchema": tool["inputSchema"]}
    # 穩定序列化：鍵排序、固定分隔符號，同樣的內容一定得到同樣的字串
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def check_tools(tools, lock):
    result = {"ok": [], "changed": [], "unapproved": [], "removed": [], "conflict": []}
    counts = Counter(tool["name"] for tool in tools)
    for tool in tools:
        name = tool["name"]
        if counts[name] > 1:
            continue                                  # 同名衝突：下面統一處理
        if name not in lock:
            result["unapproved"].append(name)
        elif lock[name] == fingerprint(tool):
            result["ok"].append(name)
        else:
            result["changed"].append(name)            # 核准後被改過：停用、等重新核准
    result["conflict"] = [name for name, n in counts.items() if n > 1]
    result["removed"] = [name for name in lock if name not in counts]
    return {key: sorted(names) for key, names in result.items()}


approved = {
    "name": "add",
    "description": "Adds two numbers.",
    "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]},
}
lock = {"add": fingerprint(approved)}                 # 核准時存下來

# 之後重新連線拿到的版本：描述多了一段，schema 多了一個參數（內容用佔位文字表示）
reloaded = {
    "name": "add",
    "description": "Adds two numbers.\n[示範佔位：新加入、寫給模型看的段落]",
    "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}, "note": {"type": "string"}}, "required": ["a", "b"]},
}
print(check_tools([approved], lock))
print(check_tools([reloaded], lock))
`,
    tests: [
      { name: "指紋：照規定的序列化算 SHA-256；鍵的順序不同指紋不變", code: String.raw`_a = {"name": "add", "description": "Adds two numbers.",
      "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]}}
_b = {"inputSchema": {"required": ["a", "b"], "properties": {"b": {"type": "number"}, "a": {"type": "number"}}, "type": "object"},
      "description": "Adds two numbers.", "name": "add"}
assert fingerprint(_a) == "b72bb5c5d6900ad1a587bd4fea3feff5" + "3c1187d5b6379f71d5ecaa1de1ee381c", f"指紋要照題目規定的序列化方式算：{fingerprint(_a)}"
assert fingerprint(_b) == fingerprint(_a), "鍵的順序不同，內容相同，指紋要一樣"
_zh = dict(_a, description="把兩個數字相加。")
assert fingerprint(_zh) != fingerprint(_a) and len(fingerprint(_zh)) == 64` },
      { name: "指紋涵蓋名稱與完整 schema，不含 annotations 這類其他欄位", code: String.raw`_a = {"name": "add", "description": "Adds two numbers.",
      "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]}}
_more_param = dict(_a, inputSchema={"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}, "note": {"type": "string"}}, "required": ["a", "b"]})
_param_desc = dict(_a, inputSchema={"type": "object", "properties": {"a": {"type": "number", "description": "[示範佔位：參數說明裡新加入的段落]"}, "b": {"type": "number"}}, "required": ["a", "b"]})
_renamed = dict(_a, name="add_numbers")
assert fingerprint(_more_param) != fingerprint(_a), "schema 多一個參數，指紋要變"
assert fingerprint(_param_desc) != fingerprint(_a), "參數自己的說明改了，指紋要變"
assert fingerprint(_renamed) != fingerprint(_a), "名稱也在指紋裡"
_annotated = dict(_a, annotations={"readOnlyHint": True})
assert fingerprint(_annotated) == fingerprint(_a), "annotations 是 server 自己宣稱的，不算進指紋"` },
      { name: "比對：相同、被改過（rug pull）、未核准、已下架各歸一類，依名稱排序", code: String.raw`def _tool(name, desc, props=("a", "b")):
    return {"name": name, "description": desc,
            "inputSchema": {"type": "object", "properties": {p: {"type": "number"} for p in props}}}
_lock = {"add": fingerprint(_tool("add", "Adds two numbers.")),
         "search_docs": fingerprint(_tool("search_docs", "Search internal docs.", ("query",))),
         "export_csv": fingerprint(_tool("export_csv", "Export a report.", ("report_id",)))}
_now = [_tool("search_docs", "Search internal docs.\n[示範佔位：新加入、寫給模型看的段落]", ("query",)),
        _tool("zip_files", "Create an archive.", ("path",)),
        _tool("add", "Adds two numbers.")]
_r = check_tools(_now, _lock)
assert _r == {"ok": ["add"], "changed": ["search_docs"], "unapproved": ["zip_files"], "removed": ["export_csv"], "conflict": []}, _r` },
      { name: "描述一字未改、只在 schema 多一個參數，也要判成 changed", code: String.raw`def _tool(name, desc, props=("a", "b")):
    return {"name": name, "description": desc,
            "inputSchema": {"type": "object", "properties": {p: {"type": "number"} for p in props}}}
_lock = {"add": fingerprint(_tool("add", "Adds two numbers."))}
_r = check_tools([_tool("add", "Adds two numbers.", ("a", "b", "note"))], _lock)
assert _r["changed"] == ["add"] and _r["ok"] == [], f"描述沒變但 schema 變了：{_r}"
_same = dict(_tool("add", "Adds two numbers."), annotations={"readOnlyHint": True})
assert check_tools([_same], _lock)["ok"] == ["add"]` },
      { name: "同名衝突：出現兩次以上的名稱只列在 conflict，不能載入", code: String.raw`def _tool(name, desc, props=("a", "b")):
    return {"name": name, "description": desc,
            "inputSchema": {"type": "object", "properties": {p: {"type": "number"} for p in props}}}
_lock = {"add": fingerprint(_tool("add", "Adds two numbers.")),
         "send_email": fingerprint(_tool("send_email", "Send an email.", ("to", "body")))}
_now = [_tool("send_email", "Send an email.", ("to", "body")),
        _tool("add", "Adds two numbers."),
        _tool("send_email", "Send an email. [示範佔位：另一個 server 的同名工具]", ("to", "body", "bcc")),
        _tool("ping", "Ping.", ()), _tool("ping", "Ping.", ())]
_r = check_tools(_now, _lock)
assert _r == {"ok": ["add"], "changed": [], "unapproved": [], "removed": [], "conflict": ["ping", "send_email"]}, _r` },
      { name: "邊界：清單是空的就全部算下架；lock 是空的就全部未核准", code: String.raw`def _tool(name, desc, props=("a", "b")):
    return {"name": name, "description": desc,
            "inputSchema": {"type": "object", "properties": {p: {"type": "number"} for p in props}}}
_lock = {"b_tool": fingerprint(_tool("b_tool", "B.")), "a_tool": fingerprint(_tool("a_tool", "A."))}
assert check_tools([], _lock) == {"ok": [], "changed": [], "unapproved": [], "removed": ["a_tool", "b_tool"], "conflict": []}
_r = check_tools([_tool("b_tool", "B."), _tool("a_tool", "A.")], {})
assert _r == {"ok": [], "changed": [], "unapproved": ["a_tool", "b_tool"], "removed": [], "conflict": []}, _r` },
    ],
    hints: [
      "指紋只取三個欄位：`{\"name\": tool[\"name\"], \"description\": tool[\"description\"], \"inputSchema\": tool[\"inputSchema\"]}`，再照題目給的 `json.dumps` 參數序列化。",
      "先數每個名稱出現幾次（`collections.Counter`）；出現兩次以上的直接進 `conflict`，後面的分類都跳過它。",
      "`removed` 是 `lock` 裡有、這次清單完全沒出現的名稱；五個清單最後都 `sorted()`。",
    ],
  },
  {
    id: 'agent-credential-isolation-1', skill: 'agent-credential-isolation', kind: 'python', level: 2,
    title: "檢查 agent 執行環境：憑證隔離、不進 context、高風險動作要核准",
    prompt: "實作 `check_isolation(setup)`，檢查一個 agent 執行環境的設定，回傳排序過的 `(規則代碼, 對象)` 清單。前提是「假設模型會被騙、某個工具會被打穿」，所以每一條都在問：那時候拿得到什麼。\n\n`setup` 有四個鍵：\n\n- `tools`：每個工具的 `name`、`env`（掛載了哪些憑證的名稱）、`egress`（連得到的主機，`\"*\"` 代表不限）、`risk`（`\"low\"` 或 `\"high\"`）、`approval`（執行前要不要人核准）\n- `credentials`：`{名稱: {\"scopes\": [...], \"ttl_minutes\": 數字或 None, \"level\": \"scoped\" / \"admin\" / \"root\"}}`\n- `context_vars`：會被放進模型 context 的變數名稱\n- `internal_hosts`：平台內部的主機（快取、控制面）\n\n規則，對象是憑證名稱或工具名稱：\n\n- `shared_credential`：同一個憑證掛在兩個以上的工具（一個被打穿，其他工具的權限一起丟）\n- `in_context`：憑證名稱出現在 `context_vars`（模型看得到就印得出來）\n- `no_expiry`：憑證的 `ttl_minutes` 是 `None`\n- `over_privileged`：憑證的 `level` 是 `admin` 或 `root`，或 `scopes` 是空的（沒有範圍），或 `scopes` 裡有 `*`\n- `internal_network`：工具的 `egress` 是 `\"*\"`，或連得到 `internal_hosts` 裡的任何主機\n- `no_approval`：`risk` 是 `high` 的工具不需要人核准\n\n同一組 `(規則代碼, 對象)` 只列一次；沒有問題時回傳 `[]`。",
    starter: String.raw`def check_isolation(setup):
    findings = []
    # TODO：目前只檢查「憑證有沒有進 context」，其他五條規則還沒寫
    for name in setup["context_vars"]:
        if name in setup["credentials"]:
            findings.append(("in_context", name))
    return sorted(findings)


setup = {
    "tools": [
        {"name": "issues", "env": ["ISSUES_TOKEN"], "egress": ["api.tracker.example"], "risk": "low", "approval": False},
        {"name": "deploy", "env": ["ISSUES_TOKEN", "DEPLOY_KEY"], "egress": ["*"], "risk": "high", "approval": False},
    ],
    "credentials": {
        "ISSUES_TOKEN": {"scopes": ["issues:read"], "ttl_minutes": 60, "level": "scoped"},
        "DEPLOY_KEY": {"scopes": [], "ttl_minutes": None, "level": "admin"},
    },
    "context_vars": ["DEPLOY_KEY"],
    "internal_hosts": ["cache.platform.internal", "admin.platform.internal"],
}
for rule, subject in check_isolation(setup):
    print(rule, subject)
`,
    solution: String.raw`from collections import Counter


def check_isolation(setup):
    findings = set()
    creds = setup["credentials"]
    internal = set(setup["internal_hosts"])

    # 第 1 道：每個工具只拿得到自己的憑證
    mounted = Counter(name for tool in setup["tools"] for name in set(tool["env"]))
    for name, count in mounted.items():
        if count > 1:
            findings.add(("shared_credential", name))

    for name, cred in creds.items():
        # 第 2 道：憑證不進模型的 context
        if name in setup["context_vars"]:
            findings.add(("in_context", name))
        # 每把憑證有期限、有範圍；管理員與 root 等級不給自動化流程
        if cred["ttl_minutes"] is None:
            findings.add(("no_expiry", name))
        if cred["level"] in ("admin", "root") or not cred["scopes"] or "*" in cred["scopes"]:
            findings.add(("over_privileged", name))

    for tool in setup["tools"]:
        # 工作負載連不到平台內部的快取與控制面
        if "*" in tool["egress"] or internal & set(tool["egress"]):
            findings.add(("internal_network", tool["name"]))
        # 第 3 道：高風險動作要人核准
        if tool["risk"] == "high" and not tool["approval"]:
            findings.add(("no_approval", tool["name"]))

    return sorted(findings)


setup = {
    "tools": [
        {"name": "issues", "env": ["ISSUES_TOKEN"], "egress": ["api.tracker.example"], "risk": "low", "approval": False},
        {"name": "deploy", "env": ["ISSUES_TOKEN", "DEPLOY_KEY"], "egress": ["*"], "risk": "high", "approval": False},
    ],
    "credentials": {
        "ISSUES_TOKEN": {"scopes": ["issues:read"], "ttl_minutes": 60, "level": "scoped"},
        "DEPLOY_KEY": {"scopes": [], "ttl_minutes": None, "level": "admin"},
    },
    "context_vars": ["DEPLOY_KEY"],
    "internal_hosts": ["cache.platform.internal", "admin.platform.internal"],
}
for rule, subject in check_isolation(setup):
    print(rule, subject)
`,
    tests: [
      { name: "三道防線都有做的環境：沒有任何問題", code: String.raw`_s = {
    "tools": [
        {"name": "issues", "env": ["ISSUES_TOKEN"], "egress": ["api.tracker.example"], "risk": "low", "approval": False},
        {"name": "deploy", "env": ["DEPLOY_TOKEN"], "egress": ["deploy.example"], "risk": "high", "approval": True},
        {"name": "calc", "env": [], "egress": [], "risk": "low", "approval": False},
    ],
    "credentials": {
        "ISSUES_TOKEN": {"scopes": ["issues:read"], "ttl_minutes": 60, "level": "scoped"},
        "DEPLOY_TOKEN": {"scopes": ["deploy:write"], "ttl_minutes": 15, "level": "scoped"},
    },
    "context_vars": ["TASK_ID", "REPO_NAME"],
    "internal_hosts": ["cache.platform.internal", "admin.platform.internal"],
}
assert check_isolation(_s) == [], check_isolation(_s)` },
      { name: "共用憑證：同一個憑證掛在兩個以上的工具才算，而且只列一次", code: String.raw`_cred = {"scopes": ["repo:read"], "ttl_minutes": 30, "level": "scoped"}
def _tool(name, env):
    return {"name": name, "env": env, "egress": [], "risk": "low", "approval": False}
_s = {"tools": [_tool("a", ["SHARED", "ONLY_A"]), _tool("b", ["SHARED"]), _tool("c", ["SHARED", "ONLY_C"])],
      "credentials": {"SHARED": _cred, "ONLY_A": _cred, "ONLY_C": _cred}, "context_vars": [], "internal_hosts": []}
assert check_isolation(_s) == [("shared_credential", "SHARED")], check_isolation(_s)` },
      { name: "憑證：進了 context、沒有期限、範圍過大各自列出", code: String.raw`def _tool(name, env):
    return {"name": name, "env": env, "egress": [], "risk": "low", "approval": False}
_creds = {
    "OK_TOKEN": {"scopes": ["issues:read"], "ttl_minutes": 60, "level": "scoped"},
    "SEEN_TOKEN": {"scopes": ["issues:read"], "ttl_minutes": 60, "level": "scoped"},
    "FOREVER_KEY": {"scopes": ["reports:read"], "ttl_minutes": None, "level": "scoped"},
    "ADMIN_KEY": {"scopes": ["team:manage"], "ttl_minutes": 30, "level": "admin"},
    "ROOT_KEY": {"scopes": ["cloud:all"], "ttl_minutes": 30, "level": "root"},
    "NO_SCOPE_KEY": {"scopes": [], "ttl_minutes": 30, "level": "scoped"},
    "STAR_KEY": {"scopes": ["*"], "ttl_minutes": 30, "level": "scoped"},
}
_s = {"tools": [_tool("t" + str(i), [n]) for i, n in enumerate(_creds)], "credentials": _creds,
      "context_vars": ["SEEN_TOKEN", "TASK_ID"], "internal_hosts": []}
assert check_isolation(_s) == [("in_context", "SEEN_TOKEN"), ("no_expiry", "FOREVER_KEY"), ("over_privileged", "ADMIN_KEY"),
                               ("over_privileged", "NO_SCOPE_KEY"), ("over_privileged", "ROOT_KEY"),
                               ("over_privileged", "STAR_KEY")], check_isolation(_s)` },
      { name: "網路：出站不限、或連得到平台內部主機的工具要列出", code: String.raw`def _tool(name, egress):
    return {"name": name, "env": [], "egress": egress, "risk": "low", "approval": False}
_s = {"tools": [_tool("fetch", ["*"]), _tool("router", ["api.partner.example", "cache.platform.internal"]),
                _tool("issues", ["api.tracker.example"]), _tool("offline", [])],
      "credentials": {}, "context_vars": [], "internal_hosts": ["cache.platform.internal", "admin.platform.internal"]}
assert check_isolation(_s) == [("internal_network", "fetch"), ("internal_network", "router")], check_isolation(_s)` },
      { name: "核准：只有高風險又不需要人核准的工具要列出", code: String.raw`def _tool(name, risk, approval):
    return {"name": name, "env": [], "egress": [], "risk": risk, "approval": approval}
_s = {"tools": [_tool("delete_branch", "high", False), _tool("deploy", "high", True),
                _tool("read_issue", "low", False), _tool("list_files", "low", True)],
      "credentials": {}, "context_vars": [], "internal_hosts": []}
assert check_isolation(_s) == [("no_approval", "delete_branch")], check_isolation(_s)` },
      { name: "綜合：一把沒有邊界的金鑰同時違反多條，結果依代碼與對象排序", code: String.raw`_s = {
    "tools": [
        {"name": "issues", "env": ["ISSUES_TOKEN"], "egress": ["api.tracker.example"], "risk": "low", "approval": False},
        {"name": "deploy", "env": ["ISSUES_TOKEN", "DEPLOY_KEY"], "egress": ["*"], "risk": "high", "approval": False},
    ],
    "credentials": {
        "ISSUES_TOKEN": {"scopes": ["issues:read"], "ttl_minutes": 60, "level": "scoped"},
        "DEPLOY_KEY": {"scopes": [], "ttl_minutes": None, "level": "admin"},
    },
    "context_vars": ["DEPLOY_KEY"],
    "internal_hosts": ["cache.platform.internal", "admin.platform.internal"],
}
assert check_isolation(_s) == [("in_context", "DEPLOY_KEY"), ("internal_network", "deploy"), ("no_approval", "deploy"),
                               ("no_expiry", "DEPLOY_KEY"), ("over_privileged", "DEPLOY_KEY"),
                               ("shared_credential", "ISSUES_TOKEN")], check_isolation(_s)` },
    ],
    hints: [
      "共用憑證：先數每個憑證名稱出現在幾個工具的 `env` 裡（`collections.Counter`），大於 1 的才列出。",
      "`over_privileged` 有三種情況：`level` 是 `admin` 或 `root`、`scopes` 是空的、`scopes` 裡有 `*`。",
      "網路：`\"*\" in tool[\"egress\"]` 或 `set(tool[\"egress\"]) & set(setup[\"internal_hosts\"])` 不是空的。最後整個清單 `sorted()`。",
    ],
  },
  {
    id: 'agent-supply-chain-1', skill: 'agent-supply-chain', kind: 'python', level: 2,
    title: "某一版有問題的通報：誰載入了、哪些要重審、哪些憑證要輪替",
    prompt: "內部登錄記錄每個 Skill 與 MCP server 的來源、鎖定的版本、負責人與授予的憑證；盤點則記錄每台機器實際載入了哪個來源的哪一版。收到「某個來源的某些版本有問題」的通報時，第一個問題是「有哪些 agent 載入了這一版」。\n\n實作 `impact(registry, inventory, advisory)`，回傳一個 dict，五個鍵都是去重、排序過的清單：\n\n- `pull`：載入了受影響版本的 `host`，要立刻撤下\n- `verify`：載入這個來源、但版本沒鎖（空字串或 `latest`）的 `host`。實際跑的是哪一版要另外查，不能當成沒事\n- `teams`：`pull` 與 `verify` 那些機器所屬的 `team`，要通知\n- `re_review`：登錄裡來源相同、而且**鎖定的版本**就在受影響範圍內的項目名稱。登錄要更新並重新審核\n- `rotate`：只要 `pull` 或 `verify` 有任何一台，登錄裡這個來源的所有項目被授予的憑證都要輪替；兩者都空就是 `[]`\n\n資料格式：\n\n- `registry`：`{名稱: {\"source\", \"version\", \"owner\", \"credentials\": [...]}}`\n- `inventory`：`[{\"host\", \"team\", \"source\", \"version\"}]`\n- `advisory`：`{\"source\", \"introduced\", \"fixed\"}`。受影響的版本是 `introduced <= 版本 < fixed`；`fixed` 是 `None` 代表還沒有修正版，`introduced` 之後全部受影響\n\n版本是 `主.次.修訂` 三段整數，要依數字比較。其他來源的項目完全不受影響。",
    starter: String.raw`def impact(registry, inventory, advisory):
    result = {"pull": [], "verify": [], "teams": [], "re_review": [], "rotate": []}
    # TODO：版本用字串比較會出錯；沒鎖版本的、要通知的團隊、登錄與憑證都還沒處理
    for item in inventory:
        if item["source"] == advisory["source"] and advisory["introduced"] <= item["version"] < advisory["fixed"]:
            result["pull"].append(item["host"])
    return result


registry = {
    "github": {"source": "some-github-mcp", "version": "2.3.1", "owner": "platform", "credentials": ["github-readonly"]},
    "release-notes": {"source": "release-notes-skill", "version": "1.4.0", "owner": "docs", "credentials": []},
}
inventory = [
    {"host": "dev-amy", "team": "web", "source": "some-github-mcp", "version": "2.3.1"},
    {"host": "dev-ben", "team": "data", "source": "some-github-mcp", "version": "latest"},
    {"host": "ci-runner", "team": "platform", "source": "some-github-mcp", "version": "2.2.9"},
    {"host": "dev-amy", "team": "web", "source": "release-notes-skill", "version": "1.4.0"},
]
advisory = {"source": "some-github-mcp", "introduced": "2.3.0", "fixed": "2.3.2"}
print(impact(registry, inventory, advisory))
# 預期 pull=['dev-amy']、verify=['dev-ben']、teams=['data', 'web']、re_review=['github']、rotate=['github-readonly']
`,
    solution: String.raw`def _parse(version):
    # 依數字比較："2.10.0" → (2, 10, 0)
    return tuple(int(x) for x in version.split("."))


def _pinned(version):
    return bool(version) and version != "latest"


def _affected(version, advisory):
    v = _parse(version)
    if v < _parse(advisory["introduced"]):
        return False
    return advisory["fixed"] is None or v < _parse(advisory["fixed"])


def impact(registry, inventory, advisory):
    source = advisory["source"]
    pull, verify, teams = set(), set(), set()
    for item in inventory:
        if item["source"] != source:
            continue
        if not _pinned(item["version"]):
            verify.add(item["host"])                 # 不知道實際跑哪一版，不能當成沒事
        elif _affected(item["version"], advisory):
            pull.add(item["host"])
        else:
            continue
        teams.add(item["team"])

    same_source = {name: entry for name, entry in registry.items() if entry["source"] == source}
    # 登錄鎖的就是有問題的版本：登錄本身要更新並重審
    re_review = [name for name, entry in same_source.items()
                 if _pinned(entry["version"]) and _affected(entry["version"], advisory)]
    # 有問題的版本碰得到的憑證都當成已外洩
    rotate = set()
    if pull or verify:
        for entry in same_source.values():
            rotate.update(entry["credentials"])

    return {"pull": sorted(pull), "verify": sorted(verify), "teams": sorted(teams),
            "re_review": sorted(re_review), "rotate": sorted(rotate)}


registry = {
    "github": {"source": "some-github-mcp", "version": "2.3.1", "owner": "platform", "credentials": ["github-readonly"]},
    "release-notes": {"source": "release-notes-skill", "version": "1.4.0", "owner": "docs", "credentials": []},
}
inventory = [
    {"host": "dev-amy", "team": "web", "source": "some-github-mcp", "version": "2.3.1"},
    {"host": "dev-ben", "team": "data", "source": "some-github-mcp", "version": "latest"},
    {"host": "ci-runner", "team": "platform", "source": "some-github-mcp", "version": "2.2.9"},
    {"host": "dev-amy", "team": "web", "source": "release-notes-skill", "version": "1.4.0"},
]
advisory = {"source": "some-github-mcp", "introduced": "2.3.0", "fixed": "2.3.2"}
print(impact(registry, inventory, advisory))
# 預期 pull=['dev-amy']、verify=['dev-ben']、teams=['data', 'web']、re_review=['github']、rotate=['github-readonly']
`,
    tests: [
      { name: "受影響範圍：introduced <= 版本 < fixed，版本依數字比較", code: String.raw`_reg = {"github": {"source": "some-github-mcp", "version": "2.8.0", "owner": "platform", "credentials": []}}
_inv = [{"host": "h-289", "team": "web", "source": "some-github-mcp", "version": "2.8.9"},
        {"host": "h-290", "team": "web", "source": "some-github-mcp", "version": "2.9.0"},
        {"host": "h-2100", "team": "data", "source": "some-github-mcp", "version": "2.10.0"},
        {"host": "h-2103", "team": "data", "source": "some-github-mcp", "version": "2.10.3"},
        {"host": "h-2110", "team": "ops", "source": "some-github-mcp", "version": "2.11.0"}]
_r = impact(_reg, _inv, {"source": "some-github-mcp", "introduced": "2.9.0", "fixed": "2.11.0"})
assert _r["pull"] == ["h-2100", "h-2103", "h-290"], _r["pull"]
assert _r["teams"] == ["data", "web"], _r["teams"]
assert _r["verify"] == [] and _r["re_review"] == [], _r` },
      { name: "沒鎖版本的機器：空字串與 latest 進 verify，不算 pull，但所屬團隊要通知", code: String.raw`_reg = {"github": {"source": "some-github-mcp", "version": "2.2.0", "owner": "platform", "credentials": ["github-readonly"]}}
_inv = [{"host": "dev-ben", "team": "data", "source": "some-github-mcp", "version": "latest"},
        {"host": "dev-cat", "team": "design", "source": "some-github-mcp", "version": ""},
        {"host": "dev-dan", "team": "web", "source": "some-github-mcp", "version": "2.2.0"}]
_r = impact(_reg, _inv, {"source": "some-github-mcp", "introduced": "2.3.0", "fixed": "2.3.2"})
assert _r == {"pull": [], "verify": ["dev-ben", "dev-cat"], "teams": ["data", "design"],
              "re_review": [], "rotate": ["github-readonly"]}, _r` },
      { name: "還沒有修正版（fixed 是 None）：introduced 之後全部受影響", code: String.raw`_reg = {"docs": {"source": "internal-docs-mcp", "version": "1.4.2", "owner": "docs", "credentials": ["docs-readonly"]}}
_inv = [{"host": "ci-runner", "team": "platform", "source": "internal-docs-mcp", "version": "1.4.2"},
        {"host": "dev-amy", "team": "web", "source": "internal-docs-mcp", "version": "12.0.0"},
        {"host": "dev-eve", "team": "web", "source": "internal-docs-mcp", "version": "1.3.9"}]
_r = impact(_reg, _inv, {"source": "internal-docs-mcp", "introduced": "1.4.0", "fixed": None})
assert _r == {"pull": ["ci-runner", "dev-amy"], "verify": [], "teams": ["platform", "web"],
              "re_review": ["docs"], "rotate": ["docs-readonly"]}, _r` },
      { name: "登錄與憑證：同來源的項目，鎖定版本受影響的要重審；憑證全部輪替；其他來源不動", code: String.raw`_reg = {
    "github": {"source": "some-github-mcp", "version": "2.3.1", "owner": "platform", "credentials": ["github-readonly"]},
    "github-admin": {"source": "some-github-mcp", "version": "2.1.0", "owner": "platform", "credentials": ["github-org", "github-readonly"]},
    "release-notes": {"source": "release-notes-skill", "version": "2.3.1", "owner": "docs", "credentials": ["docs-write"]},
}
_inv = [{"host": "dev-amy", "team": "web", "source": "some-github-mcp", "version": "2.3.1"},
        {"host": "dev-amy", "team": "web", "source": "release-notes-skill", "version": "2.3.1"},
        {"host": "dev-fay", "team": "docs", "source": "release-notes-skill", "version": "latest"}]
_r = impact(_reg, _inv, {"source": "some-github-mcp", "introduced": "2.3.0", "fixed": "2.3.2"})
assert _r == {"pull": ["dev-amy"], "verify": [], "teams": ["web"], "re_review": ["github"],
              "rotate": ["github-org", "github-readonly"]}, _r` },
      { name: "沒有人載入受影響的版本：不撤、不輪替；但登錄鎖的版本有問題仍要重審", code: String.raw`_reg = {"github": {"source": "some-github-mcp", "version": "2.3.1", "owner": "platform", "credentials": ["github-readonly"]}}
_inv = [{"host": "dev-amy", "team": "web", "source": "some-github-mcp", "version": "2.3.2"},
        {"host": "ci-runner", "team": "platform", "source": "some-github-mcp", "version": "2.2.9"}]
_r = impact(_reg, _inv, {"source": "some-github-mcp", "introduced": "2.3.0", "fixed": "2.3.2"})
assert _r == {"pull": [], "verify": [], "teams": [], "re_review": ["github"], "rotate": []}, _r
assert impact({}, [], {"source": "x", "introduced": "1.0.0", "fixed": None}) == {"pull": [], "verify": [], "teams": [], "re_review": [], "rotate": []}` },
      { name: "去重與排序：同一台機器出現多次只列一次", code: String.raw`_reg = {"github": {"source": "some-github-mcp", "version": "2.3.0", "owner": "platform", "credentials": ["b-key", "a-key"]}}
_inv = [{"host": "dev-zoe", "team": "web", "source": "some-github-mcp", "version": "2.3.1"},
        {"host": "dev-amy", "team": "web", "source": "some-github-mcp", "version": "2.3.0"},
        {"host": "dev-zoe", "team": "web", "source": "some-github-mcp", "version": "2.3.1"},
        {"host": "dev-amy", "team": "web", "source": "some-github-mcp", "version": "latest"}]
_r = impact(_reg, _inv, {"source": "some-github-mcp", "introduced": "2.3.0", "fixed": "2.3.2"})
assert _r == {"pull": ["dev-amy", "dev-zoe"], "verify": ["dev-amy"], "teams": ["web"],
              "re_review": ["github"], "rotate": ["a-key", "b-key"]}, _r` },
    ],
    hints: [
      "版本先轉成整數 tuple 再比：`tuple(int(x) for x in v.split(\".\"))`，`2.10.0` 才會比 `2.9.0` 新。",
      "受影響的條件是 `introduced <= 版本`，而且 `fixed` 是 `None` 或 `版本 < fixed`。沒鎖版本（空字串或 `latest`）的不要拿去比，直接進 `verify`。",
      "`rotate` 要先看 `pull` 與 `verify` 是不是都空的；五個清單都用 `sorted(set(...))` 去重排序。",
    ],
  },
  {
    id: 'llm-wiki-1', skill: 'llm-wiki', kind: 'python', level: 2,
    title: "wiki 的 lint：斷鏈、孤兒頁、沒標來源、引用對不上頁首",
    prompt: "LLM Wiki 的 lint 裡，有幾項可以用程式檢查。`pages` 是 `{頁名: 整頁文字}`，每頁開頭可以有一段頁首（`---` 包起來的 `type`、`sources`、`updated`）；`raw_files` 是 `raw/` 底下實際存在的檔案路徑集合。\n\n三個輔助函式已寫好：`front_matter(text)` 回傳 `(meta, body)`，`links(body)` 回傳內文裡 `[[頁面]]` 連到的頁名，`citations(body)` 回傳內文裡 `（來源：raw/…）` 引用的檔案路徑。\n\n實作 `lint(pages, raw_files)`，回傳一個 dict，五個鍵的值都是去重、排序過的清單：\n\n- `broken`：`(來源頁, 目標頁名)`，目標不存在\n- `orphans`：沒有任何**其他頁**連進來的頁名。自己連自己不算；`index` 頁是入口，不算孤兒\n- `no_sources`：頁首沒有 `sources`、或 `sources` 是空的頁名。`index` 頁不檢查\n- `missing_raw`：`(頁名, 路徑)`，頁首 `sources` 列的檔案不在 `raw_files` 裡\n- `unlisted`：`(頁名, 路徑)`，內文引用了某個 raw 檔，但它沒有列在這一頁頁首的 `sources`\n\nlint 只產生報告，不修改 `pages`。",
    starter: String.raw`import re

LINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
CITE = re.compile(r"（來源：(raw/[^\s，）]+)")


def front_matter(text):
    """已寫好，不用改：把一頁拆成 (meta, body)。meta 例如 {"type": "concept", "sources": [...], "updated": "2026-03-16"}。"""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---" or "---" not in [l.strip() for l in lines[1:]]:
        return {}, text
    end = [l.strip() for l in lines[1:]].index("---") + 1
    meta, key = {}, None
    for line in lines[1:end]:
        if line.startswith("  - ") and key:
            meta.setdefault(key, [])
            if isinstance(meta[key], list):
                meta[key].append(line[4:].strip())
        elif ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            meta[key] = value.strip() if value.strip() else []
    return meta, "\n".join(lines[end + 1:])


def links(body):
    """已寫好，不用改：內文裡 [[頁面]] 與 [[頁面|顯示文字]] 連到的頁名（去掉前後空白）。"""
    return [m.strip() for m in LINK.findall(body) if m.strip()]


def citations(body):
    """已寫好，不用改：內文裡（來源：raw/xxx.md §3）這種引用的檔案路徑。"""
    return CITE.findall(body)


def lint(pages, raw_files):
    report = {"broken": [], "orphans": [], "no_sources": [], "missing_raw": [], "unlisted": []}
    # TODO：目前只找斷鏈（而且沒去重、沒排序）；另外四項還沒做
    for name, text in pages.items():
        meta, body = front_matter(text)
        for target in links(body):
            if target not in pages:
                report["broken"].append((name, target))
    return report


pages = {
    "index": "# 索引\n- [[方法A]]\n- [[長文件評測]]",
    "方法A": "---\ntype: entity\nsources:\n  - raw/2026-03-02-paper-a.md\nupdated: 2026-03-16\n---\n# 方法A\n在長文件上表現較好（來源：raw/2026-03-02-paper-a.md §4）。見 [[方法B]]。",
    "長文件評測": "---\ntype: concept\nupdated: 2026-03-16\n---\n# 長文件評測\n兩種設定的結論相反（來源：raw/2026-03-09-blog-b.md）。相關：[[方法A]]",
}
raw_files = {"raw/2026-03-02-paper-a.md", "raw/2026-03-09-blog-b.md"}
for key, value in lint(pages, raw_files).items():
    print(key, value)
`,
    solution: String.raw`import re

LINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
CITE = re.compile(r"（來源：(raw/[^\s，）]+)")


def front_matter(text):
    """已寫好，不用改：把一頁拆成 (meta, body)。meta 例如 {"type": "concept", "sources": [...], "updated": "2026-03-16"}。"""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---" or "---" not in [l.strip() for l in lines[1:]]:
        return {}, text
    end = [l.strip() for l in lines[1:]].index("---") + 1
    meta, key = {}, None
    for line in lines[1:end]:
        if line.startswith("  - ") and key:
            meta.setdefault(key, [])
            if isinstance(meta[key], list):
                meta[key].append(line[4:].strip())
        elif ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            meta[key] = value.strip() if value.strip() else []
    return meta, "\n".join(lines[end + 1:])


def links(body):
    """已寫好，不用改：內文裡 [[頁面]] 與 [[頁面|顯示文字]] 連到的頁名（去掉前後空白）。"""
    return [m.strip() for m in LINK.findall(body) if m.strip()]


def citations(body):
    """已寫好，不用改：內文裡（來源：raw/xxx.md §3）這種引用的檔案路徑。"""
    return CITE.findall(body)


def lint(pages, raw_files):
    broken, linked, no_sources, missing_raw, unlisted = set(), set(), set(), set(), set()
    for name, text in pages.items():
        meta, body = front_matter(text)

        # 連結：斷鏈，以及「誰被其他頁連到」
        for target in links(body):
            if target not in pages:
                broken.add((name, target))
            elif target != name:                       # 自己連自己不算有人連進來
                linked.add(target)

        if name == "index":                            # 索引頁是入口，不檢查來源
            continue

        # 來源標記：頁首必填 sources，而且列的檔案要真的在 raw/ 裡
        sources = meta.get("sources") or []
        if not sources:
            no_sources.add(name)
        for path in sources:
            if path not in raw_files:
                missing_raw.add((name, path))
        # 內文的引用要和頁首對得上，lint 才追得到每個說法的出處
        for path in citations(body):
            if path not in sources:
                unlisted.add((name, path))

    orphans = [name for name in pages if name != "index" and name not in linked]
    return {"broken": sorted(broken), "orphans": sorted(orphans), "no_sources": sorted(no_sources),
            "missing_raw": sorted(missing_raw), "unlisted": sorted(unlisted)}


pages = {
    "index": "# 索引\n- [[方法A]]\n- [[長文件評測]]",
    "方法A": "---\ntype: entity\nsources:\n  - raw/2026-03-02-paper-a.md\nupdated: 2026-03-16\n---\n# 方法A\n在長文件上表現較好（來源：raw/2026-03-02-paper-a.md §4）。見 [[方法B]]。",
    "長文件評測": "---\ntype: concept\nupdated: 2026-03-16\n---\n# 長文件評測\n兩種設定的結論相反（來源：raw/2026-03-09-blog-b.md）。相關：[[方法A]]",
}
raw_files = {"raw/2026-03-02-paper-a.md", "raw/2026-03-09-blog-b.md"}
for key, value in lint(pages, raw_files).items():
    print(key, value)
`,
    tests: [
      { name: "斷鏈：目標不存在的連結要列出，去重、排序", code: String.raw`def _page(body, sources=("raw/a.md",)):
    head = "---\ntype: concept\nsources:\n" + "".join(f"  - {s}\n" for s in sources) + "updated: 2026-03-16\n---\n"
    return head + body
_pages = {"index": "- [[RAG]]\n- [[切段]]",
          "RAG": _page("見 [[切段]]、[[重新排序]] 與 [[重新排序|rerank]]。"),
          "切段": _page("回到 [[RAG]]，另見 [[Embedding]]。")}
_r = lint(_pages, {"raw/a.md"})
assert _r["broken"] == [("RAG", "重新排序"), ("切段", "Embedding")], _r["broken"]
assert _r["orphans"] == [], _r["orphans"]` },
      { name: "孤兒頁：沒有其他頁連進來才算；自己連自己不算；index 不算孤兒", code: String.raw`def _page(body, sources=("raw/a.md",)):
    head = "---\ntype: concept\nsources:\n" + "".join(f"  - {s}\n" for s in sources) + "updated: 2026-03-16\n---\n"
    return head + body
_pages = {"index": "- [[RAG]]",
          "RAG": _page("概念頁。"),
          "舊筆記": _page("這頁只連到自己：[[舊筆記]]，也提到 [[RAG]]。"),
          "摘要-paper-a": _page("沒有任何頁連到這裡。")}
_r = lint(_pages, {"raw/a.md"})
assert _r["orphans"] == ["摘要-paper-a", "舊筆記"], _r["orphans"]
assert _r["broken"] == [], _r["broken"]` },
      { name: "沒標來源：頁首沒有 sources、sources 是空的、完全沒有頁首；index 不檢查", code: String.raw`_pages = {"index": "- [[A]] [[B]] [[C]] [[D]]",
          "A": "---\ntype: concept\nsources:\n  - raw/a.md\nupdated: 2026-03-16\n---\n有來源。[[B]]",
          "B": "---\ntype: concept\nupdated: 2026-03-16\n---\n頁首沒有 sources。",
          "C": "---\ntype: entity\nsources:\nupdated: 2026-03-16\n---\nsources 是空的。",
          "D": "# D\n完全沒有頁首。"}
_r = lint(_pages, {"raw/a.md"})
assert _r["no_sources"] == ["B", "C", "D"], _r["no_sources"]
assert _r["missing_raw"] == [] and _r["unlisted"] == [], _r` },
      { name: "頁首 sources 列的檔案不在 raw/ 裡", code: String.raw`_pages = {"index": "- [[A]] [[B]]",
          "A": "---\ntype: concept\nsources:\n  - raw/2026-03-02-paper-a.md\n  - raw/2026-03-99-typo.md\nupdated: 2026-03-16\n---\n內容。",
          "B": "---\ntype: summary\nsources:\n  - notes/draft.md\n  - raw/2026-03-09-blog-b.md\nupdated: 2026-03-16\n---\n內容。"}
_r = lint(_pages, {"raw/2026-03-02-paper-a.md", "raw/2026-03-09-blog-b.md"})
assert _r["missing_raw"] == [("A", "raw/2026-03-99-typo.md"), ("B", "notes/draft.md")], _r["missing_raw"]
assert _r["no_sources"] == [], _r["no_sources"]` },
      { name: "內文引用了頁首沒列的 raw 檔：帶章節的引用也要認得，同一檔案只列一次", code: String.raw`_pages = {"index": "- [[長文件評測]]",
          "長文件評測": "---\ntype: concept\nsources:\n  - raw/2026-03-02-paper-a.md\nupdated: 2026-03-16\n---\n"
                        "- 藏一句關鍵資訊再提問（來源：raw/2026-03-02-paper-a.md §2）\n"
                        "- 需要整合多處資訊的問題（來源：raw/2026-03-09-blog-b.md）\n"
                        "- 另一種題型（來源：raw/2026-03-09-blog-b.md §5）\n"
                        "- 這一條還沒查證：未查證"}
_r = lint(_pages, {"raw/2026-03-02-paper-a.md", "raw/2026-03-09-blog-b.md"})
assert _r["unlisted"] == [("長文件評測", "raw/2026-03-09-blog-b.md")], _r["unlisted"]
assert _r["missing_raw"] == [] and _r["no_sources"] == [], _r` },
      { name: "乾淨的 wiki：五個鍵都在、都是空清單，而且 pages 沒被改動", code: String.raw`_pages = {"index": "- [[方法A]]\n- [[方法B]]",
          "方法A": "---\ntype: entity\nsources:\n  - raw/2026-03-02-paper-a.md\nupdated: 2026-03-16\n---\n表現較好（來源：raw/2026-03-02-paper-a.md §4）。見 [[方法B]]。",
          "方法B": "---\ntype: entity\nsources:\n  - raw/2026-03-09-blog-b.md\nupdated: 2026-03-16\n---\n結論相反（來源：raw/2026-03-09-blog-b.md）。見 [[方法A|另一種方法]]。"}
_before = dict(_pages)
_r = lint(_pages, {"raw/2026-03-02-paper-a.md", "raw/2026-03-09-blog-b.md"})
assert _r == {"broken": [], "orphans": [], "no_sources": [], "missing_raw": [], "unlisted": []}, _r
assert _pages == _before, "lint 只產生報告，不能修改 pages"
assert lint({}, set()) == {"broken": [], "orphans": [], "no_sources": [], "missing_raw": [], "unlisted": []}` },
    ],
    hints: [
      "先用 `front_matter(text)` 把每一頁拆成 `(meta, body)`，連結與引用都只從 `body` 找。",
      "孤兒頁：收集「被其他頁連到的頁名」的集合（來源頁和目標頁相同的不算），不在集合裡、又不是 `index` 的就是孤兒。",
      "`unlisted` 比的是 `citations(body)` 和這一頁自己的 `meta.get(\"sources\", [])`；`missing_raw` 比的是頁首的 `sources` 和 `raw_files`。",
    ],
  },
  {
    id: 'knowledge-choice-1', skill: 'knowledge-choice', kind: 'python', level: 2,
    title: "recommend：照判斷順序決定用 wiki、RAG 還是直接查詢",
    prompt: "實作 `recommend(req)`：依一批資料的性質，照課文的判斷順序決定做法。回傳 `{\"use\": [...], \"deploy\": ..., \"reasons\": [...]}`。\n\n`req` 的欄位：`docs`（文件數）、`update`（`\"daily\"`、`\"weekly\"`、`\"yearly\"`）、`per_user_access`（不同人能看的範圍不同）、`sensitive`（含個資或營業秘密）、`external_ok`（政策允許送到外部模型）、`structured`（是資料庫裡的結構化資料）、`high_cost`（答錯代價高）、`hot`（問題集中在少數主題）。\n\n依下面的順序判斷，命中就把理由代碼依序加進 `reasons`：\n\n- `per_user_access` → `ACL_AT_RETRIEVAL`：權限要做在檢索層，這批資料不能合併進共用的 wiki\n- `sensitive` 而且不是 `external_ok` → `NO_EXTERNAL`，`deploy` 是 `\"internal\"`；其他情況 `deploy` 是 `\"any\"`\n- `update` 是 `\"daily\"` → `CHANGES_DAILY`：不做成 wiki\n- `structured` → `STRUCTURED_QUERY`：直接用有權限控管的查詢回答，`use` 就是 `[\"db_query\"]`，後面兩條不用再看\n- `docs` 超過 `WIKI_MAX_DOCS` → `LONG_TAIL`：整批放不進一份 wiki，長尾要靠 RAG\n- `high_cost` 而且 `hot`，wiki 又沒有在前面被排除 → `REVIEWED_WIKI`：高頻題整理成審核過的 wiki 頁\n\n`use` 的內容：有 `REVIEWED_WIKI` 就放 `\"wiki\"`；`\"rag\"` 是預設做法，只有「用了 wiki 而且文件數沒超過 `WIKI_MAX_DOCS`」時不需要。兩者都有時 wiki 在前（先查 wiki，不夠再查 RAG）。\n\n`WIKI_MAX_DOCS` 是這一題約定的門檻，代表「整理後放得進長上下文」的量級。",
    starter: String.raw`WIKI_MAX_DOCS = 300     # 本題約定：超過這個數量，整批資料放不進一份 wiki


def recommend(req):
    # TODO：現在只看文件數；權限、敏感資料、更新頻率、結構化資料、答錯代價都沒看
    if req["docs"] <= WIKI_MAX_DOCS:
        return {"use": ["wiki"], "deploy": "any", "reasons": []}
    return {"use": ["rag"], "deploy": "any", "reasons": ["LONG_TAIL"]}


# 試跑：診所的三種資料
sop = {"docs": 40, "update": "yearly", "per_user_access": False, "sensitive": False, "external_ok": True,
       "structured": False, "high_cost": True, "hot": True}
letters = dict(sop, docs=5000, update="weekly", high_cost=False, hot=False)
records = dict(sop, docs=20000, update="daily", per_user_access=True, sensitive=True, external_ok=False, structured=True)
for name, req in [("SOP 與制度", sop), ("往來文件", letters), ("病歷", records)]:
    print(name, recommend(req))
`,
    solution: String.raw`WIKI_MAX_DOCS = 300     # 本題約定：超過這個數量，整批資料放不進一份 wiki


def recommend(req):
    reasons = []
    deploy = "any"
    wiki_ok = True

    # 1. 誰能看：權限因人而異，就要在檢索層過濾，不能合併進共用的 wiki
    if req["per_user_access"]:
        reasons.append("ACL_AT_RETRIEVAL")
        wiki_ok = False
    # 2. 能不能送到外部模型
    if req["sensitive"] and not req["external_ok"]:
        reasons.append("NO_EXTERNAL")
        deploy = "internal"
    # 3. 多常變：每天變的資料不做成 wiki
    if req["update"] == "daily":
        reasons.append("CHANGES_DAILY")
        wiki_ok = False
    # 結構化資料直接查，不經過 RAG 也不做 wiki
    if req["structured"]:
        reasons.append("STRUCTURED_QUERY")
        return {"use": ["db_query"], "deploy": deploy, "reasons": reasons}
    # 4. 多少：放不進長上下文的長尾交給 RAG
    fits = req["docs"] <= WIKI_MAX_DOCS
    if not fits:
        reasons.append("LONG_TAIL")
    # 5. 答錯的代價：高代價又集中的問題，值得整理成審核過的 wiki 頁
    use = []
    if wiki_ok and req["high_cost"] and req["hot"]:
        reasons.append("REVIEWED_WIKI")
        use.append("wiki")
    if not (use and fits):
        use.append("rag")
    return {"use": use, "deploy": deploy, "reasons": reasons}


# 試跑：診所的三種資料
sop = {"docs": 40, "update": "yearly", "per_user_access": False, "sensitive": False, "external_ok": True,
       "structured": False, "high_cost": True, "hot": True}
letters = dict(sop, docs=5000, update="weekly", high_cost=False, hot=False)
records = dict(sop, docs=20000, update="daily", per_user_access=True, sensitive=True, external_ok=False, structured=True)
for name, req in [("SOP 與制度", sop), ("往來文件", letters), ("病歷", records)]:
    print(name, recommend(req))
`,
    tests: [
      { name: "SOP 與制度：量少、穩定、答錯代價高又集中 → 只用審核過的 wiki", code: String.raw`_base = {"docs": 40, "update": "yearly", "per_user_access": False, "sensitive": False, "external_ok": True,
         "structured": False, "high_cost": True, "hot": True}
_r = recommend(_base)
assert _r == {"use": ["wiki"], "deploy": "any", "reasons": ["REVIEWED_WIKI"]}, _r
_r = recommend(dict(_base, docs=300))
assert _r["use"] == ["wiki"], f"剛好等於門檻還放得進 wiki：{_r}"` },
      { name: "大量長尾文件 → RAG；其中高頻、高代價的題目再加一層 wiki（wiki 在前）", code: String.raw`_base = {"docs": 5000, "update": "weekly", "per_user_access": False, "sensitive": False, "external_ok": True,
         "structured": False, "high_cost": False, "hot": False}
_r = recommend(_base)
assert _r == {"use": ["rag"], "deploy": "any", "reasons": ["LONG_TAIL"]}, _r
_r = recommend(dict(_base, high_cost=True, hot=True))
assert _r == {"use": ["wiki", "rag"], "deploy": "any", "reasons": ["LONG_TAIL", "REVIEWED_WIKI"]}, _r
_r = recommend(dict(_base, docs=301, high_cost=True, hot=True))
assert _r["use"] == ["wiki", "rag"], f"超過門檻一份也要有 RAG：{_r}"` },
      { name: "病歷：權限因人而異、不能外送、每天變、結構化 → 直接查詢，理由依判斷順序", code: String.raw`_req = {"docs": 20000, "update": "daily", "per_user_access": True, "sensitive": True, "external_ok": False,
        "structured": True, "high_cost": True, "hot": True}
_r = recommend(_req)
assert _r == {"use": ["db_query"], "deploy": "internal",
              "reasons": ["ACL_AT_RETRIEVAL", "NO_EXTERNAL", "CHANGES_DAILY", "STRUCTURED_QUERY"]}, _r
_r = recommend(dict(_req, docs=10, update="yearly", per_user_access=False, sensitive=False))
assert _r == {"use": ["db_query"], "deploy": "any", "reasons": ["STRUCTURED_QUERY"]}, _r` },
      { name: "權限因人而異或每天變動：就算量少、代價高也不做成 wiki", code: String.raw`_base = {"docs": 40, "update": "yearly", "per_user_access": False, "sensitive": False, "external_ok": True,
         "structured": False, "high_cost": True, "hot": True}
_r = recommend(dict(_base, per_user_access=True))
assert _r == {"use": ["rag"], "deploy": "any", "reasons": ["ACL_AT_RETRIEVAL"]}, _r
_r = recommend(dict(_base, update="daily"))
assert _r == {"use": ["rag"], "deploy": "any", "reasons": ["CHANGES_DAILY"]}, _r
_r = recommend(dict(_base, per_user_access=True, update="daily", docs=5000))
assert _r == {"use": ["rag"], "deploy": "any", "reasons": ["ACL_AT_RETRIEVAL", "CHANGES_DAILY", "LONG_TAIL"]}, _r` },
      { name: "敏感資料：政策不允許外送才限定內部部署；允許時不受限", code: String.raw`_base = {"docs": 40, "update": "yearly", "per_user_access": False, "sensitive": True, "external_ok": False,
         "structured": False, "high_cost": True, "hot": True}
_r = recommend(_base)
assert _r == {"use": ["wiki"], "deploy": "internal", "reasons": ["NO_EXTERNAL", "REVIEWED_WIKI"]}, _r
assert recommend(dict(_base, external_ok=True))["deploy"] == "any"
assert recommend(dict(_base, sensitive=False))["deploy"] == "any", "不敏感的資料不受 external_ok 影響"` },
      { name: "預設做法是 RAG：量少但代價不高、或問題不集中，不值得整理成 wiki", code: String.raw`_base = {"docs": 40, "update": "weekly", "per_user_access": False, "sensitive": False, "external_ok": True,
         "structured": False, "high_cost": False, "hot": False}
assert recommend(_base) == {"use": ["rag"], "deploy": "any", "reasons": []}, recommend(_base)
assert recommend(dict(_base, high_cost=True)) == {"use": ["rag"], "deploy": "any", "reasons": []}
assert recommend(dict(_base, hot=True)) == {"use": ["rag"], "deploy": "any", "reasons": []}` },
    ],
    hints: [
      "用一個 `wiki_ok = True` 的旗標：遇到「權限因人而異」或「每天變」就設成 `False`，最後再和「答錯代價高且問題集中」一起決定要不要 wiki。",
      "結構化資料是提早 `return` 的分支：`use` 只有 `db_query`，但在它之前已經記下的理由要保留。",
      "RAG 是預設值，只有一種情況不需要：選了 wiki，而且 `docs <= WIKI_MAX_DOCS`。",
    ],
  },
  {
    id: 'knowledge-poisoning-1', skill: 'knowledge-poisoning', kind: 'python', level: 2,
    title: "檢索結果進 context 之前：權限過濾、來源分級、包成資料區塊",
    prompt: "檢索到的段落在放進 prompt 之前要先處理。實作 `build_context(chunks, user_roles, allowed_tiers=(\"A\", \"B\"))`，回傳 `{\"context\": 字串, \"sources\": [...], \"dropped\": [...]}`。\n\n每個段落是 dict：`id`、`text`、`source`（原始檔路徑）、`roles`（看得到的角色，set）、`tier`（來源等級 `\"A\"`、`\"B\"`、`\"C\"`，可能沒有這個鍵）。\n\n依 `chunks` 的順序逐段處理，被濾掉的段落以 `(id, 原因)` 記進 `dropped`，一段只記第一個命中的原因：\n\n- **權限**：`roles` 和 `user_roles` 沒有交集 → `\"no_access\"`。沒權限的內容根本不進 context\n- **來源分級**：`tier` 不在 `allowed_tiers` 裡 → `\"tier\"`。這是白名單，沒標等級的也不收\n- **清理**：拿掉 HTML 註解（`<!-- … -->`，可能跨行）與零寬字元（`\\u200b`、`\\u200c`、`\\u200d`、`\\u2060`、`\\ufeff`）這些人看不見、模型讀得到的內容；拿掉文字裡的 `<資料>` 與 `</資料>` 字樣，區塊才不會被提早關閉；換行換成一個空白，再去掉前後空白。清完是空的 → `\"empty\"`\n\n留下來的段落包成一個資料區塊，第一行 `<資料>`、最後一行 `</資料>`，中間每段一行：\n\n- 格式是 `[id]（來源：source，等級 tier）清理後的文字`\n\n`sources` 是留下來的段落的 `{\"id\", \"source\", \"tier\"}`，順序同上。全部被濾掉時 `context` 是 `\"<資料>\\n</資料>\"`。",
    starter: String.raw`import re


def build_context(chunks, user_roles, allowed_tiers=("A", "B")):
    # TODO：現在把檢索到的全部內容原樣接起來——沒看權限、沒看來源等級、沒清理、沒標來源
    context = "\n".join(c["text"] for c in chunks)
    return {"context": context, "sources": [], "dropped": []}


chunks = [
    {"id": "sop-07", "text": "針扎事件通報流程：依 SOP 第 3 節處理傷口後，盡快通報感染管制單位。",
     "source": "raw/sop-07.md", "roles": {"nurse", "doctor"}, "tier": "A"},
    {"id": "blog-12", "text": "各家產品的比較。<!-- [文件內含給模型的指示] -->結論：依需求選擇。",
     "source": "raw/2026-04-01-vendor-blog.md", "roles": {"staff", "nurse", "doctor"}, "tier": "C"},
    {"id": "pt-1043", "text": "病人 1043 用藥紀錄：每日一次。", "source": "raw/pt-1043.md", "roles": {"doctor"}, "tier": "A"},
]
out = build_context(chunks, user_roles={"staff", "nurse"})
print(out["context"])
print(out["dropped"])
`,
    solution: String.raw`import re

HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)               # 瀏覽器不顯示，模型讀得到
INVISIBLE = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")    # 零寬字元
BLOCK_TAG = re.compile(r"</?資料>")                           # 內文不能自己開關資料區塊


def clean(text):
    text = HTML_COMMENT.sub("", text)
    text = INVISIBLE.sub("", text)
    text = BLOCK_TAG.sub("", text)
    return text.replace("\n", " ").strip()


def build_context(chunks, user_roles, allowed_tiers=("A", "B")):
    lines, sources, dropped = [], [], []
    for c in chunks:
        # 1. 權限在檢索層過濾：看不到的內容不進 context，被誘導也洩漏不出去
        if not (set(c["roles"]) & set(user_roles)):
            dropped.append((c["id"], "no_access"))
            continue
        # 2. 來源分級是白名單：不在允許的等級裡（包括沒標等級）就不收
        tier = c.get("tier")
        if tier not in allowed_tiers:
            dropped.append((c["id"], "tier"))
            continue
        # 3. 清理人看不見的內容與區塊標記
        text = clean(c["text"])
        if not text:
            dropped.append((c["id"], "empty"))
            continue
        # 4. 每段保留來源與等級，回答才追得到出處
        lines.append(f"[{c['id']}]（來源：{c['source']}，等級 {tier}）{text}")
        sources.append({"id": c["id"], "source": c["source"], "tier": tier})
    context = "\n".join(["<資料>"] + lines + ["</資料>"])
    return {"context": context, "sources": sources, "dropped": dropped}


chunks = [
    {"id": "sop-07", "text": "針扎事件通報流程：依 SOP 第 3 節處理傷口後，盡快通報感染管制單位。",
     "source": "raw/sop-07.md", "roles": {"nurse", "doctor"}, "tier": "A"},
    {"id": "blog-12", "text": "各家產品的比較。<!-- [文件內含給模型的指示] -->結論：依需求選擇。",
     "source": "raw/2026-04-01-vendor-blog.md", "roles": {"staff", "nurse", "doctor"}, "tier": "C"},
    {"id": "pt-1043", "text": "病人 1043 用藥紀錄：每日一次。", "source": "raw/pt-1043.md", "roles": {"doctor"}, "tier": "A"},
]
out = build_context(chunks, user_roles={"staff", "nurse"})
print(out["context"])
print(out["dropped"])
`,
    tests: [
      { name: "包成資料區塊：每段一行，保留編號、來源與等級", code: String.raw`_chunks = [
    {"id": "sop-07", "text": "針扎事件通報流程：依 SOP 第 3 節處理傷口。", "source": "raw/sop-07.md", "roles": {"nurse", "doctor"}, "tier": "A"},
    {"id": "std-02", "text": "感染管制指引\n第 5 章：通報時限。", "source": "raw/guideline-02.md", "roles": {"nurse"}, "tier": "B"},
]
_r = build_context(_chunks, {"nurse"})
assert _r["context"] == ("<資料>\n"
                         "[sop-07]（來源：raw/sop-07.md，等級 A）針扎事件通報流程：依 SOP 第 3 節處理傷口。\n"
                         "[std-02]（來源：raw/guideline-02.md，等級 B）感染管制指引 第 5 章：通報時限。\n"
                         "</資料>"), _r["context"]
assert _r["sources"] == [{"id": "sop-07", "source": "raw/sop-07.md", "tier": "A"},
                         {"id": "std-02", "source": "raw/guideline-02.md", "tier": "B"}], _r["sources"]
assert _r["dropped"] == [], _r["dropped"]` },
      { name: "權限：沒有交集的段落不進 context，而且權限排在來源分級之前", code: String.raw`_chunks = [
    {"id": "hr-02", "text": "特休計算：依年資給假。", "source": "raw/hr-02.md", "roles": {"staff"}, "tier": "A"},
    {"id": "pt-1043", "text": "病人 1043 用藥紀錄：每日一次。", "source": "raw/pt-1043.md", "roles": {"doctor"}, "tier": "A"},
    {"id": "pt-note", "text": "未分級的個案紀錄。", "source": "raw/pt-note.md", "roles": {"doctor"}},
]
_r = build_context(_chunks, {"staff", "nurse"})
assert "1043" not in _r["context"] and "個案" not in _r["context"], _r["context"]
assert [s["id"] for s in _r["sources"]] == ["hr-02"], _r["sources"]
assert _r["dropped"] == [("pt-1043", "no_access"), ("pt-note", "no_access")], _r["dropped"]
assert [s["id"] for s in build_context(_chunks, {"doctor"})["sources"]] == ["pt-1043"]` },
      { name: "來源分級是白名單：等級 C、沒標等級、不在 allowed_tiers 裡的都不收", code: String.raw`_chunks = [
    {"id": "a", "text": "內部 SOP。", "source": "raw/a.md", "roles": {"staff"}, "tier": "A"},
    {"id": "b", "text": "官方文件。", "source": "raw/b.md", "roles": {"staff"}, "tier": "B"},
    {"id": "c", "text": "論壇貼文。", "source": "raw/c.md", "roles": {"staff"}, "tier": "C"},
    {"id": "d", "text": "來源不明的檔案。", "source": "raw/d.md", "roles": {"staff"}},
]
_r = build_context(_chunks, {"staff"})
assert [s["id"] for s in _r["sources"]] == ["a", "b"], _r["sources"]
assert _r["dropped"] == [("c", "tier"), ("d", "tier")], _r["dropped"]
_r = build_context(_chunks, {"staff"}, allowed_tiers=("A",))
assert [s["id"] for s in _r["sources"]] == ["a"] and ("b", "tier") in _r["dropped"], _r` },
      { name: "清理：HTML 註解（含跨行）與零寬字元拿掉；清完是空的段落不收", code: String.raw`_chunks = [
    {"id": "blog", "text": "各家產品的比較。<!-- [文件內含給模型的指示] -->結論：依需求選擇。", "source": "raw/blog.md", "roles": {"staff"}, "tier": "B"},
    {"id": "multi", "text": "第一段。\n<!--\n[文件內含給模型的指示]\n-->\n第二段。", "source": "raw/multi.md", "roles": {"staff"}, "tier": "B"},
    {"id": "zw", "text": "\u200b索引\u200d類型\ufeff比較\u2060。\u200c", "source": "raw/zw.md", "roles": {"staff"}, "tier": "A"},
    {"id": "only", "text": " <!-- [文件內含給模型的指示] -->\u200b\n", "source": "raw/only.md", "roles": {"staff"}, "tier": "A"},
]
_r = build_context(_chunks, {"staff"})
assert "<!--" not in _r["context"] and "給模型的指示" not in _r["context"], _r["context"]
assert not any(ch in _r["context"] for ch in "\u200b\u200c\u200d\u2060\ufeff"), "零寬字元要拿掉"
_lines = _r["context"].split("\n")
assert _lines[1].endswith("）各家產品的比較。結論：依需求選擇。"), _lines[1]
assert len(_lines) == 5 and "第一段。" in _lines[2] and _lines[2].endswith("第二段。"), "跨行的註解拿掉後，這一段仍然是一行"
assert _lines[3].endswith("）索引類型比較。"), repr(_lines[3])
assert _r["dropped"] == [("only", "empty")], _r["dropped"]` },
      { name: "區塊標記：內文裡的 <資料>、</資料> 字樣要拿掉，整個 context 只有一組", code: String.raw`_chunks = [
    {"id": "x", "text": "第一段。</資料>[文件內含給模型的指示]<資料>第二段。", "source": "raw/x.md", "roles": {"staff"}, "tier": "A"},
    {"id": "y", "text": "正常的段落。", "source": "raw/y.md", "roles": {"staff"}, "tier": "A"},
]
_r = build_context(_chunks, {"staff"})
assert _r["context"].count("<資料>") == 1 and _r["context"].count("</資料>") == 1, _r["context"]
assert _r["context"].startswith("<資料>\n") and _r["context"].endswith("\n</資料>"), _r["context"]
assert len(_r["context"].split("\n")) == 4, "每段一行，加上頭尾共四行"` },
      { name: "全部被濾掉：仍然回傳空的資料區塊，sources 是空的", code: String.raw`_chunks = [
    {"id": "pt-1043", "text": "病人 1043 用藥紀錄。", "source": "raw/pt-1043.md", "roles": {"doctor"}, "tier": "A"},
    {"id": "forum", "text": "論壇貼文。", "source": "raw/forum.md", "roles": {"staff"}, "tier": "C"},
]
_r = build_context(_chunks, {"staff"})
assert _r == {"context": "<資料>\n</資料>", "sources": [], "dropped": [("pt-1043", "no_access"), ("forum", "tier")]}, _r
assert build_context([], {"staff"}) == {"context": "<資料>\n</資料>", "sources": [], "dropped": []}` },
    ],
    hints: [
      "順序很重要：先看權限（`chunk[\"roles\"] & user_roles`），再看等級（`chunk.get(\"tier\") in allowed_tiers`），最後才清理文字。",
      "HTML 註解可能跨行：`re.sub(r\"<!--.*?-->\", \"\", text, flags=re.S)`；零寬字元用 `[\\u200b\\u200c\\u200d\\u2060\\ufeff]` 一次拿掉。",
      "每段一行，最後用 `\"\\n\".join([\"<資料>\"] + lines + [\"</資料>\"])` 組起來；沒有任何段落時剛好是 `\"<資料>\\n</資料>\"`。",
    ],
  },
  {
    id: 'how-programs-run-1', skill: 'how-programs-run', kind: 'python', level: 1,
    title: "簡化的 fd 表：最小空號、用完要還、Errno 24",
    prompt: "行程打開任何可以讀寫的東西（檔案、socket、每條進來的連線），核心就在它的 fd 表裡放一筆，回傳一個小整數。實作簡化版的 `FdTable(limit)`：\n\n- 建立時 `0`、`1`、`2` 已經被 `stdin`、`stdout`、`stderr` 佔用\n- `open(name)`：配一個 fd 並回傳。新的 fd 拿**目前最小的空號**。已開啟的數量達到 `limit`（含 0、1、2）時 `raise OSError(24, \"Too many open files\")`\n- `close(fd)`：把號碼還回去。這個 fd 沒開著就 `raise OSError(9, \"Bad file descriptor\")`\n- `open_fds()`：回傳目前開著的 fd，由小到大\n- `opened(name)`：給 `with` 用的版本。進入區塊時開、離開時一定關，區塊裡丟例外也一樣；`with table.opened(\"app.log\") as fd:` 的 `fd` 就是配到的號碼\n\n起始碼的號碼只會一直往上長、沒有上限，`opened` 在中途丟例外時也不會關。",
    starter: String.raw`from contextlib import contextmanager


class FdTable:
    def __init__(self, limit=1024):
        self.limit = limit
        self.table = {0: "stdin", 1: "stdout", 2: "stderr"}
        self.next_fd = 3

    def open(self, name):
        # TODO：要拿目前最小的空號；數量到上限要丟 OSError(24, ...)
        fd = self.next_fd
        self.next_fd += 1
        self.table[fd] = name
        return fd

    def close(self, fd):
        # TODO：沒開著的 fd 要丟 OSError(9, ...)
        self.table.pop(fd, None)

    def open_fds(self):
        return sorted(self.table)

    @contextmanager
    def opened(self, name):
        # TODO：區塊裡丟例外時也要關
        fd = self.open(name)
        yield fd
        self.close(fd)


table = FdTable(limit=8)
fds = [table.open(f"conn-{i}") for i in range(3)]
print("開了三條連線：", fds)                 # [3, 4, 5]
table.close(fds[1])
print("關掉 4 之後再開：", table.open("conn-x"))   # 拿到目前最小的空號 4
`,
    solution: String.raw`from contextlib import contextmanager


class FdTable:
    def __init__(self, limit=1024):
        self.limit = limit
        self.table = {0: "stdin", 1: "stdout", 2: "stderr"}

    def open(self, name):
        if len(self.table) >= self.limit:
            raise OSError(24, "Too many open files")      # fd 用完：先查有沒有洩漏，再考慮調上限
        fd = 0
        while fd in self.table:                            # 目前最小的空號
            fd += 1
        self.table[fd] = name
        return fd

    def close(self, fd):
        if fd not in self.table:
            raise OSError(9, "Bad file descriptor")
        del self.table[fd]

    def open_fds(self):
        return sorted(self.table)

    @contextmanager
    def opened(self, name):
        fd = self.open(name)
        try:
            yield fd
        finally:
            self.close(fd)                                 # 中途丟例外也一定會關


table = FdTable(limit=8)
fds = [table.open(f"conn-{i}") for i in range(3)]
print("開了三條連線：", fds)                 # [3, 4, 5]
table.close(fds[1])
print("關掉 4 之後再開：", table.open("conn-x"))   # 拿到目前最小的空號 4
`,
    tests: [
      { name: "0、1、2 已被佔用，新的 fd 從 3 起跳、依序往上", code: String.raw`_t = FdTable(limit=16)
assert _t.open_fds() == [0, 1, 2], _t.open_fds()
assert [_t.open(f"conn-{i}") for i in range(3)] == [3, 4, 5]
assert _t.open_fds() == [0, 1, 2, 3, 4, 5], _t.open_fds()` },
      { name: "關掉之後再開：拿到目前最小的空號", code: String.raw`_t = FdTable(limit=16)
_fds = [_t.open(f"conn-{i}") for i in range(5)]          # 3..7
_t.close(6)
_t.close(4)
assert _t.open_fds() == [0, 1, 2, 3, 5, 7], _t.open_fds()
assert _t.open("a") == 4, "有 4 和 6 兩個空號時要拿 4"
assert _t.open("b") == 6
assert _t.open("c") == 8
_t.close(0)
assert _t.open("d") == 0, "0 被關掉之後也是空號"` },
      { name: "達到上限丟 OSError，errno 是 24；還回一個之後又能開", code: String.raw`_t = FdTable(limit=6)
assert [_t.open("c") for _ in range(3)] == [3, 4, 5]     # 含 0、1、2 共 6 個
try:
    _t.open("one-too-many")
    raise AssertionError("超過上限沒有丟 OSError")
except OSError as e:
    assert e.errno == 24, e.errno
assert _t.open_fds() == [0, 1, 2, 3, 4, 5], "開失敗不能留下任何東西"
_t.close(4)
assert _t.open("again") == 4` },
      { name: "關一個沒開著的 fd：OSError，errno 是 9（重複關同一個也是）", code: String.raw`_t = FdTable(limit=16)
_fd = _t.open("app.log")
_t.close(_fd)
for _bad in (_fd, 99):
    try:
        _t.close(_bad)
        raise AssertionError(f"close({_bad}) 沒有丟 OSError")
    except OSError as e:
        assert e.errno == 9, e.errno
assert _t.open_fds() == [0, 1, 2]` },
      { name: "with 版本：離開區塊就還回去，所以每次都拿到同一個號碼", code: String.raw`_t = FdTable(limit=16)
_seen = []
for _i in range(3):
    with _t.opened("app.log") as _fd:
        _seen.append(_fd)
        assert _fd in _t.open_fds()
assert _seen == [3, 3, 3], _seen
assert _t.open_fds() == [0, 1, 2], _t.open_fds()` },
      { name: "with 區塊裡丟例外也會關：不洩漏 fd，例外照樣往外傳", code: String.raw`_t = FdTable(limit=5)                                     # 只剩兩個空位
for _i in range(10):
    try:
        with _t.opened(f"request-{_i}") as _fd:
            raise ValueError("處理請求時出錯")
    except ValueError:
        pass
assert _t.open_fds() == [0, 1, 2], f"出錯的請求沒有把 fd 還回去：{_t.open_fds()}"` },
    ],
    hints: [
      "用一個 dict 存 `{fd: 名稱}`。找最小空號：從 0 開始往上數，第一個不在 dict 裡的就是。",
      "上限檢查要在配號之前：`len(self.table) >= self.limit` 就 `raise OSError(24, \"Too many open files\")`。",
      "`opened` 用 `try / finally`：`fd = self.open(name)`、`try: yield fd`、`finally: self.close(fd)`，區塊裡丟例外也會關。",
    ],
  },
  {
    id: 'http2-http3-1', skill: 'http2-http3', kind: 'js', level: 2,
    title: "兩種隊頭阻塞：算出 HTTP/1.1、HTTP/2、HTTP/3 各請求的完成時間",
    prompt: "實作 `finishTimes(durations, options)`，算出一批請求各自的完成時間（ms）。`durations[i]` 是第 i 個請求的回應需要傳多久；所有請求在時間 0 就準備好，依陣列順序送出。回傳和 `durations` 同順序的陣列，不要改動 `durations`。\n\n`options.protocol` 決定排隊方式：\n\n- `'h1'`：有 `options.connections` 條連線（沒給就是 6）。每條連線一次只能處理一個請求，回應收完才能送下一個；依序把請求交給最早空出來的連線。完成時間 = 開始時間 + 傳輸時間\n- `'h2'`、`'h3'`：一條連線多工，全部從時間 0 開始，各自在自己的傳輸時間完成（這一題不考慮頻寬分配）\n- 其他值丟 `Error`\n\n`options.loss`（可以沒有）是 `{ request, at, delay }`：時間 `at` 時，第 `request` 個請求的一個封包遺失，重傳多花 `delay` ms。只有那個請求當時正在傳輸（已開始、還沒完成）才有影響：\n\n- `'h1'`：那個請求晚 `delay` 完成，同一條連線上排在它後面的請求跟著往後；其他連線不受影響\n- `'h2'`：所有 stream 共用一條 TCP 連線，`at` 時還沒完成的 stream **全部**晚 `delay`\n- `'h3'`：QUIC 的 stream 各自獨立，只有那個請求晚 `delay`",
    starter: String.raw`function finishTimes(durations, options) {
  const { protocol } = options
  // TODO：h1 現在只當成一條連線；多條連線、封包遺失、不認得的 protocol 都還沒處理
  if (protocol === 'h1') {
    let t = 0
    return durations.map((d) => (t += d))
  }
  return [...durations]
}

// 試跑：一支 2 秒的報表 API 排在最前面
const durations = [2000, 100, 100, 100]
console.log('HTTP/1.1 一條連線：', finishTimes(durations, { protocol: 'h1', connections: 1 }))   // 預期 [2000, 2100, 2200, 2300]
console.log('HTTP/1.1 兩條連線：', finishTimes(durations, { protocol: 'h1', connections: 2 }))   // 預期 [2000, 100, 200, 300]
console.log('HTTP/2 多工：     ', finishTimes(durations, { protocol: 'h2' }))                    // 預期 [2000, 100, 100, 100]
`,
    solution: String.raw`function finishTimes(durations, options) {
  const { protocol, connections = 6, loss = null } = options
  // 封包遺失只在「那個請求正在傳輸」時才有影響
  const hit = (i, start, finish) => loss !== null && loss.request === i && start <= loss.at && loss.at < finish

  if (protocol === 'h1') {
    // HTTP 層的隊頭阻塞：每條連線一問一答，後面的請求要等連線空出來
    const freeAt = new Array(connections).fill(0)
    return durations.map((d, i) => {
      const c = freeAt.indexOf(Math.min(...freeAt))          // 最早空出來的連線
      const start = freeAt[c]
      let finish = start + d
      if (hit(i, start, finish)) finish += loss.delay        // 只卡這條連線，排在後面的自然跟著晚
      freeAt[c] = finish
      return finish
    })
  }

  if (protocol === 'h2' || protocol === 'h3') {
    // 多工：全部從 0 開始，各自完成
    const lossActive = loss !== null && hit(loss.request, 0, durations[loss.request])
    return durations.map((d, i) => {
      if (!lossActive) return d
      // TCP 層的隊頭阻塞：h2 所有還在傳的 stream 一起等重傳；h3 只有遺失封包的那條 stream 等
      const stalled = protocol === 'h2' ? loss.at < d : i === loss.request
      return stalled ? d + loss.delay : d
    })
  }

  throw new Error('不認得的 protocol：' + protocol)
}

// 試跑：一支 2 秒的報表 API 排在最前面
const durations = [2000, 100, 100, 100]
console.log('HTTP/1.1 一條連線：', finishTimes(durations, { protocol: 'h1', connections: 1 }))   // 預期 [2000, 2100, 2200, 2300]
console.log('HTTP/1.1 兩條連線：', finishTimes(durations, { protocol: 'h1', connections: 2 }))   // 預期 [2000, 100, 200, 300]
console.log('HTTP/2 多工：     ', finishTimes(durations, { protocol: 'h2' }))                    // 預期 [2000, 100, 100, 100]
`,
    tests: [
      { name: "HTTP/1.1 一條連線：慢的回應擋住後面所有請求", code: String.raw`assertEqual(finishTimes([2000, 100, 100, 100], { protocol: 'h1', connections: 1 }), [2000, 2100, 2200, 2300])
assertEqual(finishTimes([100, 100, 2000, 100], { protocol: 'h1', connections: 1 }), [100, 200, 2200, 2300])
assertEqual(finishTimes([], { protocol: 'h1', connections: 1 }), [])` },
      { name: "HTTP/1.1 多條連線：交給最早空出來的連線；預設 6 條，用完還是要排隊", code: String.raw`assertEqual(finishTimes([2000, 100, 100, 100], { protocol: 'h1', connections: 2 }), [2000, 100, 200, 300])
assertEqual(finishTimes([300, 100, 100, 100, 100], { protocol: 'h1', connections: 2 }), [300, 100, 200, 300, 400])
assertEqual(finishTimes([100, 100, 100, 100, 100, 100, 100, 100], { protocol: 'h1' }), [100, 100, 100, 100, 100, 100, 200, 200], '沒給 connections 時是 6 條')
const d = [50, 60, 70]
finishTimes(d, { protocol: 'h1', connections: 2 })
assertEqual(d, [50, 60, 70], '不能改動傳進來的 durations')` },
      { name: "HTTP/2 與 HTTP/3 多工：各自完成，慢的不擋別人", code: String.raw`assertEqual(finishTimes([2000, 100, 100, 100], { protocol: 'h2' }), [2000, 100, 100, 100])
assertEqual(finishTimes([2000, 100, 100, 100], { protocol: 'h3' }), [2000, 100, 100, 100])
assertEqual(finishTimes(new Array(80).fill(30), { protocol: 'h2' }), new Array(80).fill(30), '80 個請求同時進行')` },
      { name: "封包遺失：HTTP/2 還在傳的 stream 全部一起晚，HTTP/3 只有那一條晚", code: String.raw`const loss = { request: 1, at: 100, delay: 100 }
assertEqual(finishTimes([50, 300, 200, 100], { protocol: 'h2', loss }), [50, 400, 300, 100], 'h2：at 時還沒完成的都被拖住')
assertEqual(finishTimes([50, 300, 200, 100], { protocol: 'h3', loss }), [50, 400, 200, 100], 'h3：只有 request 1')
assertEqual(finishTimes([300, 300, 300], { protocol: 'h2', loss: { request: 0, at: 0, delay: 40 } }), [340, 340, 340])
assertEqual(finishTimes([300, 300, 300], { protocol: 'h3', loss: { request: 0, at: 0, delay: 40 } }), [340, 300, 300])` },
      { name: "封包遺失在 HTTP/1.1：只卡那條連線，排在它後面的跟著晚", code: String.raw`const loss = { request: 0, at: 100, delay: 100 }
assertEqual(finishTimes([300, 300, 300], { protocol: 'h1', connections: 3, loss }), [400, 300, 300], '三條連線：其他兩條不受影響')
assertEqual(finishTimes([300, 300, 300], { protocol: 'h1', connections: 1, loss }), [400, 700, 1000], '一條連線：後面全部往後')
assertEqual(finishTimes([300, 100, 100, 100, 100], { protocol: 'h1', connections: 2, loss }), [400, 100, 200, 300, 400], '被卡住的連線空不出來，後面的請求都走另一條')` },
      { name: "邊界：遺失時那個請求已經傳完或還沒開始就沒有影響；不認得的 protocol 丟 Error", code: String.raw`assertEqual(finishTimes([50, 300], { protocol: 'h2', loss: { request: 0, at: 100, delay: 100 } }), [50, 300], 'h2：request 0 在 50 就傳完了')
assertEqual(finishTimes([50, 300], { protocol: 'h3', loss: { request: 0, at: 50, delay: 100 } }), [50, 300], '剛好完成的那一刻不算還在傳')
assertEqual(finishTimes([100, 100], { protocol: 'h1', connections: 1, loss: { request: 1, at: 50, delay: 100 } }), [100, 200], 'h1：request 1 在 100 才開始')
assertEqual(finishTimes([100, 100], { protocol: 'h1', connections: 1, loss: { request: 1, at: 100, delay: 100 } }), [100, 300], 'h1：request 1 剛開始傳就遺失')
let threw = false
try { finishTimes([100], { protocol: 'spdy' }) } catch (e) { threw = e instanceof Error }
assert(threw, '不認得的 protocol 要丟 Error')` },
    ],
    hints: [
      "`h1`：用一個長度為 `connections` 的陣列記每條連線「什麼時候空出來」，每個請求挑最小的那個當開始時間，算完再把完成時間寫回去。",
      "封包遺失有沒有影響，先看那個請求當時是不是正在傳：`start <= loss.at && loss.at < finish`。`h1` 要在算那個請求的完成時間時就加上去，排在它後面的才會跟著晚。",
      "`h2` 與 `h3` 的差別只有一行：`h2` 把延遲加到所有 `loss.at < duration` 的 stream，`h3` 只加到 `loss.request` 那一條。",
    ],
  },
]
