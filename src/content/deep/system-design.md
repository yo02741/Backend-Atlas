## 從一個具體問題開始：短網址服務的第一版架構圖

需求只有一句話：「做一個公司內部用的短網址服務，行銷活動會用到。」第一版設計很快就畫出來了：API gateway、建立服務、轉址服務、統計服務、Kafka 收點擊事件、Cassandra 存網址、Redis 叢集做快取，一共七個元件。

評審會上的問題，一個都答不出來：

- 一天會建立多少個短網址？轉址多少次？
- 轉址要多快？服務掛掉五分鐘，影響是什麼？
- 短網址可以修改目的地嗎？要不要統計點擊？要不要過期？
- 有人拿它做釣魚連結時，怎麼停用？

回頭估算之後發現：一天大約 10 萬個新網址、1,000 萬次轉址，尖峰每秒幾百次轉址。這個量一台 PostgreSQL 加一個 Redis 就綽綽有餘。七個元件的設計不是「錯」，而是在沒有數字的情況下，替一個不存在的問題付出了七份維運成本。

系統設計的思考框架就是為了避免這件事：**先把需求和數字問清楚，再決定架構，每一個元件都要能說出它在解決哪個數字帶來的問題。**

## 六個步驟

| 步驟 | 產出 | 要回答的問題 | 相關課程 |
|---|---|---|---|
| 1. 釐清需求 | 功能清單、非功能需求、明確不做的事 | 誰在用？做什麼？多快、多可靠？ | |
| 2. 粗估規模 | QPS（平均與尖峰）、讀寫比、儲存量 | 數量級是多少？ | [容量規劃](#/skill/capacity-planning) |
| 3. API 與資料模型 | 端點、核心資料表、索引 | 資料怎麼被讀、怎麼被寫？ | [REST 設計](#/skill/rest-design)、[資料建模](#/skill/data-modeling) |
| 4. 高層架構 | 元件圖與資料流 | 每個元件為什麼在這裡？ | [擴展](#/skill/scaling) |
| 5. 找瓶頸、加東西 | 「流量變 10 倍時先爆什麼」與對策 | 哪裡先撐不住？哪裡是單點？ | [Redis 快取](#/skill/redis-cache)、[訊息佇列](#/skill/queues-workers) |
| 6. 講取捨 | 每個重要決定的選項與理由 | 為什麼選這個？放棄了什麼？ | [ADR](#/skill/ai-adr) |

順序很重要：第 4 步的每一個方塊，都要能回指到第 1、2 步的某個需求或數字。下面用短網址服務走一遍。

## 1. 釐清需求

**功能需求**（使用者能做什麼）：

- 輸入一個長網址，得到一個短網址；可選擇自訂代碼與到期時間。
- 打開短網址時轉到原網址。
- 建立者可以看每天的點擊數、停用自己的連結。
- 管理員可以停用任何連結（處理檢舉）。

**非功能需求**（做得多好）：

| 項目 | 這個服務的答案 | 影響到的設計 |
|---|---|---|
| 規模 | 每天約 10 萬個新網址、1,000 萬次轉址 | 第 2 步的估算 |
| 延遲 | 轉址在伺服器端要很快（例如 p99 幾十毫秒內），建立可以慢一點 | 轉址路徑要快取 |
| 可用性 | 轉址比建立重要：活動連結已經印在海報上 | 轉址路徑不能依賴太多元件 |
| 一致性 | 建立後要立刻可用；點擊數晚幾分鐘沒關係 | 建立走主庫；點擊數可以非同步 |
| 持久性 | 已發出去的短網址不能遺失 | 資料庫備份與還原演練 |
| 安全 | 防濫用（大量建立釣魚連結）、代碼不能被輕易列舉 | 建立端點限流、代碼隨機 |

**明確不做的事**：連結預覽頁、A/B 測試導流、即時的點擊儀表板。把它們寫下來，評審時就不會為了一個沒人要的功能爭論架構。

需求不清楚時，先問；問不到就寫下假設（「假設尖峰是平均的 5 倍」），讓別人可以挑戰它。

## 2. 粗估規模

公式很簡單：每天的量 ÷ 86,400 = 每秒平均；再乘上尖峰倍數。儲存量 = 每天新增筆數 × 每筆大小 × 保留天數。數量級對就好：答案是 600 QPS 還是 700 QPS 不影響設計，600 和 60,000 才會。

```python run
import math

# 1. 粗估：短網址服務（數字是假設值，要換成自己的）
creates_per_day = 100_000          # 每天新建的短網址
redirects_per_day = 10_000_000     # 每天的轉址次數（讀寫比 100:1）
peak_factor = 5                    # 尖峰是平均的幾倍（實際要看流量曲線）
bytes_per_link = 500               # 一筆資料加上索引的粗估
years = 5

def per_sec(per_day):
    return per_day / 86_400        # 一天 86,400 秒

print(f"建立：平均 {per_sec(creates_per_day):.1f}/s，尖峰約 {per_sec(creates_per_day) * peak_factor:.0f}/s")
print(f"轉址：平均 {per_sec(redirects_per_day):.0f}/s，尖峰約 {per_sec(redirects_per_day) * peak_factor:.0f}/s")
links = creates_per_day * 365 * years
print(f"{years} 年累積 {links / 1e6:.1f} 百萬筆，約 {links * bytes_per_link / 1e9:.0f} GB")

# 2. 短碼要幾個字元：base62（0-9、a-z、A-Z）
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
for length in (6, 7, 8):
    space = 62 ** length
    print(f"{length} 碼：{space:,} 種，是 {years} 年用量的 {space / links:,.0f} 倍")

# 3. 用遞增 id 轉 base62：短、不會碰撞，但可以被猜
def base62(n: int) -> str:
    out = []
    while True:
        n, r = divmod(n, 62)
        out.append(ALPHABET[r])
        if n == 0:
            return "".join(reversed(out))

for n in (1, 61, 62, 125_000_000, 125_000_001):
    print(f"id {n:>11,} → {base62(n)}")

# 4. 隨機 7 碼：猜不到，但會碰撞嗎？
space = 62 ** 7
p_next = links / space                                     # 已有 links 筆時，下一個新碼撞到的機率
p_any = 1 - math.exp(-links * (links - 1) / (2 * space))   # 生日問題：全部裡至少一次碰撞
print(f"已有 {links / 1e6:.1f} 百萬筆時，新產生的一碼撞到的機率約 {p_next:.4%}")
print(f"{years} 年內至少發生一次碰撞的機率約 {p_any:.0%}：一定要有 UNIQUE 約束 + 重試")
```

從這些數字可以直接讀出設計方向：

- **轉址尖峰每秒幾百次、建立每秒個位數**：這是讀取為主的系統，寫入量小到不需要特別處理。
- **5 年約 1.8 億筆、百 GB 等級**：一台 PostgreSQL 放得下，不需要分片。
- **7 碼 base62 有 3.5 兆種**：用量的上萬倍，夠用。
- **隨機產生代碼時，單次碰撞機率很低，但累積下來一定會發生**：不能「機率很低所以不處理」，要靠資料庫的唯一約束在碰撞時重試。

這個例子沒有用到「每台機器能撐多少」的換算。需要決定機器數量與規格時，從尖峰 RPS 推到核心數、記憶體與磁碟的方法見 [容量規劃](#/skill/capacity-planning) 與 [容量估算](#/lab/CapacityLab) 實驗室。

## 3. API 與資料模型

```http
POST /links            {"url": "https://…", "alias": "spring", "expires_at": "…"}   → 201 {"code": "aZ3kP9q", "short_url": "…"}
GET  /{code}           → 302 Location: https://…（不存在或已停用 → 404，過期 → 410）
GET  /links/{code}/stats?from=2026-10-01&to=2026-10-20                            → 每日點擊數
POST /links/{code}/disable                                                        → 204
```

一個值得在這一步就決定的細節：**轉址用 301 還是 302**。301 是永久轉址，依 HTTP 規範預設可以被快取，瀏覽器會記住它，之後不再問伺服器。好處是省流量，壞處是伺服器再也看不到那些點擊，連結被停用或改目的地時，已經快取的瀏覽器也不會知道。這個服務需要點擊數也需要能停用，所以用 302。

資料模型：

```sql run
-- 短網址本體：轉址只需要用 code 查一筆，主鍵就夠了
CREATE TABLE links (
  code        TEXT PRIMARY KEY,
  target_url  TEXT NOT NULL CHECK (target_url ~ '^https?://'),
  owner_id    BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ
);

-- 點擊數以「每個連結每天一列」彙總，而不是每次點擊寫一列
CREATE TABLE link_clicks_daily (
  code   TEXT NOT NULL REFERENCES links(code),
  day    DATE NOT NULL,
  clicks BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (code, day)
);

INSERT INTO links (code, target_url, owner_id) VALUES ('aZ3kP9q', 'https://example.com/spring-sale', 1);
INSERT INTO links (code, target_url, owner_id, expires_at)
VALUES ('Qm81xTe', 'https://example.com/old-event', 2, now() - interval '1 day');

-- 隨機代碼撞到既有的：ON CONFLICT DO NOTHING 回傳 0 列，應用程式換一個代碼重試
INSERT INTO links (code, target_url, owner_id) VALUES ('aZ3kP9q', 'https://example.com/other', 3)
ON CONFLICT (code) DO NOTHING
RETURNING code;

-- 轉址查詢：存在、沒停用、沒過期
SELECT target_url FROM links
WHERE code = 'aZ3kP9q' AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > now());
SELECT target_url FROM links
WHERE code = 'Qm81xTe' AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > now());

-- worker 把一段時間內累積的點擊數一次加進去
INSERT INTO link_clicks_daily (code, day, clicks) VALUES ('aZ3kP9q', '2026-10-20', 120)
ON CONFLICT (code, day) DO UPDATE SET clicks = link_clicks_daily.clicks + EXCLUDED.clicks;
INSERT INTO link_clicks_daily (code, day, clicks) VALUES ('aZ3kP9q', '2026-10-20', 35)
ON CONFLICT (code, day) DO UPDATE SET clicks = link_clicks_daily.clicks + EXCLUDED.clicks;
SELECT code, day, clicks FROM link_clicks_daily;
```

點擊數用每日彙總而不是每次點擊一列，是根據第 2 步的數字決定的：每天 1,000 萬次點擊，每次一列的話一年是 36 億列，而需求只要「每天的點擊數」。

## 4. 高層架構

```text
            ┌──────────┐
 使用者 ───▶│ 負載平衡  │
            └────┬─────┘
                 ▼
          ┌──────────────┐   未命中   ┌──────────────┐
          │ API × 2 台    │──────────▶│ PostgreSQL   │
          │（無狀態）      │◀──────────│ 主庫 + 備援   │
          └──┬────────┬──┘            └──────▲───────┘
     code→url│        │點擊事件               │每分鐘批次寫入
             ▼        ▼                      │
        ┌────────┐ ┌──────────┐        ┌─────┴────┐
        │ Redis  │ │ 佇列      │───────▶│ worker   │
        │ 快取    │ └──────────┘        └──────────┘
        └────────┘
```

每一個元件都要能說出它在解決什麼：

- **兩台 API**：不是因為一台撐不住，而是一台掛掉時轉址還能用（可用性需求）。API 無狀態，見 [擴展](#/skill/scaling)。
- **Redis 快取 code → url**：讀寫比 100:1，而且對應關係幾乎不會變，命中率會很高。停用連結時刪除快取。不存在的代碼也短暫快取起來（negative caching），避免有人用隨機代碼一直打到資料庫。
- **PostgreSQL 主庫加一台備援**：資料量與寫入量一台就夠；備援是為了持久性與故障切換，不是為了效能。
- **佇列加 worker 處理點擊**：轉址路徑上不做寫入，只送出事件；worker 每分鐘彙總一次寫入資料庫。點擊數晚幾分鐘可以接受（一致性需求）。

和開頭的七個元件相比：沒有 Kafka（點擊事件只有一個消費者，也不需要重播）、沒有 Cassandra（資料量一台 PostgreSQL 放得下）、沒有拆成多個服務（一個小團隊維運一個服務比較實際）。

## 5. 找瓶頸、加東西

問「流量變 10 倍、100 倍時，先爆什麼」：

| 情況 | 先出問題的地方 | 對策 |
|---|---|---|
| 某個連結突然爆紅 | 同一個 key 的讀取集中在 Redis 的一個節點；若點擊直接 `UPDATE` 同一列，會在那一列上排隊等鎖 | 點擊已經走佇列與批次彙總；熱門連結可在 API 程序內再快取幾秒 |
| 轉址量 100 倍 | Redis 與 API 的 CPU | API 加台數；Redis 先垂直擴展，必要時讀副本 |
| 有人大量建立連結 | 資料庫寫入、儲存量、濫用 | 建立端點依帳號限流（見 [限流演算法](#/skill/rate-limiting)） |
| Redis 掛掉 | 所有轉址打到資料庫 | 資料庫要能短時間承受全部的轉址查詢，或接受降級 |
| 主庫掛掉 | 不能建立新連結 | 轉址仍可從快取服務；故障切換到備援 |

最後兩行是在找**單點故障**：每個元件掛掉時，系統的哪一部分還能運作。轉址比建立重要，所以設計上讓轉址在資料庫短暫不可用時仍能從快取回應。

每加一個元件，就多一個要監控、升級、備份、在半夜被叫起來處理的東西。只在數字顯示需要時才加。

## 6. 講取捨

設計文件裡最有價值的部分，是每個重要決定的選項與理由。它讓後來的人知道「當時為什麼這樣做」，以及「什麼情況改變時要重新考慮」：

| 決定 | 選項 | 這次的選擇與理由 |
|---|---|---|
| 代碼怎麼產生 | 遞增 id 轉 base62：短、不碰撞，但可以被列舉，也洩漏總量；隨機：猜不到，要處理碰撞；網址的 hash：同網址同代碼，但碰撞與隱私問題較多 | 隨機 7 碼 + 唯一約束重試。內部連結也可能包含不該被列舉的活動頁 |
| 301 或 302 | 301 省流量但無法統計、無法停用；302 每次都經過伺服器 | 302，因為需要點擊數與停用 |
| 點擊數 | 同步寫入：精確即時，但寫入量大、熱點會搶鎖；非同步彙總：晚幾分鐘 | 非同步彙總 |
| 資料庫 | PostgreSQL：團隊熟、有交易與約束；分散式 NoSQL：水平擴展容易，維運與一致性成本高 | PostgreSQL，5 年的量一台放得下 |

取捨可以寫成 ADR（架構決策紀錄）保存下來，見 [ADR：把架構決策寫下來](#/skill/ai-adr)。

## 常見錯誤

- **先選技術，再找理由**：「我們用 Kafka」不是設計，「點擊事件每秒幾千筆、有三個不同的消費者、需要重播」才是用 Kafka 的理由。
- **沒有數字**：沒有 QPS、資料量、讀寫比，就無法判斷要不要快取、要不要分片、要幾台。
- **用平均值設計**：尖峰可能是平均的好幾倍，系統要撐的是尖峰（見 [容量規劃](#/skill/capacity-planning)）。
- **只設計正常流程**：沒有回答「這個元件掛掉時會怎樣」、「請求重送兩次會怎樣」、「網路逾時時結果是什麼」。分散式系統裡的失敗模式見 [分散式基礎](#/skill/distributed-basics)。
- **忽略資料的生命週期**：資料要保留多久、怎麼刪除、裡面有沒有個資。這會影響儲存量的估算，也會影響法規遵循（見 [資料治理](#/skill/data-governance)）。
- **忽略維運成本與團隊規模**：三個人的團隊維運十個微服務、三種資料庫，大部分時間會花在維運上。
- **沒寫「不做什麼」**：範圍不清楚，設計就會一直膨脹。
- **把估算當成精確值**：估算的目的是找出數量級與瓶頸。上線後要用實際的監控數字回頭修正。

## 動手

1. 在 Playground 跑估算那段，把轉址量改成每天 10 億次，重新判斷：一台資料庫還夠嗎？快取是否變成必要？哪個數字最先迫使你改架構？
2. 跑資料模型那段 SQL，加一個「同一個長網址重複建立時回傳既有的代碼」的需求，想想要加什麼索引或約束，以及它和「代碼不可被列舉」的需求是否衝突。
3. 程式題：[粗估規模：QPS、儲存與機器數](#/exercise/system-design-1)。
4. 設計情境：[一則貼文要通知 10 萬個追蹤者](#/scenario/notifications-fanout)（用同樣的六步驟想 fan-out 的取捨）、[從 100 到 10 萬 QPS](#/scenario/scale-path)。
5. 挑一個熟悉的系統，用六個步驟寫一份一頁的設計文件：需求、數字、API、資料模型、架構圖、三個最重要的取捨。
