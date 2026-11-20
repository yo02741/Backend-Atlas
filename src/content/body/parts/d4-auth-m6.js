// 領域內文（d4-auth，m6 批）：以技能 id 為 key，由 body/d4-auth.js 合併。只放這些技能：enterprise-identity
export default {
  'enterprise-identity': {
    challenge: {
      task: '用本課「群組展開與對帳」那段的資料，模擬 wang.jiahao 週五 17:00 離職：HR 當天輸入離職、目錄每晚 01:00 從 HR 同步、排班系統每 6 小時向目錄對帳一次（00:00、06:00…，示意排程）。畫出時間線：從離職到他在排班系統裡不能登入、既有 session 與 refresh token 失效、個人 API key 失效，每一段延遲是哪個系統造成、由哪個團隊負責。再把資料改成他已停用，實際跑一次對帳確認結果。',
      deliver: '一條時間線（時間點、事件、負責的系統或團隊），標出最長的空窗與縮短它的做法，加上對帳程式的實際輸出。',
      check: [
        '時間線分開「不能登入」與「既有憑證全部失效」兩個時間點',
        '每一段延遲都有負責的系統或團隊（HR、目錄管理者、排班系統）',
        '縮短空窗的做法寫出代價（SCIM 要 IdP 支援、對帳頻率提高的負載）',
        '本地管理員或服務帳號若在範例裡出現，另外寫出它們的負責人',
      ],
      twist: '其實他週五是調到另一個部門：從 head-nurses 移到別的群組，帳號仍然有效。先預測對帳程式會停用、更新還是新建帳號，`schedule:edit` 會不會殘留，再修改範例資料執行驗證。',
    },
    points: [
      { b: '應用程式不擁有身分', t: '組織的帳號與密碼放在目錄服務。LDAP 的資料是一棵樹：DN 是 entry 的完整路徑、OU 用來分類、群組用 `member` 列出成員且可以巢狀。Active Directory 提供 LDAP 介面，網域內的驗證主要用 Kerberos（用票證，不把密碼傳給每個服務）。應用程式自己再存一份帳號，就多一份沒人同步的副本。' },
      { b: '三種接法：LDAP bind、SAML、OIDC', t: 'LDAP bind 讓應用程式經手明文密碼，也做不了 MFA 與單一登入，只留給舊系統。SAML 2.0 與 OIDC 都把登入交給 IdP：SAML 用瀏覽器轉址送回簽章的 XML assertion，OIDC 用授權碼換 JWT。新系統在 IdP 兩者都支援時選 OIDC；對方只支援 SAML 時用 SAML。' },
      { b: 'assertion 與 token 要完整驗證', t: 'SAML 要驗簽章、`Audience` 是自己、`Recipient` 是自己的 ACS 網址、有效時間與 `InResponseTo`，交給維護中的函式庫做，不自己解析 XML，也不為了先接通而關掉檢查。IdP 的簽章憑證會更換，到期日要追蹤；SP 與 IdP 的時間要同步。' },
      { b: '群組對應角色，對應表放在設定', t: 'IdP 給的是群組，程式檢查的是自己定義的角色與權限，中間用一張對應表。群組名稱不寫死在程式的判斷式裡；沒對應到角色就是沒有權限；巢狀群組自己展開時要處理循環；判斷權限前先看帳號是否啟用，停用的人可能還留在群組裡。' },
      { b: '停用要自動生效：SCIM 或定期對帳', t: '只靠「不能登入」擋不住既有的 session、refresh token 與 API key。IdP 支援時用 SCIM 推送建立與停用；沒有時定期同步並對帳，用目錄產生的不變 id 配對（不用 email），要停用的比例異常時先停下來告警。本地管理員與服務帳號不受 IdP 管理，要有負責人並另外列管。' },
    ],
    checklist: [
      '能說明 LDAP bind、SAML、OIDC 三種接法中，應用程式各自會不會經手使用者的密碼，以及新系統該選哪一種',
      '能寫出目錄群組到應用程式角色的對應表，並展開巢狀群組（含循環）算出一個人的角色',
      '能實作目錄與應用程式帳號的對帳：找出該停用、該建立、該更新的帳號，並用不會變的 id 而不是 email 配對',
    ],
    refs: [
      { label: 'RFC 4511：LDAP 協定', url: 'https://www.rfc-editor.org/rfc/rfc4511' },
      { label: 'RFC 4515：LDAP 搜尋 filter 的字串表示法', url: 'https://www.rfc-editor.org/rfc/rfc4515' },
      { label: 'OASIS：SAML 2.0 Technical Overview', url: 'https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html' },
      { label: 'RFC 7644：SCIM 協定', url: 'https://www.rfc-editor.org/rfc/rfc7644' },
      { label: 'OWASP：LDAP Injection Prevention Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html' },
      { label: 'OWASP：SAML Security Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html' },
    ],
  },
}
