## 從一個具體問題開始：沒有人記得當初為什麼這樣做

一個門診掛號系統，「同一位醫師同一個時段只能被預約一次」是用 PostgreSQL 的 exclusion constraint 擋的：資料庫層直接拒絕時間重疊的兩筆預約。兩年後，一位新成員請 AI agent 優化掛號 API 的延遲，agent 看到每次寫入都要檢查約束，提議改成「先在 Redis 拿分散式鎖、再寫入、拿掉資料庫約束」，測試全過、延遲下降，PR 合併了。

三個月後 Redis 主節點切換，鎖在切換期間失效，同一個時段出現兩筆預約，兩位病患同時到診。翻聊天紀錄才找到當年的討論：團隊評估過 Redis 鎖，正是因為切換時鎖可能失效，才選了資料庫約束。這個理由只存在於一次會議和一串訊息裡，新成員看不到，agent 更看不到。

程式碼記錄了「現在怎麼做」，但不會記錄「為什麼這樣做、考慮過什麼、放棄了什麼」。**ADR（Architecture Decision Record，架構決策紀錄）**就是把這一段寫下來，放在程式碼旁邊。

## ADR 長什麼樣：一個決策一份短文件

最常見的格式來自 Michael Nygard 2011 年的文章，五個部分：

| 段落 | 寫什麼 | 常見的錯 |
|---|---|---|
| 標題 | 編號 + 一句話講決策，例如「0005. 用資料庫約束防止時段重複預約」 | 寫成主題（「關於預約」）而不是決策 |
| 狀態 | `Proposed`、`Accepted`、`Deprecated`、`Superseded by ADR-xxxx` | 狀態沒有隨決策更新 |
| 背景（Context） | 當時的限制、需求、考慮過的選項與各自的問題。用事實寫，數字越具體越好 | 只寫結論，沒寫為什麼其他選項不行 |
| 決策（Decision） | 用主動語氣：「我們會……」。一份 ADR 只做一個決策 | 一份 ADR 塞好幾個不相關的決定 |
| 後果（Consequences） | 決策之後變容易的事、變困難的事、要付的代價、之後要注意什麼 | 只寫好處 |

**後果段最重要。**之後有人想改掉這個決策時，他需要知道代價是怎麼被接受的。前面的例子裡，如果 ADR 的後果段寫著「寫入延遲多約 2 ms；不採用 Redis 鎖，因為主節點切換時鎖可能失效」，agent 讀到就不會提出那個 PR，或至少會在 PR 裡說明它怎麼處理切換。

一份 ADR 通常一到兩頁。寫太長的話，通常是把設計文件或會議記錄塞了進來；ADR 只記決策與理由，詳細設計可以另外連結。

### 狀態的生命週期

```text
Proposed ──(review 通過)──> Accepted ──(不再適用)──> Deprecated
                                │
                                └──(被新決策取代)──> Superseded by ADR-0011
```

- **Proposed**：還在討論，通常跟著一個 PR 一起 review。
- **Accepted**：團隊同意，之後的程式應該遵守。
- **Deprecated**：這個決策不再適用，但沒有新的決策取代（例如那個功能整個拿掉了）。
- **Superseded**：有新的 ADR 取代它，狀態寫出是哪一份。

## 什麼時候寫，什麼時候不寫

判斷標準不是「改動大不大」，而是「之後有沒有人會問為什麼」：

- **之後很難反悔**：選資料庫、選訊息佇列、API 版本策略、驗證方式。
- **影響好幾個模組或團隊**：共用的錯誤格式、服務之間的通訊方式、模組邊界（「領域層不直接使用 ORM」）。
- **討論過不只一次**：同一個問題在 review 裡吵第二次時，就該寫下來，讓第三次直接引用。
- **刻意不做某件事**：「不做多租戶資料庫隔離，改用 row-level 的 tenant_id」這種決定，最容易在之後被當成疏忽而「修正」。

不需要 ADR 的：變數命名、某個函式的實作細節、可以隨時改回來的設定值。這些交給 code review 與程式碼本身。

## 放在哪裡、怎麼編號

放在 repo 裡，例如 `docs/adr/`，檔名用四位數編號加標題：

```text
docs/adr/
├── README.md                                  # 索引：編號、標題、狀態一覽
├── 0001-record-architecture-decisions.md      # 第一份通常是「我們決定用 ADR」
├── 0002-booking-lock-in-redis.md
├── 0003-no-orm-in-domain-layer.md
├── 0004-cursor-pagination.md
└── 0005-booking-conflict-by-db-constraint.md
```

放在 repo 而不是 wiki 的理由：

- **跟程式碼一起 review**。決策和實作它的程式在同一個 PR，review 的人同時看到「做了什麼」與「為什麼」。
- **跟程式碼一起版控**。`git log docs/adr/0005-*.md` 可以看到決策的歷史；切到舊的 tag 時，看到的也是當時的 ADR。
- **agent 讀得到**。agent 的工作脈絡是 repo，wiki 通常不在裡面。

編號只增不減，刪掉的編號也不重用。有些團隊用 `adr-tools` 這類命令列工具產生檔案與處理取代關係；手動維護也完全可以。

## 被取代時怎麼處理：不改寫，只取代

已經 Accepted 的 ADR 不回頭改內容。要改變決策時：

1. 新增一份 ADR，背景段說明「ADR-0002 的什麼前提不再成立」，狀態行加上 `Supersedes ADR-0002`。
2. 把 ADR-0002 的狀態改成 `Superseded by ADR-0005`。這是唯一會動舊檔的地方。
3. 更新索引。

這樣讀者打開任何一份舊 ADR，都能沿著狀態找到現行決策，也看得到當時的推理。直接改寫舊檔的話，「為什麼當年選 Redis、後來為什麼放棄」就消失了，下一個人很可能再提一次 Redis 方案。錯字、失效的連結這類不改變意思的修正可以直接改。

## 範例：一份完整的 ADR

```markdown
# 5. 用資料庫約束防止同一醫師時段重複預約

## 狀態

Accepted（2026-03-12）

Supersedes ADR-0002

## 背景

ADR-0002 決定在 Redis 取得以「醫師 + 時段」為 key 的鎖，再寫入預約。
2026-02 的演練中，Redis 主節點切換期間鎖會遺失，兩個請求同時拿到鎖，
產生了兩筆同時段預約。

需求：同一位醫師的預約時段不可重疊；尖峰時每秒約 50 筆預約寫入。

考慮過的選項：
1. 保留 Redis 鎖，改用多節點鎖演算法：實作與維運複雜度高，團隊沒有經驗。
2. 寫入前 SELECT 檢查是否重疊：兩個交易可能同時檢查都通過（需要額外上鎖）。
3. PostgreSQL exclusion constraint：由資料庫保證，交易內就會失敗。

## 決策

我們會在 appointments 表加上 exclusion constraint：

    EXCLUDE USING gist (doctor_id WITH =, slot WITH &&)

（需要 btree_gist extension），並移除 Redis 鎖。
應用程式捕捉 exclusion_violation（SQLSTATE 23P01），回傳 409 Conflict。

## 後果

- 重複預約由資料庫保證，不受快取或鎖服務故障影響。
- 每筆寫入多一次 GiST 索引檢查；壓測下 p95 寫入延遲增加約 2 ms，可接受。
- 不要再引入應用層的預約鎖；要改變這個做法，需要新的 ADR 說明如何處理
  鎖服務故障。
- migration 前要先清掉既有的重疊資料，否則建立約束會失敗。
```

注意後果段的第三點：它直接對未來想「優化」的人說話。agent 讀到這一句，就知道改成 Redis 鎖是在推翻一個決策，而不是單純的效能改善。

## ADR 也是給 AI agent 的規範來源

人會在走廊上問「這裡為什麼這樣寫」，agent 不會。agent 只看得到它工作脈絡裡的東西，所以要讓 ADR 進到脈絡裡：

- **在專案規範檔裡指出位置與用法**。例如：「架構決策在 `docs/adr/`，索引在 `docs/adr/README.md`。拆票或修改程式前，先讀索引並打開與這次改動相關的 ADR（狀態為 Accepted 的才是現行決策）。」
- **違反時先停下來**。規範檔寫明：「如果改動會違反某份 Accepted 的 ADR，不要自行改寫；在回覆或 PR 描述中指出是哪一份、為什麼需要改變，並草擬一份新的 ADR（狀態 Proposed）。」決策的改變要被人看見。
- **拆票時引用 ADR**。把需求拆成票時（見[把需求拆成垂直切片](#/skill/ai-vertical-slices)），每張票寫出相關的 ADR 編號，執行那張票的 agent 不用自己去找。
- **能機械判定的部分交給工具**。「領域層不得 import ORM」可以寫成 lint 規則（例如 Ruff 的 banned-api 設定，或專門檢查 import 依賴方向的工具），讀漏了也會在 CI 被擋（見 [AI 改程式的品質閘門](#/skill/ai-quality-gates)）。ADR 寫理由，lint 負責執行。
- **索引要短**。索引一行一份 ADR：編號、標題、狀態。agent 先讀索引再決定打開哪幾份，不必每次把所有 ADR 都讀進脈絡。

下面這段程式模擬「讀 `docs/adr/`、產生索引、檢查取代關係有沒有兩邊都標好」，可以直接執行。實務上可以把類似的檢查放進 CI：

```python run
# 虛構的 docs/adr/ 內容：檔名 → 檔案文字（實務上用 pathlib.Path("docs/adr").glob("*.md") 讀）
ADRS = {
    "0001-record-architecture-decisions.md": "# 1. 記錄架構決策\n\n## 狀態\n\nAccepted\n",
    "0002-booking-lock-in-redis.md": "# 2. 用 Redis 鎖防止重複預約\n\n## 狀態\n\nAccepted\n",
    "0003-no-orm-in-domain-layer.md": "# 3. 領域層不直接使用 ORM\n\n## 狀態\n\nAccepted\n",
    "0004-cursor-pagination.md": "# 4. 列表 API 改用 cursor 分頁\n\n## 狀態\n\nProposed\n",
    "0005-booking-conflict-by-db-constraint.md": "# 5. 用資料庫約束防止重複預約\n\n## 狀態\n\nAccepted\n\nSupersedes ADR-0002\n",
}


def parse(filename, text):
    lines = text.splitlines()
    title = lines[0].lstrip("# ").strip()
    # 「## 狀態」之後第一個非空行是狀態
    i = lines.index("## 狀態")
    status = next(l.strip() for l in lines[i + 1:] if l.strip())
    supersedes = [int(l.split("ADR-")[1]) for l in lines if l.startswith("Supersedes ADR-")]
    return {"no": int(filename[:4]), "title": title, "status": status, "supersedes": supersedes}


records = {r["no"]: r for r in (parse(f, t) for f, t in sorted(ADRS.items()))}

print("索引")
for r in records.values():
    print(f"  ADR-{r['no']:04d}  {r['status']:<28} {r['title']}")

print("\n檢查取代關係")
problems = 0
for r in records.values():
    for old in r["supersedes"]:
        want = f"Superseded by ADR-{r['no']:04d}"
        got = records[old]["status"]
        if got != want:
            problems += 1
            print(f"  ADR-{old:04d} 的狀態是「{got}」，應該是「{want}」")
print(f"  {problems} 個問題" if problems else "  取代關係都有標好")
```

執行結果會指出 ADR-0002 還寫著 Accepted：新決策已經取代它，但舊檔沒更新。agent 讀索引時會看到兩份互相矛盾的 Accepted 決策，不知道該遵守哪一份。

## 常見錯誤

| 狀況 | 後果 | 修法 |
|---|---|---|
| 寫成會議記錄：誰說了什麼、討論過程 | 太長，沒人讀，也找不到決策本身 | 只留背景、決策、後果；討論過程可以連結出去 |
| 只寫決策，沒寫考慮過的選項 | 之後有人提出被否決過的方案，沒有依據回應 | 背景段列出選項與各自被放棄的原因 |
| 後果只寫好處 | 代價在之後被當成 bug「修掉」 | 後果段一定要有「變困難的事」 |
| 直接改寫已接受的 ADR | 歷史消失，看不出決策為什麼改變 | 新增 ADR 並標 Supersedes / Superseded by |
| 新 ADR 取代舊的，舊檔狀態沒改 | 兩份 Accepted 互相矛盾，人和 agent 都不知道該聽哪一份 | 取代時同一個 PR 改舊檔狀態；用上面那種檢查放進 CI |
| ADR 放在 wiki，跟程式碼分開 | 不跟 PR 一起 review，agent 讀不到 | 放在 repo 的 `docs/adr/` |
| 每個小改動都寫 ADR | 重要的決策被淹沒 | 只寫「之後會有人問為什麼」的決策 |

## 動手

1. 在 Playground 執行上面的索引程式，把 ADR-0002 的狀態改成 `Superseded by ADR-0005`，再跑一次，確認檢查通過。
2. 再加一份 `0006-…md`，寫 `Supersedes ADR-0004`，但不改 ADR-0004，看看檢查怎麼回報。
3. 挑一個做過的技術選擇（例如為什麼用 PostgreSQL 而不是 MongoDB），用上面的五段格式寫一份 ADR，後果段至少寫兩個代價。
4. 寫一段給 agent 的規範文字：ADR 在哪、什麼時候要讀、違反時怎麼做。接著到[把需求拆成垂直切片](#/skill/ai-vertical-slices)，拆票時在每張票上標出相關的 ADR。
