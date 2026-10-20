// 設計情境：地端、雲端還是混合（導入 K8s 前決定主機放哪）
export default {
  id: 'hosting-choice',
  order: 19,
  group: 'ops',
  title: '地端、雲端還是混合',
  en: 'Hosting choice',
  level: 2,
  week: 18,
  skills: ['hosting-models', 'capacity-planning', 'k8s-readiness', 'cloud-basics'],
  lab: 'HostingChoiceScenarioLab',
  summary: '區域醫院明年導入 K8s，18 個服務要放哪：自建機房、公有雲託管，還是敏感資料留院內、彈性負載上雲？',
  situation: '一家虛構的區域醫院資訊室：18 個服務（掛號、檢驗報告查詢、批價、院內排班、對外衛教與預約入口…），其中約 6 成的負載會碰到可識別病人的資料。平時約 40 vCPU，門診早上 8–10 點是平時的 3 倍，疫苗或健檢預約開放時對外入口會再暴衝。資料庫約 12 TB、每年成長約 15%。資訊室的維運人力 2 人，同時要顧網路、備份與院內電腦。以上數字皆為示意。',
  constraints: [
    '可識別病人的資料能放在哪裡，依主管機關規範與契約要求；法遵尚未給最終答覆',
    '對外網路中斷時，院內掛號與檢驗報告查詢仍要能用',
    '維運只有 2 人，任何方案都不能讓平台變成只有一個人會修',
    '明年上線，3 年內不想再大改架構',
  ],
  options: [
    {
      id: 'onprem', name: '地端（自建機房 + 自管 K8s）',
      summary: '依 3 年後的尖峰加 N+1 採購伺服器與儲存，自己裝 Kubernetes，LoadBalancer、儲存、registry、監控、備份都自己補。',
      pros: ['資料不離開院區，資料落地最單純', '負載平穩時長期成本可預期，不吃流量費', '對外網路斷了，院內服務照常運作'],
      cons: ['依尖峰採購，離峰大半閒置；擴充要走採購，以週或月計', 'K8s 升級、儲存、硬體叫修全部自己扛，2 人的團隊工時吃緊', '單一機房斷電或冷氣故障就是全停，第二機房要另外花錢'],
    },
    {
      id: 'cloud', name: '公有雲託管服務',
      summary: '用託管 K8s 與託管資料庫，按用量付費；控制平面、底層硬體與資料庫引擎維護交給業者，帳號權限、資料與應用程式仍是自己的。',
      pros: ['擴充以分鐘計（受配額限制），尖峰離峰差距大時較划算', '控制平面與硬體不用自己顧，維運工時最低', '多可用區部署，單一機房故障的影響小'],
      cons: ['敏感資料若依規範或契約不能離開院區，這個做法直接不成立', '沒做自動擴縮或忘了關閒置環境，帳單比地端高；資料大量傳出時流量費可觀', '院內對外網路一斷，院內使用者也連不到服務'],
    },
    {
      id: 'hybrid', name: '混合（敏感與核心地端、彈性與非敏感上雲）',
      summary: '依資料分級決定位置：掛號、檢驗、病歷相關的核心系統留在院內；對外衛教網站、預約入口的排隊頁、不含個資的工具服務放雲端，兩邊以 VPN 或專線連線。',
      pros: ['合規風險集中在地端那一半，彈性需求交給雲端', '對外入口暴衝時，院內核心系統不和它搶同一池資源', '雲端那一半可以先上，讓團隊在風險低的服務上熟悉 K8s'],
      cons: ['兩套環境：身分認證、DNS、監控、部署流程都要跨環境一致，維運工時最高', '連線本身是新的單點：VPN 或專線斷了，跨兩邊的功能一起壞', '核心系統仍在單一機房，災備問題沒有消失'],
    },
  ],
  tradeoffs: {
    axes: ['成本結構', '擴充速度', '維運負擔', '合規與資料落地', '單點故障 / 災備'],
    rows: [
      { option: 'onprem', cells: ['依尖峰買斷，平穩負載有利', '差：採購以週計', '高：硬體到平台都自己扛', '好：資料留院內', '差：單一機房，除非加第二機房'] },
      { option: 'cloud', cells: ['跟著用量走，尖峰離峰差大時有利', '好：分鐘級', '低：仍要管帳號、權限、成本', '依規範而定，限制嚴時不成立', '好：多可用區；但依賴院內對外網路'] },
      { option: 'hybrid', cells: ['兩邊都付，再加連線', '彈性部分分鐘級、核心以週計', '最高：兩套環境加連線', '好：依分級放置', '中：核心仍單一機房，連線是新的單點'] },
    ],
  },
  decisions: [
    { id: 'clinic', situation: '同一集團旗下的連鎖健檢中心：沒有自己的機房，維運 1 人，法遵確認資料可放在國內區域（含備份副本），每年健檢季流量是平時的 4 倍。',
      options: ['onprem', 'cloud', 'hybrid'], answer: 'cloud',
      explain: '沒有機房、只有 1 個人，自建平台等於製造人的單點故障；資料落地已確認可行，尖峰離峰差距又大。託管服務把控制平面與硬體交出去，剩下的帳號權限、區域與備份位置、成本告警要自己顧。' },
    { id: 'stable', situation: '契約要求所有病人資料與備份都必須留在院內；系統負載全年平穩，院方已有新建的機房，維運 4 人且有人熟悉儲存與網路。',
      options: ['onprem', 'cloud', 'hybrid'], answer: 'onprem',
      explain: '資料落地限制排除了雲端放資料的選項，平穩負載也讓「依尖峰採購」的浪費很小。人力足夠時，地端的重點是把 K8s 升級排進年度計畫，並為單一機房的風險準備備份還原演練或第二機房。' },
    { id: 'campaign', situation: '病歷與檢驗資料依規範須留院內；但對外的衛教網站與預約入口每次開放疫苗預約時流量暴衝 5 倍，過去曾拖慢院內掛號。',
      options: ['onprem', 'cloud', 'hybrid'], answer: 'hybrid',
      explain: '暴衝的是不含病歷的對外入口，核心資料又不能上雲，正好依分級切開：入口與排隊頁在雲端擴充，真正寫入掛號的 API 留在院內並限流。全地端要為一年幾次的尖峰買機器，全雲端則過不了資料落地。' },
    { id: 'oldroom', situation: '院內機房老舊、電力與冷氣已到上限，再加機櫃要先改建；法遵確認可在國內區域放置資料，院方也能接受用量計費。',
      options: ['onprem', 'cloud', 'hybrid'], answer: 'cloud',
      explain: '自建機房的前提是電力、冷氣、實體安全都夠，這裡連前提都不成立；改建的時間與費用要算進地端方案。資料落地沒有阻礙時，託管服務能跳過機房改建，但要先確認院內對外網路有備援線路。' },
  ],
  implementation: [
    { title: '依資料分級決定放置位置（決策紀錄）', lang: 'yaml', code: `# 放置決策：每個服務一列，分級由資料負責人確認，限制依主管機關規範與契約要求
# 這份紀錄和架構圖一起放進版本控制，法遵答覆後更新 status
placement:
  - service: registration-api        # 掛號
    data: identifiable               # 可識別個人
    site: on-prem
    reason: 核心系統；對外網路中斷時院內仍要可用
  - service: lab-report-api          # 檢驗報告查詢
    data: identifiable
    site: on-prem
  - service: booking-waiting-room    # 預約入口排隊頁（不存個資，只轉送排隊序號）
    data: none
    site: cloud
    reason: 疫苗預約時暴衝，需要分鐘級擴充
  - service: health-education-web    # 衛教網站
    data: public
    site: cloud
review:
  status: pending-legal              # 法遵答覆前，所有 identifiable 一律 on-prem
  open_questions:
    - 備份與災難復原副本的位置
    - 加密金鑰由誰持有
    - 終止合約時資料返還與刪除方式` },
    { title: '地端依尖峰 + N+1 估節點數（示意）', lang: 'python', code: `import math

base_vcpu   = 40      # 平時（示意）
peak_ratio  = 3.0     # 門診尖峰是平時的幾倍
growth      = 0.15    # 每年成長
years       = 3       # 採購要撐幾年
target_util = 0.70    # 尖峰時 CPU 只用到 70%，留 headroom
node_vcpu   = 32

peak_future = base_vcpu * peak_ratio * (1 + growth) ** years
nodes = math.ceil(peak_future / target_util / node_vcpu) + 1   # +1：壞一台還扛得住尖峰
print(f"3 年後尖峰約 {peak_future:.0f} vCPU，需 {nodes} 台（含 N+1）")

# 對照：平時只用到多少
print(f"平時使用率約 {base_vcpu / (nodes * node_vcpu):.0%}")` },
  ],
  exercise: null,
}
