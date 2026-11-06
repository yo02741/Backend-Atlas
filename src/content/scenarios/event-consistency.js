// 設計情境：事件和資料庫不同步（雙寫 / outbox / CDC）
export default {
  id: 'event-consistency',
  order: 27,
  group: 'traffic',
  title: '事件和資料庫不同步',
  en: 'Keeping events consistent with the database',
  level: 3,
  week: 10,
  skills: ['event-driven', 'queues-workers', 'distributed-basics', 'transactions'],
  lab: 'EventConsistencyScenarioLab',
  summary: '掛號寫進資料庫之後要通知 LINE、更新報表、同步給檢驗系統。先寫 DB 再 publish，哪一步會丟事件、哪一步會送兩次？',
  situation: '仁和醫院（虛構）的掛號服務：病患掛號成功後，要送 LINE 通知、更新當日報表、把預約同步給檢驗系統。目前的寫法是在 API handler 裡先寫 PostgreSQL、再 publish 一筆 `appointment.created` 事件到佇列，三個消費端各自訂閱。平日一天約 8,000 筆掛號，尖峰每分鐘兩百筆。最近檢驗系統反映偶爾少收到預約，LINE 則有病患收到兩則一樣的通知。',
  constraints: [
    '掛號成功就一定要有事件：檢驗系統少收一筆，病患到了現場沒有檢驗單',
    '交易回滾（例如時段已滿）時不能有事件送出去，否則 LINE 會通知一個不存在的掛號',
    '同一筆掛號的通知不能寄兩次；重複的事件可以存在，但效果只能發生一次',
    '通知延遲幾秒可以接受，幾分鐘不行',
    '團隊維運能力有限：多一個要顧的元件就要有人值班',
  ],
  options: [
    {
      id: 'dual', name: '雙寫：寫 DB，再 publish',
      summary: 'handler 裡先 `INSERT` 掛號列，再呼叫佇列的 `publish()`。兩個系統、兩次寫入，中間沒有任何東西把它們綁在一起。',
      pros: ['程式最短，沒有新元件', '事件幾乎即時送出'],
      cons: ['commit 之後、publish 之前程序被砍，事件就丟了；publish 失敗只能記 log 或自己重試', '如果 publish 寫在交易裡，交易回滾之後事件已經送出去，變成幽靈事件', 'publish 逾時後重試會送兩次；消費端沒有去重就會通知兩次'],
    },
    {
      id: 'outbox', name: 'Outbox：事件與業務資料同一交易',
      summary: '同一個交易裡 `INSERT` 掛號列與一筆 outbox 列（事件內容）。一個背景 relay 掃 outbox 表、送進佇列、標記已送出。至少一次送達，消費端用冪等鍵表去重。',
      pros: ['業務資料與事件要嘛一起 commit、要嘛一起回滾：不會丟、不會有幽靈事件', '只用到資料庫交易，不需要分散式交易', 'relay 掛了事件還在表裡，起來再送'],
      cons: ['多一個 relay 要維運、要監控 outbox 積壓', 'relay 送出後、標記前掛掉會重送：消費端一定要冪等', '事件比雙寫慢一拍：取決於 relay 的掃描間隔'],
    },
    {
      id: 'cdc', name: 'CDC：從資料庫日誌讀變更',
      summary: '不改應用程式。CDC 連接器（例如 Debezium 這一類）讀 PostgreSQL 的 WAL，把已 commit 的列變更轉成事件送進佇列。只有 commit 過的變更會出現在日誌裡。',
      pros: ['應用程式一行都不用改，所有表的變更都拿得到', '天生只有已 commit 的資料，沒有幽靈事件', '適合把既有系統的資料「流」出去給報表或搜尋'],
      cons: ['事件是「列變了」而不是「掛號成立了」：業務語意要在下游重建，schema 一改事件就跟著變', '連接器、replication slot、位移管理都是新的維運面；slot 卡住會讓 WAL 無限長大', '延遲取決於日誌讀取與連接器；重啟時會從上次位移重放，消費端仍要冪等'],
    },
  ],
  tradeoffs: {
    axes: ['丟事件', '幽靈事件', '重複送達', '延遲', '維運成本'],
    rows: [
      { option: 'dual', cells: ['差：commit 後程序被砍就丟', '差：publish 在交易裡時會有', '差：重試就重複，沒有去重', '好：幾十毫秒', '低：沒有新元件'] },
      { option: 'outbox', cells: ['好：同一交易', '好：同一交易', '中：relay 重送，靠消費端冪等', '中：relay 掃描間隔', '中：relay + outbox 積壓監控'] },
      { option: 'cdc', cells: ['好：日誌不會漏', '好：只有已 commit 的變更', '中：重啟重放，靠消費端冪等', '中：日誌讀取延遲', '高：連接器、slot、schema 變更'] },
    ],
  },
  decisions: [
    { id: 'lab-sync', situation: '檢驗系統少收預約是最嚴重的問題；團隊只有兩個後端工程師，PostgreSQL 已經有人在顧，沒有人管過 Kafka 或連接器。', options: ['dual', 'outbox', 'cdc'], answer: 'outbox',
      explain: '不能丟事件，雙寫就出局。outbox 只多一個 relay 程序，用的是團隊已經熟的資料庫交易；CDC 的連接器與 replication slot 是全新的維運面，兩個人顧不來。' },
    { id: 'reporting', situation: '要把掛號、看診、繳費十幾張表的變更都流到報表倉儲，應用程式是舊系統，沒人敢改。', options: ['dual', 'outbox', 'cdc'], answer: 'cdc',
      explain: '每張表都要改程式加 outbox 既危險又費工，而報表要的本來就是「列變了什麼」的資料變更，不需要業務語意。CDC 不碰應用程式、所有表一次拿到，是這類「資料流出去」需求的正解。' },
    { id: 'internal-tool', situation: '內部的值班表小工具，存檔後送一則群組通知；偶爾少一則通知沒人在意，多一則也只是多看一眼。', options: ['dual', 'outbox', 'cdc'], answer: 'dual',
      explain: '丟事件與重複都沒有後果時，雙寫的簡單就是優點。寫在 commit 之後、publish 失敗記個 log 就夠了；為它建 outbox 或 CDC 是殺雞用牛刀。' },
    { id: 'line-twice', situation: '已經用了 outbox，但 LINE 通知偶爾還是寄兩次。relay 的紀錄顯示同一筆事件在 relay 重啟時送了第二次。', options: ['dual', 'outbox', 'cdc'], answer: 'outbox',
      explain: '這不是 outbox 選錯，而是消費端沒做冪等：outbox 保證的是至少一次。在 LINE 消費端加冪等鍵表（事件 id 為主鍵，`INSERT … ON CONFLICT DO NOTHING`，插入成功才寄），重複的事件就只會寄一次。換成 CDC 一樣會重放，問題不會消失。' },
  ],
  implementation: [
    { title: 'outbox：業務列與事件列同一交易（PostgreSQL）', lang: 'sql', code: `CREATE TABLE outbox (
  id          uuid PRIMARY KEY,
  aggregate   text        NOT NULL,          -- 'appointment'
  type        text        NOT NULL,          -- 'appointment.created'
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz                    -- NULL = 尚未送出
);
CREATE INDEX outbox_unsent ON outbox (created_at) WHERE sent_at IS NULL;

BEGIN;
INSERT INTO appointments (id, patient_id, slot_id, status)
VALUES ($1, $2, $3, 'booked');

INSERT INTO outbox (id, aggregate, type, payload)
VALUES ($4, 'appointment', 'appointment.created',
        jsonb_build_object('appointment_id', $1, 'patient_id', $2, 'slot_id', $3));
COMMIT;   -- 兩列一起成功或一起回滾；時段已滿而回滾時，outbox 列也不存在

-- relay 每 200 ms 掃一次：鎖住一批未送出的列，送進佇列，再標記
SELECT id, type, payload FROM outbox
WHERE sent_at IS NULL
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
-- publish(...) 成功後：
UPDATE outbox SET sent_at = now() WHERE id = ANY($1);
-- publish 成功但 UPDATE 之前 relay 掛掉 → 下一輪會重送同一筆：消費端要冪等` },
    { title: '消費端冪等：事件 id 當鍵，插得進才做', lang: 'sql', code: `CREATE TABLE processed_events (
  consumer     text        NOT NULL,         -- 'line-notifier'：每個消費端各記各的
  event_id     uuid        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- 消費端收到事件：
BEGIN;
INSERT INTO processed_events (consumer, event_id)
VALUES ('line-notifier', $1)
ON CONFLICT DO NOTHING;
-- 回傳的影響列數 = 0 → 已處理過，直接 ack、不寄
-- 影響列數 = 1 → 第一次看到：在同一個交易裡做效果
INSERT INTO line_push_jobs (event_id, patient_id, message)
VALUES ($1, $2, $3);
COMMIT;
-- 寄信、推播這類外部副作用放在 commit 之後執行，並帶 event_id 當對方的冪等鍵；
-- 若 commit 前程序被砍，去重紀錄與效果一起回滾，事件重送時會再做一次` },
  ],
  exercise: 'event-driven-1',
  refs: [],
}
