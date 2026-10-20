## 這階段要做出什麼

第 3 階段的每個介面都還沒有門。這一階段加上兩件事：**驗證**（這個請求是誰發的）與**授權**（這個人能不能對這筆資料做這件事）。

系統有三種角色：

| 動作 | 病患 patient | 櫃台 desk | 醫師 doctor |
|---|---|---|---|
| 查診次與剩餘名額 | 可以 | 可以 | 可以 |
| 掛號 | 只能替自己掛 | 可以替任何病患掛 | 不行 |
| 讀取掛號 | 自己的 | 全部 | 自己診次的 |
| 取消 | 自己的 | 全部 | 不行 |
| 報到 | 不行 | 全部 | 不行 |
| 列出掛號 | 只列自己的 | 全部 | 只列自己診次的 |

這張表就是這一階段的規格，程式要長得跟它一樣。驗證機制的選擇在 [驗證基礎：Session vs Token](#/skill/authn-basics)；角色與屬性的授權模型在 [RBAC 與 ABAC 授權模型](#/skill/rbac-abac)；把驗證授權接進框架（middleware、dependency）在 [驗證授權落地](#/skill/auth-in-practice)。

## 設計決策與取捨

### 驗證與授權分開

請求進來先經過一層驗證：從 cookie 或 `Authorization` 標頭取出憑證、確認有效，產生一個代表「目前使用者」的物件（principal），例如 `{"id": 51, "role": "patient", "patient_id": 7}`。驗證失敗回 **401**。

handler 拿到 principal 之後，才問授權的問題：`can(user, "cancel", appointment)`。不允許時回 **403** 或 **404**（見下面）。兩件事分開，換驗證方式（例如從 session cookie 換成 token）時，授權規則一行都不用改。

憑證本身的選擇：網頁前端用伺服器端 session（cookie 只放 session id，`HttpOnly`、`Secure`、`SameSite`），登出或停權時刪掉 session 就立刻失效；行動 App 或給其他服務呼叫時常用 token。用 JWT 這類自含式 token 時，角色寫在 token 裡，角色變更要等 token 過期才生效，所以有效期限要短。哪一種都可以，取捨在驗證基礎那一課。

### 規則寫成資料：角色 × 動作 × 範圍

純 RBAC（角色決定能做什麼）不夠：病患都是 `patient` 角色，但只能動**自己的**掛號。這需要比對屬性：使用者的 `patient_id` 是否等於掛號的 `patient_id`。這已經是最簡單形式的 ABAC。把它寫成一張表：

```python
POLICY = {
    "desk":    {"read": "any",        "cancel": "any",        "check_in": "any"},
    "patient": {"read": "patient_id", "cancel": "patient_id"},
    "doctor":  {"read": "doctor_id"},
}
```

`"any"` 代表全部，其他值代表「使用者與資料上這個欄位要相等」。好處是規格表和程式一一對應，審查時一眼看得出誰多了權限；查不到的組合就是不允許（**預設拒絕**），新增角色或動作時忘了設定，結果是「不能用」而不是「全部都能用」。

### 掛號時 patient_id 從哪裡來

病患掛號時，`patient_id` **只能**來自 principal，不能採用 body 裡的值。如果 handler 直接用 `body["patient_id"]`，任何病患都能替別人掛號（或把別人的每日上限用完）。櫃台替病患掛號時才從 body 讀 `patient_id`。同一個介面，不同角色取值的來源不同，這一段要寫清楚、測清楚。

### 看不到的資源：403 還是 404

病患請求 `GET /appointments/42`，但 42 號是別人的。兩種回法：

- **403 Forbidden**：誠實說「有這筆，但你不能看」
- **404 Not Found**：當作不存在

掛號 id 是遞增整數，回 403 等於告訴對方「42 號存在」，可以用來推測掛號量。這個系統對病患回 **404**，對櫃台（本來就看得到全部）維持正常行為。代價是除錯比較難：病患說「我的掛號不見了」時，要從日誌確認是真的不存在還是權限擋下（第 8 階段的日誌會記錄授權拒絕的原因）。

401 與 403 也要分清楚：401 是「沒有驗證或憑證無效」，依 HTTP 規範應該附 `WWW-Authenticate` 標頭；403 是「知道你是誰，但不允許」。

### 列表：把權限推進查詢

「列出我的掛號」不能先查全部再在 Python 裡過濾：

- 分頁會壞掉：一頁 50 筆過濾完剩 3 筆，下一頁的 cursor 又從哪裡算
- 資料越多越慢，而且所有人的資料都經過了應用程式的記憶體
- 回傳的總筆數（如果有）會洩漏別人的資料量

正確做法是依角色產生 `WHERE` 條件，讓資料庫只回看得到的列。條件片段是程式寫死的字串，值一律用參數傳入：

| 角色 | 條件 |
|---|---|
| desk | （無條件） |
| patient | `a.patient_id = ?` |
| doctor | `s.doctor_id = ?`（要 JOIN sessions） |
| 其他 | 不查，直接回空 |

### 授權檢查要靠近資料

`can()` 需要掛號的 `patient_id` 與診次的 `doctor_id`，所以授權發生在「讀出資料之後、回傳或修改之前」。只在路由層檢查角色（「病患可以呼叫 cancel」）不夠，那只回答了「能不能呼叫這個介面」，沒有回答「能不能動這一筆」。漏掉後者就是 IDOR（不安全的直接物件參照）：改網址上的 id 就能動別人的資料。

## 關鍵程式

授權函式加上一個取消 handler，示範 404／403 與擁有者檢查怎麼接在一起：

```python run
POLICY = {
    "desk": {"read": "any", "cancel": "any", "check_in": "any"},
    "patient": {"read": "patient_id", "cancel": "patient_id"},
    "doctor": {"read": "doctor_id"},
}


def can(user, action, appointment):
    scope = POLICY.get((user or {}).get("role"), {}).get(action)
    if scope is None:
        return False
    if scope == "any":
        return True
    mine = user.get(scope)
    return mine is not None and mine == appointment.get(scope)


APPOINTMENTS = {
    41: {"id": 41, "patient_id": 7, "doctor_id": 3, "status": "booked"},
    42: {"id": 42, "patient_id": 8, "doctor_id": 3, "status": "booked"},
}


def cancel_handler(user, appointment_id):
    appt = APPOINTMENTS.get(appointment_id)
    if appt is None or not can(user, "read", appt):
        return 404                      # 看不到就當作不存在
    if not can(user, "cancel", appt):
        return 403                      # 看得到但不能取消（例如醫師）
    appt["status"] = "cancelled"
    return 200


patient7 = {"role": "patient", "patient_id": 7}
doctor3 = {"role": "doctor", "doctor_id": 3}
desk = {"role": "desk"}

print("病患 7 取消自己的 41：", cancel_handler(patient7, 41))
print("病患 7 取消別人的 42：", cancel_handler(patient7, 42))
print("醫師 3 取消 42：      ", cancel_handler(doctor3, 42))
print("櫃台取消 42：         ", cancel_handler(desk, 42))
print("沒有 patient_id 的病患：", cancel_handler({"role": "patient"}, 41))
```

在 FastAPI 這類框架裡，驗證通常寫成一個 dependency（`current_user = Depends(get_current_user)`），每個 handler 宣告它需要目前使用者；授權則在 handler 讀出資料後呼叫 `can()`。框架細節在 [驗證授權落地](#/skill/auth-in-practice)。

## 常見錯誤

**只檢查角色，沒檢查擁有者。** `if user.role == "patient": allow()` 讓所有病患都能取消所有掛號。測試時一定要有「病患 A 對病患 B 的資料」這種案例。

**`None == None`。** 使用者物件少了 `patient_id`（例如櫃台帳號誤設成 patient 角色），掛號資料的 `patient_id` 也是 `None` 時，比對結果是 `True`。比對前先確認使用者這邊的值存在。

**相信 body 裡的身分。** 病患掛號時採用 body 的 `patient_id`、取消時採用 body 的 `role`——身分只能來自驗證過的憑證。

**先分頁、再過濾。** 列表頁的筆數忽多忽少，甚至整頁空白。過濾條件要在 SQL 的 `WHERE` 裡。

**把使用者的值拼進 SQL。** `f"WHERE patient_id = {user['patient_id']}"` 在 `patient_id` 來自 token 時看似安全，但只要有一條路徑讓使用者影響這個值，就是 SQL injection。條件片段可以拼，值一律走參數。

**錯誤的狀態碼洩漏存在與否。** 對病患回 403 等於確認了資源存在；要不要洩漏，是一個要在設計時決定的事，而不是哪個 handler 寫了什麼就是什麼。

## 驗收題在測什麼

**三種角色與擁有者**：病患只能讀、取消自己的，不能報到；醫師只能讀自己診次的，不能取消或報到；櫃台三個動作都可以；未知角色、未知動作、沒有角色一律拒絕；缺 `patient_id` 或 `doctor_id` 時不能因為 `None == None` 而通過。

**把權限推進查詢**：用 `sqlite3` 建一個小資料庫，驗證病患、醫師、櫃台各自只拿到看得到的 id，未知角色與缺欄位拿到空 list，並用 `"7 OR 1=1"` 這種輸入確認值是以參數傳入、不會變成 SQL。

登入流程本身（密碼雜湊、session 儲存、token 簽章）不在驗收範圍內，這些在對應的課裡有各自的練習。下一階段處理另一種「同時」的問題：兩個人同時搶同一個診次的最後一個號。
