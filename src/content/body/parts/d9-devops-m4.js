// 領域內文（d9-devops，m4 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：data-pipelines, dimensional-modeling
export default {
  'data-pipelines': {
    points: [
      { b: '重跑的結果要和跑一次一樣', t: '管線一定會失敗，失敗之後的處理就是重跑。單純的 `INSERT` 追加，重跑一次數字就變兩倍。三種冪等的寫法：分區覆寫（同一個交易裡刪掉這個批次的範圍再寫入）、upsert（`INSERT … ON CONFLICT DO UPDATE`，來源裡消失的列不會被刪掉）、暫存表加原子交換（整張表重算後在一個交易裡換名字）。' },
      { b: '批次日期是參數，回補是同一支程式換日期範圍', t: '批次日期由排程傳入排定的那一天，不用 `now()` 推算，否則補跑時算出來的是別的日期。回補逐個分區執行、各自一個交易，中斷後從失敗的那一天接著跑。另外寫一支回補程式，兩份邏輯遲早不一致。' },
      { b: '增量靠水位，遲到的資料靠重算分區', t: '只處理新資料有兩種定義：依業務日期切分區，或依異動時間的水位。業務日期在過去、之後才出現的資料，當天的批次已經跑完；做法是每天重算最近 N 天的分區，或用載入時間找出受影響的分區，超過區間的交給回補。' },
      { b: '分層：raw、staging、mart', t: 'raw 原樣落地；staging 做改名、轉型、去重與時區換算；mart 放業務邏輯與給人用的表。ETL 與 ELT 差在轉換放在載入之前還是之後：有 raw 層時，轉換失敗或邏輯改了可以從 raw 重跑，不必再抽一次來源。' },
      { b: '品質檢查是管線的一步，失敗要擋住下游', t: '筆數、唯一性、非空、對帳排在發布之前，沒通過就不寫入 mart，下游維持上一個正確的版本。cron、Airflow、Dagster 負責順序、重試、告警與相依，dbt 把 SQL 轉換當程式管理；冪等、分區鍵、品質門檻是管線自己的設計，工具不會代勞。' },
    ],
    checklist: [
      '能把一支追加式的每日彙總改成分區覆寫或 upsert，並說明來源資料被更正時兩者的結果差在哪裡',
      '能說明批次日期為什麼不能用現在時間推算，以及遲到的資料有哪幾種處理方式',
      '能替一個批次寫出筆數、唯一性、非空、對帳四種檢查，並說明檢查失敗時下游應該看到什麼',
    ],
    refs: [
      { label: 'PostgreSQL：INSERT（ON CONFLICT）', url: 'https://www.postgresql.org/docs/current/sql-insert.html' },
      { label: 'PostgreSQL：ALTER TABLE（RENAME）', url: 'https://www.postgresql.org/docs/current/sql-altertable.html' },
      { label: 'Apache Airflow 文件', url: 'https://airflow.apache.org/docs/apache-airflow/stable/index.html' },
      { label: 'dbt 文件', url: 'https://docs.getdbt.com/' },
      { label: 'Dagster 文件', url: 'https://docs.dagster.io/' },
    ],
  },
  'dimensional-modeling': {
    points: [
      { b: '事實表記事件與數字，維度表記描述', t: '事實表一列是一個事件（一筆掛號），欄位是指向各維度的外鍵加上可以計算的數字；維度表放拿來篩選與分組的屬性，刻意不正規化。交易系統的正規化模型為寫入設計，維度模型為查詢設計，是前者的下游，不是取代它。' },
      { b: '先定粒度，再加欄位', t: '粒度是「一列代表什麼」，一張事實表只能有一種，而且盡量取最細的。數字分三類：可加總（掛號數）、半可加總（每日在院人數，不能跨時間加）、不可加總（比率，改存分子與分母）。' },
      { b: '星狀綱要、代理鍵與日期維度', t: '星狀綱要是事實表在中間、每個維度一張表，JOIN 只有一層；雪花把維度再正規化，寬表把屬性攤進事實表。維度表的主鍵用倉儲自己產生的代理鍵，來源的代號留作一般欄位。日期維度一天一列，放假日、會計年度這類算不出來的屬性。' },
      { b: 'SCD：維度變了，歷史要不要跟著變', t: 'Type 1 直接覆寫，過去的事實改用新值歸類。Type 2 關閉舊列、插入新列，用生效日、失效日與是否現行標記版本，每筆事實指向發生當時的版本。Type 3 多一個欄位存前一個值。更正錯字用 Type 1，換科用 Type 2，逐欄決定。' },
      { b: 'Type 2 的細節決定數字對不對', t: '區間用左閉右開，舊版本的失效日等於新版本的生效日；關閉與插入在同一個交易；載入事實時用事件日期當天有效的版本查出代理鍵。用自然鍵 JOIN Type 2 維度卻沒有時間條件，一筆事實會對到多個版本，數字變大而且沒有錯誤訊息。' },
    ],
    checklist: [
      '給一個業務流程，能說出事實表的粒度、有哪些維度，以及每個數字屬於可加總、半可加總還是不可加總',
      '能說明 Type 1 與 Type 2 對歷史報表的影響，並把一筆維度變更套成 Type 2（關閉舊列、插入新列）',
      '能寫出對 Type 2 維度取「某個日期當天有效的版本」的 JOIN，並說明少了時間條件會發生什麼事',
    ],
    refs: [
      { label: 'PostgreSQL：Partial Indexes', url: 'https://www.postgresql.org/docs/current/indexes-partial.html' },
      { label: 'PostgreSQL：Date/Time Types', url: 'https://www.postgresql.org/docs/current/datatype-datetime.html' },
    ],
  },
}
