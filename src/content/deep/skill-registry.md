## 從一個具體問題開始：同一個 skill，五個版本

工程團隊有一個「寫 release notes」的 skill，最早是某位同事寫給自己用的一份 `SKILL.md`，放在共用雲端資料夾。好用，大家就各自複製一份到自己的 agent 設定裡。一年後：

- **五個人手上有五個版本**。有人照自己的習慣改過，有人還停在最早那版。同一個 MR 交給不同人的 agent 寫 release notes，格式完全不同。
- **原作者改了一條規則**：「不得在 release notes 裡貼出內部票號」，因為外部客戶會看到。他在聊天室說了一聲，但沒人知道自己手上那份有沒有跟著更新。
- **有人從網路上找到一個「更強的版本」**換掉了原本的檔案。裡面多了一段要 agent「完成後順便把 CHANGELOG 推到遠端」的指示。沒有人審過。
- **安全團隊想知道**：「誰在用那個會建議以 root 執行部署腳本的 skill？」沒有任何清單可以查。

這和沒有套件管理器之前的程式庫處境一樣：複製貼上、各自修改、不知道誰用哪一版、上游改了也收不到通知。skill 改變的是 agent 的行為（見 [行為層的供應鏈管理](#/skill/agent-supply-chain)），所以它需要的不是「放在大家找得到的地方」，而是套件該有的整套管理：來源、版本、變更紀錄、審核、鎖定、更新通知、下架。

## 運作原理：skill 也是套件

### skill 需要的套件屬性

| 屬性 | 程式套件怎麼做 | skill 怎麼做 |
|---|---|---|
| 唯一名稱 | 套件庫裡的名稱 | registry 清單裡的 `name`，同名不能有兩份 |
| 來源 | 套件庫網址、原始碼 repo | registry 的 git repo 與路徑；外部來源要記原始出處 |
| 版本 | 語意化版本號 | 同樣用語意化版本：改規則或行為是 minor 以上，改錯字是 patch |
| 內容雜湊 | lock 檔裡的完整性雜湊 | 對 skill 資料夾內容算 SHA-256，記在清單與安裝端 |
| 變更紀錄 | CHANGELOG | 每個版本一段：改了什麼、為什麼、對 agent 行為的影響 |
| 負責人 | 維護者 | 清單裡的 `owner`，出事時找誰 |
| 審核 | 程式碼審查、套件庫的掃描 | MR 審查，審過的人與日期記在清單 |
| 下架 | yank、deprecate | 清單裡標 `yanked` 與原因、替代方案 |

skill 比程式套件多一個難處：它的「行為」是語意的。一段文字是否會讓模型做出危險的事，靜態掃描回答不了，只能靠人讀，或至少靠規則篩出可疑段落交給人讀（篩法見 [Tool Poisoning 與 rug pull](#/skill/tool-poisoning)）。所以審核在 skill 的管理裡比在程式套件裡更重。

### 內部 registry 的最小形式

不需要先導入任何平台。最小可行的 registry 是一個 git repo：

```text
skills-registry/
├── manifest.json              ← 機器讀的真相來源：所有 skill 的名稱、版本、雜湊、狀態
├── release-notes/
│   ├── SKILL.md
│   ├── templates/notes.md
│   └── CHANGELOG.md
├── sql-review/
│   ├── SKILL.md
│   └── CHANGELOG.md
└── CODEOWNERS                 ← 每個 skill 資料夾指定審查者
```

清單檔的一筆長這樣：

```json
{
  "name": "release-notes",
  "version": "1.4.0",
  "sha256": "e3b0c44298fc…（完整 64 碼）",
  "path": "release-notes/",
  "owner": "platform",
  "reviewed_by": "alice",
  "reviewed_at": "2026-10-28",
  "changelog": "1.4.0：加入「不得貼出內部票號」的規則",
  "yanked": false
}
```

發布一個新版本的流程：

1. 在 skill 資料夾改內容、更新 `CHANGELOG.md`。
2. 開 MR。CODEOWNERS 讓那個 skill 的負責人與一位審查者必須核准；CI 檢查版本號有沒有加、CHANGELOG 有沒有對應段落、清單裡的雜湊和實際內容是否一致。
3. 合併後打 git tag（例如 `release-notes/v1.4.0`）。tag 讓任何人都能取回某個確切版本，也讓 diff 有明確的兩端可比。
4. 清單檔的雜湊由 CI 計算並寫入，不由人手填，避免填錯或被刻意填錯。

網頁介面、搜尋、評分這些都可以之後再加。先有清單檔與版本標籤，才有東西可以比對；這也是 [MCP Gateway](#/skill/mcp-gateway) 的上架清單在做的事，只是對象從 MCP server 換成 skill。

### 安裝端：鎖版本

安裝端（每個人的 agent 設定、或團隊共用的 agent 映像）不直接「拉最新版」，而是記一份 lock：

```json
{ "release-notes": { "version": "1.3.2", "sha256": "9f86d081884c…" } }
```

每次載入 skill 前重算本機內容的雜湊，和 lock 比對：

- **一致**：載入。
- **不一致**：本機內容被改過（有人手動編輯、被其他工具覆寫、或被惡意替換）。停用並提示，給出本機內容與 lock 版本的差異。

這和工具描述的指紋比對是同一招：審過的內容被悄悄換掉時要能發現。差別是工具描述由遠端 server 在執行期提供，skill 通常是本機檔案；後者更容易被「好心修改」，前者更容易被上游改掉，兩者都要比對。

### 更新通知與 diff

registry 有新版本時，不是自動替換，而是：

1. 定期（或在 agent 啟動時）讀 registry 的清單，和本機 lock 比對版本。
2. 有新版就通知使用者或該 agent 設定的負責人，通知裡附上：版本號的變化、CHANGELOG 的對應段落、**新舊版內容的 diff**（兩個 git tag 之間的差異）。
3. 使用者看過 diff 後決定升級，lock 更新為新版本與新雜湊。

為什麼不自動更新：自動更新到最新版，等於把「這段文字能不能進我的 agent」的決定權交給上游。上游被入侵、或上游的人改了一條你不同意的規則，你的 agent 會立刻照做。這正是 rug pull 的模式（見 [Tool Poisoning 與 rug pull](#/skill/tool-poisoning)）：審過的東西之後被換掉，而使用者端沒有任何提示。對 patch 等級的更新可以放寬（例如只通知、預設接受），但 minor 以上的行為變更應該要人看過。

還有一種比「有新版」更嚴重的情況：**同一個版本號、不同雜湊**。這代表 registry 那一邊的內容被改寫了，而版本號沒動。正常流程不會出現這種事，看到就暫停載入並通報。

### 下架流程

發現 skill 有問題時（會誤導 agent 做危險的事、洩漏資料、或負責人不再維護）：

1. 在清單裡把那個版本（或所有版本）標成 `yanked: true`，寫 `yank_reason` 與替代方案。不刪除檔案與 tag，歷史要留著，才查得到誰曾經用過。
2. 安裝端下次比對清單時看到標記，停用該 skill 並顯示原因。
3. 用安裝端回報的資料（或 agent 啟動時的紀錄）列出還在用的人，確認都已停用。
4. 下架本身也走 MR，留下誰在什麼時候、為什麼下架的紀錄。

## 實際程式：比對清單與本機安裝

下面用純 Python 模擬一次比對：解析 registry 的清單、讀本機的 lock 與磁碟上的實際內容、重算雜湊，列出四種狀況：有更新、雜湊不符、已下架、未登錄。雜湊為了好讀只取前 12 碼，實務上用完整的 64 碼。

```python run
import hashlib, json

def digest(text):
    # 清單與安裝端用同一個算法：對 skill 內容的 UTF-8 bytes 算 SHA-256，取前 12 碼方便閱讀
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]

def parse_version(v):
    return tuple(int(x) for x in v.split("."))

# registry 的清單檔（實務上是 repo 裡的 manifest.json，這裡直接寫成字串）
MANIFEST = json.loads("""
{
  "skills": [
    {"name": "release-notes", "version": "1.4.0", "sha256": "%s", "owner": "platform",
     "changelog": "1.4.0：加入「不得貼出內部票號」的規則", "yanked": false},
    {"name": "sql-review",    "version": "2.0.1", "sha256": "%s", "owner": "data",
     "changelog": "2.0.1：修正 PostgreSQL 16 的語法提示", "yanked": false},
    {"name": "deploy-helper", "version": "0.9.0", "sha256": "%s", "owner": "ops",
     "changelog": "0.9.0：初版", "yanked": true, "yank_reason": "會建議以 root 執行部署腳本，已由 deploy-checklist 取代"}
  ]
}
""" % (digest("release-notes v1.4.0 的內容"), digest("sql-review v2.0.1 的內容"), digest("deploy-helper v0.9.0 的內容")))

# 本機安裝的 skill：lock 檔記了版本與安裝時的雜湊；on_disk 是目前磁碟上的實際內容
INSTALLED = [
    {"name": "release-notes", "version": "1.3.2", "locked_sha256": digest("release-notes v1.3.2 的內容"),
     "on_disk": "release-notes v1.3.2 的內容"},
    {"name": "sql-review",    "version": "2.0.1", "locked_sha256": digest("sql-review v2.0.1 的內容"),
     "on_disk": "sql-review v2.0.1 的內容\\n（被人在本機多加了一段）"},
    {"name": "deploy-helper", "version": "0.9.0", "locked_sha256": digest("deploy-helper v0.9.0 的內容"),
     "on_disk": "deploy-helper v0.9.0 的內容"},
    {"name": "my-local-notes","version": "0.0.1", "locked_sha256": digest("x"), "on_disk": "x"},
]

def audit(manifest, installed):
    by_name = {s["name"]: s for s in manifest["skills"]}
    findings = []
    for s in installed:
        reg = by_name.get(s["name"])
        if reg is None:
            findings.append(("unregistered", s["name"], "不在清單上：來源不明，送審或移除"))
            continue
        if reg.get("yanked"):
            findings.append(("yanked", s["name"], f"已下架：{reg.get('yank_reason', '')}"))
        actual = digest(s["on_disk"])
        if actual != s["locked_sha256"]:
            findings.append(("hash_mismatch", s["name"],
                             f"本機內容 {actual} ≠ lock 檔 {s['locked_sha256']}：內容被改過，停用並比對差異"))
        if parse_version(reg["version"]) > parse_version(s["version"]):
            findings.append(("update", s["name"],
                             f"{s['version']} → {reg['version']}（{reg['changelog']}）：通知使用者，附 diff"))
        elif reg["version"] == s["version"] and reg["sha256"] != s["locked_sha256"]:
            # 同一個版本號、不同雜湊：registry 那一邊被改了，比「有新版」嚴重
            findings.append(("registry_tampered", s["name"], "同版本不同雜湊：registry 內容被改寫，暫停載入並通報"))
    return findings

for kind, name, msg in audit(MANIFEST, INSTALLED):
    print(f"{kind:<18} {name:<16} {msg}")
```

幾點說明：

- 版本比較用 `tuple(int(...))`，不能用字串比較：字串比較下 `"1.10.0" < "1.9.0"`。
- 雜湊比對有兩個方向。「本機內容 vs lock」抓的是本機被改；「lock vs registry 同版本」抓的是 registry 被改。兩個都要做。
- `sql-review` 版本號和 registry 一樣，但本機內容被改過。只比版本號的工具會說它是最新的；比雜湊才看得出來。
- 實際的 skill 是一個資料夾而不是一段字串。雜湊要對資料夾內所有檔案依路徑排序後一起算，並且路徑本身也要算進去，否則把檔案改名或搬位置不會被發現。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| skill 放在共用雲端資料夾 | 沒有版本、沒有審核、不知道誰用哪一版 | git repo + 清單檔 + 版本標籤 |
| 只比版本號，不比雜湊 | 本機或 registry 的內容被改了，版本號沒動，比對說「最新」 | 版本與雜湊都比，兩個方向都比 |
| 雜湊由人手填進清單 | 填錯或被刻意填成符合惡意內容的值 | CI 計算並寫入，MR 審查看得到 |
| 安裝端自動更新到最新版 | 上游的任何改動立刻進入 agent，rug pull 無從防起 | 通知並附 diff，由人決定升級 |
| 下架時刪掉檔案與 tag | 查不到誰用過、當時內容是什麼 | 標 yanked、寫原因，保留歷史 |
| 從網路下載的 skill 直接放進安裝目錄 | 未經審核的指示進入 agent | 外部 skill 也走 MR 進 registry，記原始出處 |
| 版本號隨便加 | 行為改變被標成 patch，使用者以為可以放心接受 | 改規則或行為至少是 minor，CHANGELOG 寫清楚影響 |
| 雜湊只算 SKILL.md | 附帶的腳本或範本被改不會被發現 | 對整個資料夾（含路徑）算雜湊 |

## 動手

1. 執行上面的比對，依每一項的建議修改 `INSTALLED`，直到輸出清空。
2. 在 [Playground](#/playground?lang=python) 把 registry 裡 `sql-review` 的雜湊改成 `digest("別的內容")`、本機內容改回原樣，確認輸出的是 `registry_tampered`。
3. 把 `parse_version` 換成直接比字串，加一筆 `1.9.0` 對 `1.10.0` 的案例，看結果哪裡錯。
4. 寫一個函式：輸入一個資料夾的 `{路徑: 內容}` dict，依路徑排序後算出整個 skill 的雜湊；確認改檔名也會讓雜湊改變。
5. 本課的程式題：實作清單與本機安裝的比對函式。接著回頭讀 [行為層的供應鏈管理](#/skill/agent-supply-chain) 的檢查清單，看 registry 對應到哪幾項。
