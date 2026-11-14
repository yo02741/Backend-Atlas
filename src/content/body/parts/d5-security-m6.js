// 領域內文（d5-security，m6 批）：以技能 id 為 key，由 body/d5-security.js 合併。只放這些技能：security-operations
export default {
  'security-operations': {
    points: [
      { b: '先有資產清冊', t: '公告出來時要能馬上回答「這個元件的這個版本我們哪裡有、誰負責」。清冊記主機、服務、對外網域、版本、負責人、對外與否、重要性，從平台 API、DNS、SBOM 自動產生，並定期從外部盤點核對。不在清冊裡的資產沒有人修補。' },
      { b: '弱點來源不同，找法不同', t: '依賴用依賴掃描、映像用映像掃描、作業系統用主機弱點掃描、設定錯誤用設定稽核、自己的程式用 SAST、DAST 與程式碼審查。已經上線的也要定期重掃，因為弱點是之後才公布的；掃描器的資料庫要更新，掃描只針對自己擁有或已授權的範圍。' },
      { b: '嚴重度不等於優先序', t: 'CVSS 回答「技術上多嚴重」，不知道你的環境。排序還要看有沒有已知被利用（CISA KEV）、近期被利用的可能性（EPSS）、是否對外、資產的重要性與資料敏感度。規則事先寫好、可以重算；資產不在清冊裡時用最壞的情況算。' },
      { b: '修補是有期限的變更', t: '流程是判定影響、分級指派、修補、測試、依變更流程上線、重新掃描驗證。期限依等級分級，天數依主管機關規範與組織政策。例行修補可以是標準變更，正被利用的弱點走緊急變更。更新後要重啟或重新部署才生效，以重新掃描的結果結案。' },
      { b: 'WAF 與網路分段是補償控制', t: '不能馬上修時用補償控制爭取時間：關閉功能、限制來源、WAF 虛擬修補、隔離。每一項都有負責人與到期日，工單不因此結案。WAF 擋得住符合已知樣式的請求，擋不住授權邏輯錯誤與不經過它的流量。網路分段、出站限制與零信任限制的是出事後的影響範圍。' },
    ],
    checklist: [
      '拿到一則弱點公告，能說明要查哪些資料才能判定哪些資產受影響，以及清冊該有哪些欄位',
      '給定一組弱點的嚴重度、是否已知被利用、資產是否對外與重要性，能依規則排出修補優先序與期限，並說明和只看 CVSS 的差別',
      '能說明 WAF 虛擬修補、網路分段、出站限制各自降低什麼風險，以及為什麼它們不能取代修補',
    ],
    refs: [
      { label: 'FIRST：CVSS', url: 'https://www.first.org/cvss/' },
      { label: 'FIRST：EPSS', url: 'https://www.first.org/epss/' },
      { label: 'CISA：Known Exploited Vulnerabilities Catalog', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' },
      { label: 'OWASP：Virtual Patching Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Virtual_Patching_Cheat_Sheet.html' },
      { label: 'Kubernetes：Network Policies', url: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/' },
    ],
  },
}
