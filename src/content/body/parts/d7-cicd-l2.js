// 領域內文（d7-cicd，P9 新課）：以技能 id 為 key，由 body/d7-cicd.js 合併。只放這些技能：llm-observability
export default {
  'llm-observability': {
    points: [
      { b: '每次呼叫記這幾個欄位', t: 'prompt 版本、模型（實際回應的那個，不是別名）、輸入與輸出 token、延遲（含第一個 token 的時間）、成本、trace id、工具呼叫的名稱與結果狀態、結束原因。少了 prompt 版本就分不出是誰的改動變差；少了 trace id 就串不回使用者的那次請求。' },
      { b: '品質不是錯誤率', t: 'HTTP 200 的回答可能完全答錯。品質靠抽樣：固定比例的回應交給人或另一個模型評分，加上使用者的回饋（讚、倒讚、重試、放棄）。評分與回饋都要帶著 prompt 版本與模型，才能畫出「哪一版變差」。' },
      { b: '成本是指標，不是月底的帳單', t: '每千次呼叫的成本、每個功能的成本、每個 prompt 版本的平均 token 數。單價以「每百萬 token 的單價」當變數放設定，程式只算 token；改 prompt 導致輸入 token 翻倍，當天就該在圖上看到。' },
      { b: 'OpenTelemetry 有 GenAI 的語意慣例', t: 'OpenTelemetry 的 semantic conventions 替模型呼叫的 span 與 metrics 定了一套屬性名稱（模型、token 用量、操作類型等），讓不同供應商、不同框架的紀錄用同一套欄位。慣例還在演進，欄位名稱以官方文件當下的版本為準，不要從記憶裡抄。' },
      { b: 'prompt 與回應全文是敏感資料', t: '使用者輸入裡有什麼都可能被模型原樣帶回，記全文等於把個資與秘密複製到可觀測性平台。預設只記欄位與長度，全文另外存、有存取控管與保存期限；遮罩與白名單的做法見日誌與稽核紀錄裡的個資。' },
    ],
    checklist: [
      '能列出一筆模型呼叫紀錄的必要欄位，並說出每個欄位在「找慢的原因」「算成本」「比較 prompt 版本」各自回答什麼問題',
      '能從一批呼叫紀錄算出 p50 / p95 延遲、每千次成本、各 prompt 版本的通過率',
      '能說出 LLM 應用儀表板至少要有哪幾張圖，以及哪些資料不能直接寫進 log',
    ],
    refs: [
      { label: 'OpenTelemetry：Semantic conventions for generative AI', url: 'https://opentelemetry.io/docs/specs/semconv/gen-ai/' },
      { label: 'OpenTelemetry 文件', url: 'https://opentelemetry.io/docs/' },
      { label: 'Langfuse 文件（開源的 LLM 可觀測性平台）', url: 'https://langfuse.com/docs' },
    ],
  },
}
