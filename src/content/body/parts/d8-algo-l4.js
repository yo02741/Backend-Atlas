// 領域內文（d8-algo，P9 新課）：以技能 id 為 key，由 body/d8-algo.js 合併。只放這些技能：event-driven
export default {
  'event-driven': {
    points: [
      { b: '雙寫問題', t: '先 commit 再送事件：送出前程式掛掉，事件就丟了。先送事件再 commit：交易失敗，下游收到一個不存在的「幽靈事件」。只要寫入與送出不在同一個交易，兩種失敗都會發生。' },
      { b: 'outbox：事件和資料同一個交易', t: '把事件寫進同一個資料庫的 outbox 表，與業務資料一起 commit；背景工作讀 outbox 送進 broker，送成功才標記。送出與標記之間掛掉會重送，所以語意是至少一次。' },
      { b: '消費端一定要冪等', t: '用事件 id 當冪等鍵：處理前先 INSERT 進 processed_events，撞到唯一鍵就跳過；去重紀錄和業務效果要在同一個交易。另一種做法是版本號：事件帶版本，比目前版本舊就丟掉。' },
      { b: '順序只在分區內成立', t: '同一個 aggregate（例如同一張訂單）的事件要進同一個分區才能保序；跨分區沒有全局順序。消費端用版本號或 sequence 處理亂序，不能假設先送的先到。' },
      { b: '重放與事件版本', t: '事件是長期資料：schema 要有版本欄位，新增欄位向後相容，改意義就發新版本事件。CDC（Debezium 這類）從資料庫的變更日誌產事件，省掉自己寫 outbox 發送程序，但事件形狀跟著資料表走。' },
    ],
    checklist: [
      '能畫出雙寫的兩種失敗時間線，說明 outbox 分別如何避免',
      '能用 SQL 寫出 outbox 表與冪等鍵表，並說明為什麼去重與效果要在同一個交易',
      '能說明順序保證的範圍（分區內）與事件版本的相容規則',
    ],
    refs: [
      { label: 'PostgreSQL：Logical Decoding', url: 'https://www.postgresql.org/docs/current/logicaldecoding.html' },
      { label: 'Debezium 文件', url: 'https://debezium.io/documentation/' },
    ],
  },
}
