## 從一個具體問題開始：備份每天都成功，還原卻救不回來

下午 2:05，有人在正式環境執行了一句少了 `WHERE` 的 `DELETE FROM orders;`。團隊的備份排程每天凌晨 3:00 跑 `pg_dump`，監控顯示每一次都「成功」。接下來發生的事：

| 時間 | 發生什麼 |
|---|---|
| 14:05 | 誤刪，`orders` 清空 |
| 14:20 | 決定還原，找到凌晨 3:00 的備份檔（40 GB） |
| 14:40 | 開一台新機器開始 `pg_restore`，發現備份裡沒有資料庫角色，先手動補建 |
| 19:30 | 還原完成：資料搬回去只花一半時間，另一半在重建索引 |
| 19:30 | 03:00 到 14:05 之間的 11 小時訂單**沒有任何備份** |

兩個數字決定了這次事故的大小：

- **RPO（Recovery Point Objective）**：最多可以丟失多久的資料。每天一次 dump，RPO 就是最多 24 小時。
- **RTO（Recovery Time Objective）**：從決定還原到服務恢復要多久。沒演練過，就沒有人知道是 5 小時。

「備份成功」只代表檔案產生了。能不能在可以接受的時間內還原到可以接受的時間點，要靠備份方式的選擇和定期演練。

## 備份：邏輯備份、實體備份與 PITR

| | 邏輯備份（`pg_dump`） | 實體備份（`pg_basebackup` + WAL 歸檔） |
|---|---|---|
| 內容 | SQL 指令或自訂格式：建表、資料、索引定義 | 資料目錄的檔案複本 |
| 範圍 | 單一資料庫（角色等全域物件要另外 `pg_dumpall --globals-only`） | 整個叢集（所有資料庫、角色） |
| 一致性 | 在一個交易快照裡匯出，備份期間可以照常讀寫 | 備份期間的變更靠 WAL 補齊 |
| 還原速度 | 慢：要重新插入資料、重建每個索引 | 快：檔案放回去、重播 WAL |
| 可還原到 | 備份那一刻 | 有 WAL 歸檔時，可以到任意時間點（PITR） |
| 跨大版本 | 可以（升級常用這個方式） | 不行，要同一個大版本 |

### WAL 與時間點還原（PITR）

PostgreSQL 的每一筆變更都先寫進 WAL（Write-Ahead Log，預寫日誌），再寫進資料檔。把 WAL 檔持續複製到別的地方（歸檔），就等於有一份「從某個基準備份開始的所有變更紀錄」。還原時：

1. 把最近一次的基準備份（base backup）放回資料目錄
2. 設定 `restore_command`，讓 PostgreSQL 從歸檔區取回 WAL 檔
3. 設定 `recovery_target_time = '2026-10-20 14:04:00+08'`，重播到誤刪前一分鐘就停
4. 建立 `recovery.signal` 檔（PostgreSQL 12 起的做法），啟動

這樣 RPO 就從 24 小時縮短到「最後一個成功歸檔的 WAL 檔」，通常是分鐘級。實務上很少手寫 `archive_command`，常用 pgBackRest、Barman、WAL-G 這類工具管理基準備份、WAL 歸檔與保存期限。受管服務（RDS、Cloud SQL 等）的自動備份多半已經包含 PITR，要確認的是保存天數與還原流程。

```bash
# 邏輯備份：自訂格式（-Fc）可以用 pg_restore 選擇性還原、平行還原
pg_dump -h db.internal -U backup -d shop -Fc -f shop-$(date +%F).dump
pg_dumpall -h db.internal -U postgres --globals-only > globals.sql   # 角色、權限

# 實體備份：整個叢集的基準備份，-X stream 一併帶上備份期間的 WAL
pg_basebackup -h db.internal -U replicator -D /backup/base-$(date +%F) -Ft -z -X stream

# postgresql.conf：開啟 WAL 歸檔（改 archive_mode 要重啟）
# wal_level = replica
# archive_mode = on
# archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'   # 文件裡的範例；正式環境用備份工具
```

不管哪一種，備份都要**放在另一個地方**：同一台機器、同一個磁碟、同一個雲端帳號裡的備份，會跟資料庫一起消失。

## 還原演練

還原演練的目的是回答三個問題：備份檔能用嗎、要多久、步驟寫下來了嗎。做法是定期（例如每個月）在一台**跟正式環境分開的機器**上完整還原一次：

```bash
#!/usr/bin/env bash
# 還原演練：在獨立的機器還原最新備份，記錄花費時間並做基本檢查
set -euo pipefail
start=$(date +%s)

createdb -h restore-test shop_restore
psql -h restore-test -d postgres -f globals.sql              # 先建角色，否則 OWNER / GRANT 會失敗
pg_restore -h restore-test -d shop_restore -j 4 --exit-on-error latest.dump   # -j 平行還原

# 檢查：資料量與最新一筆資料的時間，跟正式環境的監控數字對照
psql -h restore-test -d shop_restore -c "SELECT count(*) FROM orders;"
psql -h restore-test -d shop_restore -c "SELECT max(created_at) FROM orders;"

echo "還原花了 $(( $(date +%s) - start )) 秒"   # 這就是你的 RTO 下限
```

要記下的是：總時間（拆成搬資料、建索引、補角色）、每一個手動步驟、還原出來的最新資料時間點。手動步驟要寫進腳本或操作手冊，否則事故當下一定有人忘記。

誤刪單一張表時，常見做法是還原到另一個資料庫（`pg_restore -t orders` 只還原一張表），再把需要的列複製回去，而不是覆蓋整個正式資料庫。

## 連線：max_connections 與連線池

PostgreSQL 為每個連線開一個後端程序（process），每個都要記憶體，排序或 hash 時還依 `work_mem` 再要更多；連線多到某個程度，程序切換與鎖競爭會讓整體吞吐量下降。`max_connections` 預設是 100，正式環境通常也只設到幾百。

先看自己的資料庫目前的設定與連線狀態：

```sql run
-- context 欄位說明改這個設定要做什麼：postmaster = 要重啟；sighup = reload 即可；user = 每個連線自己可以 SET
SELECT name, setting, unit, context FROM pg_settings
WHERE name IN ('max_connections', 'superuser_reserved_connections', 'work_mem',
               'statement_timeout', 'idle_in_transaction_session_timeout', 'log_min_duration_statement')
ORDER BY name;

-- 每種狀態各有幾個連線；正式環境要特別注意 idle in transaction
SELECT backend_type, state, count(*) FROM pg_stat_activity GROUP BY backend_type, state;
```

瀏覽器裡的 PGlite 是單一連線的嵌入式版本，`pg_stat_activity` 只會看到自己；正式環境的同一句查詢會列出每一個用戶端連線（`client backend`），以及 autovacuum、WAL writer 等背景程序。

### 算連線預算

應用程式端的連線池上限加起來，必須小於 `max_connections` 扣掉保留給管理用途的數量：

| 項目 | 數字 |
|---|---|
| API：6 個 Pod × 每個 4 個 worker 程序 | 24 個連線池 |
| 每個池（SQLAlchemy 預設 `pool_size=5`、`max_overflow=10`） | 最多 15 |
| API 最壞情況 | 24 × 15 = 360 |
| 背景工作：2 個 Pod × 8 個 worker × 5 | 80 |
| 合計 | 440，遠超過預設的 100 |

這個數字在流量尖峰、或 Pod 自動擴展到 12 個時才會出現，平常完全看不到。連線用光時新連線會得到 `FATAL: sorry, too many clients already`。

### PgBouncer 與 transaction mode

PgBouncer 放在應用程式與 PostgreSQL 之間：應用程式開幾百個連線到 PgBouncer，PgBouncer 只用少量真正的資料庫連線輪流服務它們。三種模式：

| 模式 | 一個資料庫連線被借出多久 | 共用程度 | 限制 |
|---|---|---|---|
| `session` | 用戶端連線的整個生命週期 | 低：只省去建立連線的成本 | 幾乎沒有 |
| `transaction` | 一個交易 | 高：最常用 | 跨交易的連線狀態不保證保留 |
| `statement` | 一句 SQL | 最高 | 不允許多句交易 |

transaction mode 下，同一個用戶端的兩個交易可能跑在不同的資料庫連線上，所以**依賴連線狀態的功能**會出問題：

- `SET search_path` / `SET statement_timeout` 這種 session 層級設定：下一個交易可能在另一條連線上，設定不見了，或反過來污染別人的連線。交易內用 `SET LOCAL`。
- session 層級的 advisory lock（`pg_advisory_lock`）：鎖在哪條連線上就無法掌握。改用交易層級的 `pg_advisory_xact_lock`。
- `LISTEN` / `NOTIFY` 的 LISTEN 端、`WITH HOLD` cursor、跨交易使用的暫存表。
- Prepared statement：PgBouncer 1.21 起可以設定 `max_prepared_statements` 支援協定層級的 prepared statement；較舊的版本要在驅動端關掉（例如 asyncpg 設 `statement_cache_size=0`）。

資料庫端真正的連線數由 PgBouncer 的 `default_pool_size` 統一控制。設定範例見設計情境 [資料庫撐不住了](#/scenario/db-scaling)。

## 慢查詢：先量再改

優化從「哪條查詢總共花掉最多時間」開始，不是從「看起來最複雜的那條」開始。兩個工具：

- **`log_min_duration_statement`**：超過這個時間的查詢會連同參數寫進 log。設成 `500ms` 是常見起點；設成 `0` 會記錄所有查詢，量大時 log 本身就是負擔。可以 `ALTER SYSTEM SET` 後 reload 生效，不用重啟。
- **`pg_stat_statements`**：擴充套件，把同形狀的查詢正規化（參數換成 `$1`）後累計次數與時間。要先加進 `shared_preload_libraries`（需要重啟），再 `CREATE EXTENSION`。

```sql
-- 總耗時最高的 10 條查詢（PostgreSQL 13 起欄位名是 total_exec_time / mean_exec_time）
SELECT calls,
       round(total_exec_time::numeric / 1000, 1) AS total_s,
       round(mean_exec_time::numeric, 2)         AS mean_ms,
       rows,
       left(query, 80)                           AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

一條平均 2 ms、每天 500 萬次的查詢，總耗時可能遠超過平均 3 秒、每天 20 次的報表；前者通常是 N+1 或缺索引，見 [ORM 與 migration](#/skill/orm-migrations) 與 [索引與查詢計畫](#/skill/indexes)。

兩個防護性設定：`statement_timeout`（單句太久就取消，可針對角色設定 `ALTER ROLE app SET statement_timeout = '5s'`）與 `idle_in_transaction_session_timeout`（交易開著不動太久就斷線）。

## VACUUM、autovacuum 與表膨脹

MVCC 下，`UPDATE` 寫出新版本、`DELETE` 只標記刪除，舊版本（dead tuple）留在資料檔裡，直到 `VACUUM` 確認沒有任何交易還需要它，才把空間標成可重用。原理見 [交易與隔離等級](#/skill/transactions)。可以直接看到一次全表 UPDATE 讓表變成兩倍大：

```sql run
-- 建一張 2 萬列的表，全部更新一次，看資料檔大小
CREATE TABLE events (id bigint PRIMARY KEY, payload text);
INSERT INTO events SELECT g, repeat('x', 100) FROM generate_series(1, 20000) g;
SELECT '插入後' AS 時機, pg_size_pretty(pg_relation_size('events')) AS 資料檔, pg_size_pretty(pg_total_relation_size('events')) AS 含索引;

UPDATE events SET payload = repeat('y', 100);   -- 每一列都寫出新版本，舊版本還在
SELECT '全表 UPDATE 後' AS 時機, pg_size_pretty(pg_relation_size('events')) AS 資料檔, pg_size_pretty(pg_total_relation_size('events')) AS 含索引;
```

幾個關鍵事實：

- **一般的 `VACUUM` 不會把檔案變小**（只有檔案尾端整段空出來時才會截掉），它讓空間可以被之後的寫入重用。表不會無限長大，但也不會縮回去。
- **`VACUUM FULL` 會重寫整張表、真的縮小**，但全程拿 ACCESS EXCLUSIVE 鎖，大表上等於停機。不停機縮表常見的做法是第三方工具 pg_repack。
- **autovacuum 的觸發條件**：dead tuple 數超過 `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × 表的列數`，預設是 50 + 0.2 × 列數。1 億列的表要累積 2,000 萬個 dead tuple 才會觸發，對大表太晚；可以針對單一表調整：`ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.01);`。

```sql run
-- 預設參數下，不同大小的表要累積多少 dead tuple 才會觸發 autovacuum
SELECT n AS 表的列數,
       (50 + 0.2 * n)::bigint  AS 預設門檻,
       (50 + 0.01 * n)::bigint AS "scale_factor 0.01 時"
FROM unnest(ARRAY[1000, 100000, 10000000, 100000000]) AS n;
```

**什麼會讓 VACUUM 清不掉**：VACUUM 只能清掉「所有交易都不再需要」的版本。一個開了 6 小時的交易（或 idle in transaction 的連線）、一個沒人消費的 replication slot，都會讓這 6 小時內產生的所有 dead tuple 留著。表膨脹時先查最老的交易：

```sql
SELECT pid, usename, state, now() - xact_start AS xact_age, left(query, 60)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 5;

-- 各表的 dead tuple 與上次 autovacuum 時間
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

VACUUM 還有另一個工作：凍結（freeze）舊的交易編號，防止 32 位元的交易編號繞回（transaction ID wraparound）。`SELECT datname, age(datfrozenxid) FROM pg_database;` 看的是最舊未凍結交易的年齡；超過 `autovacuum_freeze_max_age`（預設 2 億）時 autovacuum 會強制凍結。這個數字遠超過門檻還持續上升，代表凍結一直沒完成（常見原因同樣是長交易），要立刻處理；細節以官方文件 Routine Vacuuming 一章為準。

## 監控指標

| 指標 | 從哪裡看 | 要警覺的訊號 |
|---|---|---|
| 連線使用率 | `pg_stat_activity` 筆數 / `max_connections` | 持續超過 80%；idle in transaction 很多 |
| 最老的交易 | `pg_stat_activity.xact_start` | 超過幾分鐘（擋 VACUUM、握著鎖） |
| 等待鎖的查詢 | `pg_stat_activity.wait_event_type = 'Lock'` | 數量突然上升，通常是 migration 或長交易 |
| 快取命中率 | `pg_stat_database` 的 `blks_hit / (blks_hit + blks_read)` | 明顯下降：工作集超過記憶體 |
| 複寫延遲 | 主庫 `pg_stat_replication` 的 lag 欄位 | 讀副本資料變舊，見 [讀寫分離](#/scenario/replica-consistency) |
| dead tuple、表大小 | `pg_stat_user_tables`、`pg_total_relation_size` | 持續成長、autovacuum 很久沒跑 |
| 磁碟使用率 | 主機或受管服務指標 | WAL 歸檔失敗時 WAL 會堆在本機，磁碟會被吃光 |
| 慢查詢 | `pg_stat_statements`、慢查詢 log | 新部署後某條查詢的總耗時跳升 |
| 備份 | 備份工具的最後成功時間、最近一次演練 | 超過一個週期沒有成功備份 |

```sql run
-- 每張表與它的索引各占多少空間；正式環境用同一句找出最大的表
SELECT relname AS 表,
       pg_size_pretty(pg_relation_size(relid))       AS 資料,
       pg_size_pretty(pg_indexes_size(relid))        AS 索引,
       pg_size_pretty(pg_total_relation_size(relid)) AS 合計
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

SELECT pg_size_pretty(pg_database_size(current_database())) AS 整個資料庫;
```

## 常見錯誤與錯誤訊息

| 錯誤訊息 | 原因 | 怎麼處理 |
|---|---|---|
| `FATAL: sorry, too many clients already` | 連線數達到 `max_connections` | 算連線預算、縮小各池上限、加 PgBouncer；不要直接把 `max_connections` 調到幾千 |
| `pg_dump: error: aborting because of server version mismatch` | `pg_dump` 的版本比伺服器舊 | 用與伺服器相同或更新的 `pg_dump` |
| `ERROR: role "app" does not exist`（還原時） | 備份裡沒有角色 | 先還原 `pg_dumpall --globals-only` 的輸出，或 `pg_restore --no-owner` |
| `prepared statement "…" does not exist` | transaction mode 的 PgBouncer 上，prepared statement 建在另一條連線 | 升級 PgBouncer 並設定 `max_prepared_statements`，或在驅動關閉 prepared statement 快取 |
| `canceling statement due to statement timeout` | 超過 `statement_timeout` | 這是保護；找出那條查詢優化，而不是把 timeout 拉長 |
| `terminating connection due to idle-in-transaction timeout` | 交易開著不動超過 `idle_in_transaction_session_timeout` | 找出應用程式在交易中做了什麼（等外部 API、忘了 commit） |
| `could not extend file "…": No space left on device` | 磁碟滿了 | 先看 WAL 目錄是否因歸檔失敗或廢棄的 replication slot 堆積 |

## 動手

1. 執行表膨脹那段，然後在 Playground 單獨執行 `VACUUM events;`（VACUUM 不能和其他指令放在同一次執行裡），再查一次 `pg_relation_size('events')`，確認一般 VACUUM 不會讓檔案變小；接著試 `VACUUM FULL events;` 比較結果。
2. 在 Playground 執行 `ALTER TABLE events SET (autovacuum_vacuum_scale_factor = 0.01);`，再查 `SELECT reloptions FROM pg_class WHERE relname = 'events';` 看單表設定存在哪裡。
3. 用「算連線預算」那張表，把你的服務代入：Pod 數、worker 數、每個池的上限，再加上自動擴展的上限。
4. 寫一份自己的還原演練腳本，排進行事曆，第一次執行時記下 RTO。
