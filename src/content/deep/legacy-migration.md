## 從一個具體問題開始：跑了十幾年的系統要換，但一天都不能停

一家醫院（虛構）的排班與掛號系統上線十幾年，跑在舊的關聯式資料庫上（例如 Informix、Oracle、DB2）。業務規則一部分寫在應用程式裡，一部分在資料庫的預存程序和每晚的排程批次裡。原始開發者已經離開，文件只涵蓋一部分功能。門診每天開診，急診 24 小時都在用。現在要把它換成新的服務。

第一個提案通常是：新系統全部寫好，挑一個週末整套換掉。這種一次重寫、一次切換（big bang）的做法常常失敗，原因有三個：

- **範圍大**：所有功能都完成才能上線，上線之前新系統沒有任何一部分被真實使用過。開發期間舊系統還在改（法規調整、報修），新系統要一直追。
- **行為沒人說得清**：規格書寫的是「應該怎樣」，舊系統實際「現在怎樣」散在程式、預存程序、批次與資料裡。照規格書重寫，會漏掉沒寫進去的規則。
- **切換日風險集中**：所有差異在同一天暴露。開診後新系統已經收了新資料，要退回舊系統就得把這些資料搬回去，實務上常常是退不回去。

這一課講的是另一條路：不一次換掉，而是讓新舊系統並存一段時間，一塊一塊把功能移過去，每一步都能驗證、都能退回。

## 逐步替換：strangler fig

Martin Fowler 把這個做法取名為 **strangler fig**（絞殺榕）：榕樹從宿主樹的外面長起來，逐漸包住它，最後取代它。對應到系統：

1. 在舊系統前面放一層**入口**（反向代理或 API 閘道）。一開始所有請求原封不動轉給舊系統。這一步本身就是一次上線，要先讓它穩定。
2. 挑一塊功能在新系統實作，在入口層加一條規則，把這塊功能的請求導到新系統。
3. 重複第 2 步。舊系統處理的範圍越來越小。
4. 舊系統不再收到任何請求後，把它停掉。

```
 櫃台、App、其他系統
          │
          ▼
 入口層（反向代理 / API 閘道）
   /api/schedules     → 新系統
   /api/appointments  → 新系統 20%、舊系統 80%
   /api/fees          → 舊系統（複製一份給新系統比對）
   其他路徑           → 舊系統
          │
          ▼
 新系統 ◀── 資料同步 ──▶ 舊系統 + 舊資料庫
```

入口層可以是 [nginx 反向代理](#/skill/nginx)、API 閘道，或一個自己寫的小服務。規則通常依路徑、HTTP 方法、使用者或診間來分。

先搬哪一塊，沒有標準答案，常見的考量是：

| 考量 | 先搬 | 晚點搬 |
|---|---|---|
| 邊界 | 和其他功能少有牽連的 | 和很多功能共用資料或流程的 |
| 讀寫 | 只讀的查詢 | 會寫入、而且舊系統其他功能要讀到這些寫入的 |
| 風險 | 出錯影響小、容易發現的 | 算錯會影響收費或病人安全的 |
| 行為 | 有文件、有測試的 | 沒人說得清的（先做下面的行為考古與並行比對） |

寫入類的功能搬過去之後，新舊系統各有一份資料，兩邊怎麼保持一致是另一個大題目，見 [從舊資料庫同步資料](#/skill/legacy-data-sync)。

入口層的前提是請求會經過一個可以攔截的地方。舊系統如果是桌面程式直接連資料庫，沒有 HTTP 這一層，網路層就沒有接縫可用，要改從別處切：在客戶端程式裡分流、在資料層做同步，或先替舊系統包一層 API。這種情況的做法差異很大，要看舊系統的架構。

## 防腐層：不讓舊的資料模型流進新系統

舊資料表的欄位常是縮寫（`dept_cd`、`stat`），狀態用代碼（`'1'`、`'2'`、`'9'`），日期存成字串，沒有值的地方用空字串或一串空白。新系統如果直接拿這些欄位和代碼來用，舊模型就擴散到新系統的每一層，之後想改也改不動。

**防腐層**（anti-corruption layer，出自領域驅動設計）是一個專門做轉換的模組，放在新系統和舊系統之間：

- 讀取方向：舊的列或回應 → 新系統的模型。
- 寫入方向（過渡期還要寫回舊系統時）：新系統的模型 → 舊的格式。
- 新系統的其他程式只看得到自己的模型，不知道 `stat = '9'` 是什麼。

```python run
# 防腐層：把舊系統的一列資料轉成新系統的模型。舊格式的知識只存在這個模組裡
from dataclasses import dataclass
from datetime import date

STATUS = {"1": "booked", "2": "cancelled", "9": "no_show"}


@dataclass
class Appointment:
    id: int
    patient_name: str
    visit_date: date
    status: str
    note: str | None


def roc_to_date(text):
    # 舊系統用民國年字串：'1150504' → 2026-05-04
    return date(int(text[:3]) + 1911, int(text[3:5]), int(text[5:7]))


def from_legacy(row):
    status = STATUS.get(row["stat"])
    if status is None:                       # 不認識的代碼：停下來，不要猜
        raise ValueError(f"appt_no={row['appt_no']} 有不認識的狀態代碼 {row['stat']!r}")
    return Appointment(
        id=row["appt_no"],
        patient_name=row["pt_name"].strip(),         # 定長欄位，尾端補了空白
        visit_date=roc_to_date(row["visit_dt"]),
        status=status,
        note=row["note"].strip() or None,            # 空字串與空白 → None
    )


def to_legacy(appt):
    # 過渡期要寫回舊系統時，反方向轉換
    code = {v: k for k, v in STATUS.items()}[appt.status]
    d = appt.visit_date
    return {"appt_no": appt.id, "pt_name": appt.patient_name, "visit_dt": f"{d.year - 1911:03d}{d.month:02d}{d.day:02d}",
            "stat": code, "note": appt.note or ""}


legacy_row = {"appt_no": 3107, "pt_name": "王小明    ", "visit_dt": "1150504", "stat": "9", "note": "   "}
appt = from_legacy(legacy_row)
print(appt)
print(to_legacy(appt))
try:
    from_legacy({**legacy_row, "stat": "7"})
except ValueError as exc:
    print("錯誤：", exc)
```

舊系統停用之後，防腐層可以整個刪掉，新系統的其他部分不受影響。

## 並行比對：兩邊都跑，只回舊的結果

把一塊功能導到新系統之前，要先知道新系統的結果和舊系統一不一樣。**平行執行**（parallel run，也叫 shadow 或並行比對）的做法是：同一個請求兩邊都執行，使用者拿到的是舊系統的結果，新系統的結果只用來比對，差異記下來。

| 要處理的事 | 做法 |
|---|---|
| 副作用 | 新系統在比對期間不能寄通知、不能送外部介面、不能寫進正式資料。只對查詢與試算類的請求做，或讓新系統寫到隔離的資料庫 |
| 本來就會不同的欄位 | 時間戳、流水號、追蹤 id 列入忽略清單；順序不保證的清單先排序再比 |
| 對回應時間的影響 | 複製出去的請求非同步送、設逾時；新系統慢或掛掉只是一筆紀錄，不能拖累使用者 |
| 比對量 | 全量或抽樣都可以；流量大時抽樣，但少見的情況要夠多筆才看得出來 |
| 個人資料 | 差異紀錄裡會有病人資料，要遮罩並限制誰能看 |

每一筆差異要歸類，否則紀錄只是一堆雜訊：

| 類別 | 處理 |
|---|---|
| 新系統的錯 | 修新系統 |
| 沒寫進規格的舊規則 | 確認規則還有效，補進規格與新系統 |
| 舊系統的錯 | 由業務單位決定：新系統照正確的做，或暫時相容。決定要留紀錄 |
| 刻意的改變（例如金額從字串改成數字） | 加進忽略清單或轉換後再比，並通知使用這個回應的下游 |

什麼時候算比對通過，要事先寫好條件，例如「連續兩週差異率低於某個門檻，而且剩下的差異都已歸類」。門檻是多少取決於這塊功能出錯的代價，沒有通用數字。

:::stop 讀到這裡可以先停：會在入口層一條路徑一條路徑把流量導到新系統，用防腐層隔開舊資料模型，用並行比對找出差異。後面的分支抽象化、切換與回退、行為考古與入口層的完整程式，在要換的是系統內部的元件、準備放量或停用舊系統時再回來讀。

## 分支抽象化：要換的東西在系統裡面

入口層只能分流進到系統的請求。要換的如果是系統內部的東西（一個計算模組、資料存取層、對某個外部元件的呼叫），用 **分支抽象化**（branch by abstraction）：

1. 在要換掉的實作前面建一個抽象層（一個介面）。
2. 把所有呼叫的地方改成走這個介面，背後仍然是舊實作。行為不變，可以先上線。
3. 在介面後面寫新實作。
4. 用功能旗標決定用哪一個實作，可以只對部分請求打開，也可以兩個都跑、比對結果。
5. 新實作穩定後移除舊實作；抽象層不再需要的話一起移除。

每一步都能單獨部署，程式一直在主幹上，不需要一條長期存在的分支。和 strangler fig 的差別只在接縫的位置：

| | strangler fig | 分支抽象化 |
|---|---|---|
| 接縫在哪 | 系統外面的入口層 | 程式裡的介面 |
| 切換單位 | 路徑、功能 | 模組、元件 |
| 新舊實作 | 兩個各自部署的系統 | 同一個程式裡的兩個實作 |

兩者常一起用：對外用入口層分流，新系統內部用抽象層隔開還沒搬完的相依。

## 切換、回退與停用舊系統

一塊功能從舊到新，通常經過這幾個狀態：

| 狀態 | 誰回應使用者 | 怎麼退回 |
|---|---|---|
| 舊 | 舊系統 | 不需要 |
| 並行比對 | 舊系統（新系統只比對） | 關掉比對 |
| 部分流量 | 一部分使用者由新系統回應 | 把比例調回 0 |
| 全流量 | 新系統，舊系統待命 | 把規則改回舊系統 |
| 舊系統停用 | 新系統 | 不能，只能往前修 |

放量的方式和 [部署策略](#/skill/cd-strategies) 的 canary 相同：依使用者或診間固定分流（同一個人不要一下新一下舊），先小比例，觀察錯誤率與業務指標，再逐步放大。規則的每一次調整都是一次變更，要有紀錄與核准，見 [變更管理](#/skill/change-management)。

**回退的前提是資料**。規則改回去只要幾分鐘，但新系統已經收下的寫入，舊系統要看得到，否則切回去之後這些資料就不見了。過渡期常見的做法是新系統的寫入同時回寫舊資料庫（經過防腐層），或以舊資料庫為準。新系統一旦開始存舊系統表示不了的資料，回退就不再是改一條規則，而是一次資料搬移。「能回退到什麼時候」要在切換前講清楚。

停用舊系統之前，至少確認這些事：

- 入口層的紀錄顯示舊系統已經一段時間沒有流量，這段時間要涵蓋月結、年度批次這類不常跑的工作。
- 不經過入口層、直接連舊資料庫的報表、排程與介面都盤點過並移轉完成。
- 資料以新系統為準，對帳通過。
- 回退期限已過，決定有紀錄。
- 法規要求保存的舊資料已經封存成唯讀、需要時查得到。

沒有走到這一步的遷移，會停在兩套系統長期並存的狀態：每個修改要做兩次，同步程式與入口層規則也要一直維護。

## 行為考古：把「現在怎樣」固定下來

舊系統實際的行為，可以從這些地方還原：

| 來源 | 看得出什麼 |
|---|---|
| 資料 | 每個代碼實際出現的值與比例、極端值、空值的表示方式、規則改版前後的資料差異 |
| 日誌與入口層紀錄 | 哪些功能真的有人用、用什麼參數、一年沒被呼叫過的功能有哪些 |
| 原始碼、預存程序、排程批次 | 規則本身，包含沒寫進文件的例外 |
| 報表與下游介面 | 別的單位依賴的輸出格式 |
| 使用者 | 櫃台人員習慣的操作順序、系統做不到而用人工補的流程 |

還原出來的行為寫成 **characterization test**（Michael Feathers 在《Working Effectively with Legacy Code》裡的用語）：它不測「應該怎樣」，而是把「現在怎樣」固定下來。做法是拿一批去識別化的真實輸入餵給舊系統，把輸出記錄下來當成期待值；新系統要通過同一批測試。測試本身的寫法見 [測試](#/skill/testing)。

發現舊系統的行為是錯的時，明確決定要保留還是修正，把決定寫進測試的期待值與變更紀錄。不要默默照抄，也不要默默改掉。

## 實際程式：入口層路由與並行比對

下面的程式模擬入口層：依規則決定請求去哪裡；掛號費試算仍由舊系統回應，同時複製一份給新系統，比對結果。舊系統裡有一條文件沒寫的規則（身分別 `"3"` 免掛號費），新系統不知道。

```python run
# 入口層：依規則把請求導到舊系統或新系統；標了 shadow 的請求兩邊都跑，只回舊的結果並記錄差異
import zlib

# 由上往下比對，第一條符合的生效；都不符合 → 舊系統
RULES = [
    {"prefix": "/api/schedules",    "target": "new", "percent": 100},   # 查排班：已全量切到新系統
    {"prefix": "/api/appointments", "target": "new", "percent": 20},    # 查預約：先放 20% 的使用者
    {"prefix": "/api/fees",         "target": "old", "shadow": True},   # 掛號費試算：仍回舊系統的結果，同時並行比對
]


def bucket(user_id):
    # 同一個使用者永遠落在同一桶（0–99），不會這次走新系統、下次走舊系統
    return zlib.crc32(user_id.encode()) % 100


def route(request, rules):
    for rule in rules:
        prefix = rule["prefix"]
        if request["path"] == prefix or request["path"].startswith(prefix + "/"):
            to_new = rule["target"] == "new" and bucket(request["user_id"]) < rule.get("percent", 100)
            return {"target": "new" if to_new else "old", "shadow": bool(rule.get("shadow")) and not to_new}
    return {"target": "old", "shadow": False}


# 舊系統：十幾年累積下來的行為。identity "3" 免掛號費這條規則只存在程式裡，文件沒寫
def old_system(req):
    if req["path"].startswith("/api/fees"):
        fee = 0 if req["identity"] == "3" else 150
        return {"fee": str(fee), "currency": "TWD", "generated_at": "115/05/04 09:00"}
    return {"source": "old", "path": req["path"]}


# 新系統：照規格書寫的，不知道那條規則；金額改成數字
def new_system(req):
    if req["path"].startswith("/api/fees"):
        return {"fee": 150, "currency": "TWD", "generated_at": "2026-05-04T09:00:00+08:00"}
    return {"source": "new", "path": req["path"]}


def compare(old, new, ignore_fields):
    diffs = []
    for key in sorted(set(old) | set(new)):
        if key in ignore_fields:
            continue
        if old.get(key, "<missing>") != new.get(key, "<missing>"):
            diffs.append({"path": key, "old": old.get(key, "<missing>"), "new": new.get(key, "<missing>")})
    return diffs


def handle(req, stats, diff_log):
    decision = route(req, RULES)
    stats[decision["target"]] += 1
    if decision["target"] == "new":
        return new_system(req)
    result = old_system(req)
    if decision["shadow"]:
        stats["shadow"] += 1
        try:
            shadow = new_system(req)                 # 真實系統：非同步送、設逾時，新系統慢或掛掉不能拖累回應
            diffs = compare(result, shadow, ignore_fields={"generated_at"})
            if diffs:
                diff_log.append({"path": req["path"], "identity": req["identity"], "diffs": diffs})
        except Exception as exc:                     # 新系統出錯也只是一筆紀錄
            diff_log.append({"path": req["path"], "identity": req["identity"], "diffs": [{"path": "<error>", "old": "", "new": str(exc)}]})
    return result                                    # 使用者拿到的永遠是舊系統的結果


stats, diff_log = {"old": 0, "new": 0, "shadow": 0}, []
paths = ["/api/schedules", "/api/appointments", "/api/fees", "/api/reports/daily"]
for i in range(400):
    req = {"method": "GET", "path": paths[i % 4], "user_id": f"U{i // 4:03d}", "identity": "3" if i % 40 == 2 else "1"}
    handle(req, stats, diff_log)

print("流量分配：", stats)
print(f"並行比對 {stats['shadow']} 筆，有差異 {len(diff_log)} 筆")

# 差異彙總：同一種差異只列一次，附次數，才看得出是哪一條規則
summary = {}
for entry in diff_log:
    for d in entry["diffs"]:
        key = (entry["identity"], d["path"], repr(d["old"]), repr(d["new"]))
        summary[key] = summary.get(key, 0) + 1
for (identity, path, old, new), count in sorted(summary.items()):
    print(f"  identity={identity} 欄位 {path}: 舊 {old} → 新 {new}（{count} 筆）")
```

輸出裡有兩種差異。`identity=1` 的 90 筆是 `'150'` 對 `150`：金額從字串改成數字，屬於刻意的改變，比對前先轉成同一種型別就會消失。`identity=3` 的 10 筆是 `'0'` 對 `150`：這是那條沒寫進文件的規則。它只占比對量的一成，如果沒有先把第一種差異處理掉，很容易被淹沒。

## 常見錯誤

| 現象 | 原因 | 怎麼處理 |
|---|---|---|
| 新系統寫了一年還沒上線 | 等所有功能完成才切換 | 先上入口層，挑一塊最小的功能走完整個流程 |
| 並行比對期間病人收到兩封通知 | 新系統在比對時也執行了副作用 | 比對模式關掉寄信與外部介面，或只比對查詢類請求 |
| 差異紀錄每天幾萬筆，沒人看 | 時間戳、流水號沒有忽略；差異沒有彙總與歸類 | 設忽略清單，同類差異合併計數，每一類指定處理方式 |
| 同一個使用者看到的畫面忽新忽舊 | 每個請求隨機分流 | 依使用者或診間固定分流 |
| 切回舊系統後，這兩天的預約不見了 | 新系統的寫入沒有回到舊資料庫 | 切換前先決定過渡期資料以誰為準、怎麼回寫 |
| 規則順序錯，請求進了舊系統 | 範圍大的規則排在前面，先符合就生效 | 範圍小的規則放前面；規則改動要有測試 |
| 新系統到處是 `if stat == '9'` | 沒有防腐層，舊代碼直接流進新系統 | 轉換集中在一個模組 |
| 舊系統關掉後月結報表跑不出來 | 有工作不經過入口層、直接連舊資料庫 | 停用前盤點所有連到舊資料庫的帳號與排程，觀察期涵蓋月結與年度批次 |

## 動手

1. 執行入口層那段程式，把 `/api/appointments` 的 `percent` 改成 50，看流量分配怎麼變；再把 `compare` 改成比對前先把 `fee` 轉成 `int`，確認只剩下 `identity=3` 那一種差異。
2. 在 `new_system` 補上身分別 `"3"` 免掛號費的規則，確認差異變成 0。
3. 在防腐層那段把 `legacy_row` 的 `visit_dt` 改成 `"0000000"`（舊系統常用來表示沒有日期），看會發生什麼，再決定 `from_legacy` 該怎麼處理。
4. 做本課的程式題：實作有 HTTP 方法、流量比例與 shadow 的 `route`，以及能比對巢狀欄位的 `compare`。
5. 到設計情境 [舊排班與掛號系統的替換](#/scenario/legacy-replacement)，比較一次切換、逐步替換、並行比對後再切三種做法。
