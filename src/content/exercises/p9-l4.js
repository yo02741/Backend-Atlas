// 程式題：P9 新課（l4 批）——semantic-layer、finops、aiops、event-driven
// SQL 題的資料表都由 setup 建立（虛構的掛號、訂單、庫存資料，沒有真實個資）

// 虛構的門診掛號；metrics 是指標清單（定義寫在這裡）
const CLINIC = `
CREATE TABLE registrations (
  id           BIGINT PRIMARY KEY,
  visit_date   DATE NOT NULL,
  dept_code    TEXT NOT NULL,
  status       TEXT NOT NULL,          -- booked / completed / cancelled / void
  cancelled_at TIMESTAMPTZ,
  is_test      BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO registrations VALUES
  (1,  '2026-05-04', 'IM',  'completed', NULL,                  false),
  (2,  '2026-05-04', 'IM',  'cancelled', '2026-05-03 09:00+08', false),
  (3,  '2026-05-04', 'IM',  'completed', '2026-05-02 10:00+08', false),
  (4,  '2026-05-04', 'SUR', 'void',      NULL,                  false),
  (5,  '2026-05-04', 'SUR', 'completed', NULL,                  false),
  (6,  '2026-05-04', 'SUR', 'completed', NULL,                  true),
  (7,  '2026-05-05', 'IM',  'cancelled', '2026-05-05 07:30+08', false),
  (8,  '2026-05-05', 'IM',  'booked',    NULL,                  false),
  (9,  '2026-05-05', 'SUR', 'cancelled', '2026-05-04 18:00+08', false),
  (10, '2026-05-05', 'SUR', 'completed', NULL,                  false),
  (11, '2026-05-05', 'PED', 'void',      NULL,                  false),
  (12, '2026-05-05', 'PED', 'completed', NULL,                  false),
  (13, '2026-05-06', 'PED', 'cancelled', '2026-05-06 08:00+08', true),
  (14, '2026-05-06', 'PED', 'booked',    NULL,                  false);
CREATE TABLE metrics (
  name TEXT PRIMARY KEY, formula TEXT NOT NULL, source TEXT NOT NULL,
  grain TEXT NOT NULL, dimensions TEXT NOT NULL, owner TEXT NOT NULL
);
INSERT INTO metrics VALUES
  ('registrations', 'COUNT(*)，排除 status = void 與 is_test = true', 'registrations', '一列一筆掛號', 'visit_date, dept_code', '門診管理組'),
  ('cancellations', 'status = cancelled 的筆數（同樣排除 void 與測試資料；不看 cancelled_at）', 'registrations', '一列一筆掛號', 'visit_date, dept_code', '門診管理組'),
  ('cancel_rate',   'cancellations ÷ registrations，四捨五入到小數 2 位', 'registrations', '一列一筆掛號', 'visit_date, dept_code', '門診管理組');
`

const OUTBOX = `
CREATE TABLE orders (
  id      BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount  NUMERIC(10,2) NOT NULL,
  status  TEXT NOT NULL DEFAULT 'paid'
);
CREATE TABLE outbox (
  id             BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
`

const CONSUMER = `
CREATE TABLE stock (product_id BIGINT PRIMARY KEY, qty INT NOT NULL);
CREATE TABLE processed_events (event_id TEXT PRIMARY KEY, processed_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- 這一批從 broker 收到的事件：至少一次傳遞，有重送；evt-100 是上一批已經處理過的
CREATE TABLE incoming (delivery_no BIGINT PRIMARY KEY, event_id TEXT NOT NULL, product_id BIGINT NOT NULL, qty INT NOT NULL);
INSERT INTO stock VALUES (1, 100), (2, 50), (3, 20);
INSERT INTO processed_events (event_id) VALUES ('evt-100');
INSERT INTO incoming VALUES
  (1, 'evt-100', 1, 5),
  (2, 'evt-101', 1, 3),
  (3, 'evt-102', 2, 10),
  (4, 'evt-101', 1, 3),
  (5, 'evt-103', 3, 2),
  (6, 'evt-102', 2, 10);
`

export default [
  {
    id: 'semantic-layer-1', skill: 'semantic-layer', kind: 'sql', level: 2,
    title: '依指標定義建取消率 view',
    prompt: '`registrations` 是虛構的門診掛號資料，`metrics` 是門診管理組維護的指標清單（先 `SELECT * FROM metrics;` 看定義）。\n\n建立 view `v_dept_cancel_rate`，每個科別一列，欄位是 `dept_code`、`registrations`、`cancellations`、`cancel_rate`，**完全依照指標清單的定義**：\n\n- 掛號數排除 `status = \'void\'` 與 `is_test = true`\n- 取消數看 `status = \'cancelled\'`，不看 `cancelled_at`（有病人取消後又改回報到，`cancelled_at` 沒清掉）\n- 取消率 = 取消數 ÷ 掛號數，四捨五入到小數 2 位\n\n起始碼是看欄位名猜出來的版本。交卷時會用 `SELECT * FROM v_dept_cancel_rate` 檢查。',
    setup: CLINIC, setupKey: 'p9-clinic-metrics',
    starter: `-- 看欄位名猜的版本：分母含作廢單與測試資料，分子看 cancelled_at
CREATE VIEW v_dept_cancel_rate AS
SELECT dept_code,
       COUNT(*)            AS registrations,
       COUNT(cancelled_at) AS cancellations,
       ROUND(COUNT(cancelled_at)::numeric / COUNT(*), 2) AS cancel_rate
FROM registrations
GROUP BY dept_code;

SELECT * FROM v_dept_cancel_rate ORDER BY dept_code;`,
    solution: `CREATE VIEW v_dept_cancel_rate AS
SELECT dept_code,
       COUNT(*)                                     AS registrations,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancellations,
       ROUND(COUNT(*) FILTER (WHERE status = 'cancelled')::numeric / COUNT(*), 2) AS cancel_rate
FROM registrations
WHERE status <> 'void' AND NOT is_test
GROUP BY dept_code;

SELECT * FROM v_dept_cancel_rate ORDER BY dept_code;`,
    expect: {
      query: `SELECT dept_code, registrations, cancellations, cancel_rate FROM v_dept_cancel_rate`,
      columns: ['dept_code', 'registrations', 'cancellations', 'cancel_rate'],
      rows: [['IM', '5', '2', '0.4'], ['PED', '2', '0', '0'], ['SUR', '3', '1', '0.33']],
      ordered: false,
    },
    hints: ['排除條件放在 WHERE：`WHERE status <> \'void\' AND NOT is_test`，分子分母就都排除了。', '`COUNT(*) FILTER (WHERE status = \'cancelled\')` 算取消數；除法前先轉 numeric，否則整數相除會變 0。'],
  },
  {
    id: 'finops-1', skill: 'finops', kind: 'python', level: 2,
    title: '估 agent 工作流的月 token 成本',
    prompt: '實作 `monthly_cost(w, prices, cache_prefix=False, max_context=None, days=30) -> float`。\n\n`w` 是工作流參數：`runs_per_day`、`turns`、`prefix_tokens`（每輪都送的系統提示與工具定義）、`history_per_turn`（每輪新增的歷史）、`output_per_turn`。`prices` 是每**百萬** token 的單價：`input`、`cached_input`、`output`。\n\n每次執行的第 `t` 輪（t 從 0 開始）：\n\n- 輸入 = `prefix_tokens + history_per_turn * t`；有 `max_context` 時取 `min(輸入, max_context)`\n- `cache_prefix=True` 時，輸入中 `min(prefix_tokens, 輸入)` 的部分用 `cached_input` 計價，其餘用 `input`\n- 輸出 = `output_per_turn`\n\n回傳 `每次成本 × runs_per_day × days`，四捨五入到小數 2 位。單價由呼叫者傳入，不要寫死。\n\n起始碼只算了最後一輪乘以輪數，也沒處理快取與上限。',
    starter: `def monthly_cost(w: dict, prices: dict, cache_prefix: bool = False, max_context: int | None = None, days: int = 30) -> float:
    # TODO：每一輪的輸入都不一樣（歷史會累積），要逐輪加總；還沒處理快取與 context 上限
    last_input = w["prefix_tokens"] + w["history_per_turn"] * (w["turns"] - 1)
    inp = last_input * w["turns"]
    out = w["output_per_turn"] * w["turns"]
    per_run = (inp * prices["input"] + out * prices["output"]) / 1_000_000
    return round(per_run * w["runs_per_day"] * days, 2)


W = {"runs_per_day": 200, "turns": 6, "prefix_tokens": 6000, "history_per_turn": 2500, "output_per_turn": 400}
P = {"input": 1.0, "cached_input": 0.1, "output": 5.0}
print(monthly_cost(W, P), monthly_cost(W, P, cache_prefix=True), monthly_cost(W, P, max_context=12000))
`,
    solution: `def monthly_cost(w: dict, prices: dict, cache_prefix: bool = False, max_context: int | None = None, days: int = 30) -> float:
    inp = cached = out = 0
    for t in range(w["turns"]):
        total_in = w["prefix_tokens"] + w["history_per_turn"] * t   # 第 t 輪帶著前面 t 輪的歷史
        if max_context is not None:
            total_in = min(total_in, max_context)
        hit = min(w["prefix_tokens"], total_in) if cache_prefix else 0
        cached += hit
        inp += total_in - hit
        out += w["output_per_turn"]
    per_run = (inp * prices["input"] + cached * prices["cached_input"] + out * prices["output"]) / 1_000_000
    return round(per_run * w["runs_per_day"] * days, 2)


W = {"runs_per_day": 200, "turns": 6, "prefix_tokens": 6000, "history_per_turn": 2500, "output_per_turn": 400}
P = {"input": 1.0, "cached_input": 0.1, "output": 5.0}
print(monthly_cost(W, P), monthly_cost(W, P, cache_prefix=True), monthly_cost(W, P, max_context=12000))
`,
    tests: [
      { name: '逐輪累積歷史', code: `_W = {"runs_per_day": 200, "turns": 6, "prefix_tokens": 6000, "history_per_turn": 2500, "output_per_turn": 400}\n_P = {"input": 1.0, "cached_input": 0.1, "output": 5.0}\n_r = monthly_cost(_W, _P)\nassert abs(_r - 513.0) < 0.01, f"預期 513.0，得到 {_r}——每一輪的輸入要分別算再加總"` },
      { name: '固定前綴走快取價', code: `_W = {"runs_per_day": 200, "turns": 6, "prefix_tokens": 6000, "history_per_turn": 2500, "output_per_turn": 400}\n_P = {"input": 1.0, "cached_input": 0.1, "output": 5.0}\n_r = monthly_cost(_W, _P, cache_prefix=True)\nassert abs(_r - 318.6) < 0.01, f"預期 318.6，得到 {_r}"` },
      { name: 'context 上限與兩者並用', code: `_W = {"runs_per_day": 200, "turns": 6, "prefix_tokens": 6000, "history_per_turn": 2500, "output_per_turn": 400}\n_P = {"input": 1.0, "cached_input": 0.1, "output": 5.0}\n_a = monthly_cost(_W, _P, max_context=12000)\n_b = monthly_cost(_W, _P, cache_prefix=True, max_context=12000)\nassert abs(_a - 441.0) < 0.01, f"只限 context：預期 441.0，得到 {_a}"\nassert abs(_b - 246.6) < 0.01, f"快取 + 限 context：預期 246.6，得到 {_b}"` },
      { name: '單價與天數由參數決定', code: `_W = {"runs_per_day": 10, "turns": 1, "prefix_tokens": 1000, "history_per_turn": 0, "output_per_turn": 0}\nassert monthly_cost(_W, {"input": 2.0, "cached_input": 0.5, "output": 9.0}, days=1) == 0.02\nassert monthly_cost(_W, {"input": 2.0, "cached_input": 1.0, "output": 9.0}, cache_prefix=True, days=1) == 0.01\n_W2 = dict(_W, runs_per_day=20, prefix_tokens=8000)\nassert monthly_cost(_W2, {"input": 1.0, "cached_input": 0.1, "output": 1.0}, cache_prefix=True, max_context=5000, days=1) == 0.01, "上限小於前綴時，快取部分最多就是被截過的輸入"` },
    ],
    hints: ['`for t in range(w["turns"])` 逐輪算輸入，`total_in = prefix + history_per_turn * t`，再套 `min(total_in, max_context)`。', '快取部分是 `min(prefix_tokens, total_in)`，用 cached_input 計價；剩下的才用 input 計價。'],
  },
  {
    id: 'aiops-1', skill: 'aiops', kind: 'python', level: 2,
    title: 'triage：只呼叫唯讀工具',
    prompt: '實作 `triage(alert, tools) -> dict`，讓 agent 調查一則告警但不改動系統。\n\n`alert` 有 `name` 與 `service`。`tools` 是 `{工具名: {"readonly": bool, "fn": callable}}`，每個 `fn` 都接受一個參數 `service`。\n\n規則：\n\n- 依序處理 `tools` 裡的每個工具（dict 的順序）。**只呼叫 `readonly` 為 True 的工具**；判斷依據是旗標，不是名稱（名稱叫 `get_…` 的也可能被設定成會改東西）\n- 非唯讀的工具不呼叫，名稱放進 `needs_approval`\n- 唯讀工具丟出例外時不中止，名稱放進 `failed`，繼續下一個\n- 成功的呼叫在 `evidence` 加一筆 `f"{名稱}: {結果}"`\n- 若有 `get_recent_deploys` 且成功回傳非空 list，`suggested_actions` 加一筆 `{"action": f"rollback {service}", "requires_approval": True}`\n\n回傳 `{"service", "evidence", "failed", "needs_approval", "suggested_actions"}`。\n\n起始碼把每個工具都呼叫了一遍。',
    starter: `def triage(alert: dict, tools: dict) -> dict:
    svc = alert["service"]
    evidence, failed, needs_approval, actions = [], [], [], []
    for name, tool in tools.items():
        # TODO：只能呼叫唯讀工具；例外不能讓整個調查中止
        result = tool["fn"](svc)
        evidence.append(f"{name}: {result}")
        if name == "get_recent_deploys" and result:
            actions.append({"action": f"rollback {svc}", "requires_approval": True})
    return {"service": svc, "evidence": evidence, "failed": failed,
            "needs_approval": needs_approval, "suggested_actions": actions}


calls = []
def _tool(name, readonly, value):
    def fn(svc):
        calls.append(name)
        return value
    return {"readonly": readonly, "fn": fn}

tools = {
    "get_metrics": _tool("get_metrics", True, {"error_rate": 0.12}),
    "get_recent_deploys": _tool("get_recent_deploys", True, ["v2.31.0"]),
    "rollback_deploy": _tool("rollback_deploy", False, "rolled back"),
}
print(triage({"name": "HighErrorRate", "service": "api"}, tools))
print("實際呼叫：", calls)
`,
    solution: `def triage(alert: dict, tools: dict) -> dict:
    svc = alert["service"]
    evidence, failed, needs_approval, actions = [], [], [], []
    for name, tool in tools.items():
        if not tool.get("readonly", False):      # 看旗標，不看名稱；缺旗標也當成會改東西
            needs_approval.append(name)
            continue
        try:
            result = tool["fn"](svc)
        except Exception:
            failed.append(name)                  # 查不到就記下來，繼續查別的
            continue
        evidence.append(f"{name}: {result}")
        if name == "get_recent_deploys" and isinstance(result, list) and result:
            actions.append({"action": f"rollback {svc}", "requires_approval": True})
    return {"service": svc, "evidence": evidence, "failed": failed,
            "needs_approval": needs_approval, "suggested_actions": actions}


calls = []
def _tool(name, readonly, value):
    def fn(svc):
        calls.append(name)
        return value
    return {"readonly": readonly, "fn": fn}

tools = {
    "get_metrics": _tool("get_metrics", True, {"error_rate": 0.12}),
    "get_recent_deploys": _tool("get_recent_deploys", True, ["v2.31.0"]),
    "rollback_deploy": _tool("rollback_deploy", False, "rolled back"),
}
print(triage({"name": "HighErrorRate", "service": "api"}, tools))
print("實際呼叫：", calls)
`,
    tests: [
      { name: '變更工具不能被呼叫', code: `_calls = []\ndef _mk(n, ro, v):\n    def fn(svc):\n        _calls.append(n)\n        return v\n    return {"readonly": ro, "fn": fn}\n_t = {"get_metrics": _mk("get_metrics", True, {"error_rate": 0.12}), "restart_service": _mk("restart_service", False, "ok"), "rollback_deploy": _mk("rollback_deploy", False, "ok")}\n_r = triage({"name": "HighErrorRate", "service": "api"}, _t)\nassert _calls == ["get_metrics"], f"實際呼叫了：{_calls}"\nassert _r["needs_approval"] == ["restart_service", "rollback_deploy"], _r["needs_approval"]` },
      { name: '看旗標，不看名稱', code: `_calls = []\ndef _mk(n, ro, v):\n    def fn(svc):\n        _calls.append(n)\n        return v\n    return {"readonly": ro, "fn": fn}\n_t = {"get_logs": _mk("get_logs", False, "這個工具被設定成會清日誌"), "get_metrics": _mk("get_metrics", True, 1)}\n_r = triage({"name": "X", "service": "api"}, _t)\nassert "get_logs" not in _calls, "get_logs 的 readonly 是 False，不能呼叫"\nassert _r["needs_approval"] == ["get_logs"], _r` },
      { name: '工具失敗不中止調查', code: `def _boom(svc):\n    raise TimeoutError("loki timeout")\n_t = {"get_logs": {"readonly": True, "fn": _boom}, "get_metrics": {"readonly": True, "fn": lambda s: {"p95_ms": 1800}}}\n_r = triage({"name": "X", "service": "api"}, _t)\nassert _r["failed"] == ["get_logs"], _r["failed"]\nassert _r["evidence"] == ["get_metrics: {'p95_ms': 1800}"], _r["evidence"]` },
      { name: '有最近部署才建議回滾，且標記需核准', code: `_t = {"get_recent_deploys": {"readonly": True, "fn": lambda s: [{"service": s, "version": "v2.31.0"}]}}\n_r = triage({"name": "X", "service": "api"}, _t)\nassert _r["suggested_actions"] == [{"action": "rollback api", "requires_approval": True}], _r["suggested_actions"]\n_t2 = {"get_recent_deploys": {"readonly": True, "fn": lambda s: []}}\nassert triage({"name": "X", "service": "api"}, _t2)["suggested_actions"] == []` },
    ],
    hints: ['迴圈裡先檢查 `tool.get("readonly", False)`，不是 True 就放進 needs_approval 並 `continue`。', '呼叫包在 `try / except Exception` 裡，失敗就放進 failed 再 `continue`。'],
  },
  {
    id: 'event-driven-1', skill: 'event-driven', kind: 'sql', level: 2,
    title: '訂單與 outbox 事件寫在同一個交易',
    prompt: '使用者 42 付款 1280 元，訂單編號 9001。在**同一個交易**裡完成兩件事：\n\n1. 在 `orders` 新增訂單（`id = 9001`、`user_id = 42`、`amount = 1280`，status 用預設值 `paid`）\n2. 在 `outbox` 新增事件：`aggregate_type = \'order\'`、`aggregate_id = \'9001\'`、`event_type = \'order.paid\'`、`payload` 是 `{"order_id": 9001, "amount": 1280}`（JSONB），`published_at` 留空等 relay 送出\n\n起始碼只寫了訂單，事件要等 commit 之後另外送——這正是雙寫問題。交卷時會檢查訂單與事件都存在、payload 正確，而且兩筆是同一個交易寫入的（`xmin` 相同）。',
    setup: OUTBOX, setupKey: 'p9-outbox',
    starter: `BEGIN;
INSERT INTO orders (id, user_id, amount) VALUES (9001, 42, 1280);
COMMIT;
-- TODO：commit 之後才送事件，程式在這裡掛掉事件就丟了。把事件改成寫進 outbox，和訂單同一個交易`,
    solution: `BEGIN;
INSERT INTO orders (id, user_id, amount) VALUES (9001, 42, 1280);
INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
VALUES ('order', '9001', 'order.paid', jsonb_build_object('order_id', 9001, 'amount', 1280));
COMMIT;`,
    expect: {
      query: `SELECT
  (SELECT count(*) FROM orders WHERE id = 9001) AS orders,
  (SELECT count(*) FROM outbox WHERE aggregate_type = 'order' AND aggregate_id = '9001' AND event_type = 'order.paid'
     AND (payload->>'order_id')::numeric = 9001 AND (payload->>'amount')::numeric = 1280 AND published_at IS NULL) AS events,
  COALESCE((SELECT xmin::text FROM orders WHERE id = 9001) = (SELECT xmin::text FROM outbox WHERE aggregate_id = '9001' LIMIT 1), false) AS same_tx`,
      columns: ['orders', 'events', 'same_tx'],
      rows: [['1', '1', 'true']],
      ordered: false,
    },
    hints: ['在 BEGIN 與 COMMIT 之間再加一句 `INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload) VALUES (…)`。', 'payload 可以用 `jsonb_build_object(\'order_id\', 9001, \'amount\', 1280)`，或寫成 `\'{"order_id": 9001, "amount": 1280}\'::jsonb`。'],
  },
  {
    id: 'event-driven-2', skill: 'event-driven', kind: 'sql', level: 3,
    title: '冪等消費：重送的事件不能扣兩次庫存',
    prompt: '`incoming` 是這一批從 broker 收到的庫存扣減事件。傳遞是至少一次：`evt-101`、`evt-102` 各被送了兩次，`evt-100` 是上一批已經處理過的（已在 `processed_events` 裡）。\n\n寫 SQL 處理這一批：\n\n- 每個**沒處理過**的事件，依 `product_id` 扣 `qty` 一次\n- 把這批所有事件 id 記進 `processed_events`（已存在的不能讓 SQL 出錯）\n\n正確結果：商品 1 剩 97、商品 2 剩 40、商品 3 剩 18，`processed_events` 共 4 筆。起始碼把每一次送達都扣了，也扣了已處理過的 `evt-100`。\n\n交卷時會查 `stock` 與 `processed_events` 的筆數。',
    setup: CONSUMER, setupKey: 'p9-consumer',
    starter: `-- 每一次送達都扣：重送的 evt-101、evt-102 扣了兩次，已處理過的 evt-100 又扣一次
UPDATE stock s SET qty = s.qty - t.qty
FROM (SELECT product_id, SUM(qty) AS qty FROM incoming GROUP BY product_id) t
WHERE s.product_id = t.product_id;

INSERT INTO processed_events (event_id)
SELECT DISTINCT event_id FROM incoming
ON CONFLICT (event_id) DO NOTHING;

SELECT * FROM stock ORDER BY product_id;`,
    solution: `-- 一句完成「領取事件 id」與「扣庫存」：只有這次新領到的 id 才會扣
WITH claimed AS (
  INSERT INTO processed_events (event_id)
  SELECT DISTINCT event_id FROM incoming
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
), to_apply AS (
  SELECT d.product_id, SUM(d.qty) AS qty
  FROM (SELECT DISTINCT i.event_id, i.product_id, i.qty
        FROM incoming i JOIN claimed c ON c.event_id = i.event_id) d
  GROUP BY d.product_id
)
UPDATE stock s SET qty = s.qty - t.qty
FROM to_apply t
WHERE s.product_id = t.product_id;

SELECT * FROM stock ORDER BY product_id;`,
    expect: {
      query: `SELECT s.product_id, s.qty, (SELECT count(*) FROM processed_events) AS processed FROM stock s`,
      columns: ['product_id', 'qty', 'processed'],
      rows: [['1', '97', '4'], ['2', '40', '4'], ['3', '18', '4']],
      ordered: false,
    },
    hints: ['先去重：同一個 event_id 送了兩次，用 `SELECT DISTINCT event_id, product_id, qty` 只留一筆；再排除已在 processed_events 的 id。', '進階做法：`INSERT … ON CONFLICT DO NOTHING RETURNING event_id` 只回傳這次新寫入的 id，拿它 JOIN incoming 再扣庫存，去重與效果就在同一句裡。'],
  },
]
