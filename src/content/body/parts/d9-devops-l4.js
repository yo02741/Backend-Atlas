// 領域內文（d9-devops，P9 新課）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：finops, aiops
export default {
  'finops': {
    points: [
      { b: '雲端帳單的計費項目', t: '運算（開機時數或 vCPU 秒）、儲存（容量乘以時間，加上請求數）、流量（出站流量通常最貴，入站多半免費）、託管服務的請求數與單位。保留與預留折扣是「承諾用量換折扣」，只適合穩定的基礎負載。' },
      { b: 'AI 工具的計費項目', t: 'API 依輸入與輸出 token 計費，輸出通常比輸入貴；context 越長每次送出的輸入越多；prompt 快取讓重複的前綴以較低價格計算；IDE 與聊天工具多是座位制加用量上限。' },
      { b: 'FinOps 三步：看見、分攤、優化', t: '先讓每一塊錢對得到團隊與服務（tag、帳單匯出、預算告警），再分攤給擁有者，最後才談優化。沒有前兩步，優化只是猜。' },
      { b: '常見的浪費', t: '閒置的機器與資料庫、刪了機器沒刪的磁碟與快照、測試環境週末不關、agent 每一輪都把整段對話歷史重送、沒有上限的重試迴圈。' },
      { b: '估算要寫成可以改單價的公式', t: '價格會變、不同方案不同，所以估算程式裡的單價是變數，不是常數。比較方案時看的是結構差異：有沒有快取、context 有沒有上限、一天跑幾次。' },
    ],
    checklist: [
      '能列出一張雲端帳單的主要計費項目，並說出哪一項最容易被忽略',
      '能用輸入 / 輸出 token 與快取比例，估算一個 agent 工作流一個月的成本區間',
      '能說明 tag 與預算告警為什麼要先於優化',
    ],
    refs: [
      { label: 'FinOps Foundation：FinOps Framework', url: 'https://www.finops.org/framework/' },
      { label: 'AWS：成本分配標籤', url: 'https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html' },
      { label: 'Google Cloud：建立預算與告警', url: 'https://cloud.google.com/billing/docs/how-to/budgets' },
    ],
  },
  'aiops': {
    points: [
      { b: '告警噪音是先決問題', t: '一天幾百則告警沒人會看，真正的事故混在裡面。agent 的第一個價值是把每則告警變成一段有脈絡的摘要，而不是取代 on-call。' },
      { b: 'agent 的角色是先調查再建議', t: '工具只開放唯讀：查指標、查日誌、查最近的部署與變更、讀 runbook。產出是摘要、證據、可能原因與建議動作；重啟、回滾、改設定一律由人核准後執行。' },
      { b: '每一步有紀錄、可隨時接手', t: '查了什麼、看到什麼、為什麼這樣推論，全部寫進事故時間線。on-call 接手時不用重跑一遍，事後 postmortem 也有材料。' },
      { b: '用指標評估 agent', t: '誤報率（agent 說有問題但沒事）、漏報率、平均確認時間（告警到人知道該不該理它）、建議被採用的比例。沒有這些數字，不知道它是在幫忙還是在製造更多噪音。' },
      { b: 'Kubernetes 告警要分級', t: 'Pod 重啟一次和整個 Deployment 沒有可用副本不是同一級；節點壓力、PVC 快滿、CrashLoopBackOff 各有不同的緊急程度與第一步查法。分級規則寫在 runbook，agent 照著查。' },
    ],
    checklist: [
      '能列出 agent 調查一則告警時可以用的唯讀工具，以及哪些動作必須人工核准',
      '能設計 agent 輸出的格式：摘要、證據、可能原因、建議動作與需要核准的標記',
      '能說出至少兩個衡量 AIOps 成效的指標與量法',
    ],
    refs: [
      { label: 'Google SRE Book：Monitoring Distributed Systems', url: 'https://sre.google/sre-book/monitoring-distributed-systems/' },
      { label: 'Prometheus：Alerting rules', url: 'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/' },
      { label: 'Kubernetes：Troubleshooting', url: 'https://kubernetes.io/docs/tasks/debug/' },
    ],
  },
}
