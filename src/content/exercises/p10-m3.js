// 程式題：P10 新課（m3 批）——legacy-migration、legacy-data-sync
// SQL 題的資料表都由 setup 建立（虛構的排班與預約資料，沒有真實個資）

// 舊排班表 → 新排班表；sync_state 記錄水位
const SHIFT_SYNC = `
CREATE TABLE legacy_shift (
  shift_no INT PRIMARY KEY,
  doc_id   TEXT NOT NULL,
  dept_cd  TEXT NOT NULL,       -- 舊系統是定長欄位，值的尾端補了空白
  shift_dt DATE NOT NULL,
  period   TEXT NOT NULL,       -- 'A' 上午、'P' 下午、'N' 夜間
  stat     TEXT NOT NULL,       -- '0' 正常、'1' 停診、'2' 代診
  upd_seq  BIGINT NOT NULL      -- 每次異動遞增的序號
);
CREATE TABLE dept_map (legacy_code TEXT PRIMARY KEY, dept TEXT NOT NULL);
CREATE TABLE shifts (
  id         BIGINT PRIMARY KEY,
  doctor_id  TEXT NOT NULL,
  dept       TEXT NOT NULL,
  shift_date DATE NOT NULL,
  period     TEXT NOT NULL,     -- am / pm / night
  status     TEXT NOT NULL,     -- open / closed / substitute
  source_seq BIGINT NOT NULL,   -- 這一列對應舊資料的哪個 upd_seq
  batch_no   INT NOT NULL       -- 最後一次寫入這一列的同步批號
);
CREATE TABLE sync_state (job TEXT PRIMARY KEY, watermark BIGINT NOT NULL);
INSERT INTO dept_map VALUES ('IM', 'internal'), ('SUR', 'surgery'), ('PED', 'pediatrics');
INSERT INTO legacy_shift VALUES
  (1, 'D012', 'IM  ', '2026-06-01', 'A', '0', 101),
  (2, 'D012', 'IM  ', '2026-06-01', 'P', '1', 108),
  (3, 'D031', 'SUR ', '2026-06-01', 'A', '0', 103),
  (4, 'D031', 'SUR ', '2026-06-02', 'N', '2', 110),
  (5, 'D047', 'PED ', '2026-06-02', 'A', '0', 105),
  (6, 'D047', 'PED ', '2026-06-03', 'P', '0', 107),
  (7, 'D058', 'RHB ', '2026-06-03', 'A', '0', 111),
  (8, 'D012', 'IM  ', '2026-06-04', 'N', '0', 112);
INSERT INTO shifts VALUES
  (1, 'D012', 'internal',   '2026-06-01', 'am',    'open', 101, 6),
  (2, 'D012', 'internal',   '2026-06-01', 'pm',    'open', 102, 6),
  (3, 'D031', 'surgery',    '2026-06-01', 'am',    'open', 103, 7),
  (4, 'D031', 'surgery',    '2026-06-02', 'night', 'open', 104, 7),
  (5, 'D047', 'pediatrics', '2026-06-02', 'am',    'open', 105, 7);
INSERT INTO sync_state VALUES ('shift', 105);
`

// 舊預約表與同步過去的新表，其中幾筆不一致
const APPT_RECON = `
CREATE TABLE legacy_appt (
  appt_no INT PRIMARY KEY,
  pt_id   TEXT NOT NULL,
  stat    TEXT NOT NULL,     -- '1' 已預約、'2' 已取消、'9' 未到
  note    TEXT NOT NULL      -- 沒有備註時是空字串或一串空白；有內容時尾端可能帶空白
);
CREATE TABLE status_map (legacy_code TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE appointments (
  id         BIGINT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  status     TEXT NOT NULL,  -- booked / cancelled / no_show
  note       TEXT            -- 沒有備註時是 NULL
);
INSERT INTO status_map VALUES ('1', 'booked'), ('2', 'cancelled'), ('9', 'no_show');
INSERT INTO legacy_appt VALUES
  (201, 'P0007', '1', ''),
  (202, 'P0011', '2', '家屬來電取消  '),
  (203, 'P0003', '1', '需輪椅'),
  (204, 'P0020', '9', '   '),
  (205, 'P0015', '1', ''),
  (206, 'P0009', '2', ''),
  (208, 'P0031', '1', '初診'),
  (209, 'P0002', '1', '');
INSERT INTO appointments VALUES
  (201, 'P0007', 'booked',    NULL),
  (202, 'P0011', 'cancelled', '家屬來電取消'),
  (203, 'P0003', 'booked',    '需輪椅、家屬陪同'),
  (204, 'P0020', 'booked',    NULL),
  (205, 'P0015', 'booked',    NULL),
  (206, 'P0009', 'booked',    NULL),
  (207, 'P0018', 'booked',    NULL),
  (209, 'P0002', 'booked',    NULL);
`

export default [
  {
    id: 'legacy-migration-1', skill: 'legacy-migration', kind: 'python', level: 3,
    title: '入口層路由與並行比對',
    prompt: '入口層依規則決定每個請求去舊系統還是新系統，並對一部分請求做並行比對。實作兩個函式。\n\n`route(request, rules) -> dict`：決定請求去哪裡\n\n- `request` 有 `method`、`path`、`user_id`。`rules` 是規則清單，由上往下比對，**第一條符合的生效**。\n- 規則符合的條件：`path` 等於 `prefix`，或以 `prefix + "/"` 開頭（`/api/fees` 不能吃到 `/api/fees-report`）；規則有 `methods` 時，`method` 還要在裡面。\n- 符合的規則 `target` 是 `"new"` 時，只有 `bucket(user_id) < percent` 的使用者走新系統（`percent` 沒給就是 100），其餘走舊系統。`bucket` 已經寫好，同一個使用者永遠落在同一桶。\n- 回傳 `{"target": "old" 或 "new", "shadow": bool}`。`shadow` 為 True 的條件：規則有 `"shadow": True`，而且這個請求最後是由舊系統回應。\n- 沒有規則符合：`{"target": "old", "shadow": False}`。\n\n`compare(old_result, new_result, ignore_fields) -> list`：比對新舊系統的結果\n\n- 比對兩個 dict，回傳差異清單，每筆是 `{"path", "old", "new"}`，依 `path` 排序。\n- 兩邊都是 dict 的欄位往下比，`path` 用點號接起來（`slot.room`）；其他型別（含 list）整個值直接比。\n- 型別不同就算差異（`"150"` 和 `150`、`True` 和 `1`）。某一邊沒有這個欄位時，那一邊的值用字串 `"<missing>"`。\n- `path` 在 `ignore_fields` 裡的欄位跳過，也不再往下比。\n\n起始碼的 `route` 只看 prefix 開頭，`compare` 只比第一層。',
    starter: `import zlib


def bucket(user_id: str) -> int:
    # 同一個使用者永遠落在同一桶（0–99）
    return zlib.crc32(user_id.encode()) % 100


def route(request: dict, rules: list) -> dict:
    # TODO：路徑要比到邊界、要看 methods、target 是 new 時要看 percent、還要回傳 shadow
    for rule in rules:
        if request["path"].startswith(rule["prefix"]):
            return {"target": rule["target"], "shadow": False}
    return {"target": "old", "shadow": False}


def compare(old_result: dict, new_result: dict, ignore_fields: set) -> list:
    # TODO：只比了第一層、沒有忽略欄位、缺欄位沒處理、型別不同沒算差異
    diffs = []
    for key in old_result:
        if old_result[key] != new_result.get(key):
            diffs.append({"path": key, "old": old_result[key], "new": new_result.get(key)})
    return diffs


RULES = [
    {"prefix": "/api/schedules", "methods": ["GET"], "target": "new"},
    {"prefix": "/api/appointments", "methods": ["GET"], "target": "new", "percent": 20, "shadow": True},
    {"prefix": "/api/fees", "target": "old", "shadow": True},
]
for method, path in [("GET", "/api/schedules/2026-06-01"), ("POST", "/api/schedules"), ("GET", "/api/fees"), ("GET", "/api/fees-report")]:
    print(method, path, route({"method": method, "path": path, "user_id": "U001"}, RULES))
print(compare({"fee": "150", "meta": {"trace": "a1", "rule": "R7"}}, {"fee": 150, "meta": {"trace": "b2"}}, {"meta.trace"}))
`,
    solution: `import zlib


def bucket(user_id: str) -> int:
    # 同一個使用者永遠落在同一桶（0–99）
    return zlib.crc32(user_id.encode()) % 100


def route(request: dict, rules: list) -> dict:
    path = request["path"]
    for rule in rules:
        prefix = rule["prefix"]
        if not (path == prefix or path.startswith(prefix + "/")):   # 路徑邊界：/api/fees 不該吃到 /api/fees-report
            continue
        if "methods" in rule and request["method"] not in rule["methods"]:
            continue
        to_new = rule["target"] == "new" and bucket(request["user_id"]) < rule.get("percent", 100)
        return {"target": "new" if to_new else "old",
                "shadow": bool(rule.get("shadow", False)) and not to_new}
    return {"target": "old", "shadow": False}                      # 沒有規則符合：舊系統


def compare(old_result: dict, new_result: dict, ignore_fields: set) -> list:
    diffs = []

    def walk(old, new, prefix):
        for key in set(old) | set(new):
            path = f"{prefix}.{key}" if prefix else key
            if path in ignore_fields:
                continue
            o, n = old.get(key, "<missing>"), new.get(key, "<missing>")
            if isinstance(o, dict) and isinstance(n, dict):
                walk(o, n, path)                                   # 兩邊都是 dict 才往下比
            elif type(o) is not type(n) or o != n:                 # 型別不同也算差異："150" 和 150
                diffs.append({"path": path, "old": o, "new": n})

    walk(old_result, new_result, "")
    return sorted(diffs, key=lambda d: d["path"])


RULES = [
    {"prefix": "/api/schedules", "methods": ["GET"], "target": "new"},
    {"prefix": "/api/appointments", "methods": ["GET"], "target": "new", "percent": 20, "shadow": True},
    {"prefix": "/api/fees", "target": "old", "shadow": True},
]
for method, path in [("GET", "/api/schedules/2026-06-01"), ("POST", "/api/schedules"), ("GET", "/api/fees"), ("GET", "/api/fees-report")]:
    print(method, path, route({"method": method, "path": path, "user_id": "U001"}, RULES))
print(compare({"fee": "150", "meta": {"trace": "a1", "rule": "R7"}}, {"fee": 150, "meta": {"trace": "b2"}}, {"meta.trace"}))
`,
    tests: [
      { name: '第一條符合的規則生效；都不符合就走舊系統', code: `_R = [{"prefix": "/api/appointments", "target": "old"}, {"prefix": "/api/appointments/search", "target": "new"}, {"prefix": "/api/schedules", "target": "new"}]
_q = lambda p, m="GET", u="U001": {"method": m, "path": p, "user_id": u}
assert route(_q("/api/appointments/search"), _R) == {"target": "old", "shadow": False}, "規則由上往下，第一條符合的生效"
assert route(_q("/api/schedules/2026-06-01"), _R) == {"target": "new", "shadow": False}
assert route(_q("/api/reports/daily"), _R) == {"target": "old", "shadow": False}, "沒有規則符合時走舊系統"
assert route(_q("/api/schedules"), []) == {"target": "old", "shadow": False}` },
      { name: 'prefix 要比到路徑邊界', code: `_R = [{"prefix": "/api/fees", "target": "new"}]
_q = lambda p: {"method": "GET", "path": p, "user_id": "U001"}
assert route(_q("/api/fees"), _R)["target"] == "new"
assert route(_q("/api/fees/outpatient"), _R)["target"] == "new"
assert route(_q("/api/fees-report"), _R)["target"] == "old", "/api/fees-report 不是 /api/fees 底下的路徑"
assert route(_q("/api/feeschedule"), _R)["target"] == "old"` },
      { name: 'methods 不符合就看下一條規則', code: `_R = [{"prefix": "/api/appointments", "methods": ["GET"], "target": "new"}, {"prefix": "/api/appointments", "methods": ["POST", "PUT"], "target": "old", "shadow": True}]
_q = lambda m: {"method": m, "path": "/api/appointments/88", "user_id": "U001"}
assert route(_q("GET"), _R) == {"target": "new", "shadow": False}
assert route(_q("PUT"), _R) == {"target": "old", "shadow": True}
assert route(_q("DELETE"), _R) == {"target": "old", "shadow": False}, "兩條規則的 methods 都不含 DELETE"` },
      { name: 'percent：同一個使用者固定走同一邊', code: `import zlib as _z
_b = lambda u: _z.crc32(u.encode()) % 100
_users = [f"U{i:04d}" for i in range(500)]
_q = lambda u: {"method": "GET", "path": "/api/appointments", "user_id": u}
for _p in (0, 20, 100):
    _R = [{"prefix": "/api/appointments", "target": "new", "percent": _p}]
    for _u in _users:
        _want = "new" if _b(_u) < _p else "old"
        _got = route(_q(_u), _R)["target"]
        assert _got == _want, f"percent={_p}、使用者 {_u}（bucket {_b(_u)}）應該走 {_want}，得到 {_got}"
_R = [{"prefix": "/api/appointments", "target": "old", "percent": 100}]
assert all(route(_q(_u), _R)["target"] == "old" for _u in _users), "target 是 old 時不看 percent"` },
      { name: 'shadow：只有回舊系統結果的請求才並行比對', code: `import zlib as _z
_b = lambda u: _z.crc32(u.encode()) % 100
_R = [{"prefix": "/api/appointments", "target": "new", "percent": 30, "shadow": True}, {"prefix": "/api/fees", "target": "old", "shadow": True}, {"prefix": "/api/rooms", "target": "old"}]
for _u in [f"U{i:04d}" for i in range(200)]:
    _r = route({"method": "GET", "path": "/api/appointments", "user_id": _u}, _R)
    _want = {"target": "new", "shadow": False} if _b(_u) < 30 else {"target": "old", "shadow": True}
    assert _r == _want, f"使用者 {_u}（bucket {_b(_u)}）預期 {_want}，得到 {_r}"
assert route({"method": "GET", "path": "/api/fees", "user_id": "U0001"}, _R) == {"target": "old", "shadow": True}
assert route({"method": "GET", "path": "/api/rooms", "user_id": "U0001"}, _R) == {"target": "old", "shadow": False}` },
      { name: 'compare：忽略欄位、缺欄位、型別不同', code: `_old = {"fee": "150", "currency": "TWD", "generated_at": "115/05/04", "rule": "R7"}
_new = {"fee": 150, "currency": "TWD", "generated_at": "2026-05-04", "discount": 0}
_d = compare(_old, _new, {"generated_at"})
assert _d == [{"path": "discount", "old": "<missing>", "new": 0}, {"path": "fee", "old": "150", "new": 150}, {"path": "rule", "old": "R7", "new": "<missing>"}], _d
assert compare({"a": 1, "b": None}, {"a": 1, "b": None}, set()) == []
assert compare({"b": None}, {}, set()) == [{"path": "b", "old": None, "new": "<missing>"}], "值是 None 和沒有這個欄位是兩回事"
assert compare({"ok": True}, {"ok": 1}, set()) == [{"path": "ok", "old": True, "new": 1}], "True 和 1 型別不同，要算差異"` },
      { name: 'compare：巢狀欄位用點號路徑，結果依 path 排序', code: `_old = {"slot": {"room": "A12", "doctor": {"id": "D012", "name": "王醫師"}}, "meta": {"trace": "a1"}, "items": [1, 2]}
_new = {"slot": {"room": "A-12", "doctor": {"id": "D012", "name": "王醫師", "title": "主治"}}, "meta": {"trace": "b2"}, "items": [2, 1]}
_d = compare(_old, _new, {"meta.trace"})
assert _d == [{"path": "items", "old": [1, 2], "new": [2, 1]}, {"path": "slot.doctor.title", "old": "<missing>", "new": "主治"}, {"path": "slot.room", "old": "A12", "new": "A-12"}], _d
assert compare({"slot": {"room": "A12"}}, {"slot": "A12"}, set()) == [{"path": "slot", "old": {"room": "A12"}, "new": "A12"}], "只有兩邊都是 dict 才往下比"
assert compare({"meta": {"trace": "a1", "v": 1}}, {"meta": {"trace": "b2", "v": 2}}, {"meta"}) == [], "忽略 meta 就不再往下比"` },
    ],
    hints: ['路徑邊界：`path == prefix or path.startswith(prefix + "/")`。規則有 `methods` 而且 `method` 不在裡面時 `continue`，繼續看下一條。', '`compare` 用遞迴：對兩邊 key 的聯集逐一處理，先算出完整的 path；在忽略清單裡就跳過，兩邊都是 dict 就往下，否則比型別與值。'],
  },
  {
    id: 'legacy-data-sync-1', skill: 'legacy-data-sync', kind: 'sql', level: 2,
    title: '依水位把排班異動 upsert 到新表',
    prompt: '`legacy_shift` 是舊系統的排班表（虛構資料），`shifts` 是新系統的表，已經同步到 `upd_seq = 105`（`sync_state` 裡 `job = \'shift\'` 的水位）。舊表之後又有異動。寫 SQL 做一次增量同步，這一批的批號是 **8**：\n\n- 只處理 `upd_seq` 大於水位的列，用 `INSERT … ON CONFLICT (id) DO UPDATE` 寫進 `shifts`：新的列新增，已存在的列更新。沒有異動的列不能動（`batch_no` 要維持原值）。\n- 把水位推進到這次同步後 `shifts` 裡最大的 `source_seq`。\n- 整段 SQL 再執行一次，結果要完全相同。\n\n轉換規則：\n\n- `dept_cd` 用 `dept_map` 對照成 `dept`。舊欄位是定長的，值的尾端補了空白，要先去掉；對照表沒有的代碼寫成 `\'unknown\'`。\n- `period`：`\'A\'` → `\'am\'`、`\'P\'` → `\'pm\'`、`\'N\'` → `\'night\'`。\n- `stat`：`\'0\'` → `\'open\'`、`\'1\'` → `\'closed\'`、`\'2\'` → `\'substitute\'`。\n- `source_seq` 存舊表的 `upd_seq`，`batch_no` 存 8。\n\n起始碼把整張表重灌一次，而且碰到已存在的列就跳過。交卷時會查 `shifts` 的內容與水位。',
    setup: SHIFT_SYNC, setupKey: 'p10-shift-sync',
    starter: `-- 整張表重灌：沒看水位、已存在的列直接跳過、代碼沒轉換、水位也沒推進
INSERT INTO shifts (id, doctor_id, dept, shift_date, period, status, source_seq, batch_no)
SELECT shift_no, doc_id, dept_cd, shift_dt, period, stat, upd_seq, 8
FROM legacy_shift
ON CONFLICT (id) DO NOTHING;

SELECT * FROM shifts ORDER BY id;`,
    solution: `BEGIN;
INSERT INTO shifts (id, doctor_id, dept, shift_date, period, status, source_seq, batch_no)
SELECT l.shift_no, l.doc_id,
       COALESCE(m.dept, 'unknown'),
       l.shift_dt,
       CASE l.period WHEN 'A' THEN 'am' WHEN 'P' THEN 'pm' WHEN 'N' THEN 'night' END,
       CASE l.stat WHEN '0' THEN 'open' WHEN '1' THEN 'closed' WHEN '2' THEN 'substitute' END,
       l.upd_seq, 8
FROM legacy_shift l
LEFT JOIN dept_map m ON m.legacy_code = btrim(l.dept_cd)
WHERE l.upd_seq > (SELECT watermark FROM sync_state WHERE job = 'shift')
ON CONFLICT (id) DO UPDATE
  SET doctor_id = EXCLUDED.doctor_id, dept = EXCLUDED.dept, shift_date = EXCLUDED.shift_date,
      period = EXCLUDED.period, status = EXCLUDED.status,
      source_seq = EXCLUDED.source_seq, batch_no = EXCLUDED.batch_no;

-- 水位推進到新表實際有的最大序號，和資料同一個交易
UPDATE sync_state SET watermark = (SELECT max(source_seq) FROM shifts) WHERE job = 'shift';
COMMIT;

SELECT * FROM shifts ORDER BY id;`,
    expect: {
      query: `SELECT id, doctor_id, dept, shift_date::text AS shift_date, period, status, source_seq, batch_no,
       (SELECT watermark FROM sync_state WHERE job = 'shift') AS watermark
FROM shifts ORDER BY id`,
      columns: ['id', 'doctor_id', 'dept', 'shift_date', 'period', 'status', 'source_seq', 'batch_no', 'watermark'],
      rows: [
        ['1', 'D012', 'internal', '2026-06-01', 'am', 'open', '101', '6', '112'],
        ['2', 'D012', 'internal', '2026-06-01', 'pm', 'closed', '108', '8', '112'],
        ['3', 'D031', 'surgery', '2026-06-01', 'am', 'open', '103', '7', '112'],
        ['4', 'D031', 'surgery', '2026-06-02', 'night', 'substitute', '110', '8', '112'],
        ['5', 'D047', 'pediatrics', '2026-06-02', 'am', 'open', '105', '7', '112'],
        ['6', 'D047', 'pediatrics', '2026-06-03', 'pm', 'open', '107', '8', '112'],
        ['7', 'D058', 'unknown', '2026-06-03', 'am', 'open', '111', '8', '112'],
        ['8', 'D012', 'internal', '2026-06-04', 'night', 'open', '112', '8', '112'],
      ],
      ordered: false,
    },
    hints: ['來源加上 `WHERE l.upd_seq > (SELECT watermark FROM sync_state WHERE job = \'shift\')`；`ON CONFLICT (id) DO UPDATE SET dept = EXCLUDED.dept, …` 把每個欄位都更新成新值。', '科別用 `LEFT JOIN dept_map m ON m.legacy_code = btrim(l.dept_cd)` 加 `COALESCE(m.dept, \'unknown\')`；period 與 stat 用 `CASE … WHEN … THEN … END`。', '水位：`UPDATE sync_state SET watermark = (SELECT max(source_seq) FROM shifts) WHERE job = \'shift\'`，和 INSERT 包在同一個 `BEGIN … COMMIT`。'],
  },
  {
    id: 'legacy-data-sync-2', skill: 'legacy-data-sync', kind: 'sql', level: 3,
    title: '對帳：列出不一致的主鍵與原因',
    prompt: '`legacy_appt` 是舊系統的預約表，`appointments` 是同步過去的新表（虛構資料）。寫一句對帳查詢，列出兩邊不一致的預約，欄位是 `id` 與 `reason`，依 `id` 排序。\n\n`reason` 的值：\n\n- `missing_in_new`：舊表有、新表沒有\n- `extra_in_new`：新表有、舊表沒有（舊表已刪除）\n- `status_mismatch`：兩邊都有，但狀態不同。舊表的 `stat` 要先用 `status_map` 轉成新系統的狀態再比\n- `note_mismatch`：狀態相同，但備註不同\n\n比對備註前兩邊要用同一套規則正規化：去掉頭尾空白，空字串視為沒有備註（NULL）。舊表用空字串或一串空白表示沒有備註、新表用 NULL，這種不算差異；只差尾端空白也不算。\n\n起始碼只比兩邊都有的列，而且直接拿原始值比。',
    setup: APPT_RECON, setupKey: 'p10-appt-recon',
    starter: `-- 只比兩邊都有的列，而且直接拿原始值比：代碼沒轉換、空字串和 NULL 沒對齊
SELECT a.id, 'mismatch' AS reason
FROM legacy_appt l
JOIN appointments a ON a.id = l.appt_no
WHERE l.stat <> a.status OR l.note <> a.note
ORDER BY a.id;`,
    solution: `SELECT COALESCE(l.appt_no, a.id) AS id,
       CASE
         WHEN a.id IS NULL      THEN 'missing_in_new'
         WHEN l.appt_no IS NULL THEN 'extra_in_new'
         WHEN m.status IS DISTINCT FROM a.status THEN 'status_mismatch'
         ELSE 'note_mismatch'
       END AS reason
FROM legacy_appt l
LEFT JOIN status_map m ON m.legacy_code = l.stat
FULL JOIN appointments a ON a.id = l.appt_no
WHERE a.id IS NULL
   OR l.appt_no IS NULL
   OR m.status IS DISTINCT FROM a.status
   OR NULLIF(btrim(l.note), '') IS DISTINCT FROM NULLIF(btrim(a.note), '')
ORDER BY id;`,
    expect: {
      columns: ['id', 'reason'],
      rows: [['203', 'note_mismatch'], ['204', 'status_mismatch'], ['206', 'status_mismatch'], ['207', 'extra_in_new'], ['208', 'missing_in_new']],
      ordered: true,
    },
    hints: ['兩邊都要保留，用 `FULL JOIN appointments a ON a.id = l.appt_no`；主鍵取 `COALESCE(l.appt_no, a.id)`。', '可能是 NULL 的值用 `IS DISTINCT FROM` 比；備註先做 `NULLIF(btrim(note), \'\')` 再比。', '`reason` 用 `CASE`，依序判斷：新表沒有 → 舊表沒有 → 狀態不同 → 其餘是備註不同。'],
  },
]
