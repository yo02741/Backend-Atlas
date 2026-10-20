## 從一個具體問題開始：稽核問「這次上線是誰核准的？」

一家醫院的資訊部在年度稽核時被抽查三筆正式環境的變更。稽核員的問題很具體：

1. 3 月 12 日檢驗報告系統的更新，**申請單在哪裡**？變更內容、影響範圍、風險評估是什麼？
2. **誰核准的**？核准人是不是寫程式的那個人？
3. **什麼時候**部署的？是不是在公告的維護時段？部署到正式環境的版本，和測試過的是不是同一個？
4. 如果出問題，**回復計畫**是什麼？有沒有演練過？
5. 6 月 3 日那次半夜的緊急修正，**事後有沒有補核准**？

資訊部手上有的是：一封 email 寫著「主任說可以」、GitLab 上一個沒有人審查就合併的 merge request、工程師在自己電腦上執行的部署指令，和一段沒人記得的對話。每一項變更也許都沒問題，但**沒有證據證明沒問題**。在受監管的環境（醫療、金融、公部門），「證明有照流程做」和「真的做對」一樣重要。

變更管理就是把這五個問題的答案，在變更發生的當下就自然留下來。做得好的話，證據不是額外寫的文件，而是 CI/CD 流程本身的紀錄。

## 變更管理的基本元素

| 元素 | 要回答的問題 | 常見做法 |
|---|---|---|
| 變更申請 | 改什麼、為什麼改、影響哪些系統與使用者 | 申請單或 issue，連到實際的程式變更 |
| 風險分級 | 出錯的機率與後果有多大 | 依影響範圍、可回復性、是否碰到個資或病人照護分級 |
| 審核 | 誰有權決定可以做 | 低風險：技術主管；高風險：變更審查會議 |
| 職責分離 | 同一個人能不能自己寫、自己核准、自己上線 | 至少「寫的人」與「核准的人」不同 |
| 維護時段 | 什麼時候可以做 | 公告的維護時段；尖峰時段、重要活動期間凍結 |
| 回復計畫 | 失敗時怎麼回到原狀、要多久 | 回滾步驟、資料庫還原方式、判斷「要回滾」的條件 |
| 驗證 | 怎麼確認變更成功 | 上線後的檢查清單、監控指標 |
| 稽核軌跡 | 事後能不能證明上面每一步都做了 | 不可竄改、可查詢、保存期限符合規範的紀錄 |

院內資安政策、醫院評鑑或資訊安全管理制度（例如 ISO/IEC 27001）通常都會要求某種形式的變更管理；具體要留哪些紀錄、保存多久，以適用的規範與院內政策為準，**導入前與資安、稽核單位確認要求**，再設計流程去滿足它，而不是反過來。

### 三種變更

變更管理最常見的抱怨是「每個小改動都要開會」。解法是把變更分類，讓流程的重量和風險相稱。以下是 ITIL 等服務管理框架常用的分法：

| 類型 | 定義 | 例子 | 流程 |
|---|---|---|---|
| **標準變更** standard | 低風險、經常發生、步驟固定、**事先核准過一次**的變更 | 依既定流程更新憑證、調整已核可範圍內的副本數、套用例行的作業系統修補 | 不用每次審核；照標準作業程序執行並留紀錄 |
| **一般變更** normal | 需要逐案評估風險與核准的變更 | 新功能上線、資料庫結構變更、新增對外連線 | 申請 → 風險評估 → 審核 → 排入維護時段 → 執行 → 驗證 |
| **緊急變更** emergency | 必須立即處理、來不及走一般流程的變更 | 修補正在被利用的弱點、修復造成服務中斷的錯誤 | 簡化的即時核准（例如值班主管）→ 執行 → **事後補完**完整紀錄與審查 |

標準變更清單要定期檢視：一般變更做過很多次都沒出事，就可以申請轉成標準變更；標準變更出了事，就退回一般變更。**緊急變更的比例**本身是一個健康指標：比例很高，通常代表一般流程太慢，大家都繞道走。

## 風險分級與審核

風險分級要有明確的判斷依據，而不是由申請人自己勾「低風險」。一個簡單的評分方式：

| 因素 | 低（1） | 中（2） | 高（3） |
|---|---|---|---|
| 影響範圍 | 單一內部工具 | 單一科室或部分使用者 | 全院或核心照護系統 |
| 可回復性 | 一鍵回滾、幾分鐘內恢復 | 可以回滾但需要手動步驟 | 不可逆（刪欄位、資料轉換） |
| 資料敏感度 | 不碰個資 | 讀取個資 | 修改個資或權限設定 |
| 測試程度 | 自動化測試 + 測試環境驗證 | 只有部分測試 | 無法在測試環境重現 |

依總分決定審核層級：低分由技術主管在 merge request 上核准即可；高分要進**變更審查會議**（CAB，Change Advisory Board）。CAB 的價值不在於多一層簽名，而是讓**受影響的人**事先知道：資料庫管理員知道有遷移、門診知道某個時段系統要停、資安知道要開新的對外連線。如果 CAB 只是形式上蓋章，它只會拖慢流程而不會降低風險。

### 職責分離

**職責分離**（segregation of duties）要防的是：一個人就能把未經審查的程式碼放上正式環境。常見的要求：

- 寫程式的人不能核准自己的變更。
- 開發人員對正式環境沒有直接的寫入權限；部署由流水線執行，流水線的權限受控。
- 正式環境的資料庫帳號與應用程式帳號分開；人員查詢正式資料要申請並留紀錄。
- **破窗帳號**（break-glass account）：真正緊急時可以用的高權限帳號，使用時會告警、留紀錄，事後必須檢視。

小團隊人手不夠時，職責分離很難做到完美。至少做到「核准人 ≠ 作者」，並讓部署只能透過流水線，再把例外記錄下來。

## 跟 CI/CD 與 GitLab 結合

變更管理最怕的是兩套平行的世界：申請單系統裡寫一套，實際部署又是另一回事。把流程放進 GitLab，讓證據自動產生：

| 變更管理要求 | GitLab 上的對應 | 留下的證據 |
|---|---|---|
| 變更申請 | issue（含範本：目的、影響、風險、回復計畫），merge request 連到 issue | issue 與 MR 的內容與討論 |
| 審查與核准 | MR 核准規則；CODEOWNERS 指定特定目錄要特定人核准 | 誰在什麼時候核准 |
| 職責分離 | 設定禁止作者核准自己的 MR、有人加新 commit 時重置核准 | 設定本身與每筆 MR 的核准紀錄 |
| 只能透過審查進入主線 | 受保護分支（protected branches）：禁止直接 push，只能透過 MR 合併 | 分支保護設定 |
| 正式部署要人工核准 | 受保護環境（protected environments）限制誰能部署；部署核准（deployment approvals）；部署 job 設為手動 | 誰觸發、誰核准了哪一次部署 |
| 維護時段與凍結期 | 部署凍結（deploy freeze）設定，在 CI 裡用 `CI_DEPLOY_FREEZE` 變數擋住部署 | 凍結期設定與被擋下的 pipeline |
| 測過的就是上線的 | 同一個映像（以 digest 識別）從測試環境一路推到正式環境 | pipeline 紀錄的映像 digest |
| 部署紀錄 | environment 的部署歷史：每次部署的 commit、時間、觸發者 | 環境頁面的部署清單 |
| 稽核軌跡 | 稽核事件（audit events）：權限變更、設定變更 | 稽核事件紀錄 |

GitLab 的部分功能（例如必要核准規則、受保護環境、部署核准、稽核事件）**依版本與授權層級（Free／Premium／Ultimate）而有差異**，自架版（self-managed）與 gitlab.com 的設定位置也可能不同，規劃前先查所用版本的官方文件。下面是一份示意的 `.gitlab-ci.yml`（需要真實的 GitLab 與部署腳本，不能在瀏覽器執行）：

```yaml
stages: [build, test, deploy]

build:
  stage: build
  script:
    - ./build.sh                     # 建置並推送映像，把 digest 寫進 artifact
  artifacts:
    reports:
      dotenv: build.env              # 例如 IMAGE_DIGEST=sha256:...，讓後面的 job 用同一個映像

deploy_staging:
  stage: deploy
  script:
    - ./deploy.sh staging "$IMAGE_DIGEST"
  environment:
    name: staging
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy_production:
  stage: deploy
  script:
    - ./deploy.sh production "$IMAGE_DIGEST"   # 和 staging 用同一個 digest，不重新建置
  environment:
    name: production                 # 在專案設定中把 production 設為受保護環境、需要核准
  resource_group: production         # 同一時間只允許一個正式部署
  rules:
    - if: $CI_DEPLOY_FREEZE          # 凍結期間（部署凍結設定）不產生這個 job
      when: never
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
      when: manual                   # 打版本標籤後才出現，而且要有權限的人手動執行
```

這樣設計之後，「誰核准、什麼時候部署、部署了哪個版本」都在 GitLab 裡。要注意兩件事：

- **紀錄的保存期限**。job 日誌與 artifact 可能依設定過期或被清理；稽核需要的證據（核准紀錄、部署清單、測試報告）要依規範的保存期限另外匯出或確認保存設定。
- **流水線之外的變更**。直接登入伺服器改設定、直接在資料庫下 SQL，GitLab 都看不到。這類操作要另外走申請，並盡量改成透過程式碼與流水線執行（基礎設施即程式碼、migration 檔）。

## 回復計畫與維護時段

每一筆一般變更都要有**回復計畫**，而且要具體到能照著做：

```text
回復條件：上線後 30 分鐘內，掛號 API 錯誤率 > 1% 或 p95 延遲 > 2 秒
回復步驟：
  1. 在 GitLab 重新執行上一個版本的 deploy_production job（v2.3.1）
  2. 資料庫遷移為 expand 階段（只新增可為空的欄位），程式回滾後不需要還原資料
  3. 確認監控指標恢復，通知門診與主管
預估回復時間：10 分鐘
最後演練：2026-03-05，在測試環境實際回滾一次
```

不可逆的變更（刪欄位、資料轉換）要特別處理：先拆成可以回滾的步驟（見 [部署策略與資料庫遷移](#/skill/cd-strategies) 的 expand／contract），或在變更前做好備份並**實際驗證還原所需的時間**。

**維護時段**要選在影響最小的時間，並考慮人力：半夜部署影響的使用者少，但出事時能支援的人也少。醫院的門診尖峰、批價結帳時段、健保申報期間等，可以設為凍結期。

## 實際程式：檢查一張變更申請

下面這段 Python 把上面的規則寫成程式：計算風險分數、決定審核層級、檢查職責分離與維護時段，最後產生一筆稽核紀錄。實務上這類檢查可以放在 CI 裡，對 MR 的描述或變更單內容自動執行：

```python run
import json
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))

def risk_score(c):
    # 四個因素各 1～3 分，見上面的分級表
    return c["scope"] + c["reversibility"] + c["data_sensitivity"] + c["test_level"]

def required_approval(c):
    if c["type"] == "standard":
        return "pre-approved"
    if c["type"] == "emergency":
        return "on-call-manager"          # 事後要補完整審查
    return "cab" if risk_score(c) >= 9 else "tech-lead"

def in_window(ts):
    # 維護時段：週二、週四 22:00～24:00（台北時間）
    return ts.weekday() in (1, 3) and 22 <= ts.hour < 24

def check(c):
    problems = []
    if c["type"] != "standard" and not c.get("rollback_plan"):
        problems.append("缺少回復計畫")
    if c["author"] in c["approvers"]:
        problems.append("作者不能核准自己的變更（職責分離）")
    need = required_approval(c)
    if need == "cab" and not c.get("cab_meeting"):
        problems.append("風險分數高，需要變更審查會議紀錄")
    if c["type"] == "normal" and not in_window(c["scheduled_at"]):
        problems.append("一般變更不在維護時段")
    if c["type"] == "emergency" and not c.get("post_review_due"):
        problems.append("緊急變更要設定事後審查期限")
    return need, problems

change = {
    "id": "CHG-0312",
    "type": "normal",
    "title": "檢驗報告查詢加入分頁",
    "scope": 3, "reversibility": 1, "data_sensitivity": 2, "test_level": 1,
    "author": "dev-a",
    "approvers": ["dev-a"],
    "rollback_plan": "重新部署 v2.3.1；本次無資料庫結構變更",
    "scheduled_at": datetime(2026, 3, 12, 14, 0, tzinfo=TPE),   # 週四下午
    "mr": "!128",
    "image_digest": "sha256:0f3c...",                           # 示意值
}

need, problems = check(change)
print("風險分數：", risk_score(change), "審核層級：", need)
print("問題：", problems or "無")

# 修正：換人核准、改到維護時段，再檢查一次
change["approvers"] = ["lead-b"]
change["scheduled_at"] = datetime(2026, 3, 12, 22, 30, tzinfo=TPE)
need, problems = check(change)
print("修正後問題：", problems or "無")

# 稽核紀錄：誰申請、誰核准、何時、哪個版本、對應的 MR
audit = {k: change[k] for k in ("id", "type", "title", "author", "approvers", "mr", "image_digest")}
audit["scheduled_at"] = change["scheduled_at"].isoformat()
audit["risk_score"] = risk_score(change)
audit["approval_level"] = need
print(json.dumps(audit, ensure_ascii=False, indent=2))
```

## 常見錯誤

| 錯誤 | 後果 | 改法 |
|---|---|---|
| 所有變更都走同一套重流程 | 大家找方法繞過，或全部報成緊急變更 | 分出標準變更；流程重量與風險相稱 |
| 核准在 email 或口頭，部署在另一個系統 | 稽核時對不起來，無法證明核准的就是上線的那個版本 | 核准、部署、版本都在同一條 MR 與 pipeline 上留下紀錄 |
| 每個環境重新建置映像 | 測過的與上線的不是同一個東西 | 建置一次，用 digest 一路推進各環境 |
| 開發人員保有正式環境的直接權限 | 職責分離形同虛設，有人「順手」改設定 | 部署只透過流水線；人員存取走申請與紀錄 |
| 回復計畫只寫「回滾」 | 出事時才發現資料庫回不去 | 寫出條件、步驟、預估時間，並實際演練 |
| 緊急變更沒有事後審查 | 緊急通道變成常態的後門 | 設定補審期限，定期檢視緊急變更的比例與原因 |
| CAB 變成形式上的簽名 | 拖慢流程卻沒降低風險 | 只讓高風險變更進 CAB；會議聚焦在影響與回復計畫 |
| 稽核證據依賴會過期的紀錄 | 一年後要查時，日誌與 artifact 已經被清掉 | 確認保存設定，必要時定期匯出 |

## 動手

1. 執行上面的 Python，把 `type` 改成 `emergency`、拿掉 `post_review_due`，看檢查結果；再把 `scope` 與 `reversibility` 都改成 3，觀察審核層級變成什麼。
2. 為一個熟悉的系統列出三項可以成為**標準變更**的例行作業，並寫下每一項的固定步驟與驗證方式。
3. 檢查一個 GitLab 專案的設定：預設分支是否受保護、MR 是否需要作者以外的人核准、正式環境的部署是否需要手動觸發並限制人員。
4. 相關課程：[GitLab CI/CD 實戰](#/skill/gitlab-cicd)（管線本身怎麼寫）、[環境、secrets 與 artifact](#/skill/environments-secrets)（環境保護規則與部署紀錄）、[部署策略與資料庫遷移](#/skill/cd-strategies)（可回滾的部署方式）、[Git 工作流與分支策略](#/skill/git-workflow)、[事故處理、on-call 與 postmortem](#/skill/incident-response)（緊急變更的來源）、[SLI、SLO 與錯誤預算](#/skill/slo-error-budget)（預算用完時收緊變更）。
