// 設計情境：舊排班與掛號系統的替換
export default {
  id: 'legacy-replacement',
  order: 29,
  group: 'ops',
  title: '舊排班與掛號系統的替換',
  en: 'Replacing a legacy scheduling system',
  level: 3,
  week: 16,
  skills: ['legacy-migration', 'legacy-data-sync', 'change-management', 'cd-strategies'],
  lab: 'LegacyReplacementScenarioLab',
  summary: '用了 14 年的排班與掛號系統要換成新的服務，門診與急診不能停，約三成的行為沒有文件。一個週末全部換掉、入口層一塊一塊導流，還是新舊並行比對到達標才切？',
  situation: '景和醫院（虛構）的排班與掛號系統上線 14 年，跑在舊的關聯式資料庫上，共 24 個功能模組（示意）：查排班、預約、報到、掛號費試算、班表產生等。原開發廠商已不再維護，估計約三成的行為只存在程式與預存程序裡，沒有文件。門診每天約 3,000 筆掛號（示意），急診 24 小時使用。資訊室 7 個人要一邊維護舊系統，一邊把它換成新的服務。',
  constraints: [
    '門診開診時段與急診不能停；可以停機的只有事先公告的週末夜間',
    '約三成的行為沒有文件，原開發者已經找不到',
    '新舊並存期間兩邊資料要一致；同步程式對舊資料庫只有唯讀帳號',
    '人力固定：替換期間舊系統的法規調整與報修仍要處理',
    '每一次切換都要有回退方式，並留下變更與核准紀錄',
  ],
  options: [
    {
      id: 'bigbang', name: '一次切換',
      summary: '新系統全部寫好、測完，挑一個週末停機：搬資料、切換連線，週一全院用新系統。',
      pros: ['新舊不並存：不需要入口層、資料同步與雙軌維護', '只有一次停機公告與一次切換', '使用者只需要適應一次'],
      cons: ['全部功能做完才能上線，之前沒有任何一塊被真實使用過', '沒發現的行為差異全部在上線後、全流量下出現', '開診後新系統已有新資料，退回舊系統等於再搬一次資料', '開發期間舊系統的每個修改都要在新系統重做一次'],
    },
    {
      id: 'strangler', name: '逐步替換',
      summary: '在舊系統前面放入口層，每個月把幾個模組的請求導到新系統：先小比例、再全量；舊系統處理的範圍逐月縮小。',
      pros: ['每次切換只是改路由，不需要停機', '出問題把規則改回舊系統，幾分鐘內退回，影響限於那個模組與那個比例', '第一個月就有模組上線，新系統持續被真實流量驗證', '可以隨時停在任何進度，已搬的模組照常運作'],
      cons: ['新舊長期並存：要做資料同步、對帳與入口層規則的維護', '沒發現的差異仍然是上線後才看到，只是範圍小', '模組之間共用資料與流程時，切分的順序不好排', '最後幾個模組最難搬，容易停在兩套並存的狀態'],
    },
    {
      id: 'parallel', name: '並行比對後再切',
      summary: '模組做好後先不接手：同一個請求新舊都執行、只回舊的結果，比對差異；差異率降到門檻以下並全部歸類，才把流量切過去。',
      pros: ['大部分行為差異在上線前就被真實流量抓出來', '比對期間使用者完全不受影響', '比對紀錄可以當成切換的核准依據', '切換後仍可改路由退回'],
      cons: ['每個模組多一段並行期，總時程最長', '要建比對機制：隔離副作用、忽略清單、差異歸類，並有人每天看', '會寫入或有外部副作用的功能很難直接比對', '雙軌維護的人力最多'],
    },
  ],
  tradeoffs: {
    axes: ['切換日停機', '差異何時發現', '回退', '雙軌維護', '總時程'],
    rows: [
      { option: 'bigbang', cells: ['差：一次長停機', '差：上線後、全流量', '差：開診後幾乎退不回', '好：沒有並存期', '中：全部做完才上線'] },
      { option: 'strangler', cells: ['好：只改路由', '中：上線後、小範圍', '好：改回規則，幾分鐘', '中：同步與入口層', '中：逐月上線'] },
      { option: 'parallel', cells: ['好：只改路由', '好：多數在上線前', '好：改回規則，幾分鐘', '差：再加比對與歸類', '差：每塊多一段並行期'] },
    ],
  },
  decisions: [
    { id: 'small-tool', situation: '院內會議室借用系統要換新：5 個功能、規則簡單而且有文件，週末沒有人用，資料只有幾百筆，備份還原幾分鐘。', options: ['bigbang', 'strangler', 'parallel'], answer: 'bigbang',
      explain: '範圍小、行為清楚、週末停機沒有影響，還原也快，一次切換的三個風險在這裡都不成立。為它架入口層、做資料同步或並行比對，成本比系統本身還高。變更紀錄與回退步驟仍然要有。' },
    { id: 'fee-rules', situation: '掛號費與部分負擔的計算要搬到新系統。規則十幾年來陸續追加，沒有完整文件，算錯會直接影響收費。試算本身只讀資料、不寫入。', options: ['bigbang', 'strangler', 'parallel'], answer: 'parallel',
      explain: '行為沒人說得清、出錯代價高，而且試算沒有副作用，正適合並行比對：真實請求兩邊都算、只回舊的結果，把差異逐類釐清後再切。逐步替換會讓沒發現的規則在真實收費上出錯才被看到；一次切換則是全院同時出錯。' },
    { id: 'read-module', situation: '查詢排班是唯讀功能，有文件與自動化測試，占全部請求的六成（示意）。舊主機尖峰時段負載偏高，希望先減輕。', options: ['bigbang', 'strangler', 'parallel'], answer: 'strangler',
      explain: '邊界清楚、只讀、行為有文件，是入口層導流最好的第一塊：先放一成流量，沒問題就逐步放大，有問題改回規則即可。它的行為已經有測試固定，為它再排一段並行期的收益不大；一次切換則要等其他模組全部完成。' },
    { id: 'monthly-batch', situation: '每月產生下個月班表的批次：輸入是醫師請假與診間資料，輸出是整個月的班表。一個月只跑一次，沒有線上請求可以分流。', options: ['bigbang', 'strangler', 'parallel'], answer: 'parallel',
      explain: '批次沒有請求可以在入口層依比例導流，逐步替換的手法用不上。它的輸入與輸出都是完整的檔案，適合並行執行：同一份輸入新舊各跑一次，比對整個月的班表，連續幾個月一致再改用新的。一次切換等於第一次用新批次就直接影響全院排班。' },
  ],
  implementation: [
    { title: '入口層：依路徑與比例導流（nginx）', lang: 'nginx', code: `upstream legacy_app { server legacy.internal:8080; }
upstream new_app    { server scheduling.internal:8000; }

# 依使用者固定分流（這裡取 X-User-Id 標頭）：同一個人不會一下新、一下舊
split_clients "\${http_x_user_id}" $appointments_backend {
    20%     new_app;       # 先放 20%
    *       legacy_app;
}

server {
    listen 443 ssl;
    server_name his.example.internal;
    # 憑證設定省略

    # 已全量切到新系統
    location /api/schedules/ {
        proxy_pass http://new_app;
    }

    # 部分流量
    location /api/appointments/ {
        proxy_pass http://$appointments_backend;
    }

    # 並行比對：回舊系統的結果，請求另外複製一份給新系統
    location /api/fees/ {
        mirror /_shadow;
        proxy_pass http://legacy_app;
    }
    location = /_shadow {
        internal;
        proxy_pass http://new_app$request_uri;
        proxy_set_header X-Shadow "1";      # 新系統看到這個標頭就不執行副作用
    }

    # 其他全部照舊
    location / {
        proxy_pass http://legacy_app;
    }
}
# 注意：mirror 只負責把請求複製出去，鏡像的回應會被丟掉。
# 要比對新舊結果，得在入口服務或應用程式裡做（見程式題）。` },
    { title: '每個模組的切換檢核表（附在變更單上）', lang: 'yaml', code: `module: 掛號費試算
owner: 門診組 + 資訊室
stages:
  - name: 並行比對
    enter:
      - 新系統收到 X-Shadow 時不寄通知、不寫正式資料
      - 忽略清單已核准：generated_at、trace_id
    exit:
      - 連續 14 天差異率低於 0.1%        # 門檻依出錯代價決定
      - 剩餘差異全部歸類並有處理方式
  - name: 部分流量（10% → 50%）
    enter:
      - 資料同步對帳連續 7 天一致
    watch: [錯誤率, 回應時間, 每日掛號費合計與舊系統的差]
    rollback: 把比例調回 0（改路由，約 5 分鐘）
  - name: 全流量
    rollback: 規則改回舊系統；期間新系統的寫入已回寫舊資料庫
    rollback_until: 新系統開始儲存舊系統沒有的欄位之前
  - name: 停用舊模組
    require:
      - 入口層紀錄：舊模組 60 天沒有流量（涵蓋兩次月結）
      - 直連舊資料庫的報表與排程已移轉
      - 舊資料封存成唯讀
record: 每次調整比例都走變更單與核准` },
  ],
  exercise: 'legacy-migration-1',
  refs: [],
}
