// 設計情境：刪除使用者要留下什麼
export default {
  id: 'soft-delete',
  order: 11,
  group: 'data',
  title: '刪除使用者要留下什麼',
  en: 'Soft delete, anonymize or archive',
  level: 2,
  skills: ['data-modeling', 'db-operations', 'transactions'],
  week: 3,
  lab: 'SoftDeleteScenarioLab',
  summary: '使用者要刪帳號，但訂單、發票、留言得留給財務和其他人看，個資 30 天內要消失，客服偶爾還要復原誤刪。DELETE、deleted_at、匿名化還是搬走？',
  situation: '電商平台 40 萬個帳號，每天約 30 個刪帳號請求。每個帳號平均 6 筆訂單（含電子發票）、12 則商品留言。財務每月從 orders 出報表、稽核要能對到發票；商品頁要繼續顯示留言。法規要求收到刪除請求後 30 天內清除個資；客服每週處理 2–3 件「我按錯了，幫我復原」。',
  constraints: [
    '訂單與發票不能少：財務報表、稽核、退款流程都靠它們',
    '個資（姓名、email、電話、地址）30 天內要從可查詢的資料裡消失',
    '刪除後 30 天內客服要能復原，之後不用',
    '刪掉的 email 要能再註冊新帳號',
    '所有列表 API 不能把已刪除的使用者顯示出來',
  ],
  options: [
    {
      id: 'hard', name: '真的 DELETE',
      summary: '`DELETE FROM users WHERE id = $1`，靠外鍵 `ON DELETE CASCADE` 或 `SET NULL` 處理關聯列。',
      pros: ['個資在刪除當下就不存在，法規最容易交代', 'email 立刻可以再註冊，沒有殭屍資料要過濾'],
      cons: ['CASCADE 會把訂單、留言一起帶走；SET NULL 則讓訂單變成「不知道誰買的」', '無法復原，誤刪只能從備份撈', '關聯表多的時候一個 DELETE 會鎖很多列、跑很久'],
    },
    {
      id: 'soft', name: 'deleted_at 標記',
      summary: '`UPDATE users SET deleted_at = now()`，列還在；所有查詢加 `WHERE deleted_at IS NULL`。',
      pros: ['復原就是把欄位改回 NULL，訂單與留言完全不動', '刪除是一筆 UPDATE，快而且不鎖關聯表'],
      cons: ['個資還在表裡，法規上等於沒刪，30 天後要另外排程清除或匿名化', '每一條查詢都要記得過濾，漏一條就把死人列出來', 'UNIQUE(email) 會擋掉重新註冊，要改成 partial unique index'],
    },
    {
      id: 'anonymize', name: '匿名化',
      summary: '保留列與 id，把個資欄位覆寫成固定值（`已刪除的使用者 #1`），另存一筆稽核紀錄（只留 hash）。',
      pros: ['訂單、留言、外鍵全部完好，商品頁照常顯示「已刪除的使用者」', '個資在覆寫當下就消失，不用等排程', 'email 被覆寫後 UNIQUE 自然放行'],
      cons: ['不可逆：復原要靠備份，而備份裡有個資就是清除沒做完', '要維護一份「哪些欄位算個資」的清單，新增欄位容易漏', '匯出的舊報表、日誌、搜尋索引裡的個資不會跟著消失'],
    },
    {
      id: 'archive', name: '搬到 archive 表',
      summary: '`INSERT INTO users_archive SELECT … ; DELETE FROM users`，主表只留活人，歷史另放。',
      pros: ['主表乾淨，一般查詢不用過濾', '復原是把列搬回來，30 天內可行'],
      cons: ['外鍵要改成 SET NULL 或拆掉，訂單的 user_id 會變 NULL，財務要 JOIN archive 才知道買家', 'archive 表裡個資還在，30 天後照樣要清', '兩張表 schema 要同步演進，migration 成本加倍'],
    },
  ],
  tradeoffs: {
    axes: ['關聯資料', '個資清除', '可復原', '查詢負擔'],
    rows: [
      { option: 'hard', cells: ['差：CASCADE 帶走或 SET NULL 失聯', '好：當下清除', '無', '無'] },
      { option: 'soft', cells: ['好：完全不動', '差：要另排程', '好：改一個欄位', '高：每條查詢都要過濾、UNIQUE 要改'] },
      { option: 'anonymize', cells: ['好：完全不動', '好：當下覆寫', '無', '低：列表照樣要濾掉'] },
      { option: 'archive', cells: ['中：FK 變 NULL，要 JOIN 回來', '差：archive 要另排程', '好：搬回來', '低：主表乾淨，但雙表維護'] },
    ],
  },
  decisions: [
    { id: 'community', situation: '社群留言平台。使用者刪帳號後，他在別人貼文下的留言要留著（不然討論串會斷），但名字與頭像要消失，也不需要復原。', options: ['hard', 'soft', 'anonymize', 'archive'], answer: 'anonymize',
      explain: '留言必須留、作者必須消失、不用復原：三個條件剛好都指向匿名化。hard 會把留言連鎖刪掉或變成無主留言；soft 的個資還在，30 天後還是要多做一次匿名化，不如一開始就做。' },
    { id: 'ecommerce', situation: '電商。訂單與發票依稅法要留 5 年，客服每週都有「誤刪請復原」，法規要求 30 天內清個資。', options: ['hard', 'soft', 'anonymize', 'archive'], answer: 'soft',
      explain: '30 天內要能復原，只有 soft 與 archive 做得到；訂單與發票在 soft 下完全不動，archive 則要處理 FK 變 NULL。所以 soft 配 partial unique index，再加一個排程：deleted_at 超過 30 天的列改成匿名化——兩段式，前 30 天可復原、之後合規。' },
    { id: 'employee', situation: '內部員工帳號。離職後帳號要立刻失效；稽核要能查「兩年前這筆操作是誰做的」；離職員工不會用同一個 email 重新註冊；權限查詢每個請求都 JOIN 員工表。', options: ['hard', 'soft', 'anonymize', 'archive'], answer: 'archive',
      explain: '權限查詢是熱路徑，主表留一堆已離職的列並且每條查詢都要過濾，是 soft 的成本所在；搬到 archive 表主表只剩在職員工。稽核 JOIN archive 表即可，operations 表的 FK 改成 SET NULL 並保留 actor_id 快照欄位。沒有重新註冊需求，也沒有強個資法規，archive 的兩個缺點都不成問題。' },
    { id: 'gdpr', situation: '歐洲客戶依 GDPR 提出刪除權請求。該帳號沒有任何訂單或發票（只註冊沒買過），公司對這類帳號沒有任何法定保留義務。', options: ['hard', 'soft', 'anonymize', 'archive'], answer: 'hard',
      explain: '沒有關聯資料要保、沒有保留義務、也沒有復原需求，真的 DELETE 是最簡單也最容易舉證的做法。soft 與 archive 的個資還在，等於沒有回應請求；匿名化留一列空殼沒有價值。備份裡的資料靠備份保留期政策處理，並在回覆使用者時說明。' },
  ],
  implementation: [
    { title: 'deleted_at 與 partial unique index', lang: 'sql', code: `ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;

-- 原本的 UNIQUE(email) 會擋掉重新註冊，換成只約束活人的唯一索引
ALTER TABLE users DROP CONSTRAINT users_email_key;
CREATE UNIQUE INDEX users_email_active_uniq
  ON users (email)
  WHERE deleted_at IS NULL;

-- 軟刪除 / 復原
UPDATE users SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;
UPDATE users SET deleted_at = NULL  WHERE id = $1;` },
    { title: '匿名化：一個交易裡覆寫個資並留稽核', lang: 'sql', code: `BEGIN;

INSERT INTO deletion_audit (user_id, email_hash, requested_at, reason)
SELECT id, encode(sha256(lower(email)::bytea), 'hex'), now(), 'user_request'
FROM users WHERE id = $1;

UPDATE users
SET name       = '已刪除的使用者 #' || id,
    email      = 'deleted-' || id || '@invalid',
    phone      = NULL,
    address    = NULL,
    avatar_url = NULL,
    deleted_at = now()
WHERE id = $1;

COMMIT;
-- 30 天排程：對 deleted_at < now() - interval '30 days' 且尚未匿名化的列跑同一段` },
    { title: '預設過濾：view 與 ORM 兩種寫法', lang: 'sql', code: `-- 1. 一般查詢改讀 view，忘了加 WHERE 也不會把死人列出來
CREATE VIEW active_users AS
  SELECT * FROM users WHERE deleted_at IS NULL;

-- 2. SQLAlchemy 2.0：全域加上 deleted_at IS NULL 條件
-- @event.listens_for(Session, "do_orm_execute")
-- def _filter_deleted(state):
--     if state.is_select and not state.execution_options.get("include_deleted"):
--         state.statement = state.statement.options(
--             with_loader_criteria(User, User.deleted_at.is_(None), include_aliases=True))
-- 需要看已刪除的地方（客服後台）明確傳 execution_options(include_deleted=True)` },
  ],
  exercise: 'sql-advanced-4',
  refs: [],
}
