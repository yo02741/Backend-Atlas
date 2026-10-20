// 設計情境：掛號 API 尖峰事故
export default {
  id: 'incident-drill',
  order: 22,
  group: 'ops',
  title: '掛號 API 尖峰事故',
  en: 'Incident response under an error-budget burn',
  level: 2,
  week: 19,
  skills: ['incident-response', 'slo-error-budget', 'observability'],
  lab: 'IncidentDrillScenarioLab',
  summary: '週一 08:00 掛號尖峰，API 錯誤率衝到 25%，錯誤預算幾十分鐘內就會燒光。大家各自救火、指定事故指揮官，還是讓告警直接觸發自動回滾？',
  situation: '安禾診所集團（虛構）的線上掛號 API，平日尖峰每分鐘約 2,000 個請求，大約是全天平均的 5 倍（示意）。SLO 是 30 天內 99.9% 的請求成功，本月預算還剩 60%。週一 07:40 剛上線 v4.2，08:00 尖峰一到，一個新查詢把資料庫連線池占滿，錯誤率幾分鐘內升到 25%。值班的有 4 個工程師，客服與櫃台也在問狀況。',
  constraints: [
    '錯誤率 25% 時燃燒率是 250；尖峰流量是平均的 5 倍，以請求數計，剩下的預算約 20 分鐘燒完（示意）',
    '櫃台與電話掛號仍可用，但要有人通知他們改走替代流程',
    'v4.2 帶了一個已執行的 migration，回滾前要確認舊版和目前的 schema 相容',
    '事後要說得清楚時間線：觀察到什麼、誰做了什麼、為什麼這樣決定',
  ],
  options: [
    {
      id: 'chaos', name: '各自救火',
      summary: '告警丟進群組，看到的人各自動手：重啟、調參數、查日誌，誰先想到就先做。',
      pros: ['不需要事先準備任何流程', '只有一個人、原因又很明確的小問題，可能最快'],
      cons: ['同一件事做兩次，或一個調大、一個改回，互相抵銷', '沒人負責對外說明，客服與櫃台只能自己猜', '重啟前沒保存狀態，事後查不到原因', '沒有當下的時間線，postmortem 只能憑記憶'],
    },
    {
      id: 'ic', name: '事故指揮制度',
      summary: '值班者宣告事故等級並擔任 Incident Commander（IC），指定處理人員、溝通窗口、紀錄員；先止血（回滾、關旗標、降級），再查根本原因。',
      pros: ['每個操作先告知 IC 再做，不重複、不衝突', '溝通窗口固定頻率更新，櫃台很早就改走替代流程', '紀錄員當下寫時間線，postmortem 有依據', '止血前先保全證據（連線狀態、慢查詢、日誌）'],
      cons: ['宣告、分派要幾分鐘，人一定比自動化慢', '要事先演練；第一次當 IC 很容易自己埋頭去修', '小團隊一人要兼好幾個角色'],
    },
    {
      id: 'auto', name: '自動化優先',
      summary: '燃燒率告警觸發自動回滾到上一版或自動降級，同時呼叫 on-call；人接手後由 IC 決定下一步。',
      pros: ['止血以分鐘計，錯誤預算燒得最少', '最常見的「剛上線就壞」不必等人反應', '自動動作本身就有紀錄'],
      cons: ['只處理事先想到的情況；回滾本身失敗時要有備案', '自動化和人同時操作會互相干擾，接手時要先暫停自動化', '需要不可變的 artifact、相容的 migration 與可靠的告警，前期投資最大', '判斷影響與對外公告仍要人做'],
    },
  ],
  tradeoffs: {
    axes: ['止血速度', '重複與衝突', '對外溝通', '事後可追溯', '準備成本'],
    rows: [
      { option: 'chaos', cells: ['差：靠運氣，常常越修越糟', '差：重複與互相抵銷', '差：沒人負責', '差：沒有時間線', '無'] },
      { option: 'ic', cells: ['中：十幾分鐘', '好：IC 統一分派', '好：固定頻率更新', '好：紀錄員當下寫', '中：角色定義與演練'] },
      { option: 'auto', cells: ['好：幾分鐘', '中：接手時要先暫停自動化', '中：通知自動，公告仍靠人', '好：自動動作有紀錄', '高：自動回滾、旗標、燃燒率告警'] },
    ],
  },
  decisions: [
    { id: 'fresh-deploy', situation: '已經有多視窗燃燒率告警與自動回滾管線。錯誤在部署後 20 分鐘出現，上一版 image 還在，migration 只做了 expand（新增可為空欄位）。', options: ['chaos', 'ic', 'auto'], answer: 'auto',
      explain: '「最近改了什麼」有明確答案，而且回滾是安全的：舊版和目前的 schema 相容。自動回滾幾分鐘內止血，比等人宣告、分派快得多；人接手後確認恢復、通知櫃台、補時間線。' },
    { id: 'no-deploy', situation: '最近沒有任何部署。錯誤率慢慢爬升，看起來跟外部簡訊供應商有關，也可能是資料庫。', options: ['chaos', 'ic', 'auto'], answer: 'ic',
      explain: '沒有最近的變更，自動回滾沒有對象，也沒有事先寫好的劇本可觸發。這時需要有人統籌排查方向、分派不同人查不同假設、定時對外更新，避免四個人同時改設定。' },
    { id: 'single-owner', situation: '內部報表工具在上班時間匯出失敗，影響一位使用者。值班工程師一看就知道是昨天設定檔打錯一個字。', options: ['chaos', 'ic', 'auto'], answer: 'chaos',
      explain: '影響很小、只有一個人在處理、原因明確，沒有協調問題可言：直接修正並留下工單紀錄即可。宣告事故、指定 IC 是殺雞用牛刀。注意這不是「各自救火」的優點，而是只有一個人時不會有衝突。' },
    { id: 'rollback-fails', situation: '自動回滾觸發後失敗：v4.2 的 migration 加了 NOT NULL 欄位，舊版寫入會被拒絕。錯誤率還在 20%。', options: ['chaos', 'ic', 'auto'], answer: 'ic',
      explain: '自動化的劇本已經走完，接下來要判斷：降級哪些功能、往前修還是補一個相容的 migration。IC 先暫停自動重試，避免和手動操作打架，再分派一人做降級、一人準備修正，溝通窗口更新狀態。' },
  ],
  implementation: [
    { title: '多視窗快速燃燒告警（Prometheus）', lang: 'yaml', code: `groups:
  - name: booking-api-slo
    rules:
      # SLO 99.9%：錯誤預算 0.1%。燃燒率 14.4 ≈ 1 小時燒掉 30 天預算的 2%
      - alert: BookingApiFastBurn
        expr: |
          (
            sum(rate(http_requests_total{job="booking-api", status=~"5.."}[1h]))
              / sum(rate(http_requests_total{job="booking-api"}[1h]))
          ) > (14.4 * 0.001)
          and
          (
            sum(rate(http_requests_total{job="booking-api", status=~"5.."}[5m]))
              / sum(rate(http_requests_total{job="booking-api"}[5m]))
          ) > (14.4 * 0.001)
        labels:
          severity: page            # 叫人，也觸發自動回滾的判斷
        annotations:
          summary: "掛號 API 快速燃燒錯誤預算"` },
    { title: '自動回滾的守門條件', lang: 'python', code: `from datetime import datetime, timedelta

def decide(alert, last_deploy, now: datetime) -> str:
    """告警觸發時決定自動做什麼；不符合條件就只叫人。"""
    recent = now - last_deploy.finished_at < timedelta(hours=2)
    safe_schema = last_deploy.migrations_kind in ("none", "expand")   # contract 或資料轉換不自動退
    if alert.name == "BookingApiFastBurn" and recent and safe_schema and last_deploy.previous_digest:
        return f"rollback:{last_deploy.previous_digest}"
    if alert.name == "BookingApiFastBurn" and last_deploy.flags:
        return "disable_flags:" + ",".join(last_deploy.flags)       # 降級：關掉這版新開的功能
    return "page_only"

# 不論做了什麼都要叫人，並把動作寫進事故時間線：
#   08:05 自動：rollback:sha256:9f2c…（條件：部署 25 分鐘內、migration 為 expand）
# 人接手後第一件事：IC 宣告「自動化暫停」，之後所有操作經 IC 分派` },
    { title: '不咎責 postmortem 骨架', lang: 'yaml', code: `title: 掛號 API 錯誤率升高（SEV2）
summary: 08:00 尖峰時新查詢占滿連線池，錯誤率最高 25%，08:21 恢復
impact:
  duration_minutes: 19            # 08:02 超出 SLO → 08:21 恢復
  failed_requests: 8200           # 示意
  error_budget_used: 48%          # 30 天預算的比例（示意）
timeline:                         # 紀錄員當下寫的：觀察、決定、執行
  - "08:07 告警：快速燃燒（1h 與 5m 視窗皆超過門檻）"
  - "08:08 宣告 SEV2，IC：值班 A；處理 B、溝通 C、紀錄 D"
  - "08:13 B 保存 pg_stat_activity 快照與錯誤日誌"
  - "08:15 決定回滾 v4.2（理由：07:40 上線，慢查詢來源吻合）"
contributing_factors:             # 寫系統條件，不寫人名
  - 壓測資料量比正式小 10 倍，慢查詢沒被發現
  - 連線池上限沒有告警
action_items:
  - { item: 壓測改用正式資料量的複本, owner: 平台組, due: 兩週內 }
  - { item: 連線池使用率 > 80% 加告警, owner: 值班組, due: 一週內 }` },
  ],
  exercise: null,
  refs: [],
}
