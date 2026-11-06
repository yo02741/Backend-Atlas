## 從一個具體問題開始：改了一句 prompt，退款工單全部分錯類

客服團隊有一個分類 agent：讀進使用者來信，輸出 JSON `{"category": ..., "priority": ...}`，下游的工單系統依分類派給不同小組。系統提示寫在供應商後台的「prompt 管理」頁面裡，任何有後台權限的人都能改。

週四下午，一位同事為了讓「帳號問題」分得更準，在系統提示裡加了一句「若信件提到登入、密碼、帳號，一律分類為 account」。他手動試了五封信，結果都對，就存檔了。

週五早上，退款小組發現收不到工單。原因是很多退款信裡都有一句「我登入後看不到訂單」，全部被分到 account。追查花了半天，因為：

- **沒有版本**。後台只存最新版，看不到週四改了什麼、誰改的、改之前長什麼樣。要回滾，只能憑記憶把那句話刪掉。
- **沒有評測**。「試了五封都對」是唯一的驗證。如果有一組兩百封、標好正確分類的信，這次改動在存檔前就會看到退款類的正確率從 0.95 掉到 0.40。
- **沒有分批上線**。改動存檔的那一刻起，所有流量都用新版 prompt。
- **紀錄裡沒有 prompt 版本**。工單系統只記了分類結果，分不出哪些工單是新版 prompt 產生的、要重新分類哪一批。

同一週，供應商把團隊用的模型別名指向了新版本，JSON 輸出偶爾多了一段說明文字，下游解析失敗。這件事和 prompt 改動交疊在一起，更難判斷是哪個原因。

程式碼早就有一套處理這些問題的做法：版本控制、測試、CI、分批部署、回滾。agent 的行為由 prompt、skill、工具定義、模型決定，它們需要同一套做法，只是「測試」要換成評測。

## 運作原理：agent 的哪些東西要被交付

### 行為層的四種檔案

| 檔案 | 例子 | 改了會怎樣 | 放哪裡 |
|---|---|---|---|
| prompt | 系統提示、少樣本範例、輸出格式說明 | 判斷標準與輸出格式改變 | repo 的 `prompts/`，一個檔案一個 prompt |
| skill | `SKILL.md` 與它附帶的腳本、範本 | agent 遇到某類工作時的做法改變 | repo 的 `skills/`，或內部 registry（見 [Skill 的發布與版本](#/skill/skill-registry)） |
| 工具定義 | 工具名稱、描述、參數 schema | 模型何時用哪個工具、參數怎麼填 | 和實作工具的程式碼放一起 |
| 模型設定 | 模型版本、溫度、最大輸出長度、可用工具清單 | 同樣的輸入得到不同的決定 | repo 裡的設定檔，寫完整版本，不用會被改指向的別名 |

這四種都放進 repo、走 MR，和程式碼一起 review。這樣才有 diff 可看、有審查者、有上一版可以回滾。供應商後台的 prompt 管理功能可以當成部署目標（CI 把 repo 裡的版本推上去），但不要當成唯一的真相來源。這些檔案為什麼算供應鏈的一部分，見 [行為層的供應鏈管理](#/skill/agent-supply-chain)。

### 版本與 diff

prompt 的版本號可以很簡單：檔名或檔案開頭的 metadata 寫 `version: 12`，每次改動加一；或者直接用 git commit SHA。重點是**執行期的每一次呼叫都知道自己用的是哪一版**，並寫進紀錄（欄位設計見 [LLM 應用的可觀測性](#/skill/llm-observability)）。

review prompt 的 diff 和 review 程式碼不太一樣，要特別看：

- **新加的絕對規則**（「一律」「永遠」「不得」）：它們會覆蓋其他判斷，像前面的例子。
- **刪掉的範例**：少樣本範例被刪，模型可能就不再處理那一類情況。
- **輸出格式的任何變動**：下游會解析它。
- **提到工具名稱或其他 skill 的句子**：它們改變模型的行動，不只是說話方式。

### 評測集：agent 的測試

評測集是一組固定的輸入，每一筆都有**可以機器判定**的期望：

| 判定方式 | 適合 | 例子 |
|---|---|---|
| 精確比對 | 分類、抽取固定欄位 | `category == "refund"` |
| schema 驗證 | 結構化輸出 | 輸出是合法 JSON、有必要欄位、值在允許清單裡 |
| 包含／不包含 | 必須提到或不得提到的內容 | 回答要包含訂單編號、不得出現內部系統名稱 |
| 數值範圍 | 長度、分數、金額 | 摘要少於 200 字 |
| 工具呼叫檢查 | agent | 這個情境應該呼叫 `lookup_order`，不應該呼叫 `issue_refund` |
| 模型評分（LLM-as-judge） | 開放式回答 | 另一個模型依評分標準給分；本身也有誤差，要定期和人工標註比對 |

能用前四種就不要用模型評分：越接近確定性的判定，CI 的結果越穩定。案例來源優先順序是：過去真的出過錯的案例（每次事故都加一筆）、各分類的代表性案例、邊界案例。每一筆都要能說出「為什麼這是正確答案」，否則評測集本身就是錯的。

模型輸出有隨機性，所以評測要（一）溫度設低或固定，（二）看的是**通過率**而不是單一案例，（三）把真正不能錯的少數案例標成「必過」，單獨判定。為什麼同一個 prompt 會有不同結果、怎麼包一層 harness 控制它，見 [Harness Engineering](#/skill/harness-engineering)。

### 跨模型回歸

同一份評測集對兩個以上的模型跑，輸出一張對照表：

| 案例 | 期望 | 目前的模型 | 候選模型 |
|---|---|---|---|
| refund-017「登入後看不到訂單，想退款」 | refund | refund | account |
| account-042「改密碼收不到信」 | account | account | account |
| ship-003「包裹三天沒動」 | shipping | shipping | shipping |
| 總通過率 | | 0.94 | 0.91 |

看的不只是總通過率：候選模型總分只低一點，但如果掉的全是同一類（例如退款），那一類的使用者就會受影響。差異表要依分類、依「必過」標記分開看。

什麼時候跑跨模型回歸：換模型版本、供應商宣布舊版退役、路由表要加備援模型（見 [AI Gateway](#/skill/ai-gateway)：沒在備援模型上跑過評測，就不要設備援）。

## CI：評測是品質閘門

### pipeline 的形狀

```text
MR 改了 prompts/ 或 skills/
   │
   ├─ lint：prompt 檔案的格式、版本號有沒有加、必要的 metadata
   ├─ eval：對評測集跑新版 prompt，輸出報告；低於門檻或必過案例失敗 → job 失敗
   │        （只在 prompts/、skills/、評測集本身變動時跑：要呼叫模型，花時間也花錢）
   └─ deploy：eval 通過才執行；只在預設分支
```

GitLab CI 的寫法重點：

- **`rules: changes`** 讓 eval job 只在相關路徑改動時出現。注意 [AI 改程式的品質閘門](#/skill/ai-quality-gates) 提過的陷阱：條件寫錯時，MR 可能完全沒跑評測就顯示綠燈。路徑要包含評測集本身與模型設定檔。
- **eval 失敗要讓 pipeline 失敗**：不能 `allow_failure: true`。deploy 放在後面的 stage 或用 `needs` 依賴 eval，eval 失敗就不會執行。
- **模型金鑰**用專案設定裡的 protected、masked 變數，不寫在 `.gitlab-ci.yml`。protected 變數只在受保護分支與 tag 的 pipeline 裡才拿得到，這代表從一般分支開的 MR pipeline 預設讀不到它；要在 MR 上跑評測，得另外為評測準備一把額度很小、只能呼叫評測用模型的金鑰（最好是 AI Gateway 發的虛擬金鑰），或接受評測只在合併後跑。這是取捨，要明確決定，不要為了讓 MR 能跑就把正式金鑰設成非 protected。變數設定見 [GitLab CI/CD](#/skill/gitlab-cicd) 的變數與機密一節。
- **門檻寫在 repo 裡**，和覆蓋率門檻一樣受 CODEOWNERS 保護。同一個 MR 同時改 prompt 又把門檻從 0.90 調成 0.80，就是在繞過閘門。

```yaml
stages: [eval, deploy]

eval-prompts:
  stage: eval
  image: python:3.12-slim
  rules:
    - changes:
        - prompts/**/*
        - skills/**/*
        - evals/**/*
        - config/model.yaml
  script:
    - pip install -r evals/requirements.txt
    # 金鑰來自專案設定的 protected、masked 變數 EVAL_MODEL_API_KEY，檔案裡沒有任何值
    - python evals/run.py --suite evals/cases.jsonl --min-pass-rate 0.90 --report eval-report.json
  artifacts:
    when: always
    paths: [eval-report.json]

deploy-prompts:
  stage: deploy
  image: python:3.12-slim
  needs: [eval-prompts]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      changes:
        - prompts/**/*
        - skills/**/*
  script:
    - python scripts/publish_prompts.py --version "$CI_COMMIT_SHORT_SHA"
```

這份設定不能在瀏覽器裡跑，`evals/run.py` 與 `publish_prompts.py` 是假設存在的腳本。要注意 `needs: [eval-prompts]`：如果 eval job 因為 `rules` 沒出現在 pipeline 裡，而 deploy 出現了，GitLab 會報錯說 needs 的 job 不存在（可以用 `needs: [{job: eval-prompts, optional: true}]` 放寬，但放寬就代表允許沒評測就部署，要想清楚）。上面的寫法讓兩個 job 的 `changes` 一致來避免這個問題。

### 評測腳本做什麼

`run.py` 的核心邏輯很短：讀案例、呼叫模型、判定、算通過率、比門檻、決定結束碼。結束碼非 0，job 就失敗。下面是不呼叫模型、用假輸出代替的版本，可以直接執行：

```python run
import json, sys

# 評測集：每筆有輸入、期望、是否必過
CASES = [
    {"id": "refund-017", "input": "登入後看不到訂單，想退款", "expect": "refund", "must_pass": True},
    {"id": "refund-021", "input": "重複扣款兩次，請退一筆", "expect": "refund", "must_pass": True},
    {"id": "account-042", "input": "改密碼收不到驗證信", "expect": "account", "must_pass": False},
    {"id": "account-050", "input": "帳號被鎖住了", "expect": "account", "must_pass": False},
    {"id": "ship-003", "input": "包裹三天沒動", "expect": "shipping", "must_pass": False},
]

# 兩版 prompt 的模擬輸出（實際上是呼叫模型得到的）
OUTPUTS = {
    "v11": {"refund-017": "refund", "refund-021": "refund", "account-042": "account",
            "account-050": "account", "ship-003": "shipping"},
    # v12 加了「提到登入一律分 account」：退款信被分錯
    "v12": {"refund-017": "account", "refund-021": "refund", "account-042": "account",
            "account-050": "account", "ship-003": "shipping"},
}

def evaluate(version, min_pass_rate):
    results = [(c, OUTPUTS[version][c["id"]] == c["expect"]) for c in CASES]
    rate = sum(ok for _, ok in results) / len(results)
    failed_must = [c["id"] for c, ok in results if c["must_pass"] and not ok]
    passed = rate >= min_pass_rate and not failed_must
    report = {"version": version, "pass_rate": round(rate, 2), "failed": [c["id"] for c, ok in results if not ok],
              "failed_must_pass": failed_must, "gate": "pass" if passed else "fail"}
    print(json.dumps(report, ensure_ascii=False))
    return 0 if passed else 1        # 結束碼：CI 看的是這個

for v in ("v11", "v12"):
    code = evaluate(v, min_pass_rate=0.8)
    print(f"  → {v} 的結束碼 {code}（{'deploy 會執行' if code == 0 else 'pipeline 失敗，deploy 不執行'}）")
# 真正的腳本最後一行是 sys.exit(code)；這裡不呼叫，避免 Playground 把它當成錯誤
_ = sys
```

v12 的總通過率是 0.8，剛好等於門檻；只看通過率它會過。擋下它的是 `refund-017` 被標成必過。這就是「必過」的用途：總分掩蓋不了關鍵案例的退步。

## 上線：金絲雀與回滾到上一版 prompt

評測集再完整也只是樣本。真實流量裡有評測沒涵蓋的情況，所以上線也要分批，做法和程式的金絲雀部署一樣（見 [部署策略](#/skill/cd-strategies)）：

1. 新版 prompt 部署後先接一小部分流量，其餘仍用上一版。分流可以在應用程式裡依使用者 id 雜湊決定，或在 AI Gateway 依比例路由。
2. 同時段比較兩版的指標：錯誤率（含輸出解析失敗）、延遲、token 用量、抽樣評分的通過率、使用者回饋。比的是**同一時段的兩版**，不是新版和昨天。
3. 指標沒變差就逐步放大比例；變差就把比例調回 0。

**回滾實際上改的是什麼**：如果 prompt 是在建置時打包進映像，回滾就是部署上一版映像；如果 prompt 是執行期從設定載入，回滾就是把「目前版本」指回上一個版本號。後者快很多，也是把 prompt 和程式分開版本的理由之一。不管哪種，前提都是**上一版還在、而且知道上一版是哪一版**，這就是為什麼 prompt 一定要進版控。

回滾之後還要處理已經產生的結果：前面的例子裡，新版 prompt 分錯的那批工單要找出來重新分類。紀錄裡有 prompt 版本，才能用一個查詢找出那一批。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| prompt 只存在供應商後台 | 沒有 diff、沒有審查、回滾靠記憶 | repo 是真相來源，CI 推到後台 |
| 手動試幾個例子就上線 | 沒試到的類別退步沒人發現 | 評測集放 CI，每次改動都跑 |
| 只看總通過率 | 關鍵類別退步被平均掉 | 依類別分開看，關鍵案例標必過 |
| eval job `allow_failure: true` | 評測紅了照樣部署 | 評測失敗就讓 pipeline 失敗，deploy 依賴 eval |
| `rules: changes` 漏了評測集或模型設定 | 改評測集或換模型時不跑評測 | 路徑包含 prompts、skills、evals、模型設定 |
| 模型金鑰寫在 `.gitlab-ci.yml` | 金鑰永遠留在 git 歷史 | protected、masked 變數；最好用額度小的評測專用金鑰 |
| 同一個 MR 改 prompt 又調低門檻 | 閘門形同虛設 | 門檻檔案受 CODEOWNERS 保護 |
| 用模型別名 | 供應商改指向時行為改變，沒有變更紀錄 | 寫完整模型版本，換版走跨模型回歸 |
| 紀錄裡沒有 prompt 版本 | 金絲雀分不出兩版、回滾後找不到受影響的資料 | 每次呼叫記 prompt 版本與實際模型 |

## 動手

1. 執行上面的評測模擬，把 `refund-017` 的 `must_pass` 改成 `False`，確認 v12 會通過閘門，再想想這代表什麼。
2. 在 [Playground](#/playground?lang=python) 加一個 `v13` 的輸出，讓它總通過率比 v11 高、但把 `refund-021` 分錯，確認閘門擋下它。
3. 列出你接觸過的一個 agent 或 LLM 功能的行為層檔案，照「行為層的四種檔案」那張表分類，找出哪些目前不在版控裡。
4. 本課的程式題：寫一份 `.gitlab-ci.yml`，讓評測只在 prompts 或 skills 變動時跑、失敗擋住部署、金鑰不寫死。
5. 接著讀 [LLM 應用的可觀測性](#/skill/llm-observability)，看金絲雀比較時需要的欄位怎麼記。
