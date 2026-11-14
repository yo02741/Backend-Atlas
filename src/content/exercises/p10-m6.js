// 程式題：p10-m6（企業身分、資安維運）
// Python 在瀏覽器裡的 Pyodide 執行（只有標準函式庫）。資料全部虛構。
export default [
  {
    id: 'enterprise-identity-1', skill: 'enterprise-identity', kind: 'python', level: 2,
    title: "目錄與應用程式帳號對帳",
    prompt: "排班系統每晚向目錄拉一次資料，和自己的帳號表對帳。實作 `reconcile(directory_users, app_users)`，回傳接下來要做的動作。\n\n- `directory_users`：目錄裡的人，每筆是 `{\"id\", \"email\", \"active\", \"groups\"}`。`id` 是目錄產生、不會變的識別碼；`groups` 已經展開過巢狀群組\n- `app_users`：排班系統的帳號，每筆是 `{\"external_id\", \"login\", \"email\", \"active\", \"roles\"}`。`external_id` 存的是目錄的 `id`；本地帳號（緊急用的管理員、服務帳號）的 `external_id` 是 `None`\n- `GROUP_ROLES`（已提供）：群組 → 角色的對應表。一個人的角色是他所有群組對應到的角色，去掉重複並排序；對應表裡沒有的群組忽略\n\n**應該有帳號**的條件：目錄裡 `active` 是 `True`，而且至少對應到一個角色。\n\n回傳一個 dict，五個鍵：\n\n- `\"create\"`：應該有帳號，但排班系統裡沒有這個 `external_id`。每筆是 `{\"external_id\", \"email\", \"roles\"}`，依 `external_id` 排序\n- `\"update\"`：應該有帳號、排班系統裡也有，但 email 或角色不同，或帳號目前是停用的（復職）。格式與排序同上，內容是**目錄這邊**算出來的值；角色只是順序不同不算不同\n- `\"deactivate\"`：排班系統裡還有效、但不應該有帳號的 `external_id`（目錄已停用、目錄裡查不到、或已經沒有任何角色），排序\n- `\"unmanaged\"`：`external_id` 是 `None` 的帳號的 `login`，排序。這些帳號不自動停用，列出來給人確認\n- `\"safe\"`：`deactivate` 的筆數超過「目前有效的受管帳號數」的一半時是 `False`，否則 `True`。受管帳號指 `external_id` 不是 `None` 的帳號。目錄查詢失敗、只回來一部分資料時，照著結果執行會把大家都鎖在外面\n\n配對**只用** `external_id`，不用 email：email 會改，也可能重新配給別人。",
    starter: String.raw`# 群組 → 角色的對應表（已提供，不用改）。對應表裡沒有的群組沒有任何角色
GROUP_ROLES = {
    "nursing-all": "schedule:read",
    "ward-clerks": "schedule:read",
    "head-nurses": "schedule:edit",
    "it-ops": "schedule:admin",
}


def reconcile(directory_users, app_users):
    # TODO：現在用 email 配對，只處理「目錄已停用」這一種情況，也沒有算角色
    result = {"create": [], "update": [], "deactivate": [], "unmanaged": [], "safe": True}
    app_by_email = {acct["email"]: acct for acct in app_users}
    for person in directory_users:
        acct = app_by_email.get(person["email"])
        if acct is None and person["active"]:
            result["create"].append({"external_id": person["id"], "email": person["email"], "roles": []})
        elif acct is not None and not person["active"]:
            result["deactivate"].append(acct["external_id"])
    return result


# 試跑：chen.yiting 改了 email（id 沒變），lin.meihua 已在目錄停用
directory = [
    {"id": "u-1001", "email": "lin.meihua@hospital.example", "active": False, "groups": ["nursing-all"]},
    {"id": "u-1002", "email": "lin.yiting@hospital.example", "active": True, "groups": ["nursing-all"]},
]
app = [
    {"external_id": "u-1001", "login": "lin.meihua", "email": "lin.meihua@hospital.example", "active": True, "roles": ["schedule:read"]},
    {"external_id": "u-1002", "login": "chen.yiting", "email": "chen.yiting@hospital.example", "active": True, "roles": ["schedule:read"]},
    {"external_id": None, "login": "svc-report", "email": "", "active": True, "roles": ["schedule:read"]},
]
for key, value in reconcile(directory, app).items():
    print(key, value)
`,
    solution: String.raw`# 群組 → 角色的對應表（已提供，不用改）。對應表裡沒有的群組沒有任何角色
GROUP_ROLES = {
    "nursing-all": "schedule:read",
    "ward-clerks": "schedule:read",
    "head-nurses": "schedule:edit",
    "it-ops": "schedule:admin",
}


def roles_for(groups):
    """群組清單 → 角色清單：去掉重複、排序；對應表裡沒有的群組忽略。"""
    return sorted({GROUP_ROLES[g] for g in groups if g in GROUP_ROLES})


def reconcile(directory_users, app_users):
    # 1. 目錄這邊：算出每個人「應該有的帳號」。停用或沒有任何角色的人不在裡面
    desired = {}
    for person in directory_users:
        roles = roles_for(person["groups"])
        if person["active"] and roles:
            desired[person["id"]] = {"external_id": person["id"], "email": person["email"], "roles": roles}

    result = {"create": [], "update": [], "deactivate": [], "unmanaged": [], "safe": True}
    seen = set()            # 排班系統裡出現過的 external_id
    managed_active = 0      # 目前有效的受管帳號數
    # 2. 排班系統這邊：只用 external_id 配對，不看 email
    for acct in app_users:
        ext = acct["external_id"]
        if ext is None:                       # 本地帳號：只列出來，不自動停用
            result["unmanaged"].append(acct["login"])
            continue
        seen.add(ext)
        if acct["active"]:
            managed_active += 1
        want = desired.get(ext)
        if want is None:                      # 目錄已停用、查不到、或沒有角色
            if acct["active"]:
                result["deactivate"].append(ext)
        elif (not acct["active"]                                   # 復職
              or acct["email"] != want["email"]                    # email 改了
              or sorted(set(acct["roles"])) != want["roles"]):     # 角色不同（順序不算）
            result["update"].append(want)

    # 3. 應該有帳號、但排班系統完全沒有的人
    result["create"] = [want for ext, want in desired.items() if ext not in seen]

    result["create"].sort(key=lambda item: item["external_id"])
    result["update"].sort(key=lambda item: item["external_id"])
    result["deactivate"].sort()
    result["unmanaged"].sort()
    # 4. 保護：要停用的超過有效受管帳號的一半，多半是目錄資料不完整，不要自動執行
    result["safe"] = len(result["deactivate"]) * 2 <= managed_active
    return result


# 試跑：chen.yiting 改了 email（id 沒變），lin.meihua 已在目錄停用
directory = [
    {"id": "u-1001", "email": "lin.meihua@hospital.example", "active": False, "groups": ["nursing-all"]},
    {"id": "u-1002", "email": "lin.yiting@hospital.example", "active": True, "groups": ["nursing-all"]},
]
app = [
    {"external_id": "u-1001", "login": "lin.meihua", "email": "lin.meihua@hospital.example", "active": True, "roles": ["schedule:read"]},
    {"external_id": "u-1002", "login": "chen.yiting", "email": "chen.yiting@hospital.example", "active": True, "roles": ["schedule:read"]},
    {"external_id": None, "login": "svc-report", "email": "", "active": True, "roles": ["schedule:read"]},
]
for key, value in reconcile(directory, app).items():
    print(key, value)
`,
    tests: [
      { name: "基本情況：新進的人建立、角色變了更新、目錄停用的人停用、一致的不動", code: String.raw`def _d(id, email, active=True, groups=("nursing-all",)):
    return {"id": id, "email": email, "active": active, "groups": list(groups)}
def _a(ext, email, active=True, roles=("schedule:read",), login=None):
    return {"external_id": ext, "login": login or (email.split("@")[0] if email else "local"), "email": email, "active": active, "roles": list(roles)}
_r = reconcile(
    [_d("u-1", "a@hospital.example"), _d("u-2", "b@hospital.example", groups=["nursing-all", "head-nurses"]),
     _d("u-3", "c@hospital.example", active=False), _d("u-4", "d@hospital.example")],
    [_a("u-1", "a@hospital.example"), _a("u-2", "b@hospital.example"), _a("u-3", "c@hospital.example")])
assert _r["create"] == [{"external_id": "u-4", "email": "d@hospital.example", "roles": ["schedule:read"]}], _r["create"]
assert _r["update"] == [{"external_id": "u-2", "email": "b@hospital.example", "roles": ["schedule:edit", "schedule:read"]}], _r["update"]
assert _r["deactivate"] == ["u-3"], _r["deactivate"]
assert _r["unmanaged"] == [] and _r["safe"] is True, _r` },
      { name: "目錄裡查不到的人、已經沒有任何角色的人也要停用；本來就停用的帳號不重複列入", code: String.raw`_r = reconcile(
    [_d("u-1", "a@hospital.example"), _d("u-2", "b@hospital.example", groups=["cafeteria-staff"]),
     _d("u-5", "e@hospital.example", active=False), _d("u-6", "f@hospital.example"), _d("u-7", "g@hospital.example"),
     _d("u-8", "h@hospital.example", groups=[])],
    [_a("u-1", "a@hospital.example"), _a("u-2", "b@hospital.example"), _a("u-9", "z@hospital.example"),
     _a("u-5", "e@hospital.example", active=False), _a("u-6", "f@hospital.example"), _a("u-7", "g@hospital.example")])
assert _r["deactivate"] == ["u-2", "u-9"], f"u-2 調離後沒有任何對應的角色、u-9 在目錄裡查不到；u-5 本來就停用：{_r['deactivate']}"
assert _r["create"] == [], f"沒有角色的人（u-8）不建立帳號：{_r['create']}"
assert _r["update"] == [], _r["update"]` },
      { name: "用 id 配對，不用 email：改了 email 是更新同一個帳號，不是建立新帳號", code: String.raw`_r = reconcile([_d("u-1002", "lin.yiting@hospital.example")], [_a("u-1002", "chen.yiting@hospital.example")])
assert _r["create"] == [], f"id 沒變就是同一個人，不該建立新帳號：{_r['create']}"
assert _r["deactivate"] == [], f"也不該停用原本的帳號：{_r['deactivate']}"
assert _r["update"] == [{"external_id": "u-1002", "email": "lin.yiting@hospital.example", "roles": ["schedule:read"]}], _r["update"]` },
      { name: "離職者的 email 重新配給新進人員：舊帳號停用、新人另外建立，不接手舊帳號", code: String.raw`_r = reconcile(
    [_d("u-2001", "wang@hospital.example", groups=["ward-clerks"]), _d("u-1", "a@hospital.example"), _d("u-2", "b@hospital.example")],
    [_a("u-0500", "wang@hospital.example", roles=["schedule:admin"]), _a("u-1", "a@hospital.example"), _a("u-2", "b@hospital.example")])
assert _r["deactivate"] == ["u-0500"], f"u-0500 在目錄裡已經查不到：{_r['deactivate']}"
assert _r["create"] == [{"external_id": "u-2001", "email": "wang@hospital.example", "roles": ["schedule:read"]}], _r["create"]
assert _r["update"] == [], f"新人不能因為 email 相同就接手舊帳號（和它的 admin 角色）：{_r['update']}"` },
      { name: "角色：多個群組對到同一個角色只算一次、結果排序、不認識的群組忽略；順序不同不算變更", code: String.raw`_r = reconcile(
    [_d("u-1", "a@hospital.example", groups=["it-ops", "ward-clerks", "nursing-all", "parking-lot"]),
     _d("u-2", "b@hospital.example", groups=["head-nurses", "nursing-all"])],
    [_a("u-2", "b@hospital.example", roles=["schedule:read", "schedule:edit"])])
assert _r["create"] == [{"external_id": "u-1", "email": "a@hospital.example", "roles": ["schedule:admin", "schedule:read"]}], _r["create"]
assert _r["update"] == [], f"角色內容相同、只是順序不同，不用更新：{_r['update']}"` },
      { name: "復職：目錄重新啟用、排班系統的帳號還是停用 → 列入 update；兩邊都停用則不動", code: String.raw`_r = reconcile(
    [_d("u-1", "a@hospital.example"), _d("u-2", "b@hospital.example", active=False)],
    [_a("u-1", "a@hospital.example", active=False), _a("u-2", "b@hospital.example", active=False)])
assert _r["update"] == [{"external_id": "u-1", "email": "a@hospital.example", "roles": ["schedule:read"]}], _r["update"]
assert _r["create"] == [] and _r["deactivate"] == [], _r
assert _r["safe"] is True, "沒有要停用的帳號時是安全的"` },
      { name: "本地帳號（external_id 是 None）只列在 unmanaged，不自動停用，也不拿 email 去配對", code: String.raw`_r = reconcile(
    [_d("u-1", "a@hospital.example"), _d("u-3", "admin@hospital.example", groups=["it-ops"])],
    [_a("u-1", "a@hospital.example"), _a(None, "", login="svc-report"), _a(None, "admin@hospital.example", login="breakglass", roles=["schedule:admin"])])
assert _r["unmanaged"] == ["breakglass", "svc-report"], _r["unmanaged"]
assert _r["deactivate"] == [], f"本地帳號不自動停用：{_r['deactivate']}"
assert _r["create"] == [{"external_id": "u-3", "email": "admin@hospital.example", "roles": ["schedule:admin"]}], f"u-3 是另一個帳號，不和本地帳號用 email 配對：{_r['create']}"` },
      { name: "safe：要停用的超過有效受管帳號的一半時是 False（目錄只回來一部分資料）", code: String.raw`_apps = [_a(f"u-{i}", f"p{i}@hospital.example") for i in range(1, 5)] + [_a(None, "", login="svc-report")]
_r = reconcile([], _apps)
assert _r["deactivate"] == ["u-1", "u-2", "u-3", "u-4"] and _r["safe"] is False, f"目錄回空清單：4 個全部要停用，不安全：{_r}"
_r = reconcile([_d("u-1", "p1@hospital.example"), _d("u-2", "p2@hospital.example")], _apps)
assert _r["deactivate"] == ["u-3", "u-4"] and _r["safe"] is True, f"4 個裡停用 2 個，剛好一半，還算安全：{_r}"
_r = reconcile([_d("u-1", "p1@hospital.example")], _apps)
assert len(_r["deactivate"]) == 3 and _r["safe"] is False, f"4 個裡停用 3 個，超過一半：{_r}"
assert reconcile([], []) == {"create": [], "update": [], "deactivate": [], "unmanaged": [], "safe": True}` },
    ],
    hints: [
      "先處理目錄這邊：對每個人算出角色，把「啟用而且有角色」的人放進一個以 `id` 為鍵的 dict，值就是 `{\"external_id\", \"email\", \"roles\"}`。",
      "再走一遍 `app_users`：`external_id` 是 `None` 的放進 `unmanaged`；其他的用 `external_id` 去那個 dict 查。查不到而且帳號還有效就是 `deactivate`；查得到就比較 `active`、`email` 與排序後的角色。",
      "`create` 是 dict 裡有、但 `app_users` 裡沒出現過的 `id`。`safe` 可以寫成 `len(deactivate) * 2 <= 有效的受管帳號數`，避免除法。",
    ],
  },
  {
    id: 'security-operations-1', skill: 'security-operations', kind: 'python', level: 2,
    title: "依規則排修補優先序",
    prompt: "實作 `prioritize(findings, assets, policy)`：把掃描結果排出修補的優先序、期限，並標出逾期與需要補償控制的項目。\n\n- `findings`：每筆是 `{\"id\", \"asset\", \"cvss\", \"known_exploited\", \"found\", \"fix_available\"}`，`found` 是 `datetime.date`\n- `assets`：資產清冊，`{資產名稱: {\"exposure\": \"internet\" 或 \"internal\", \"criticality\": \"high\" 或 \"normal\"}}`\n- `policy`：`{\"today\": date, \"sla_days\": {\"P1\": 3, \"P2\": 14, \"P3\": 30, \"P4\": 90}}`，天數會變，要從這裡讀\n\n計分規則（和課文的示意相同）：\n\n- 嚴重度：`cvss` ≥ 9.0 得 3 分、≥ 7.0 得 2 分、≥ 4.0 得 1 分，其餘 0 分\n- `known_exploited` 加 2 分；資產對外（`internet`）加 1 分；資產重要性是 `high` 加 1 分\n- 資產不在清冊裡：不知道就當最壞的情況，視為對外而且重要，並在結果標 `\"unknown_asset\": True`\n- 總分 ≥ 5 是 `\"P1\"`、4 是 `\"P2\"`、2 或 3 是 `\"P3\"`、其餘 `\"P4\"`\n\n每筆回傳 `{\"id\", \"priority\", \"due\", \"overdue\", \"unknown_asset\", \"compensating_control\"}`：\n\n- `due`：`found` 加上該等級的天數\n- `overdue`：`policy[\"today\"]` 已經**超過** `due`（到期當天還不算逾期）\n- `compensating_control`：等級是 `P1` 或 `P2`，而且還沒有修正版（`fix_available` 是 `False`）或已經逾期。這種項目不能只是等，要先有補償控制\n\n結果依 `priority`、`due`、`id` 排序。不要修改傳入的資料。",
    starter: String.raw`from datetime import date, timedelta


def prioritize(findings, assets, policy):
    # TODO：現在只照 CVSS 由高到低排，期限一律 30 天；沒看清冊、沒看是否已知被利用
    result = []
    for f in sorted(findings, key=lambda f: -f["cvss"]):
        result.append({
            "id": f["id"],
            "priority": "P1" if f["cvss"] >= 9.0 else "P3",
            "due": f["found"] + timedelta(days=30),
            "overdue": False,
            "unknown_asset": False,
            "compensating_control": False,
        })
    return result


# 試跑：F-2 的 CVSS 比較低，但它在對外的重要資產上，而且已知被利用
ASSETS = {
    "portal-web": {"exposure": "internet", "criticality": "high"},
    "report-batch": {"exposure": "internal", "criticality": "normal"},
}
FINDINGS = [
    {"id": "F-1", "asset": "report-batch", "cvss": 9.8, "known_exploited": False, "found": date(2026, 3, 2), "fix_available": True},
    {"id": "F-2", "asset": "portal-web", "cvss": 7.5, "known_exploited": True, "found": date(2026, 3, 10), "fix_available": True},
]
POLICY = {"today": date(2026, 3, 16), "sla_days": {"P1": 3, "P2": 14, "P3": 30, "P4": 90}}
for row in prioritize(FINDINGS, ASSETS, POLICY):
    print(row)
`,
    solution: String.raw`from datetime import date, timedelta


def severity_points(cvss):
    """CVSS → 嚴重度分數：Critical 3、High 2、Medium 1、其餘 0。"""
    if cvss >= 9.0:
        return 3
    if cvss >= 7.0:
        return 2
    if cvss >= 4.0:
        return 1
    return 0


def prioritize(findings, assets, policy):
    today = policy["today"]
    result = []
    for f in findings:
        asset = assets.get(f["asset"])
        unknown = asset is None
        # 清冊裡查不到的資產：不知道就當最壞的情況（對外、重要）
        internet = unknown or asset["exposure"] == "internet"
        important = unknown or asset["criticality"] == "high"

        points = severity_points(f["cvss"])
        points += 2 if f["known_exploited"] else 0
        points += 1 if internet else 0
        points += 1 if important else 0

        if points >= 5:
            priority = "P1"
        elif points == 4:
            priority = "P2"
        elif points >= 2:
            priority = "P3"
        else:
            priority = "P4"

        due = f["found"] + timedelta(days=policy["sla_days"][priority])
        overdue = today > due                      # 到期當天還不算逾期
        # 高優先、但暫時修不了或已經拖過期限：不能只是等，要先有補償控制
        compensating = priority in ("P1", "P2") and (not f["fix_available"] or overdue)
        result.append({
            "id": f["id"],
            "priority": priority,
            "due": due,
            "overdue": overdue,
            "unknown_asset": unknown,
            "compensating_control": compensating,
        })
    result.sort(key=lambda r: (r["priority"], r["due"], r["id"]))
    return result


# 試跑：F-2 的 CVSS 比較低，但它在對外的重要資產上，而且已知被利用
ASSETS = {
    "portal-web": {"exposure": "internet", "criticality": "high"},
    "report-batch": {"exposure": "internal", "criticality": "normal"},
}
FINDINGS = [
    {"id": "F-1", "asset": "report-batch", "cvss": 9.8, "known_exploited": False, "found": date(2026, 3, 2), "fix_available": True},
    {"id": "F-2", "asset": "portal-web", "cvss": 7.5, "known_exploited": True, "found": date(2026, 3, 10), "fix_available": True},
]
POLICY = {"today": date(2026, 3, 16), "sla_days": {"P1": 3, "P2": 14, "P3": 30, "P4": 90}}
for row in prioritize(FINDINGS, ASSETS, POLICY):
    print(row)
`,
    tests: [
      { name: "分級：嚴重度分數加上已知被利用、對外、重要資產，決定 P1–P4", code: String.raw`from datetime import date as _date
_ASSETS = {
    "portal-web": {"exposure": "internet", "criticality": "high"},
    "vpn-gateway": {"exposure": "internet", "criticality": "high"},
    "his-db": {"exposure": "internal", "criticality": "high"},
    "report-batch": {"exposure": "internal", "criticality": "normal"},
    "wiki": {"exposure": "internal", "criticality": "normal"},
    "docs-site": {"exposure": "internet", "criticality": "normal"},
}
_POLICY = {"today": _date(2026, 3, 16), "sla_days": {"P1": 3, "P2": 14, "P3": 30, "P4": 90}}
def _f(id, asset, cvss, kev=False, found=_date(2026, 3, 16), fix=True):
    return {"id": id, "asset": asset, "cvss": cvss, "known_exploited": kev, "found": found, "fix_available": fix}
def _prio(asset, cvss, kev=False):
    return prioritize([_f("X", asset, cvss, kev)], _ASSETS, _POLICY)[0]["priority"]
assert _prio("report-batch", 9.8) == "P3", "Critical（3 分）但在內網的一般資產上，沒有加分：3 分是 P3"
assert _prio("portal-web", 7.5, True) == "P1", "High（2）+ 已知被利用（2）+ 對外（1）+ 重要（1）= 6 分"
assert _prio("his-db", 9.0) == "P2", "9.0 算 Critical（3）+ 重要資產（1）= 4 分是 P2"
assert _prio("wiki", 9.1, True) == "P1", "Critical（3）+ 已知被利用（2）= 5 分"
assert _prio("vpn-gateway", 9.8) == "P1", "Critical（3）+ 對外（1）+ 重要（1）= 5 分"
assert _prio("wiki", 4.3) == "P4", "Medium（1）沒有加分：1 分是 P4"
assert _prio("docs-site", 4.0) == "P3", "4.0 算 Medium（1）+ 對外（1）= 2 分是 P3"
assert _prio("wiki", 3.9) == "P4" and _prio("wiki", 7.0) == "P3" and _prio("wiki", 6.9) == "P4", "邊界：7.0 是 High、6.9 是 Medium、3.9 是 0 分"
assert _prio("wiki", 3.9, True) == "P3", "低嚴重度但已知被利用：0 + 2 = 2 分"` },
      { name: "排序：依等級、期限、編號，不是依 CVSS", code: String.raw`_findings = [
    _f("F-101", "report-batch", 9.8, False, _date(2026, 3, 2)),
    _f("F-102", "portal-web", 7.5, True, _date(2026, 3, 10)),
    _f("F-103", "his-db", 9.0, False, _date(2026, 3, 5)),
    _f("F-104", "portal-web", 5.3, False, _date(2026, 1, 5)),
    _f("F-105", "wiki", 9.1, True, _date(2026, 3, 14)),
    _f("F-106", "vpn-gateway", 9.8, False, _date(2026, 3, 14)),
    _f("F-107", "wiki", 4.3, False, _date(2026, 2, 1)),
]
_r = prioritize(_findings, _ASSETS, _POLICY)
assert [x["id"] for x in _r] == ["F-102", "F-105", "F-106", "F-103", "F-104", "F-101", "F-107"], [x["id"] for x in _r]
assert [x["priority"] for x in _r] == ["P1", "P1", "P1", "P2", "P3", "P3", "P4"], [x["priority"] for x in _r]
assert set(_r[0]) == {"id", "priority", "due", "overdue", "unknown_asset", "compensating_control"}, f"每筆的欄位：{sorted(_r[0])}"` },
      { name: "期限與逾期：due = found + 該等級的天數；到期當天不算逾期，隔天才算", code: String.raw`_r = {x["id"]: x for x in prioritize(_findings, _ASSETS, _POLICY)}
assert _r["F-102"]["due"] == _date(2026, 3, 13) and _r["F-102"]["overdue"] is True, _r["F-102"]
assert _r["F-105"]["due"] == _date(2026, 3, 17) and _r["F-105"]["overdue"] is False, _r["F-105"]
assert _r["F-104"]["due"] == _date(2026, 2, 4) and _r["F-104"]["overdue"] is True, _r["F-104"]
assert _r["F-101"]["due"] == _date(2026, 4, 1) and _r["F-101"]["overdue"] is False, _r["F-101"]
_x = prioritize([_f("E", "vpn-gateway", 9.8, False, _date(2026, 3, 13))], _ASSETS, _POLICY)[0]
assert _x["due"] == _date(2026, 3, 16) and _x["overdue"] is False, f"今天剛好到期，還不算逾期：{_x}"
_x = prioritize([_f("E", "vpn-gateway", 9.8, False, _date(2026, 3, 12))], _ASSETS, _POLICY)[0]
assert _x["overdue"] is True, f"昨天到期，今天算逾期：{_x}"` },
      { name: "期限的天數與今天的日期都從 policy 讀，不寫死", code: String.raw`_p2 = {"today": _date(2026, 6, 1), "sla_days": {"P1": 1, "P2": 7, "P3": 21, "P4": 60}}
_r = {x["id"]: x for x in prioritize([
    _f("A", "vpn-gateway", 9.8, False, _date(2026, 5, 30)),
    _f("B", "his-db", 9.0, False, _date(2026, 5, 20)),
    _f("C", "report-batch", 9.8, False, _date(2026, 5, 20)),
    _f("D", "wiki", 4.3, False, _date(2026, 3, 1))], _ASSETS, _p2)}
assert _r["A"]["due"] == _date(2026, 5, 31) and _r["A"]["overdue"] is True, _r["A"]
assert _r["B"]["due"] == _date(2026, 5, 27) and _r["B"]["overdue"] is True, _r["B"]
assert _r["C"]["due"] == _date(2026, 6, 10) and _r["C"]["overdue"] is False, _r["C"]
assert _r["D"]["due"] == _date(2026, 4, 30) and _r["D"]["overdue"] is True, _r["D"]` },
      { name: "清冊裡查不到的資產：當成對外而且重要，並標 unknown_asset", code: String.raw`_r = {x["id"]: x for x in prioritize([
    _f("U1", "old-report-host", 7.5), _f("U2", "old-report-host", 9.8), _f("K", "wiki", 7.5)], _ASSETS, _POLICY)}
assert _r["U1"]["unknown_asset"] is True and _r["U1"]["priority"] == "P2", f"High（2）+ 對外（1）+ 重要（1）= 4 分：{_r['U1']}"
assert _r["U2"]["priority"] == "P1", _r["U2"]
assert _r["K"]["unknown_asset"] is False and _r["K"]["priority"] == "P3", _r["K"]` },
      { name: "補償控制：P1、P2 而且（還沒有修正版，或已經逾期）", code: String.raw`_r = {x["id"]: x for x in prioritize([
    _f("N1", "vpn-gateway", 9.8, False, _date(2026, 3, 15), fix=False),
    _f("N2", "vpn-gateway", 9.8, False, _date(2026, 3, 15), fix=True),
    _f("N3", "his-db", 9.0, False, _date(2026, 2, 1), fix=True),
    _f("N4", "report-batch", 9.8, False, _date(2026, 3, 15), fix=False),
    _f("N5", "portal-web", 5.3, False, _date(2026, 1, 5), fix=True),
    _f("N6", "his-db", 9.0, False, _date(2026, 3, 10), fix=False)], _ASSETS, _POLICY)}
assert _r["N1"]["compensating_control"] is True, f"P1、還沒有修正版：{_r['N1']}"
assert _r["N2"]["compensating_control"] is False, f"P1、有修正版、還沒逾期：照期限修就好：{_r['N2']}"
assert _r["N3"]["compensating_control"] is True, f"P2、已逾期：{_r['N3']}"
assert _r["N4"]["compensating_control"] is False, f"P3 就算沒有修正版也不強制：{_r['N4']}"
assert _r["N5"]["compensating_control"] is False and _r["N5"]["overdue"] is True, f"P3 逾期要追蹤，但不在補償控制的規則內：{_r['N5']}"
assert _r["N6"]["compensating_control"] is True, f"P2、還沒有修正版：{_r['N6']}"` },
      { name: "同等級依期限、再依編號排；不修改傳入的資料；空清單回空清單", code: String.raw`_in = [_f("B-2", "wiki", 7.5, False, _date(2026, 3, 1)), _f("B-1", "wiki", 7.5, False, _date(2026, 3, 1)),
       _f("A-9", "wiki", 7.5, False, _date(2026, 2, 1)), _f("C-1", "vpn-gateway", 9.8, False, _date(2026, 3, 15))]
_copy = [dict(x) for x in _in]
_r = prioritize(_in, _ASSETS, _POLICY)
assert [x["id"] for x in _r] == ["C-1", "A-9", "B-1", "B-2"], [x["id"] for x in _r]
assert _in == _copy, "不要修改或重新排序傳入的 findings"
assert prioritize([], _ASSETS, _POLICY) == []` },
    ],
    hints: [
      "先寫一個把 `cvss` 換成 0–3 分的小函式，再加上三個加分項。資產用 `assets.get(f[\"asset\"])` 查，查不到（`None`）時把對外與重要都當成 `True`。",
      "日期可以直接相加與比較：`f[\"found\"] + timedelta(days=policy[\"sla_days\"][priority])`、`policy[\"today\"] > due`。",
      "排序用 `result.sort(key=lambda r: (r[\"priority\"], r[\"due\"], r[\"id\"]))`：`\"P1\" < \"P2\"` 的字串比較剛好是想要的順序。每筆都建立新的 dict，就不會改到傳入的資料。",
    ],
  },
]
