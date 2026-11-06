// 設計情境：讓 agent 調查夜間告警（人工全看 / agent 唯讀調查 / agent 自動執行低風險動作）
export default {
  id: 'alert-triage-agent',
  order: 26,
  group: 'ops',
  title: '讓 agent 調查告警',
  en: 'Agent-assisted alert triage',
  level: 2,
  week: 19,
  skills: ['aiops', 'incident-response', 'slo-error-budget', 'observability'],
  lab: 'AlertTriageScenarioLab',
  summary: '一個人 on-call，一晚十幾則告警，大半是誤報。讓 agent 幫忙看，要讓它看到哪裡、動到哪裡？',
  situation: '仁和醫院（虛構）的線上掛號 API 跑在 Kubernetes 上，後面是一台 PostgreSQL 主庫加一台唯讀副本。夜間 00:00–06:00 平均會響 10–15 則告警：CPU、資料庫連線數、錯誤率、磁碟使用率、健康檢查。其中約七成是備份、報表排程、同一事件觸發的重複告警；真問題一週兩三次，多半是某個 pod 連線洩漏或記憶體吃滿，偶爾是傍晚上線的版本到夜間流量型態一變才出事。on-call 一次一個人，隔天還要上班。每則會叫人的告警都有 runbook，但半夜照著查一輪通常要 20 分鐘以上。',
  constraints: [
    '真問題從告警到有人處理，要在 15 分鐘內；誤報不該叫醒人',
    '任何對正式環境的變更（回滾、改設定、改資料庫參數）都要有人核准，而且要留紀錄',
    'agent 用的憑證只能是唯讀，或限制在明確列出的少數動作；拿不到資料庫密碼與雲端管理權限',
    '每一步做了什麼、看了什麼、依據什麼判斷，事後要能回放；人隨時可以接手',
    '醫療資料不得送到院外的模型服務；agent 看的是指標與系統日誌，不是病患資料',
  ],
  options: [
    {
      id: 'manual', name: '人工全部看',
      summary: '每則告警都呼叫 on-call，人照 runbook 查指標、日誌、最近變更，自己判斷、自己動手。agent 不介入。',
      pros: ['沒有新元件，也沒有「agent 判斷錯」這類新風險', '每個決定都是人做的，責任與紀錄清楚'],
      cons: ['誤報一樣叫醒人；一晚被叫三四次之後，判斷力和隔天的工作一起壞掉', '每則告警都從零開始查，確認時間最長', '人會疲乏，告警多了就開始不看，真問題也一起被忽略'],
    },
    {
      id: 'readonly', name: 'agent 唯讀調查，寫摘要給人',
      summary: '告警觸發後 agent 先用唯讀憑證查指標、日誌、最近的部署與設定變更、對應的 runbook，兩三分鐘內寫一份摘要（觀察到什麼、可能原因、建議動作、證據連結）。像已知模式的告警降級成工單；像真問題的才叫人，人看摘要做決定，動作由人執行。',
      pros: ['誤報與重複告警大多在摘要階段就被認出，人少被叫醒', '人醒來時證據已經攤開，確認時間從二十分鐘縮到幾分鐘', 'agent 只拿唯讀憑證，判斷錯最多是摘要寫錯，不會動到系統'],
      cons: ['動作仍然要人做，低風險的重啟或擴副本一樣要叫醒人', '摘要寫得越像結論，人越容易照單全收；根因判斷錯了，人也可能跟著錯', '要替 agent 準備可查的指標、結構化日誌與部署紀錄，沒有這些它查不出東西'],
    },
    {
      id: 'auto', name: 'agent 可自動執行低風險動作，變更類要核准',
      summary: '在唯讀調查之上，允許 agent 自動執行一張明確的低風險動作清單（重啟一個 pod、把副本數加一、清一個暫存目錄），每個動作有次數上限，同一告警同一動作只做一次；回滾、改設定、改資料庫參數等變更類動作只能提案，人核准後才執行。',
      pros: ['最常見的「重啟就好」類問題在幾分鐘內自己收掉，人根本不用醒', '人只在真的需要決策時被叫，叫醒時連提案與證據一起送到', '動作清單、次數上限、核准紀錄都是程式寫的，稽核與回放容易'],
      cons: ['判斷錯時會真的做錯事：對錯的 pod 重啟、對不該擴的服務擴容；要靠次數上限與升級規則把損害擋住', '動作清單、權限範圍、上限數字都要事先定義與演練，前期投入最大', '「低風險」會隨時間蔓延：每多加一個動作都要重新評估'],
    },
  ],
  tradeoffs: {
    axes: ['真問題確認時間', '人被叫醒次數', '判斷錯的後果', '稽核與回放', '準備成本'],
    rows: [
      { option: 'manual', cells: ['差：每則從零查起', '差：每則都叫', '中：人在半夜也會錯，但不會自動放大', '中：靠人當下記', '低'] },
      { option: 'readonly', cells: ['好：證據先攤開', '中：真問題才叫', '好：只會寫錯摘要，系統不動', '好：每次查詢都有紀錄', '中：指標、日誌、部署紀錄要先結構化'] },
      { option: 'auto', cells: ['好：低風險問題自己收掉', '好：只有要決策時叫', '差：會真的動錯，靠上限與升級擋', '好：動作與核准都是程式紀錄', '高：動作清單、權限、上限、演練'] },
    ],
  },
  decisions: [
    { id: 'small-team', situation: '三個人的團隊，服務一個月才響一兩次告警，而且幾乎都是真問題。沒有結構化日誌，部署紀錄散在聊天室裡。', options: ['manual', 'readonly', 'auto'], answer: 'manual',
      explain: '告警量小、誤報少，agent 能省下的時間有限；而它需要的指標、日誌、部署紀錄都還沒整理好，接上去也查不出東西。先把告警送到會叫人的系統、把部署紀錄留下來，之後再考慮 agent。' },
    { id: 'noisy-night', situation: '一晚十幾則告警，七成是備份排程與重複告警。on-call 輪到的人隔天明顯狀況差，已經有人提離職。真問題多半要查最近變更才找得到原因。', options: ['manual', 'readonly', 'auto'], answer: 'readonly',
      explain: '最痛的是誤報叫醒人與每次從零查起，唯讀調查剛好解這兩件事，而且不引入「agent 動錯」的風險。先讓它把誤報認出來、把證據攤開；跑幾週、看它的判斷對不對，再決定要不要給動作權限。' },
    { id: 'restart-loop', situation: '過去三個月的真問題裡，八成是同一個 worker 的記憶體洩漏，runbook 第一步就是重啟那個 pod。agent 的唯讀摘要已經跑了兩個月，判斷和人一致。', options: ['manual', 'readonly', 'auto'], answer: 'auto',
      explain: '動作單一、低風險、可逆，而且已經有兩個月的紀錄證明 agent 認得出這個模式。把「重啟該 worker 的 pod」列進動作清單，設次數上限，重啟後沒恢復就升級給人。根因（洩漏本身）仍然要人排進工作。' },
    { id: 'db-param', situation: 'agent 的摘要指出資料庫連線數滿是因為某個參數太小，建議直接把 max_connections 調高並重啟資料庫。', options: ['manual', 'readonly', 'auto'], answer: 'readonly',
      explain: '這是變更類動作，而且重啟資料庫會中斷所有請求：不論採用哪種做法，都不能讓 agent 自己做。摘要的價值在把證據攤開給人看；人要先確認是不是某個服務連線洩漏，調參數往往只是把問題往後推。' },
  ],
  implementation: [
    { title: 'agent 能做的事用程式寫，不用提示詞寫', lang: 'python', code: `from dataclasses import dataclass

# 唯讀調查用的工具：只能查，不能動
READ_TOOLS = {"metrics.query", "logs.search", "deploys.recent", "k8s.describe", "runbook.get"}

# 低風險、可逆、有上限的動作；其餘一律只能「提案」
LOW_RISK = {
    "k8s.restart_pod":  {"max_per_alert": 1, "namespaces": {"booking"}},
    "k8s.scale":        {"max_per_alert": 1, "delta": 1, "deployments": {"booking-api"}},
}

@dataclass
class Proposal:
    alert_id: str
    tool: str
    args: dict
    evidence: list[str]      # 查過的指標、日誌、部署紀錄的連結

def decide(p: Proposal, done_count: int) -> str:
    if p.tool in READ_TOOLS:
        return "run"                                  # 唯讀：直接執行並記錄
    rule = LOW_RISK.get(p.tool)
    if rule and done_count < rule["max_per_alert"] and allowed_target(p, rule):
        return "run"                                  # 低風險：執行、記錄、通知（不叫醒）
    return "ask_human"                                # 其他：提案送人核准，附證據

# 升級規則：低風險動作做完 10 分鐘內同一告警再響 → 不再自動動作，叫人
# 每個 run / ask_human / approve / deny 都寫進事故時間線` },
    { title: '告警依「能不能自動處理」分級（Alertmanager 路由）', lang: 'yaml', code: `route:
  receiver: agent-triage              # 預設：先給 agent 做唯讀調查
  routes:
    - matchers: [severity="ticket"]   # 磁碟、憑證到期：開工單，早上處理
      receiver: ticket
    - matchers: [severity="page", change_required="true"]
      receiver: oncall-with-summary   # 可能要回滾或改設定：agent 查完直接叫人
    - matchers: [severity="page"]
      receiver: agent-triage          # 其餘：agent 調查 → 像誤報就降級；否則叫人

receivers:
  - name: agent-triage
    webhook_configs:
      - url: http://triage-agent.ops.svc/alerts    # 內網服務，用唯讀 service account
  - name: oncall-with-summary
    webhook_configs:
      - url: http://triage-agent.ops.svc/alerts?then=page` },
  ],
  exercise: null,
  refs: [],
}
