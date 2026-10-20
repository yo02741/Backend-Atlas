## 從一個具體問題開始：改一個欄位名稱，停機六分鐘

`customers` 表的 `name` 欄位要改名成 `full_name`。新版程式（v2）改用 `full_name`，部署流程是「先跑 migration，再滾動更新三個 Pod」：

| 時間 | 資料庫 | 正在服務的版本 | 結果 |
|---|---|---|---|
| 14:00:00 | 執行 `ALTER TABLE customers RENAME COLUMN name TO full_name` | v1 ×3 | v1 查 `name`：`ERROR: column "name" does not exist` |
| 14:00:30 | | v1 ×2、v2 ×1 | 三分之二的請求失敗 |
| 14:03:00 | | v1 ×1、v2 ×2 | 三分之一的請求失敗 |
| 14:06:00 | | v2 ×3 | 恢復 |
| 14:20:00 | 發現 v2 另有 bug，想回滾 | | 回滾到 v1 會再壞一次：欄位已經叫 `full_name` 了 |

反過來「先部署再跑 migration」也一樣：v2 先上線時，`full_name` 還不存在。問題的根源是：**部署期間新舊版本一定會同時存在**，而這次的 schema 變更讓兩個版本不可能同時正常運作。

這一課講三件事：換版的幾種方式各自怎麼運作、怎麼讓資料庫變更與新舊版本都相容、以及什麼時候該自動停下來回滾。

## 部署與發布是兩件事

- **部署（deploy）**：新版程式在正式環境跑起來。
- **發布（release）**：使用者開始用到新的行為。

傳統做法兩者同時發生；分開之後，部署可以很頻繁、很無聊，發布則用 feature flag 或流量比例控制。下面的策略處理的是部署，feature flag 處理的是發布。

## 換版的方式

### rolling：一台一台換

新版的實例一個個起來、通過 readiness 後接流量，舊版的一個個下線。Kubernetes Deployment 的預設策略就是這個，`maxSurge` 與 `maxUnavailable` 控制一次換幾個，細節見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。

- 不需要額外的整套資源。
- 過程中**新舊版本同時服務**，可能持續幾分鐘到幾十分鐘。同一個使用者的連續請求可能先打到新版、再打到舊版。
- 回滾也是一次 rolling，同樣要時間。

### blue-green：兩套切換

準備兩套完整環境：blue（目前的正式版）與 green（新版）。green 部署好、驗證完，把流量入口（負載平衡器、Service 的 selector、DNS）一次切過去。出事就切回 blue。

- 切換幾乎是瞬間的，回滾也是。
- 需要兩倍的運算資源（至少在切換期間）。
- **資料庫通常只有一個**，blue 和 green 共用。所以 schema 一樣要跟兩個版本相容，blue-green 沒有解決 migration 的問題。
- 用 DNS 切換時，客戶端與中間的快取會依 TTL 繼續連到舊的位址一段時間，切換並不是真的瞬間。

### canary：先給一小部分流量

新版先接一小部分流量（例如 5%），和舊版（baseline）比較錯誤率與延遲，沒問題再逐步放大：

```text
5% ──觀察 10 分鐘──► 25% ──觀察 10 分鐘──► 50% ──► 100%
 │                    │
 └── 指標變差 ────────┴──► 流量切回 0%（回滾），只影響了那一小部分使用者
```

- 需要能**依比例分流**的基礎設施（service mesh、ingress controller 或負載平衡器的權重設定），以及能**分別看新舊版本指標**的監控。
- 需要**足夠的流量**：每分鐘只有 20 個請求的服務，5% 是一個請求，看不出任何東西。流量少時拉長觀察時間，或直接用較大的比例。
- 比較的對象是同一時段的舊版，而不是昨天的數字：流量尖峰、外部依賴變慢會同時影響兩邊。
- Argo Rollouts、Flagger 這類工具可以把放量步驟與自動判斷寫成設定。

### feature flag：程式已部署，功能另外打開

flag 讓「誰看得到新功能」與部署脫鉤：先對內部帳號開、再對 5% 使用者開、出事就關掉，不需要重新部署。百分比放量的實作見 [Git 工作流與分支策略](#/skill/git-workflow) 的 feature flag 一節。

| | rolling | blue-green | canary | feature flag |
|---|---|---|---|---|
| 新舊版同時存在 | 是，數分鐘 | 切換瞬間之外否 | 是，整個觀察期 | 是，同一份程式裡兩條路徑 |
| 額外資源 | 少 | 兩倍 | 少 | 無 |
| 回滾速度 | 再一次 rolling | 秒級切回 | 把比例調回 0 | 關掉 flag |
| 需要的基礎 | readiness probe | 流量切換點 | 分流與分版本指標 | flag 系統、清理紀律 |
| 對資料庫相容性的要求 | 有 | 有（共用資料庫） | 有 | 有 |

最後一列是重點：**沒有一種策略能免除 schema 相容性的要求**。

## 資料庫遷移與部署順序：expand–contract

規則只有一條：**任何時刻正在跑的所有版本，都要能跟當下的 schema 一起運作**。做法是把一個破壞性的變更拆成幾個各自相容的步驟，先擴張（expand），等所有舊版本都消失、確定不會回滾之後，再收縮（contract）。

把 `name` 改名成 `full_name`：

| 步驟 | schema | 程式版本 | 這一步完成時可以同時存在的版本 |
|---|---|---|---|
| 1. expand | 新增 `full_name`（可為空） | v1：只用 `name` | v1 |
| 2. 雙寫 | 同上 | v2：寫入兩欄、讀 `name` | v1、v2 |
| 3. 回填 | 分批把舊資料的 `full_name` 補上 | v2 | v1、v2 |
| 4. 切換讀取 | 加上 NOT NULL | v3：寫入兩欄、讀 `full_name` | v2、v3 |
| 5. 停止寫舊欄 | 同上 | v4：只用 `full_name` | v3、v4 |
| 6. contract | 刪除 `name` | v4 | v4 |

步驟 2 是關鍵：v1 和 v2 同時在跑時，v1 寫入的新資料只有 `name`，所以 v2 必須讀 `name`；等回填完成、v1 全部下線，v3 才能改讀 `full_name`。每一步都能單獨回滾到前一步，直到步驟 6；步驟 6 不可逆，要等到確定不會再回滾才做。

v1 在步驟 2 之後還會寫入只有 `name` 的資料。可以用資料庫 trigger 補齊，或在回填時把它們一起補上。下面在 PostgreSQL 裡實際走一遍步驟 1 到 4：

```sql run
CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL);
INSERT INTO customers (name) VALUES ('林小美'), ('陳大文'), ('王曉明');

-- 1. expand：新增可為空的欄位。只改 catalog，不重寫整張表
ALTER TABLE customers ADD COLUMN full_name text;

-- 過渡期：舊版程式只寫 name，用 trigger 把 full_name 補上（也可以在應用程式裡雙寫）
CREATE FUNCTION customers_sync_full_name() RETURNS trigger AS $$
BEGIN
  IF NEW.full_name IS NULL THEN NEW.full_name := NEW.name; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER customers_sync BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_sync_full_name();

INSERT INTO customers (name) VALUES ('舊版寫入的新客戶');   -- 舊版的 INSERT 照常成功

-- 3. 回填：真實資料要分批（例如每次 1,000 筆），避免一個大交易長時間鎖住大量列
UPDATE customers SET full_name = name WHERE full_name IS NULL AND id BETWEEN 1 AND 1000;

-- 4. 加 NOT NULL：先加 NOT VALID 的 CHECK（不掃表），再 VALIDATE（掃表但不擋寫入），
--    PostgreSQL 12 起 SET NOT NULL 會利用已驗證的 CHECK 跳過全表掃描
ALTER TABLE customers ADD CONSTRAINT customers_full_name_nn CHECK (full_name IS NOT NULL) NOT VALID;
ALTER TABLE customers VALIDATE CONSTRAINT customers_full_name_nn;
ALTER TABLE customers ALTER COLUMN full_name SET NOT NULL;
ALTER TABLE customers DROP CONSTRAINT customers_full_name_nn;

-- 舊版查 name、新版查 full_name，兩邊都能用
SELECT id, name, full_name FROM customers ORDER BY id;
```

### migration 的鎖與執行時機

- **`ALTER TABLE` 要拿最強的鎖**（ACCESS EXCLUSIVE）。指令本身很快，但如果有一個長交易還握著這張表，`ALTER` 會排隊等它，**排隊期間後面所有讀寫這張表的查詢也一起排隊**。migration 前先 `SET lock_timeout = '5s'`，拿不到鎖就失敗重試，而不是讓整個服務卡住。
- **建索引用 `CREATE INDEX CONCURRENTLY`**：不擋寫入，但不能在交易裡執行；很多 migration 工具預設把每個 migration 包在交易裡，要另外設定。
- **加有預設值的欄位**：PostgreSQL 11 起，加上預設值不是 volatile 的欄位（常數，或 `now()` 這種在 `ALTER` 當下算一次的值）不需要重寫整張表；預設值是 `random()`、`clock_timestamp()` 這類每列結果不同的 volatile 函式時，仍然要重寫。
- **執行時機**：expand 類的 migration 在部署新版**之前**跑（舊版不受影響，新版需要它）；contract 類的在確定所有舊版下線、過了回滾窗口**之後**才跑。migration 通常由 CI 的一個獨立 job 執行一次；讓每個應用程式實例啟動時自己跑 migration，多個副本同時啟動就會同時嘗試，要確認工具有沒有處理並行。
- migration 工具（Alembic 等）的寫法見 [ORM 與 migration](#/skill/orm-migrations)。

下面用一段 Python 檢查一個部署計畫的每個階段，是不是所有同時存在的版本都跟當下的 schema 相容：

```python run
# 每個版本需要哪些欄位存在；每個 schema 階段有哪些欄位
NEEDS = {"v1": {"name"}, "v2": {"name", "full_name"}, "v3": {"name", "full_name"}, "v4": {"full_name"}}

def check(plan):
    ok = True
    for step, columns, running in plan:
        bad = [v for v in running if not NEEDS[v] <= columns]
        mark = "OK  " if not bad else "壞掉"
        ok = ok and not bad
        print(f"{mark} {step:<26} 欄位 {sorted(columns)}  執行中 {running}" + (f"  → {bad} 找不到欄位" if bad else ""))
    return ok

print("直接改名：")
check([
    ("rename 之前",         {"name"},      ["v1", "v1"]),
    ("rename 後、滾動更新中", {"full_name"}, ["v1", "v4"]),
    ("滾動更新完成",          {"full_name"}, ["v4", "v4"]),
])

print("\nexpand–contract：")
check([
    ("1. 新增 full_name",    {"name", "full_name"}, ["v1", "v1"]),
    ("2. 部署雙寫的 v2",     {"name", "full_name"}, ["v1", "v2"]),
    ("4. 部署改讀新欄的 v3", {"name", "full_name"}, ["v2", "v3"]),
    ("5. 部署只用新欄的 v4", {"name", "full_name"}, ["v3", "v4"]),
    ("6. 刪除 name",         {"full_name"},         ["v4", "v4"]),
])
```

把第二個計畫的步驟 6 提前到 v3 還在跑的時候，就會看到哪裡壞掉。

## 回滾還是往前修

出事時有兩條路：回到上一版（roll back），或盡快修好再部署一版（roll forward）。

| 狀況 | 傾向 | 原因 |
|---|---|---|
| 上一版的 artifact 還在、schema 仍相容 | 回滾 | 回到已知可用的狀態，幾分鐘內止血，再慢慢查原因 |
| 新版已經寫入了舊版看不懂的資料，或跑過不可逆的 migration | 往前修 | 回滾會讓舊版碰到它不認得的資料，可能更糟 |
| 問題只在新功能、而且有 flag | 關 flag | 不用動部署 |
| 修正只有一行、而且很確定 | 視情況 | 往前修也要走完整的 CI，壓力下跳過檢查是二次事故的常見來源 |

預設應該是**先回滾、再修**。要讓回滾一直是可行的選項：

- 每次部署用不可變的 artifact（image digest），上一版隨時可以再部署。
- migration 照 expand–contract 拆，讓上一版跟目前的 schema 相容。
- 回滾要演練過，而且是自動化的一個步驟，不是當下臨時拼湊的指令。

## 部署前後的檢查與自動回滾

**部署前**（CI 或部署工具自動檢查）：

- 這個 commit 的 CI 全部通過，artifact 存在。
- migration 是 expand 類，或確認目前沒有任何需要舊欄位的版本在跑。
- 不在凍結期間或尖峰時段（依團隊規則）。

**部署中與部署後**：

- **readiness**：新實例通過才接流量；一直不通過時 rolling 會停住，舊版繼續服務。
- **smoke test**：部署完立刻打幾個關鍵端點（健康檢查、登入、一個讀取 API）。
- **觀察期（bake time）**：canary 或 rolling 的每一步之後等一段時間，比較新舊版本的指標。

自動回滾的條件，要用**新舊版本的比較**而不是固定門檻，並且要有**最少樣本數**：

| 指標 | 例子 |
|---|---|
| 錯誤率 | canary 的 5xx 比例比 baseline 高超過 1 個百分點 |
| 延遲 | canary 的 p95 比 baseline 高 50% 以上 |
| 飽和度 | CPU、記憶體、連線池使用率明顯高於 baseline |
| 程序穩定性 | 新版 Pod 重啟（CrashLoopBackOff）、OOMKilled |
| 業務指標 | 結帳成功率、登入成功率下降 |

樣本不夠時不要做結論：5% 的流量在 10 分鐘內只有 30 個請求，一個錯誤就是 3.3%。指標怎麼收、百分位數怎麼算見 [可觀測性：log、metrics、trace](#/skill/observability)；告警門檻與錯誤預算見 [SLI、SLO 與錯誤預算](#/skill/slo-error-budget)。

## 常見錯誤與錯誤訊息

| 訊息／現象 | 原因 | 怎麼處理 |
|---|---|---|
| 部署期間零星出現 `ERROR: column "name" does not exist` | schema 變更與正在跑的某個版本不相容 | 改成 expand–contract；已經發生時，先讓所有實例都換成相容的版本 |
| migration 卡住，同時大量請求逾時 | `ALTER TABLE` 在等鎖，後面的查詢排在它後面 | 設 `lock_timeout`，找出長交易（`pg_stat_activity`），離峰重試 |
| `canceling statement due to lock timeout` | `lock_timeout` 生效，migration 沒拿到鎖 | 這是預期的保護；重試，或先處理掉長交易 |
| `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` | migration 工具把它包進交易 | 依工具的方式讓這個 migration 不在交易裡執行 |
| `deployment "shop-api" exceeded its progress deadline` | 新版 Pod 一直沒有 ready，rolling 停住 | 看新 Pod 的事件與 log（`kubectl describe pod`），修好或 `kubectl rollout undo` |
| blue-green 切換後，部分使用者仍連到舊版 | DNS TTL、客戶端或中間層快取了舊位址；或長連線還連著舊環境 | 降低 TTL、在負載平衡器層切換、舊環境保留到連線排空 |
| canary 期間同一個使用者的畫面忽新忽舊 | 分流沒有黏著性，每個請求隨機分配 | 依使用者或 session 分流 |

## 動手

1. 執行上面的 SQL，在最後加一句 `ALTER TABLE customers DROP COLUMN name;`，再執行 `SELECT id, name FROM customers;`，看看還沒下線的 v1 會遇到什麼錯誤。
2. 執行 Python 那段，把 expand–contract 計畫的步驟 6 移到 v3 還在跑的階段，確認檢查會指出哪個版本壞掉。
3. 規劃「把 `orders.amount` 從整數元改成 `numeric(12,2)`」的步驟：寫出每一步的 schema、程式版本與可以同時存在的版本。
4. 到本課的程式題：寫一個 canary 判斷函式，依新舊版本的錯誤率與延遲決定繼續放量、暫停或回滾。
