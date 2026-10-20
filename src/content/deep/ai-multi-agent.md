## 從一個具體問題開始：五個 subagent 擠在同一個 session 裡

一個功能拆成五張票，交給一個 agent，它在同一個 session 裡開了五個 subagent 平行處理。二十分鐘後：

- 畫面上是一條很長的捲動紀錄，五個 subagent 的輸出交錯在一起，看不出哪一個做完、哪一個還在跑。
- 其中一個卡在一個問題上（「取消後要不要退款？」），它的提問被埋在別人的輸出裡，沒人看到，它就一直等。
- 有一個 subagent 方向錯了，想直接跟它說「不是這樣」，只能請上層的 agent 轉達，轉達的過程又多一層誤解。
- 兩個 subagent 都改了 `api/routes.py`，它們在同一個工作目錄裡，後寫的蓋掉了先寫的，誰也沒發現。

這裡有兩個不同的問題。一個是**資訊**：所有人的脈絡混在一起，人看不清楚、也進不去任何一個。另一個是**工作區**：大家改的是同一份檔案，彼此覆蓋。

## 運作原理：一個 agent 一條分支、一個 worktree

### git worktree：同一個 repo，多個工作目錄

一般的 clone 只有一個工作目錄，一次只能 checkout 一條分支。`git worktree` 讓同一個 repo 同時有好幾個工作目錄，每個 checkout 各自的分支：

```text
/work/clinic/                 ← 主工作目錄（main）
   └── .git/                  ← 物件庫、refs：所有 worktree 共用
        └── worktrees/        ← 每個 worktree 的 HEAD、index 等資料
/work/wt-cancel-api/          ← worktree：agent/cancel-api 分支
/work/wt-cancel-ui/           ← worktree：agent/cancel-ui 分支
/work/wt-admin-log/           ← worktree：agent/admin-log 分支
```

- **共用**：物件庫與分支。在任一個 worktree 裡 commit，其他 worktree 馬上看得到那條分支的新 commit，不需要 push 或 fetch。比起每個 agent 一份完整 clone，省空間也省同步。
- **各自獨立**：工作目錄裡的檔案、`HEAD`、暫存區（index）。agent A 改檔案，agent B 的目錄完全不受影響。
- **一條分支同時只能被一個 worktree checkout**。這是 git 的限制，正好符合「一個 agent 一條分支」。
- **未追蹤的檔案不共用**：`.venv`、`node_modules`、`.env` 都不在 git 裡，新的 worktree 是乾淨的，要各自安裝依賴。

### 指令

```bash
# 從最新的 main 開三個 worktree，各自一條新分支
git fetch origin
git worktree add -b agent/cancel-api ../wt-cancel-api origin/main
git worktree add -b agent/cancel-ui  ../wt-cancel-ui  origin/main
git worktree add -b agent/admin-log  ../wt-admin-log  origin/main

# 每個 worktree 各自安裝依賴（.venv 不會共用）
(cd ../wt-cancel-api && uv sync)

# 看目前有哪些 worktree、各在哪條分支
git worktree list
# /work/clinic          3f2a1c0 [main]
# /work/wt-cancel-api   3f2a1c0 [agent/cancel-api]
# /work/wt-cancel-ui    3f2a1c0 [agent/cancel-ui]
# /work/wt-admin-log    3f2a1c0 [agent/admin-log]

# 每個 agent 一個 tmux session，工作目錄就是它的 worktree；人隨時可以 attach 進去
tmux new-session -d -s cancel-api -c ../wt-cancel-api
tmux attach -t cancel-api        # 進去看、直接打字；Ctrl-b d 離開

# 分支合併後收尾：移除 worktree、刪掉分支
git worktree remove ../wt-cancel-api
git branch -d agent/cancel-api

# 手動刪掉了 worktree 目錄時，清掉 git 裡殘留的紀錄
git worktree prune
```

## meta-agent 分派，成員 agent 做事

工作區分開之後，還要解決「誰分派、誰彙整、人怎麼看」：

```text
                         ┌──────────────┐
               人  <───> │  meta-agent  │  拆工作、分派、收報告、決定下一步
                         └──────┬───────┘
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  cancel-api  │  │  cancel-ui   │  │  admin-log   │
      │  branch      │  │  branch      │  │  branch      │
      │  worktree    │  │  worktree    │  │  worktree    │
      │  session     │  │  session     │  │  session     │
      └──────────────┘  └──────────────┘  └──────────────┘
      每個成員：一張票、一條分支、一個 worktree、一個獨立 session
```

- **meta-agent** 依票（見[把需求拆成垂直切片](#/skill/ai-vertical-slices)）與阻擋關係分派工作：前線上的票先派，某張票完成後再派被它阻擋的票。它負責彙整，不需要自己寫程式。
- **成員 agent** 只做一張票，做完寄出報告，卡住時提出問題並等待回覆。它是一個獨立的 session，有自己的脈絡，不會被別人的輸出淹沒。
- **人看得到每一個成員**：狀態、diff、最近的輸出；要介入時直接進到那個成員的 session 裡說話，不必透過 meta-agent 轉達。

[Noopher-AI/oat-agents](https://github.com/Noopher-AI/oat-agents) 是這種結構的一個實作：一個 meta-agent 只帶一層成員 agent，每個成員都是原生的 Claude Code 或 Codex session，各自有自己的分支、git worktree 與 tmux session；成員做完寄報告、卡住時提問，人可以選一個成員直接進到它的 session 裡打字。它的文件也明白寫出：worktree 只把每個 agent 的工作分開，**不會限制 agent 能碰到什麼**，所以只該在放心交給 agent 的機器上、用放心交給它的憑證來跑。

這一點值得單獨強調：worktree 是**工作區隔離**，不是**安全隔離**。agent 仍然以同一個使用者執行，讀得到家目錄、環境變數裡的憑證。執行環境與憑證的隔離是另一層問題，見[模型擋不住工具層的洞](#/skill/agent-credential-isolation)。

## 避免合併衝突：在分派時就處理

worktree 讓 agent 在**工作期間**不會互相覆蓋，但分支最後都要合回 main，兩條分支改了同一段程式，合併時一樣會衝突。衝突最便宜的處理時機是分派之前。

### 1. 介面先定好、先合併

票 2–5 都依賴票 1 建立的「取消狀態」：狀態字串叫什麼、API 回傳的形狀、資料表欄位。如果四個 agent 同時開始，各自猜一次，合併時就有四種版本。做法是先讓票 1（或一張專門的「介面」票）把這些約定定下來並合進 main，其他分支從新的 main 開始。

### 2. 每張票寫出擁有的檔案

分派時列出每張票預計會改的檔案或目錄，找出重疊：

```python run
from fnmatch import fnmatch
from itertools import combinations

# 每張票預計會改的檔案（可以用萬用字元）
plan = {
    "cancel-api":   ["api/appointments/cancel.py", "api/routes.py", "tests/api/test_cancel.py"],
    "cancel-ui":    ["web/pages/my-appointments/*", "tests/web/test_cancel_button.py"],
    "admin-log":    ["admin/cancel_log.py", "api/routes.py", "tests/admin/*"],
    "notify":       ["api/appointments/cancel.py", "workers/notify.py"],
}

# 實際的檔案清單（實務上用 git ls-files）
files = [
    "api/routes.py", "api/appointments/cancel.py", "admin/cancel_log.py",
    "web/pages/my-appointments/list.tsx", "web/pages/my-appointments/cancel.tsx",
    "workers/notify.py", "tests/api/test_cancel.py", "tests/admin/test_cancel_log.py",
    "tests/web/test_cancel_button.py",
]


def owned(patterns):
    return {f for f in files for p in patterns if fnmatch(f, p)}


conflicts = []
for a, b in combinations(plan, 2):
    overlap = owned(plan[a]) & owned(plan[b])
    if overlap:
        conflicts.append((a, b, sorted(overlap)))

if not conflicts:
    print("沒有重疊，可以全部平行")
for a, b, overlap in conflicts:
    print(f"{a} 與 {b} 都會改：{', '.join(overlap)}")
```

執行後會列出兩組重疊：`api/routes.py`（cancel-api 與 admin-log）、`api/appointments/cancel.py`（cancel-api 與 notify）。處理方式：

- **排先後**：notify 等 cancel-api 合併後再開始。代價是少了一點平行。
- **把共用的部分移到介面票**：路由註冊先在介面票裡加好兩條空的路由，兩個 agent 各自只改自己的 handler 檔。
- **指定唯一擁有者**：某些檔案只允許一個 agent 改，其他人需要改時提出來，由擁有者處理。

### 3. 認得幾個常見的熱點

| 檔案 | 為什麼常衝突 | 做法 |
|---|---|---|
| 路由表、DI 註冊、`__init__.py` 的匯出清單 | 每個功能都要在同一處加一行 | 介面票先加好；或改成依目錄自動註冊 |
| migration 檔 | 用流水號時，兩個 agent 都建了 `0042_…` | 用時間戳記命名；或 migration 只由一張票負責 |
| `pyproject.toml` 與 `uv.lock` | 兩個 agent 各加一個依賴，lock 檔衝突很難手動合 | 依賴改動集中由一個 agent 做；衝突時重新 `uv lock`，不要手動合 lock 檔 |
| `CHANGELOG.md` | 大家都在最上面加一行 | 由合併的人或 meta-agent 統一寫 |

### 4. 合併順序與 rebase

依阻擋關係的順序合併。每合進一條分支，其他還在進行的分支就 `git rebase origin/main`（或 merge main）並重跑測試，衝突越早發現越小。每條分支都要在**合併前的最新 main 上**通過 CI，才算真的綠燈。

## 常見錯誤與錯誤訊息

| 訊息或狀況 | 原因 | 處理 |
|---|---|---|
| `fatal: 'agent/api' is already checked out at '/work/wt-api'`（新版 git 措辭是 already used by worktree） | 同一條分支已經在另一個 worktree 被 checkout | 每個 agent 開自己的分支 |
| `fatal: '../wt-api' already exists` | 目標目錄已存在 | 換目錄名，或先確認舊的 worktree 是否還在用 |
| `fatal: '../wt-api' contains modified or untracked files, use --force to delete it` | 要移除的 worktree 還有沒 commit 的改動 | 先確認那些改動是否需要保留，再決定要不要 `--force` |
| 手動 `rm -rf` 了 worktree 目錄後，分支刪不掉或 `git worktree list` 還列著它 | git 的 worktree 紀錄還在 | `git worktree prune` |
| 新 worktree 裡 `ModuleNotFoundError` | `.venv` 不共用 | 在那個 worktree 執行 `uv sync` |
| 兩個 agent 的開發伺服器都要用 8000 port | 工作目錄分開了，但 port 是整台機器共用 | 每個 agent 指定不同的 port |
| 平行跑的測試互相干擾 | 共用同一個測試資料庫 | 每個 worktree 用不同的資料庫名稱或獨立容器 |
| 成員 agent 一直沒有回報 | 它在等一個沒人看到的問題 | 讓「提問」變成看得到的狀態；人定期看每個成員的狀態，而不是只看 meta-agent 的摘要 |

## 動手

1. 在 Playground 執行上面的衝突檢查，把 notify 的 `api/appointments/cancel.py` 拿掉、改成 `api/appointments/hooks.py`，確認那組衝突消失。
2. 在 `plan` 加一張 `release-slot` 票，讓它也改 `api/routes.py`，看檢查怎麼回報，再決定要排先後還是移到介面票。
3. 在自己的 repo 裡用 `git worktree add` 開兩個 worktree，分別 commit，然後在主目錄執行 `git log --all --oneline`，確認不用 fetch 就看得到兩邊的 commit。
4. 試著在第二個 worktree checkout 第一個 worktree 的分支，看 git 給的錯誤訊息；收尾時用 `git worktree remove` 與 `git branch -d` 清乾淨。
