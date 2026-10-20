## 從一個具體問題開始：一個開了三週的分支

`feature/coupon`（優惠券功能）從 main 切出來已經三週。這段期間 main 合進了 60 個 commit，其中有人重構了結帳模組。準備合併時發生的事：

| 時間 | 發生什麼 |
|---|---|
| 第 1 天 | 開分支，計畫「做完再一起合」 |
| 第 21 天 | 開 PR：2,300 行差異、改了 41 個檔案 |
| 第 21 天 | 和 main 合併，14 個檔案衝突，其中 6 個在重構過的結帳模組 |
| 第 22 天 | 解完衝突。審查者面對 2,300 行，只留下「LGTM」 |
| 第 23 天 | 合進 main、部署。結帳金額在某些組合下算錯 |
| 第 23 天 | 想 revert，但那個 merge commit 同時帶著優惠券功能和衝突解法（等於重寫了一部分重構），revert 會把別人的修正一起撤掉 |

問題不是誰寫錯了一行，而是**整合得太晚**：分支越久，跟 main 的距離越大，衝突越多、審查越形式化、出事時越難切出「要撤掉的那一塊」。

以下各節分別處理：多久整合一次、什麼東西能進 main、出事時能不能乾淨地撤、沒做完的功能怎麼每天合。

## 分支策略：多久整合一次

| 策略 | 做法 | 適合 | 代價 |
|---|---|---|---|
| Trunk-based | 所有人至少每天把小變更合回 main（trunk）；分支只活幾小時到一兩天；未完成的功能藏在 flag 後面 | 持續部署的服務 | 需要好的 CI、要會拆小變更、要有 feature flag |
| GitHub Flow | 從 main 開分支 → PR → 審查與 CI → 合併 → 部署 | 大部分 web 服務；和 trunk-based 的差別主要在分支壽命沒有明確要求 | 分支放太久就退化成上面那個三週的例子 |
| Git Flow | `develop`、`feature/*`、`release/*`、`hotfix/*`、`main` 多條長期分支 | 有明確版本號、需要同時維護多個已發行版本的產品（例如安裝在客戶端的軟體） | 分支多、合併路徑多；對持續部署的服務來說流程偏重 |

trunk-based 的核心不是「不開分支」，而是**main 永遠可以部署**，以及**沒有人長時間離開 main**。分支是開 PR、跑 CI 的載具，不是存放半成品的地方。

把一個大功能拆成每天能合的小變更，常見的切法：

- **先合不會被呼叫到的東西**：資料表新欄位（可為空）、新的函式與它的測試，還沒有任何路由用到它。
- **用 flag 包住入口**：新的 API 路由或畫面入口先合進去，但 flag 預設關閉。
- **重構和行為變更分開**：先合一個「只搬程式碼、行為不變」的 PR，再合改行為的 PR。審查者看前者只需要確認行為不變，看後者只需要看那幾行。

## PR／MR 審查：什麼東西能進 main

GitHub 叫 pull request（PR），GitLab 叫 merge request（MR），概念相同：一個「請把這個分支合進目標分支」的請求，附帶差異、討論、CI 結果與核准紀錄。

審查的品質跟 PR 的大小強烈相關：幾百行還能逐行推敲，上千行通常只剩下掃過。讓 PR 可審查的做法：

- **一個 PR 做一件事**：描述寫清楚「改了什麼、為什麼、怎麼驗證」。改格式、改名、搬檔案這種機械變更獨立一個 PR。
- **風格交給工具**：縮排、import 順序、命名格式由 formatter 與 linter 在 CI 裡檢查，審查時間留給正確性、邊界條件、錯誤處理、資料庫遷移的相容性、測試有沒有測到真正的行為。
- **CODEOWNERS**：GitHub 與 GitLab 都支援 `CODEOWNERS` 檔案，指定某些路徑（例如 `migrations/`、`infra/`）的變更要由特定的人或團隊審查。

## 保護分支：讓規則由平台執行

「main 不能直接 push」如果只是口頭約定，總有一天會被打破。平台的保護分支設定讓它變成硬性規則：

| 規則 | GitHub（branch protection rules 或 rulesets） | GitLab（protected branches 與 MR 設定） |
|---|---|---|
| 不能直接 push，必須透過 PR／MR | Require a pull request before merging | Allowed to push 設為 No one |
| 至少幾人核准 | Required approvals | Merge request approvals（細部規則依方案而定） |
| CI 必須通過 | Require status checks to pass | Pipelines must succeed |
| 禁止 force push 與刪除 | 預設禁止，可另外開放 | Allowed to force push 預設關閉 |
| 合併前要跟上最新的 main | Require branches to be up to date | Fast-forward merge 或 merged results pipelines |

「CI 必須通過」是讓 main 自動部署的前提。保護分支也是其他保護的基礎，例如 GitLab 的 protected 變數只注入受保護分支的 pipeline，見 [GitLab CI/CD](#/skill/gitlab-cicd)。

被保護規則擋下時的訊息（GitHub）：

```text
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Changes must be made through a pull request.
 ! [remote rejected] main -> main (protected branch hook declined)
```

GitLab 則會回 `You are not allowed to push code to protected branches on this project.`。這代表規則有效：開分支、發 PR，不是去找人把規則關掉。

## rebase、merge、squash：歷史長什麼樣

假設 main 在你開分支後又多了 `C`、`D` 兩個 commit，你的分支有 `X`、`Y`：

```text
main:     A---B---C---D
               \
feature:        X---Y
```

把分支整合回 main 的三種方式，結果不同：

```text
# merge commit：保留分支原貌，多一個有兩個 parent 的 M
A---B---C---D-------M
         \         /
          X-------Y

# squash merge：X、Y 壓成一個新的 commit S
A---B---C---D---S

# rebase and merge：X、Y 重新套用在 D 之後，變成新的 X'、Y'（SHA 不同）
A---B---C---D---X'---Y'
```

| 方式 | 歷史 | revert 一個功能 | 注意 |
|---|---|---|---|
| merge commit | 保留每個 commit 與分支結構 | `git revert -m 1 <M>`，一次撤掉整個分支 | 歷史比較雜；衝突解法藏在 M 裡 |
| squash merge | 一個 PR 一個 commit，main 是線性的 | `git revert <S>` | 分支內的細節 commit 不會進 main |
| rebase and merge | 線性，保留每個 commit | 要逐一 revert 該 PR 的 commit | 每個 commit 都要能單獨通過測試，否則 `git bisect` 會卡在壞掉的中間狀態 |

團隊選一種寫進規範，在平台設定裡只開放那一種。小 PR 搭配 squash merge 是常見的組合：main 上一個 commit 對應一個 PR，revert 的單位很清楚。

**rebase 會改寫歷史**：X 變成 X'，SHA 不同。只 rebase 還沒有別人在用的 commit（例如自己的功能分支），不要 rebase 已經被別人拉下來的共享分支。rebase 自己的分支後要更新遠端時，用 `--force-with-lease` 而不是 `--force`：它會先確認遠端分支還停在你上次看到的位置，如果有人在這期間推了新 commit，就拒絕覆蓋。

```bash
git fetch origin
git rebase origin/main                 # 把自己的 commit 重新套在最新的 main 上
git push --force-with-lease            # 遠端被別人改過就拒絕，不會默默蓋掉
```

## commit 訊息與可 revert 的 commit

### 一個 commit 做一件事

回到開頭的例子：功能、重構、衝突解法混在一起，revert 就撤不乾淨。可以單獨 revert 的 commit 有幾個特徵：

- 只做一件事（一個修正、一個功能切片、一個重構），訊息一句話說得完。
- 自己能通過測試，不依賴「下一個 commit 會修好」。
- 不夾帶無關的格式修改。整份檔案重新排版會讓 revert 和 `git blame` 都變得難用。

### Conventional Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 是一個 commit 訊息格式的規範：

```text
<type>(<scope>)<!>: <description>

[body]

[footer]
```

```text
fix(auth): reject expired refresh tokens

The expiry check compared seconds with milliseconds.

feat(coupon)!: require coupon code to be uppercase

BREAKING CHANGE: lowercase coupon codes are rejected with 422.
```

規範本身定義了 `feat`（新功能）與 `fix`（修正），以及兩種標示破壞性變更的方式：type 後面加 `!`，或在 footer 寫 `BREAKING CHANGE:`。`docs`、`refactor`、`test`、`ci`、`chore` 這些 type 是常見慣例（例如 commitlint 的預設設定），規範允許但沒有強制。

這個格式能讓工具自動決定下一個版本號，對應到 [Semantic Versioning](https://semver.org/)（`MAJOR.MINOR.PATCH`）：

| commit 裡出現 | 版本號 | 例子 |
|---|---|---|
| `BREAKING CHANGE` footer 或 type 後面的 `!` | MAJOR | 1.4.2 → 2.0.0 |
| `feat` | MINOR | 1.4.2 → 1.5.0 |
| `fix` | PATCH | 1.4.2 → 1.4.3 |
| 只有其他 type | 不發新版（或依團隊規則） | 1.4.2 |

一次發版包含多個 commit 時，取**最大**的那一級。升 MINOR 時 PATCH 歸零、升 MAJOR 時 MINOR 和 PATCH 都歸零。`0.y.z` 階段 SemVer 規定任何東西都可能改變，各個發版工具對 0.x 的處理方式不同，要看工具設定。

### revert 一個 merge commit

```bash
git revert 3f9c2a1            # 一般 commit：產生一個「反向」的新 commit
git revert -m 1 7c3d2a1       # merge commit：-m 1 表示以第一個 parent（main）為基準
```

對 merge commit 直接 `git revert` 會失敗，因為 git 不知道要以哪個 parent 為基準：

```text
error: commit 7c3d2a1... is a merge but no -m option was given.
fatal: revert failed
```

revert 一個 merge 之後要注意：那個分支的 commit 在 git 眼裡**已經合併過了**。修好之後再把同一個分支合一次，原本被撤掉的變更不會回來，要先 revert 那個 revert commit。git 的文件 `howto/revert-a-faulty-merge` 詳細說明了這個情況。這也是 squash merge 搭配小 PR 好處理的原因之一。

## 衝突處理

兩邊改了同一個檔案的同一段，git 沒辦法自己決定，就會停下來：

```text
$ git merge origin/main
Auto-merging app/checkout.py
CONFLICT (content): Merge conflict in app/checkout.py
Automatic merge failed; fix conflicts and then commit the result.
```

檔案裡會出現衝突標記：

```text
<<<<<<< HEAD
    total = subtotal - coupon.amount
=======
    total = pricing.apply_discounts(subtotal, discounts)
>>>>>>> origin/main
```

`HEAD` 那段是目前分支的版本，`=======` 下面是要合進來的版本。解衝突**不是選一邊**：這個例子裡 main 把折扣邏輯搬進了 `pricing.apply_discounts`，正確的解法是把優惠券加進 `discounts`，兩邊的意圖都保留。解完之後：

```bash
git status                   # 列出 both modified 的檔案
git add app/checkout.py      # 標記為已解決
git commit                   # merge 的情況；rebase 則是 git rebase --continue
uv run pytest                # 衝突解完一定要重跑測試：能編譯不代表邏輯對
```

rebase 時衝突是**一個 commit 一個 commit**出現的，訊息是 `error: could not apply ...`，並提示解完後執行 `git rebase --continue`。解到一半想放棄：`git merge --abort` 或 `git rebase --abort` 會回到開始前的狀態。

幾個減少衝突的做法：

- **常同步 main**：每天把 main 合進（或 rebase 到）自己的分支，衝突小的時候就解掉。
- **lock 檔不要手動合**：`uv.lock`、`package-lock.json` 衝突時，接受其中一邊後重新執行 `uv lock` 或 `npm install` 產生，再確認差異。
- **大規模的機械變更**（全專案重新排版、大量改名）約好時間一次合完。

## tag 與發版

tag 是指向某個 commit 的固定名字，用來標記「這是 v1.5.0」。

```bash
git tag -a v1.5.0 -m "v1.5.0"     # annotated tag：記錄建立者、時間、訊息
git push origin v1.5.0            # tag 預設不會跟著 git push 上去，要明確推
git push --follow-tags            # 或者：推送分支時一併推送可達的 annotated tag
```

- **用 annotated tag 發版**：lightweight tag（不加 `-a`）只是一個指標，沒有建立者與時間。
- **tag 發出去就不要移動**：別人可能已經依 v1.5.0 部署或建置了。發錯就發 v1.5.1。平台可以設定 protected tags，限制誰能建立或刪除符合某個模式（例如 `v*`）的 tag。
- **tag 觸發發版管線**：GitHub Actions 用 `on: push: tags: ['v*']`，GitLab 用 `$CI_COMMIT_TAG` 判斷，見 [CI 管線：lint、test、build](#/skill/ci-pipeline)。
- 持續部署的服務常直接用 commit SHA 當 image 版本（見 [環境、secrets 與 artifact](#/skill/environments-secrets)），對外提供的函式庫或 API 才用 SemVer tag。

## feature flag：沒做完也能合進 main

trunk-based 每天合併，但一個功能可能要兩週才做完。feature flag 把「程式碼已經部署」和「使用者看得到」分開：

```python
# 設定可以來自環境變數、設定檔或 flag 服務；預設一定是關
def coupon_enabled(user_id: int) -> bool:
    return flags.is_enabled("coupon", user_id=user_id)

@app.post("/checkout")
def checkout(req: CheckoutRequest, user=Depends(current_user)):
    discounts = []
    if req.coupon_code and coupon_enabled(user.id):   # 關閉時，舊流程完全不變
        discounts.append(load_coupon(req.coupon_code))
    return pricing.checkout(req.items, discounts)
```

flag 的幾種用途：

| 用途 | 例子 | 生命週期 |
|---|---|---|
| 發布開關 | 新功能先對內部帳號開，再逐步開放 | 全面開放後就移除 |
| 百分比放量 | 先給 5% 使用者 | 同上，見 [部署策略與資料庫遷移](#/skill/cd-strategies) |
| 緊急關閉（kill switch） | 推薦服務出問題時關掉推薦區塊 | 長期保留 |

百分比放量要讓**同一個使用者每次得到同樣的結果**，否則使用者重新整理一次就在新舊功能之間跳來跳去。常見做法是對 `flag 名稱 + 使用者 id` 做雜湊，取一個 0–99 的桶號：

```python run
import hashlib

def bucket(flag: str, user_id: int) -> int:
    # 雜湊 flag 名稱與使用者 id：同一個人永遠落在同一個桶，不同 flag 的分桶彼此獨立
    digest = hashlib.sha256(f"{flag}:{user_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100

def is_enabled(flag: str, user_id: int, percent: int) -> bool:
    return bucket(flag, user_id) < percent

users = range(1, 10001)
for pct in (5, 25, 50):
    on = sum(is_enabled("coupon", u, pct) for u in users)
    print(f"放量 {pct:>2}%：10000 人中 {on} 人看到新功能")

# 同一個使用者重複判斷，結果一致；把比例從 5% 調到 25% 時，原本看得到的人仍然看得到
u = 4217
print("使用者", u, "的桶號：", bucket("coupon", u))
print("5% 時：", is_enabled("coupon", u, 5), "；25% 時：", is_enabled("coupon", u, 25))
print("換一個 flag 的桶號：", bucket("new-search", u))
```

用 `hashlib` 而不是 Python 內建的 `hash()`：內建的字串雜湊每次啟動程序都會換種子（`PYTHONHASHSEED`），不同機器、重啟之後算出來的桶不一樣。

flag 的代價是**分支藏進了程式碼**：兩個 flag 就有四種組合要測。發布開關在全面開放後要移除，否則幾個月後沒有人敢動它。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼處理 |
|---|---|---|
| `! [rejected] main -> main (non-fast-forward)`，提示 `Updates were rejected because the tip of your current branch is behind` | 遠端有你本機沒有的 commit | `git pull --rebase`（或先 fetch 再合併），解完衝突再推；不要直接 `--force` |
| `GH006: Protected branch update failed` | 直接 push 到受保護分支 | 開分支、發 PR |
| `! [rejected] feature -> feature (stale info)` | `--force-with-lease` 發現遠端在你上次 fetch 之後被改過 | 先 fetch，看別人推了什麼，整合後再推 |
| `CONFLICT (content): Merge conflict in ...` | 兩邊改了同一段 | 理解兩邊的意圖後合併，`git add` 標記，重跑測試 |
| `error: commit ... is a merge but no -m option was given.` | 對 merge commit 執行 revert 沒有指定 parent | `git revert -m 1 <sha>` |

不會有錯誤訊息、但同樣會出事的情況：

- **把機密 commit 進去再刪掉**：刪掉的那一版仍在 git 歷史裡。要當成已經外洩，先**撤銷並更換**那個機密，再考慮改寫歷史。見 [秘密管理](#/skill/secrets)。
- **解衝突時兩邊都保留**：兩段邏輯同時存在，程式能跑但結果錯，例如折扣算了兩次。衝突解完一定要跑測試。

## 動手

1. 執行上面 feature flag 那段，把 `percent` 從 5 改成 25，確認原本看得到新功能的使用者仍然看得到（桶號小於 5 的一定也小於 25）。
2. 在一個練習用的 repo 裡做出開頭的三個圖：分別用 merge、squash、rebase 整合同一個分支，用 `git log --graph --oneline` 比較歷史，再各自試一次 revert。
3. 故意製造一個衝突（兩個分支改同一行），分別用 merge 與 rebase 解一次，比較 `git status` 的提示。
4. 到本課的程式題：解析 Conventional Commits 訊息，判斷下一個版本號該升哪一級。
