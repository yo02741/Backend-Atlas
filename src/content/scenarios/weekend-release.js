// 設計情境：含資料庫結構變更的週末上線
export default {
  id: 'weekend-release',
  order: 21,
  group: 'ops',
  title: '含 schema 變更的週末上線',
  en: 'Weekend release with a schema change',
  level: 2,
  week: 18,
  skills: ['change-management', 'cd-strategies', 'orm-migrations'],
  lab: 'WeekendReleaseScenarioLab',
  summary: '門診系統改版要動資料庫結構，週一 08:00 開診前一定要能用，還牽動外部檢驗介面，每一步都要留核准紀錄。週末停機一次上、平日分批上，還是維護窗口加預演？',
  situation: '青松醫院（虛構）的門診系統要上 v5.0：醫令資料表拆欄位、改用新的檢驗醫令格式，牽動約 4,000 萬列醫令紀錄（示意）。新版要和外部廠商維護的「衡安檢驗平台」（虛構）交換檢驗醫令與報告。門診週一到週五開診，週一 08:00 是一週最忙的時段；急診與住院 24 小時都會查詢醫令。資訊室 6 個人，院內規定每一筆正式環境變更都要有變更單、核准人與部署紀錄，事後可追溯。',
  constraints: [
    '週一 08:00 開診前門診系統必須可用：新版或舊版都可以，但不能停',
    '急診與住院週末仍在用，停機要事先公告並啟動紙本替代流程',
    '每一步正式環境變更都要有變更紀錄、核准人與部署紀錄，事後查得到',
    '衡安檢驗平台只有測試環境能先試，正式環境的版本由廠商控制',
    '資料轉換在測試機上跑約 4 小時（示意），正式環境資料量更大、時間不確定',
  ],
  options: [
    {
      id: 'bigbang', name: '週末停機一次上線',
      summary: '週六 22:00 停機，備份 → migration → 部署新版 → 介面測試 → 開放。一張變更單涵蓋整版。',
      pros: ['步驟最少，新舊版本不會同時存在，不必寫相容程式', '只需要一次停機公告、一次核准'],
      cons: ['migration 比預期慢只能等，沒有中途停損點', '回滾靠還原備份，沒演練過就不知道要多久', '一次改太多，出錯時很難判斷是哪一部分', '整版只有一筆核准，現場追加的操作常常沒留紀錄'],
    },
    {
      id: 'phased', name: '平日分批上線',
      summary: '用 expand–contract 拆 migration；新版程式先部署、功能旗標關著；再對一個科別開金絲雀，沒問題才全開。每一步走 MR 核准與 pipeline。',
      pros: ['不停機：expand 只新增欄位，回填在背景分批跑', '出錯時關旗標，幾分鐘內退回舊流程', '每一步都有 MR 核准與部署紀錄，稽核證據自動留下', '週一開診不依賴新版：旗標關著就是舊流程'],
      cons: ['要寫雙寫、回填與相容程式，工期拉長到一兩週', '新舊格式並存期間，測試組合變多', '需要旗標系統、分版本監控，以及足夠流量才看得出金絲雀的差異', 'contract（刪舊欄位）要另開變更，等回滾窗口過後才做'],
    },
    {
      id: 'window', name: '維護窗口 + 預演與回滾演練',
      summary: '平日先在正式資料量的複本預演 migration、實際回滾一次並量時間；窗口開始前與中途各設一個 go/no-go 檢核點，依事先寫好的條件決定繼續或回滾。',
      pros: ['停機時間是量過的，不是估的', '回滾步驟演練過，回復時間有實測數字', 'go/no-go 把「簽核齊了沒、時間還夠不夠」變成明確的決定與紀錄', '比分批上線少寫很多相容程式'],
      cons: ['仍要停機，急診與住院要走替代流程', '預演環境要有接近正式的資料量，準備成本高', '外部系統的正式環境只有上線當下才測得到', '檢核點判定 no-go，整個改版就延到下一個窗口'],
    },
  ],
  tradeoffs: {
    axes: ['停機', '回滾', '週一開診風險', '稽核證據', '工程成本'],
    rows: [
      { option: 'bigbang', cells: ['差：數小時，出問題再拉長', '差：還原備份，時間未知', '高：問題疊加時可能拖過 08:00', '差：單一核准，追加操作沒紀錄', '低'] },
      { option: 'phased', cells: ['好：無', '好：關旗標幾分鐘', '低：開診不依賴新版上線', '好：每一步都有 MR 與 pipeline 紀錄', '高：相容程式、旗標、分批回填'] },
      { option: 'window', cells: ['中：數小時，但量過', '中：演練過的回滾，約 1 小時', '低：檢核點有截止時間', '好：變更單加檢核點簽核', '中：預演環境與演練'] },
    ],
  },
  decisions: [
    { id: 'internal-tool', situation: '院內教育訓練報名系統要換資料表結構。週末沒人用，資料只有幾千筆，備份還原 2 分鐘，沒有外部介面。', options: ['bigbang', 'phased', 'window'], answer: 'bigbang',
      explain: '週末沒有使用者，停機沒有影響；資料小、還原快而且容易驗證，一次上線最省事。分批上線的相容程式與預演環境在這裡都不划算。變更單與核准紀錄仍然要留。' },
    { id: 'irreversible', situation: '病歷號編碼規則全面改版：所有表的主鍵與外鍵都要轉換，新舊編碼不能同時運作，衡安檢驗平台也要同一時間切換。', options: ['bigbang', 'phased', 'window'], answer: 'window',
      explain: '新舊編碼不能並存，expand–contract 拆不開，這種一次性轉換只能停機做。關鍵是先在正式資料量的複本預演、量出 migration 與回滾各要多久，並設一個有截止時間的 go/no-go：過了時間還沒驗證完就照演練過的步驟回滾，週一用舊版開診。' },
    { id: 'vendor-date', situation: '新的檢驗醫令格式要配合衡安檢驗平台改版，但對方正式環境的上線日期還沒確定，可能比我們晚一兩週。', options: ['bigbang', 'phased', 'window'], answer: 'phased',
      explain: '新版先部署、旗標關著，新舊格式並存；等對方正式上線、在一個科別試過再全開。兩邊的上線日期不必綁在同一個週末，也不用為了等對方反覆排停機窗口。' },
    { id: 'add-column', situation: '只是在醫令表加一個可為空的備註欄位，舊版程式完全不知道它也能正常運作。', options: ['bigbang', 'phased', 'window'], answer: 'phased',
      explain: '加可為空的欄位本身就是 expand，線上執行只改 catalog、幾秒完成（先設 lock_timeout），舊版不受影響。走平常的 MR 核准與 pipeline 即可，為它停機或辦預演都不划算。' },
  ],
  implementation: [
    { title: 'go/no-go 檢核點（附在變更單上）', lang: 'yaml', code: `change: CHG-0412            # 門診系統 v5.0（含醫令表 schema 變更）
type: normal                # 一般變更：逐案審核
approvals:
  - role: 資訊室主管        # 核准人不得是撰寫或執行的人
  - role: DBA
  - role: 門診業務窗口
rehearsal:
  date: 週三 14:00
  migration_minutes: 252    # 在正式資料量複本實測
  rollback_minutes: 58      # 實際回滾一次的時間
checkpoints:
  - name: go/no-go 1（週六 21:30，停機前）
    require:
      - 三位核准人都已簽核
      - 全量備份排程確認、還原腳本就緒
      - 執行、驗證、溝通人員到位
    on_fail: 不停機，改期
  - name: go/no-go 2（最晚週日 06:00）
    require:
      - migration 完成且列數核對一致
      - 衡安檢驗平台正式環境往返測試通過
      - 冒煙測試：掛號、開醫令、查報告
    on_fail: 照演練步驟回滾，週一用舊版開診
deadline_for_rollback_start: 週日 06:00   # 晚於此時一律回滾，留足回復時間` },
    { title: 'expand–contract 拆 migration（PostgreSQL）', lang: 'sql', code: `-- 第 1 步 expand：只新增可為空的欄位，舊版程式不受影響
SET lock_timeout = '5s';      -- 拿不到鎖就失敗重試，不讓後面的查詢排隊
ALTER TABLE orders ADD COLUMN lab_code text;
ALTER TABLE orders ADD COLUMN lab_payload jsonb;

-- 第 2 步 回填：背景分批，每批 5,000 筆，避免長交易
UPDATE orders
SET lab_code = split_part(legacy_code, '-', 1),
    lab_payload = jsonb_build_object('v', 1, 'raw', legacy_code)
WHERE id IN (
  SELECT id FROM orders
  WHERE lab_code IS NULL AND legacy_code IS NOT NULL
  ORDER BY id LIMIT 5000
);
-- 重複執行直到影響 0 列；新版程式在這段期間雙寫兩邊

-- 第 3 步 新版讀新欄位：功能旗標控制，先開一個科別

-- 第 4 步 contract：回滾窗口過後、確定沒有舊版在跑，另開變更單
-- ALTER TABLE orders DROP COLUMN legacy_code;` },
  ],
  exercise: null,
  refs: [],
}
