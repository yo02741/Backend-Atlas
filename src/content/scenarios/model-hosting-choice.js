// 設計情境：模型放雲端、地端還是分流（兩個功能、資料敏感度不同）
export default {
  id: 'model-hosting-choice',
  order: 30,
  group: 'agent',
  title: '模型放雲端、地端還是分流',
  en: 'Model hosting choice',
  level: 3,
  week: 21,
  skills: ['self-hosted-models', 'ai-gateway', 'finops', 'hosting-models'],
  lab: 'ModelHostingScenarioLab',
  summary: '醫院要上線衛教問答與病歷摘要，兩者的資料敏感度不同：全部用雲端 API、全部地端自架，還是依敏感度分流？',
  situation: '一家虛構的醫院要上線兩個用到模型的功能。門診衛教問答：民眾問檢查前的準備、用藥須知，系統依院內衛教文件回答，問題與答案不含可識別病人的資料，每天約 4,000 次，流感季會暴增。病歷摘要：醫師開出院病摘前產生草稿，輸入是這次住院的病歷紀錄，每天約 2,000 次，集中在上午查房後。院內有機房，可放 GPU 伺服器；資訊室能投入的維運人力約 2 人。以上數字皆為示意。',
  constraints: [
    '可識別病人的病歷內容能不能送到院外，依主管機關規範與契約，由法遵確認；目前的答覆是不行',
    '病歷摘要的品質要先過院內評測集的門檻，達不到就縮小功能範圍或不上線',
    '任何做法在地端滿載或故障時，都不能把敏感請求改送雲端',
    '維運人力約 2 人，同時還要顧其他系統',
  ],
  options: [
    {
      id: 'cloud', name: '全部用雲端 API',
      summary: '兩個功能都經 AI Gateway 呼叫雲端的模型 API，按用量付費；院內不放 GPU。',
      pros: ['不用採購硬體、不用維運推論服務，上線最快', '能用供應商最大的模型，品質落差最小', '流量暴增時不必自己擴容（仍受供應商的速率限制）'],
      cons: ['病歷內容離開院內：法遵不允許時，這個做法不成立', '成本跟著用量線性成長，流感季的帳單也跟著暴增', '供應商當機、限流或模型版本更替時只能配合'],
    },
    {
      id: 'local', name: '全部地端自架',
      summary: '在院內機房架推論服務，兩個功能都送到同一池 GPU；沒有任何請求送到院外。',
      pros: ['所有資料留在院內，資料去向最單純', '用量穩定且夠大時，固定成本被攤薄', '不受外部供應商的限流與版本更替影響'],
      cons: ['容量固定：衛教問答暴增時，病歷摘要跟著排隊', '跑得動的模型較小，品質要用自己的評測集確認', 'GPU、驅動、推論服務、模型更新與評測全部自己維護；壞一台就少一份容量'],
    },
    {
      id: 'split', name: '依資料敏感度分流',
      summary: '在 gateway 依功能的資料分級路由：病歷摘要只送地端，衛教問答送雲端；沒有標示分級的請求一律當成敏感。',
      pros: ['敏感資料留在院內，一般請求仍可用雲端的大模型', '衛教問答的暴增不佔地端的容量', '地端只需要依敏感請求的尖峰採購'],
      cons: ['兩條路徑都要維護：評測、監控、金鑰與紀錄各一套', '分流規則是安全邊界，設錯就是資料外洩', '地端故障時敏感請求只能排隊或被拒，不能借用雲端'],
    },
  ],
  tradeoffs: {
    axes: ['資料去向', '排隊與容量', '成本結構', '品質', '維運負擔'],
    rows: [
      { option: 'cloud', cells: ['差：敏感資料離開院內', '好：不必自己擴容，受限流影響', '幾乎全是變動成本', '好：可用最大的模型', '低：仍要管金鑰、配額、紀錄'] },
      { option: 'local', cells: ['好：全部留在院內', '差：容量固定，尖峰時全部排隊', '幾乎全是固定成本', '中：模型較小，要自己評測', '高：硬體到模型都自己扛'] },
      { option: 'split', cells: ['好：敏感留院內，其餘出去', '中：敏感請求受地端容量限制', '固定加變動，兩邊都付', '中：只有敏感功能用較小的模型', '最高：兩條路徑加分流規則'] },
    ],
  },
  decisions: [
    { id: 'clinic', situation: '連鎖診所只打算做衛教問答，法遵確認問題與答案都不含可識別病人的資料；每天幾百次、季節波動大，沒有機房也沒有專職維運。',
      options: ['cloud', 'local', 'split'], answer: 'cloud',
      explain: '沒有不能出去的資料，量小而且波動大，地端的機器大半時間閒置、還要找人維護。雲端 API 按用量付費最合適；仍然要經過 gateway 管金鑰、配額與紀錄，並確認提問欄位不會被拿來輸入個資。' },
    { id: 'all-sensitive', situation: '契約要求所有送進模型的內容（含衛教問答的提問紀錄）都必須留在院內。院方已有 GPU 機房與 3 人的維運團隊，用量全年平穩。',
      options: ['cloud', 'local', 'split'], answer: 'local',
      explain: '所有內容都不能出去，雲端與分流都不成立。用量平穩讓依尖峰採購的閒置很少，人力也足夠。重點變成 N+1、佇列上限、用自己的評測集確認品質，以及把日誌、遙測與更新管道一併檢查。' },
    { id: 'flu-season', situation: '病歷摘要必須留在院內，每天約 2,000 次且穩定；衛教問答不含個資，流感季會衝到平時的 5 倍。現有 2 台 GPU 剛好夠病歷摘要用。',
      options: ['cloud', 'local', 'split'], answer: 'split',
      explain: '兩種請求的限制與流量型態都不同：敏感且穩定的留地端，不敏感且暴增的交給雲端。全部地端要為一年幾週的尖峰多買好幾台，而且暴增時會拖慢病歷摘要；全部雲端過不了資料限制。' },
    { id: 'summary-only', situation: '另一家醫院只做病歷摘要一個功能，全部是敏感請求；團隊提議「先架分流的 gateway 規則與雲端路徑，以後也許用得到」。',
      options: ['local', 'split'], answer: 'local',
      explain: '沒有可以送出去的請求，分流多出來的只有一條用不到的雲端路徑：多一把金鑰、多一組規則，也多一個設錯就把病歷送出去的機會。先做全部地端；等真的有不敏感的功能再加分流，並在那時審查規則。' },
  ],
  switchIf: [
    { when: '契約要求連衛教問答的提問紀錄都要留在院內', then: '改用 `local`：沒有可以送出去的請求，分流規則用不上；GPU 容量依兩個功能的尖峰加總。' },
    { when: '只做衛教問答，法遵確認不含可識別病人的資料，沒有機房', then: '改用 `cloud`：沒有敏感請求，GPU 與維運人力都省下。' },
  ],
  alternative: { option: 'local', holdsWhen: '地端 GPU 在兩個功能的尖峰加總下，排隊仍在可接受範圍（模擬器的「地端最長排隊」），而且衛教問答在地端模型上也過得了評測門檻時。' },
  challenge: {
    task: '分流條件要寫成 gateway 能執行的規則，「敏感的走地端」還不夠。為兩個功能寫出路由規則：資料分級怎麼標、沒標的怎麼辦、地端排隊超過多久時衛教問答可以改走雲端、病歷摘要排隊超過上限時怎麼回應醫師。先在本頁模擬器選「依敏感度分流」，「地端 GPU 台數」設 2、「尖峰倍數（8–11 時）」設 2.5，打開「注入：10 時壞一台 GPU」，按「跑一天」，記下「地端最長排隊」與「被拒絕（佇列已滿，累計）」，用來定排隊上限。',
    deliver: '一份路由規則表（條件、目標、例外處理）與模擬器記下的兩個數字',
    check: [
      '病歷摘要在任何條件下都沒有雲端目標，排隊滿時的處理是提示等待或拒絕',
      '衛教問答改走雲端的條件是可量測的門檻（例如排隊秒數），數字依據模擬器結果',
      '沒有標分級的請求一律當成敏感',
    ],
    twist: '法遵改口：民眾在衛教問答裡自己打了姓名或病歷號，那一筆也算敏感。先預測哪一條規則要改、gateway 要多做什麼檢查，以及「離開院內的敏感請求」可能從 0 變多的原因。',
  },
  implementation: [
    { title: 'gateway 的路由設定：依資料分級，敏感路由沒有雲端備援（示意）', lang: 'yaml', code: `# 分級來自「哪個功能送來的」，不是猜內容；沒有標示的一律當 sensitive
default_class: sensitive

routes:
  discharge-summary:            # 病歷摘要
    data_class: sensitive
    targets: [local/summary]    # 只有地端
    on_full: queue              # 滿載時排隊
    queue_limit: 200
    on_queue_full: reject       # 佇列滿了回 503，由功能端降級；不設 fallback
  health-education-qa:          # 衛教問答
    data_class: general
    targets: [cloud/large, local/summary]   # 雲端不可用時才用地端的空位
    use_local_queue: false      # 一般請求不佔敏感請求的佇列

# 部署前的檢查（放進 CI）：
#   任何 data_class 為 sensitive 的路由，targets 裡不得出現 cloud/ 開頭的目標` },
    { title: '部署前檢查：敏感路由不得有雲端目標', lang: 'python', code: `def check_routes(config):
    """回傳違規清單；CI 裡有任何一筆就失敗。"""
    problems = []
    if config.get("default_class") != "sensitive":
        problems.append("default_class 必須是 sensitive（沒標示的請求不能外送）")
    for name, route in config["routes"].items():
        data_class = route.get("data_class", config.get("default_class"))
        if data_class != "general":                      # 不認得的分級也當敏感
            cloud = [t for t in route["targets"] if t.startswith("cloud/")]
            if cloud:
                problems.append(f"{name}: 敏感路由不得送到 {cloud}")
    return problems


config = {
    "default_class": "sensitive",
    "routes": {
        "discharge-summary": {"data_class": "sensitive", "targets": ["local/summary", "cloud/large"]},
        "health-education-qa": {"data_class": "general", "targets": ["cloud/large", "local/summary"]},
    },
}
print(check_routes(config))   # ['discharge-summary: 敏感路由不得送到 ...']` },
  ],
  exercise: 'self-hosted-models-1',
}
