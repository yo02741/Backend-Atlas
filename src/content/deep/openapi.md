## 從一個具體問題開始：後端改了一個型別，App 在正式環境崩潰

後端把訂單的 `amount` 從字串 `"1980.00"` 改成整數 `1980`，順便做資料清理。後端測試全過，文件（一份 wiki 頁面）忘了改。上線後，網頁前端顯示 `NaN 元`，iOS App 的 JSON 解碼在 `amount` 遇到型別不符直接拋例外，訂單頁打不開。

事後檢討：後端不知道誰在用這個欄位、怎麼用；前端不知道它改了；wiki 上的文件早就和實際行為不一致。缺的是一份**機器可讀、和程式同步、能自動檢查**的 API 描述。OpenAPI 就是這樣的格式：用 YAML 或 JSON 描述每個 endpoint 的路徑、參數、請求與回應的結構。有了它，文件、前端 client 的型別、請求驗證、相容性檢查都可以從同一份規格產生或比對。

## 運作原理：一份 OpenAPI 文件的結構

### 頂層

| 欄位 | 內容 |
|---|---|
| `openapi` | 規格版本，例如 `3.1.0`（以下範例用 3.1） |
| `info` | API 名稱、版本、說明 |
| `servers` | API 的基底網址，例如 `https://api.shop.example/v1` |
| `paths` | 每個路徑與方法：參數、請求 body、各狀態碼的回應 |
| `components` | 可重用的定義：`schemas`、`parameters`、`responses`、`securitySchemes` |
| `security` | 預設套用的認證方式 |
| `tags` | 把 endpoint 分組，給文件顯示用 |

### 一個完整的例子

```yaml
openapi: 3.1.0
info:
  title: Shop API
  version: 1.4.0
servers:
  - url: https://api.shop.example/v1
paths:
  /orders/{orderId}:
    get:
      operationId: getOrder            # 產生 client 時會變成函式名稱：getOrder()
      tags: [orders]
      parameters:
        - name: orderId
          in: path                     # path、query、header、cookie 四種
          required: true
          schema: { type: integer, minimum: 1 }
      responses:
        "200":
          description: 訂單內容
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
        "404":
          $ref: "#/components/responses/NotFound"
  /orders:
    post:
      operationId: createOrder
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/OrderCreate" }
      responses:
        "201":
          description: 已建立
          headers:
            Location: { schema: { type: string } }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
        "422":
          $ref: "#/components/responses/ValidationError"
components:
  schemas:
    Order:
      type: object
      required: [id, status, amount, created_at]
      properties:
        id: { type: integer }
        status: { type: string, enum: [pending, paid, shipped, cancelled] }
        amount: { type: integer, description: 訂單金額（新台幣元，含稅） }
        note: { type: [string, "null"], maxLength: 200 }    # 3.1 的寫法：可以是 null
        created_at: { type: string, format: date-time }
    OrderCreate:
      type: object
      required: [product_id, qty]
      properties:
        product_id: { type: integer }
        qty: { type: integer, minimum: 1, maximum: 99 }
        note: { type: string, maxLength: 200 }
    Problem:
      type: object
      properties:
        type: { type: string }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
  responses:
    NotFound:
      description: 找不到
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
    ValidationError:
      description: 請求內容不合規則
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
security:
  - bearerAuth: []
```

讀法：

- **`$ref`** 指向 `components` 裡的定義。`Order` 定義一次，所有回傳訂單的地方都引用它，改一處就全部改到。
- **`schemas` 用的是 JSON Schema**。OpenAPI 3.1 的 schema 與 JSON Schema 2020-12 對齊；3.0 用的是 JSON Schema 的一個變體，差異最常遇到的是「可為 null」：3.0 寫 `nullable: true`，3.1 寫 `type: [string, "null"]`。兩個版本的工具支援程度不同，選工具時要確認它支援你用的版本。
- **`required` 列在物件層**，不是寫在每個欄位上。沒列進 `required` 的欄位是選填。
- **`operationId`** 要全份文件唯一；產生 client 時會變成函式或方法的名稱，改它就會改到前端程式碼。
- **狀態碼是字串鍵**（`"200"`），也可以用 `"4XX"` 或 `default` 描述一整類回應。

### 規格與文件、驗證、client 的關係

```
                  ┌──────────────── 文件（Swagger UI、Redoc）
                  │
  openapi.yaml ───┼──────────────── 前端／App 的 client 與型別
                  │
                  ├──────────────── 請求驗證（伺服器端或閘道）
                  │
                  └──────────────── CI：規格 diff、契約測試、mock server
```

同一份規格驅動所有東西，任何一處和規格不一致都能被發現。

## 從程式產生，還是先寫規格

| | code-first（從程式產生） | design-first（先寫規格） |
|---|---|---|
| 做法 | 在程式裡宣告型別與路由，框架輸出規格 | 先寫 `openapi.yaml`、評審，再實作 |
| 代表工具 | FastAPI（pydantic）、NestJS 的 Swagger 模組、Spring 的 springdoc | 編輯器加 linter（例如 Spectral）、mock server（例如 Prism） |
| 規格和實作一致 | 自動一致（規格就是從程式來的） | 要靠契約測試確保 |
| 前後端並行開發 | 後端要先寫出骨架 | 規格定好就能並行，前端用 mock server 開發 |
| 評審 API 設計 | 要看程式或產出的規格 | 直接評審 YAML，改設計的成本最低 |
| 適合 | 小團隊、後端主導、快速迭代 | 多團隊、對外公開的 API、要先對齊的合作 |

FastAPI 的 code-first 長這樣（需要安裝 FastAPI，不能在瀏覽器裡跑）：

```python
from datetime import datetime
from typing import Literal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Shop API", version="1.4.0")

class OrderCreate(BaseModel):
    product_id: int
    qty: int = Field(ge=1, le=99)            # 變成 schema 的 minimum / maximum
    note: str | None = Field(default=None, max_length=200)

class Order(BaseModel):
    id: int
    status: Literal["pending", "paid", "shipped", "cancelled"]   # 變成 enum
    amount: int = Field(description="訂單金額（新台幣元，含稅）")
    note: str | None = None
    created_at: datetime                     # 變成 format: date-time

@app.post("/orders", status_code=201, response_model=Order, operation_id="createOrder")
def create_order(body: OrderCreate) -> Order:
    ...

@app.get("/orders/{order_id}", response_model=Order, operation_id="getOrder",
         responses={404: {"description": "找不到"}})
def get_order(order_id: int) -> Order:
    raise HTTPException(status_code=404, detail="order not found")
```

啟動後 `/openapi.json` 是規格、`/docs` 是 Swagger UI、`/redoc` 是 Redoc。請求 body 不符合 `OrderCreate` 時，FastAPI 自動回 422；`response_model` 會過濾回應，只留下 `Order` 有的欄位。要注意的是，`responses={404: ...}` 只是**文件**，框架不會檢查程式真的只回這些狀態碼。

兩種做法都要把規格當成**合約**：規格要進版本控制、改規格要經過評審，code-first 也要在 CI 裡把產出的 `openapi.json` 存下來比對。

## 版本與向後相容的規則

規格最直接的用途，是讓「這次改動會不會弄壞客戶端」可以被機器判斷：

| 變更 | 對回應 | 對請求 |
|---|---|---|
| 加一個選填欄位 | 相容（客戶端要忽略不認識的欄位） | 相容 |
| 加一個必填欄位 | 相容（多給了一個欄位） | **破壞**：舊客戶端不會送 |
| 刪欄位、改名 | **破壞** | 相容性看伺服器會不會拒絕多出來的欄位 |
| 改型別（string → integer） | **破壞** | **破壞** |
| 選填改必填 | 相容 | **破壞** |
| 必填改選填 | **破壞**：客戶端以為一定有值 | 相容 |
| enum 加值 | **可能破壞**：客戶端沒處理未知值 | 相容 |
| enum 刪值 | 相容 | **破壞** |
| 收緊限制（`maxLength` 200 → 100） | 相容 | **破壞** |
| 放寬限制 | 可能破壞（客戶端的欄位放不下） | 相容 |
| 改 `operationId` | 不影響線上行為 | 產生的 client 函式名稱改變，前端編譯失敗 |

規律是：**伺服器送出去的東西（回應）只能變多、變嚴格；伺服器接受的東西（請求）只能變少要求、變寬鬆**。反過來就是破壞性變更，要開新版本或走淘汰流程（見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)）。

改語意（`amount` 從含稅改成未稅）不改 schema，任何工具都抓不到，只能靠評審與 `description` 寫清楚。

回應的 schema 加上 `additionalProperties: false` 要小心：用這份規格產生的嚴格客戶端或驗證器，在伺服器之後加了新欄位時會拒絕整個回應，把「相容的加欄位」變成破壞性變更。

### 在 CI 裡自動檢查

```bash
# 比對 main 分支與這個 PR 的規格，有破壞性變更就讓 CI 失敗
git show origin/main:openapi.yaml > /tmp/base.yaml
oasdiff breaking /tmp/base.yaml openapi.yaml --fail-on ERR
```

`oasdiff` 是比對兩份 OpenAPI 文件的開源工具，類似的工具還有幾種；重點是把「比對規格」放進每個 PR 的檢查，破壞性變更必須明確標記、經過同意才能合併。

## 實際程式：一個簡化的相容性檢查

下面這段 JavaScript 比對兩版 schema，依照上面的規則找出破壞性變更。真實工具還會處理 `$ref`、巢狀物件、參數、狀態碼等，這裡只看一層物件的欄位：

```js run
// 比對兩版物件 schema；direction = 'response'（伺服器送出）或 'request'（伺服器接收）
function diffSchema(oldS, newS, direction) {
  const issues = []
  const oldReq = new Set(oldS.required || []), newReq = new Set(newS.required || [])
  const typeOf = (p) => [].concat(p.type).join('|')   // 3.1 的 type 可以是陣列
  for (const [name, oldP] of Object.entries(oldS.properties)) {
    const newP = newS.properties[name]
    if (!newP) {
      if (direction === 'response') issues.push(`刪除了欄位 ${name}`)
      continue
    }
    if (typeOf(oldP) !== typeOf(newP)) issues.push(`${name} 型別 ${typeOf(oldP)} → ${typeOf(newP)}`)
    if (direction === 'request' && !oldReq.has(name) && newReq.has(name)) issues.push(`${name} 從選填變必填`)
    if (direction === 'response' && oldReq.has(name) && !newReq.has(name)) issues.push(`${name} 從必填變選填，客戶端可能拿到 undefined`)
    if (oldP.enum && newP.enum) {
      const added = newP.enum.filter((v) => !oldP.enum.includes(v))
      const removed = oldP.enum.filter((v) => !newP.enum.includes(v))
      if (direction === 'response' && added.length) issues.push(`${name} 的 enum 多了 ${added}（客戶端要能處理未知值）`)
      if (direction === 'request' && removed.length) issues.push(`${name} 的 enum 少了 ${removed}`)
    }
    if (direction === 'request' && (newP.maxLength ?? Infinity) < (oldP.maxLength ?? Infinity)) issues.push(`${name} 的 maxLength 變小`)
  }
  for (const name of Object.keys(newS.properties)) {
    if (!oldS.properties[name] && direction === 'request' && newReq.has(name)) issues.push(`新增必填欄位 ${name}`)
  }
  return issues
}

const orderV1 = {
  required: ['id', 'status', 'amount', 'note'],
  properties: {
    id: { type: 'integer' },
    status: { type: 'string', enum: ['pending', 'paid', 'shipped'] },
    amount: { type: 'string' },
    note: { type: 'string' },
  },
}
const orderV2 = {
  required: ['id', 'status', 'amount'],
  properties: {
    id: { type: 'integer' },
    status: { type: 'string', enum: ['pending', 'paid', 'shipped', 'cancelled'] },
    amount: { type: 'integer' },
    note: { type: ['string', 'null'] },
    currency: { type: 'string' },              // 回應加欄位：相容
  },
}
console.log('回應 Order 的變更：')
for (const i of diffSchema(orderV1, orderV2, 'response')) console.log('  ✗ ' + i)

const createV1 = { required: ['product_id', 'qty'], properties: { product_id: { type: 'integer' }, qty: { type: 'integer' }, note: { type: 'string', maxLength: 200 } } }
const createV2 = { required: ['product_id', 'qty', 'channel'], properties: { product_id: { type: 'integer' }, qty: { type: 'integer' }, note: { type: 'string', maxLength: 100 }, channel: { type: 'string' } } }
console.log('請求 OrderCreate 的變更：')
for (const i of diffSchema(createV1, createV2, 'request')) console.log('  ✗ ' + i)
```

## 契約測試：規格和實作有沒有一致

design-first 的規格不會自動跟著程式走；code-first 的規格雖然來自程式，但「實際回了規格沒寫的狀態碼」「回應欄位實際是 null」這類事情仍然可能發生。契約測試就是檢查兩者是否一致：

| 做法 | 怎麼做 | 抓得到什麼 |
|---|---|---|
| 回應驗證 | 在整合測試裡，拿每個實際回應對規格的 schema 做驗證 | 欄位缺漏、型別不符、規格沒列的狀態碼 |
| 從規格產生測試 | 工具依 schema 產生大量請求（含邊界值）打 API，例如 Schemathesis | 伺服器對奇怪輸入回 500、回應不符合規格 |
| 消費者驅動的契約 | 每個客戶端寫下「我用到哪些欄位、期待什麼」，提供者在 CI 驗證，例如 Pact | 提供者的變更會不會弄壞**實際存在的**客戶端 |
| mock server | 依規格回假資料，前端在後端完成前開發 | 前端對規格的誤解 |

規格的 diff 檢查回答「規格有沒有變得不相容」，契約測試回答「實作有沒有遵守規格」，兩者都需要。

## 產生 client

```bash
# 產生 TypeScript 型別（只有型別，沒有執行期程式碼）
npx openapi-typescript https://api.shop.example/v1/openapi.json -o src/api/schema.d.ts

# 產生完整的 client（含呼叫函式）；generator 名稱依目標語言而定
npx @openapitools/openapi-generator-cli generate -i openapi.yaml -g typescript-fetch -o src/api/client
```

產生的 client 讓前端呼叫變成 `api.getOrder({ orderId: 1043 })`，回傳值有 `Order` 的型別。後端改了 `amount` 的型別，前端重新產生後，所有把 `amount` 當字串用的地方會**編譯失敗**，問題在開發時就出現，而不是在使用者面前。

幾個實務規則：

- 產生的程式碼不要手改；要客製就包一層。
- 產生步驟放進前端的建置或 CI，規格更新就重新產生，否則型別會過時。
- `operationId` 要穩定、有意義：沒寫時工具會從路徑與方法自動組名稱，路徑一改，名稱就變。

## 常見錯誤

- **規格只是文件**：手寫在 wiki 或獨立的 YAML，沒人在 CI 驗證它和程式一致，幾個月後就和實際行為脫節。
- **所有欄位都是選填**：沒寫 `required`，產生的型別全是 `field?: T`，前端到處都要判斷 `undefined`，型別檢查失去意義。
- **錯誤回應沒寫進規格**：只描述 200，客戶端不知道 422 的 body 長什麼樣。至少把共用的錯誤格式放進 `components/responses` 並在每個 endpoint 引用。
- **`nullable` 和 3.1 混用**：在 `openapi: 3.1.0` 的文件裡寫 `nullable: true`，3.1 的工具會忽略它，欄位就變成不可為 null。
- **同一個 schema 用在請求和回應**：`id`、`created_at` 是伺服器產生的，放進建立請求的 schema 會讓客戶端以為要送。分成 `OrderCreate` 和 `Order`，或用 `readOnly: true` 標記。
- **`format` 被當成驗證**：`format: email`、`format: date-time` 在 JSON Schema 中預設只是註記，不一定會被驗證器檢查，要看所用工具的設定。
- **改 `operationId` 或 tag 當作「只是整理」**：會讓產生的 client 函式名稱與檔案結構改變，前端要跟著改。

## 動手

1. 按 JavaScript 那段的「在 Playground 開啟」，在 `orderV2` 裡把 `id` 改成 `{ type: 'string' }`、刪掉 `status`，看檢查結果；再加一條規則：回應的欄位放寬了 `maxLength` 時提出警告。
2. 把上面的 YAML 例子貼到任一個 OpenAPI 編輯器（例如 Swagger Editor），看產生的文件；故意把 `required` 裡寫一個不存在的欄位，看編輯器會不會提示。
3. 為「取消訂單」`POST /orders/{orderId}/cancel` 補上規格：成功回 200 與 `Order`、已出貨回 409、找不到回 404，錯誤都引用共用的 `Problem`。狀態碼怎麼選見 [REST API 設計](#/skill/rest-design)。
4. 到 [API 改版不弄壞客戶端](#/scenario/versioning)，用上面的相容性表檢查情境裡每一個變更屬於哪一類。
