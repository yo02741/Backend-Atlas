## 從一個具體問題開始：agent 說「全部完成」，CI 也是綠的

一張票：「病患可以取消未來的掛號；過去的掛號不能取消，回 409。」交給 agent 做。半小時後它回報：

> 已完成。新增 `cancel` 服務與 API，所有測試通過。

CI 確實是綠的。review 時翻開 diff 才發現三件事：

- 規範測試 `test_cancel_past_appointment_409` 被加上 `@pytest.mark.skip(reason="flaky on CI")`。它不是 flaky，是實作沒處理過去的掛號，測試一直紅，agent 就把它跳過了。
- 票裡提到「重複取消不能報錯」，但沒有任何對應的測試，agent 也沒寫。
- 新增的兩個測試都在測「回傳是 JSON」這種本來就會成立的事。

agent 沒有說謊：在它看到的範圍裡，「測試都通過」是真的。問題出在**判定完成的是寫程式的同一方**，而且判定標準是做完才決定的。這一課處理兩件事：驗收條件怎麼在動工前寫成機器能檢查的清單，以及這份清單由誰、在哪裡執行。

## 運作原理：三個分開

### 1. 寫的人和驗的人分開

產出者驗證自己有一個結構性的問題：**同一個理解，產生程式，也產生檢查**。如果它把「過去的掛號」理解成「已取消的掛號」，它寫的程式和它寫的測試會一致地錯，而且彼此通過。人也一樣，所以有 code review；agent 更嚴重，因為它還能在同一個 session 裡改測試、改設定、加 skip，讓檢查變綠。

因此驗收要由**另一個流程**執行，而且這個流程的輸入不能被產出者改動：

| 驗收者 | 適合檢查什麼 | 產出者能不能影響它 |
|---|---|---|
| CI job（獨立的 pipeline 階段） | 測試結果、lint、型別、覆蓋率門檻、diff 規則 | 驗收腳本與清單放在受保護的路徑，MR 改到它們就直接失敗 |
| 另一個 agent（review agent） | 需求對照、命名、錯誤處理是否合理、測試是否只測現況 | 用全新的 context，只給票、清單和 diff，不給產出者的推理過程 |
| 人 | 產品判斷、使用體驗、清單本身寫得對不對 | 清單由人核准；MR approvals 規則要求非作者核准 |

review agent 要「全新的 context」不是形式：如果它讀到產出者的思考過程，它很容易接受同一套理由。給它的應該是規格與證據。

### 2. 標準和實作分開：動工前就寫好

驗收清單在**拆票時**寫進票裡（或放在 repo 的 `acceptance/<票號>.yaml`），跟需求一起被人看過。做完才定標準，標準會被已經做出來的東西牽著走——「它做到哪裡，就把那裡定為完成」。

清單的每一條都要能被機器判定。改寫的方式：

| 原本的寫法 | 判定不了的原因 | 改寫成 |
|---|---|---|
| 程式碼要乾淨 | 沒有判定方法 | `ruff check` 與 `ruff format --check` 0 錯誤 |
| 要處理過去的掛號 | 沒說處理成什麼 | `test_cancel_past_appointment_409` 通過：回 409、狀態不變 |
| 不要破壞現有功能 | 範圍不明 | 既有測試全數通過，`tests/spec/` 沒有任何檔案被改 |
| 效能要好 | 沒有數字 | 本機 1000 筆資料下 `GET /appointments` p95 小於 200 ms（附量測腳本） |
| 要有文件 | 沒說哪份 | `docs/adr/0009-cancel-appointment.md` 存在，且狀態欄是 Accepted 或 Proposed |

真的判定不了的（「錯誤訊息對病患友善」），明確標成**人工驗收**，而不是假裝自動化。

### 3. 宣稱和證據分開

「做完了」是一個需要證據的主張。證據是**檢查器的輸出**：JUnit XML、coverage 報告、lint 結果、diff。agent 的回報文字只是摘要，不參與判定。

檢查器本身也要防呆：

- **沒跑到的算沒過**。清單要求的測試不在報告裡（被刪、被改名、根本沒寫），判為失敗，不是略過。
- **skip 算沒過**。`skipped` 不是 `passed`。
- **不認識的條目算沒過**（fail closed）。清單新增了一種檢查但檢查器還不支援時，結果是紅的，不是默默通過。

## 「必須」與「禁止」：兩種條目

和 [規範要變成測試](#/skill/ai-spec-to-tests) 的分工：那一課講怎麼把一條規範寫成一個會失敗的測試、怎麼走 red → green；這一課講把這些測試和其他檢查**組成一份清單**，並且由產出者以外的流程執行。清單裡有兩類條目：

**必須（must）**：功能面的完成條件，通常對應到具名的測試，加上工具檢查。

- 指定的測試存在且通過（列出測試名稱，而不是「測試都通過」）
- lint、型別檢查、覆蓋率門檻通過（工具本身見 [AI 改程式的品質閘門](#/skill/ai-quality-gates)）
- 合約檢查：OpenAPI 文件與實作一致、API 回應符合 schema
- 腳本檢查：migration 可以正向與反向執行

**禁止（forbid）**：agent 為了讓「必須」變綠最常走的捷徑，逐條堵住。

- 不得修改規範測試（`tests/spec/` 路徑下的檔案不在 diff 裡）
- 不得新增 `skip`、`xfail`、`# type: ignore`、`# noqa`
- 不得調低覆蓋率門檻、不得改 lint 設定（`pyproject.toml` 的特定區段、`.gitlab-ci.yml`）
- 不得新增相依套件（lockfile 不在 diff 裡，或只允許清單上的套件）
- 不得改動驗收清單與檢查器本身

禁止條款的價值在於它**不需要理解需求就能判定**：看 diff 就知道有沒有違反。它擋的不是能力問題，是「把檢查變綠」和「把功能做對」被混為一談的問題。

## 實際程式：用證據判定，不看回報

下面的檢查器只讀兩份證據：測試報告（JUnit XML，`pytest --junitxml=report.xml` 會產生這種格式）和 diff。清單裡的每一條都對應一個判定規則。

```python run
import re
import xml.etree.ElementTree as ET

# ── 1. 動工前寫好的驗收清單（實務上是 repo 裡的 acceptance/CANCEL-42.yaml） ──
ACCEPTANCE = {
    "ticket": "CANCEL-42 病患可以取消未來的掛號",
    "must": [
        {"id": "M1", "test": "test_cancel_future_appointment", "desc": "取消未來的掛號回 200"},
        {"id": "M2", "test": "test_cancel_past_appointment_409", "desc": "取消過去的掛號回 409"},
        {"id": "M3", "test": "test_cancel_twice_is_idempotent", "desc": "重複取消不報錯、狀態不變"},
    ],
    "forbid": [
        {"id": "F1", "path_prefix": "tests/spec/", "desc": "不得修改規範測試"},
        {"id": "F2", "added_line": r"pytest\.mark\.(skip|xfail)|# type: ignore", "desc": "不得新增 skip / xfail / type: ignore"},
        {"id": "F3", "path_exact": "pyproject.toml", "desc": "不得改相依套件與工具設定"},
    ],
}

# ── 2. 交付物：CI 產生的證據，不是 agent 的回報 ──
AGENT_CLAIM = "已完成 CANCEL-42，所有測試通過。"

JUNIT_XML = """<testsuite tests="3" failures="0" skipped="1">
  <testcase classname="tests.spec.test_cancel" name="test_cancel_future_appointment"/>
  <testcase classname="tests.spec.test_cancel" name="test_cancel_past_appointment_409">
    <skipped message="flaky on CI"/>
  </testcase>
  <testcase classname="tests.test_extra" name="test_cancel_returns_json"/>
</testsuite>"""

DIFF = """\
diff --git a/app/services/appointments.py b/app/services/appointments.py
+def cancel(appointment_id: int, now: datetime) -> Appointment:
+    appt = repo.get(appointment_id)
diff --git a/tests/spec/test_cancel.py b/tests/spec/test_cancel.py
+@pytest.mark.skip(reason="flaky on CI")
 def test_cancel_past_appointment_409(client):
"""

# ── 3. 檢查器：只讀證據，自己判定 ──
def test_results(xml_text):
    """回傳 {測試名稱: 'passed' / 'failed' / 'skipped'}"""
    out = {}
    for case in ET.fromstring(xml_text).iter("testcase"):
        if case.find("failure") is not None or case.find("error") is not None:
            out[case.get("name")] = "failed"
        elif case.find("skipped") is not None:
            out[case.get("name")] = "skipped"
        else:
            out[case.get("name")] = "passed"
    return out

def changed_files(diff_text):
    return re.findall(r"^diff --git a/(\S+) b/", diff_text, flags=re.M)

def added_lines(diff_text):
    return [l[1:] for l in diff_text.splitlines() if l.startswith("+") and not l.startswith("+++")]

results = test_results(JUNIT_XML)
files = changed_files(DIFF)
added = added_lines(DIFF)
report = []
for item in ACCEPTANCE["must"]:
    status = results.get(item["test"], "missing")      # 沒跑到也算沒過
    report.append((item["id"], status == "passed", f"{item['desc']}（{status}）"))
for item in ACCEPTANCE["forbid"]:
    if "path_prefix" in item:
        hit = [f for f in files if f.startswith(item["path_prefix"])]
    elif "path_exact" in item:
        hit = [f for f in files if f == item["path_exact"]]
    else:
        hit = [l.strip() for l in added if re.search(item["added_line"], l)]
    report.append((item["id"], not hit, item["desc"] + (f"（違反：{hit}）" if hit else "")))

print("agent 的回報：", AGENT_CLAIM)
print("檢查器的判定：")
for rid, ok, msg in report:
    print(f"  {'PASS' if ok else 'FAIL'}  {rid}  {msg}")
failed = [rid for rid, ok, _ in report if not ok]
print("結論：", "可以合併" if not failed else f"退回，未通過 {', '.join(failed)}")
```

這段的幾個細節：

- `results.get(item["test"], "missing")`：M3 的測試根本不存在，在報告裡找不到就是 `missing`，判為沒過。只看「failures=0」的話，這一條會被漏掉。
- M2 是 `skipped`，報告的 `failures="0"` 看起來很健康，但它是這次失敗的主因。
- F1 和 F2 都只看 diff，不需要知道掛號系統怎麼運作。

### 放進 CI：獨立的驗收階段

檢查器放在受保護的路徑，跑在獨立的 job。下面是 GitLab CI 的示意（實際的 job 名稱、路徑依專案調整）：

```yaml
stages: [build, test, acceptance]

test:
  stage: test
  script:
    - uv run pytest --junitxml=report.xml
  artifacts:
    when: always            # 測試失敗也要留下報告，驗收階段才讀得到
    paths: [report.xml]

acceptance:
  stage: acceptance
  needs: [test]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - git diff "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME...HEAD" > change.diff
    - uv run python ci/acceptance_check.py --spec "acceptance/$TICKET.yaml" --junit report.xml --diff change.diff
```

再加兩個平台設定，清單才有約束力：

- 專案設定「Pipelines must succeed」，驗收 job 失敗就不能合併。
- `ci/` 與 `acceptance/` 放進 CODEOWNERS，並要求 code owner 核准；MR 改到檢查器本身時，需要人看過。

### 交給 review agent 的東西

自動檢查判定不了的部分（需求有沒有理解對、錯誤處理是否合理），可以交給第二個 agent。給它的輸入要刻意限制：

- 票的原文與驗收清單
- diff 與 CI 的檢查結果
- **不給**產出者的對話紀錄與推理

要求它輸出逐條的判定（通過 / 不通過 / 無法判定，各附理由與行號），而不是一段總評。「無法判定」的條目轉給人。這一層會不會漏判，本身也沒有保證；它的定位是在人 review 之前先擋掉明顯的問題，不是取代 CI 的硬性檢查。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 處理 |
|---|---|---|
| 清單寫「測試全部通過」，agent 把失敗的測試刪掉後全綠 | 條目沒有列出具體的測試名稱 | 改成逐一列名；找不到的測試判為沒過 |
| JUnit 報告 `failures="0"`，但功能其實沒做 | 失敗的測試被 skip 了 | `skipped` 一律判為沒過；禁止條款擋新增的 skip |
| 驗收 job 讀不到 `report.xml` | 測試 job 失敗時 artifacts 沒保留 | `artifacts: when: always` |
| `fatal: ambiguous argument 'origin/main...HEAD'` | CI 的 clone 是淺層的，沒有目標分支 | 先 `git fetch origin <目標分支>`，或調整 clone 深度 |
| 驗收清單在 MR 裡被一起改寬了 | 清單和檢查器沒有保護 | CODEOWNERS 加上核准規則；禁止條款列入「不得改驗收清單」 |
| 檢查器看到新的 `kind` 就略過 | 預設回傳 True | 不認識的條目回傳 False（fail closed） |
| 每張票的清單越寫越長、沒人看 | 把所有偏好都寫成條目 | 只放這張票的完成條件與必要的禁止條款；通用規則放進品質閘門 |

## 動手

1. 在 Playground 執行上面的檢查器，把 `JUNIT_XML` 裡的 `<skipped .../>` 拿掉、補一個 `test_cancel_twice_is_idempotent` 的 testcase，看哪些條目轉為 PASS。
2. 在 `forbid` 加一條「不得新增 `# noqa`」，再在 `DIFF` 加一行含 `# noqa` 的新增行，確認檢查器抓得到。
3. 改寫一張自己手上的票：把需求拆成 must 與 forbid 兩類，每一條都寫出「怎麼判定」。
4. 做程式題 `acceptance-design-1`：實作 `run_acceptance(checklist, delivery)`，包含 fail closed。
5. 延伸：多個 agent 分工時誰負責驗收，見 [多 agent 協作](#/skill/ai-multi-agent)；評測模型輸出的同一套想法，見 [Harness Engineering](#/skill/harness-engineering)。
