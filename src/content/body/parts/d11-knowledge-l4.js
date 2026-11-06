// 領域內文（d11-knowledge，P9 新課）：以技能 id 為 key，由 body/d11-knowledge.js 合併。只放這些技能：semantic-layer
export default {
  'semantic-layer': {
    points: [
      { b: '指標與維度是定義，不是欄位', t: '一個指標（measure）至少要寫清楚：名稱、公式、來源表、粒度、允許的篩選維度、負責人。「掛號數」是「不含作廢的掛號筆數」還是「所有列數」，差一個 WHERE 就是兩個數字。' },
      { b: 'agent 查定義，不猜 SQL', t: '直接看欄位名寫 SQL，agent 會把 cancelled_at 當取消、把測試資料算進去。有了定義層，問題變成「用哪個指標、切哪個維度、篩什麼」，SQL 由定義產生，結果可追溯到定義版本。' },
      { b: '最小實作：view 加一份指標清單', t: '不用先買工具。每個指標一個資料庫 view（或共用一個聚合 view），再用一張 metrics 表記錄名稱、公式、來源、粒度、owner；agent 的工具只開放查 view 與查清單。' },
      { b: '建在資料治理之上', t: '主資料與代碼表決定維度值是什麼（科別代碼以哪份為準）；資料品質決定指標能不能信。治理沒做，定義層算出來的仍是錯的數字，只是錯得很一致。' },
      { b: 'dbt metrics、Cube 的定位', t: 'dbt 的 semantic layer 把指標定義寫進專案，由查詢服務產生 SQL；Cube 是獨立的語意層服務，對外提供 API 與快取。兩者都解決「定義只寫一份、到處一致」，要先有人願意維護定義。' },
    ],
    checklist: [
      '能替一個常用指標寫出完整定義：名稱、公式、來源表、粒度、允許的篩選維度、負責人',
      '能用 view 實作兩個指標，並說明憑欄位名猜 SQL 會在哪裡算錯',
      '能說明定義層與資料治理（主資料、代碼表、資料品質）的分工',
    ],
    refs: [
      { label: 'PostgreSQL：CREATE VIEW', url: 'https://www.postgresql.org/docs/current/sql-createview.html' },
    ],
  },
}
