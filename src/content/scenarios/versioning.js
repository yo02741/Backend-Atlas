// 設計情境：API 改版不弄壞客戶端
export default {
  id: 'versioning',
  order: 8,
  group: 'api',
  title: 'API 改版不弄壞客戶端',
  en: 'API versioning',
  level: 2,
  skills: ['api-patterns', 'openapi', 'cd-strategies'],
  week: 10,
  lab: 'VersioningScenarioLab',
  summary: '`GET /orders/{id}` 有五種客戶端在用，要改型別、拆欄位、刪欄位，而 iOS 舊版還會活 6 個月。',
  situation: '訂單 API `GET /orders/{id}` 上線兩年，Web、iOS、Android 與兩個合作夥伴的對帳系統都在用。這次要做三件事：`status` 從字串（`"shipped"`）改成物件（代碼、顯示文字、更新時間）；`customer_name` 拆成 `first_name` / `last_name`；刪掉當初不該對外的 `internal_note`。App Store 數據顯示 iOS 舊版至少還會存活 6 個月；合作夥伴改一次整合要排一季。',
  constraints: [
    'iOS 舊版無法強制更新，6 個月內它收到的回應不能變',
    '合作夥伴有 SLA：破壞性變更要提前 90 天通知並給出停用日期',
    '舊欄位最終要真的刪掉，不能永遠養兩套欄位',
    'Web 與後端同一團隊可同天上線；Android 可強制更新，但覆蓋要兩週',
    '同一個 URL 的回應要能被 CDN 快取',
  ],
  options: [
    {
      id: 'additive', name: '只加不改（additive）',
      summary: '新欄位並存，舊欄位保留並標 `deprecated`；永不刪、永不改型別。改型別＝加一個新名字的欄位。',
      pros: ['沒有任何客戶端會壞：不認識的欄位會被忽略', '不需要版本號、不需要協調上線時間', '`Deprecation` / `Sunset` 標頭與 OpenAPI `deprecated: true` 就能把訊息傳出去'],
      cons: ['舊欄位刪不掉，回應越來越肥、命名越來越彆扭（`status` 與 `status_detail` 並存）', '「刪欄位」這件事做不到，違反本情境的限制'],
    },
    {
      id: 'path', name: 'URL 路徑版本（/v2）',
      summary: '`/v2/orders/{id}` 回新格式，`/v1` 原樣維持到 Sunset 日；兩個版本並行。',
      pros: ['界線最清楚：文件、SDK、日誌、CDN 快取鍵都直接看得到版本', '舊客戶端完全不受影響，新客戶端拿到乾淨的格式', '對外部夥伴最好溝通：一個停用日期、一條升級路徑'],
      cons: ['兩個版本的程式碼、測試、監控要同時維護到 v1 退場', '版本是整個 API 一起跳，一個欄位的小改也會逼客戶端「升 v2」', '同一筆資源在兩個 URL 下有兩個快取副本'],
    },
    {
      id: 'header', name: '標頭選版本',
      summary: 'URL 不變，用 `Accept: application/vnd.shop.v2+json` 或 `Api-Version: 2026-09-01` 選版本；沒帶標頭的請求給最舊的預設版。',
      pros: ['URL 維持「一個資源一個位址」，適合日期式版本（每個 API key 釘住一個日期）', '客戶端只改一個標頭就能升版，不用改所有路徑'],
      cons: ['瀏覽器網址列、curl、日誌裡看不到版本，除錯與客服成本高', 'CDN 要加 `Vary: Accept`（或自訂標頭），否則兩個版本互相污染快取', '預設版本一旦設成「最新」，所有沒帶標頭的舊客戶端當場全壞'],
    },
    {
      id: 'expand-contract', name: 'Expand–contract（分階段）',
      summary: '① 加新欄 → ② 雙寫、回填 → ③ 客戶端切換、監控舊欄用量 → ④ 刪舊欄。沒有版本號，靠時間分階段。',
      pros: ['最終真的能刪掉舊欄位，不留永久債', '任何時刻新舊客戶端都能同時運作，部署不需要對齊', '每一步都可回退：階段 ④ 之前隨時可以停'],
      cons: ['階段 ④ 要等最慢的客戶端退場（這裡是 6 個月），期間要一直雙寫', '要有「誰還在讀舊欄位」的量測，否則不知道何時能刪', '外部夥伴的節奏你控制不了，可能永遠卡在階段 ③'],
    },
  ],
  tradeoffs: {
    axes: ['舊客戶端安全', '維護負擔', '最終能刪舊欄', 'CDN 快取 / 除錯'],
    rows: [
      { option: 'additive', cells: ['好：只多不少', '低：一套程式', '差：刪不掉', '好：URL 不變、回應同一份'] },
      { option: 'path', cells: ['好：v1 原樣', '高：兩套並行到 Sunset', '好：v1 退場就一起刪', '好：版本在 URL 上'] },
      { option: 'header', cells: ['中：預設版設錯就全壞', '高：兩套並行', '好：同 path', '差：要 `Vary`，日誌看不到版本'] },
      { option: 'expand-contract', cells: ['好：新舊欄並存期間都安全', '中：雙寫 + 用量監控', '好：這就是它的目的', '好：URL 不變'] },
    ],
  },
  decisions: [
    { id: 'add-field', situation: '只要在回應加一個 `estimated_delivery` 欄位，其他都不動。', options: ['additive', 'path', 'header', 'expand-contract'], answer: 'additive',
      explain: '加欄位不是破壞性變更：寫得正確的客戶端會忽略不認識的欄位。不需要版本號、不需要分階段。只要確認沒有客戶端用嚴格 schema 拒絕未知欄位——合作夥伴的對帳程式要問一下。' },
    { id: 'rename-frozen', situation: '要把 `customer_name` 拆成兩欄，但兩個合作夥伴的整合程式已經沒人維護、不會改；你們也接受舊欄位一直留著。', options: ['additive', 'path', 'expand-contract'], answer: 'additive',
      explain: '既然沒人會遷移，expand–contract 的階段 ④ 永遠走不到，多出來的只是一個沒人敢按的「刪欄位」步驟；為一個欄位開 /v2 又太重。加 `first_name` / `last_name`，`customer_name` 標 deprecated 並在 OpenAPI 註明，接受它成為永久的相容欄位。' },
    { id: 'internal', situation: '內部後台，前後端同一團隊、同一個 repo、每次一起部署。要把 `status` 改成物件。', options: ['additive', 'path', 'header', 'expand-contract'], answer: 'expand-contract',
      explain: '同一團隊也不需要 /v2，但部署不是原子的：舊 bundle 還在瀏覽器快取裡、後端滾動更新有幾分鐘新舊並存。所以仍要一個相容窗口，做法是壓縮版的 expand–contract：這次上線新舊欄位並存、前端改讀新欄，下次上線刪舊欄，兩個 release 走完。' },
    { id: 'public-paid', situation: '對外公開 API，付費合作夥伴幾十家、各家整合時程不同，每年會累積好幾個破壞性變更。', options: ['additive', 'path', 'header', 'expand-contract'], answer: 'path',
      explain: '夥伴需要一條清楚的線：`/v1` 到某天為止、`/v2` 從某天開始，文件、SDK、Sunset 標頭都對得上。expand–contract 靠「舊欄位用量歸零」收尾，幾十家外部客戶的節奏你控制不了。標頭版本也可行，但夥伴在瀏覽器、curl、日誌裡看不到版本，支援成本高。' },
  ],
  implementation: [
    { title: 'deprecated 欄位的回應：欄位還在，用標頭告知停用日（Deprecation 是標記時間點、Sunset 是停止服務日）', lang: 'http', code: `GET /orders/42 HTTP/1.1
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json
Deprecation: @1767225600
Sunset: Sat, 27 Mar 2027 00:00:00 GMT
Link: </docs/changelog#orders-status>; rel="deprecation"
Cache-Control: private, max-age=60

{
  "id": 42,
  "status": "shipped",
  "status_detail": { "code": "shipped", "label": "已出貨", "updated_at": "2026-09-25T08:12:00Z" },
  "customer_name": "王小明",
  "customer": { "first_name": "小明", "last_name": "王" },
  "estimated_delivery": "2026-09-28",
  "total": 1280
}` },
    { title: 'OpenAPI：端點與欄位兩層都能標 deprecated，產生的 client 會帶警告', lang: 'yaml', code: `paths:
  /v1/orders/{id}:
    get:
      deprecated: true              # 整個端點：2027-03-27 停用
      summary: 取得訂單（v1）
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OrderV1' }
  /v2/orders/{id}:
    get:
      summary: 取得訂單
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/OrderV2' }
components:
  schemas:
    OrderV1:
      type: object
      properties:
        id: { type: integer }
        status:
          type: string
          deprecated: true          # 欄位層級：請改讀 status_detail
        status_detail: { $ref: '#/components/schemas/OrderStatus' }
        customer_name:
          type: string
          deprecated: true          # 請改讀 customer.first_name / last_name
        customer: { $ref: '#/components/schemas/Customer' }` },
    { title: 'expand–contract 四階段的資料庫 migration（每階段一次部署，隨時可停在 ④ 之前）', lang: 'sql', code: `-- ① expand：加新欄，可為 NULL，不動舊欄，不需停機
ALTER TABLE orders
  ADD COLUMN status_code       TEXT,
  ADD COLUMN status_updated_at TIMESTAMPTZ,
  ADD COLUMN first_name        TEXT,
  ADD COLUMN last_name         TEXT;

-- ② 雙寫 + 回填：應用程式同時寫新舊欄；舊資料分批補，避免長鎖
UPDATE orders
SET status_code = status,
    status_updated_at = updated_at,
    first_name = split_name(customer_name, 'first'),   -- 拆法依你的資料規則
    last_name  = split_name(customer_name, 'last')
WHERE id BETWEEN $1 AND $2 AND status_code IS NULL;    -- 每批 5,000 筆

-- ③ 客戶端切換：API 同時回新舊欄；用 log 依 User-Agent / API key 統計
--    還在讀舊欄的客戶端。歸零、或過了 Sunset 日，才進 ④

-- ④ contract：先改成不回傳舊欄（可回退），再過一個版本才真的 DROP
ALTER TABLE orders
  DROP COLUMN status,
  DROP COLUMN customer_name,
  DROP COLUMN internal_note;` },
  ],
  exercise: 'rest-design-1',
  refs: [],
}
