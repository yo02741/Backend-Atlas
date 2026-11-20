// 題庫：P10 新課（m6 批）：enterprise-identity / security-operations
export default [
  {
    skill: 'enterprise-identity',
    questions: [
      {
        q: '新系統的登入要接組織的帳號。「應用程式自己收帳號密碼再去 LDAP bind」和「用 SAML 或 OIDC 把登入交給 IdP」，最根本的差別是什麼？',
        options: [
          'LDAP bind 的連線一定沒有加密，SAML 與 OIDC 才會走 TLS',
          'LDAP bind 讓應用程式經手明文密碼，也沒有地方做 MFA',
          'LDAP bind 讀不到群組，沒辦法做角色對應；只有 SAML 與 OIDC 能帶群組',
          'LDAP bind 不需要服務帳號，所以目錄那邊查不出是哪個系統在驗證',
        ],
        answer: 1,
        explain: '直接 bind 時密碼會經過應用程式：它的日誌、錯誤回報都可能留下密碼，應用程式被入侵就等於目錄密碼外洩，而且目錄只回答密碼對不對，第二個因素沒有地方放。LDAP 可以走 TLS（LDAPS），也讀得到群組屬性；常見做法反而需要一個服務帳號先查出使用者的 DN，每個應用程式都存一份它的密碼也是缺點之一。',
      },
      {
        q: '下面的對帳程式用 email 配對。護理師的 email 因為改名從 chen.yiting 換成 lin.yiting（目錄的 id 沒變、帳號仍然啟用）。下一次對帳會發生什麼事？',
        code: 'app_by_email = {acct["email"]: acct for acct in app_users}\nfor person in directory_users:\n    acct = app_by_email.get(person["email"])\n    if acct is None and person["active"]:\n        create_account(person)\n    elif acct is not None and not person["active"]:\n        deactivate(acct)',
        lang: 'python',
        options: [
          '程式比對到同一個人，把舊帳號的 email 更新成新的，其他不變',
          '舊帳號被停用，新帳號接手原本的資料與角色',
          '什麼都不會發生，因為 active 沒有改變',
          '用新 email 建一個新帳號；舊帳號沒被更新也沒被停用',
        ],
        answer: 3,
        explain: '用新 email 查不到帳號，程式把她當成新進人員建立一個新帳號。迴圈只走目錄裡的人，舊 email 已經不在目錄裡，所以舊帳號沒有人處理：它繼續有效，班表與角色都留在上面。配對要用目錄產生、不會變的 id（例如 entryUUID、objectGUID，或 IdP 的 issuer 加 sub），email 只是一個會變的屬性。',
      },
      {
        q: '內部報表系統已經接了 OIDC，帳號在第一次登入時自動建立。稽核問：員工離職當天，他在報表系統裡還沒過期的 session 與個人 API key 怎麼處理？最合適的做法是哪一個？',
        options: [
          '不用處理：IdP 停用帳號後，各系統的 session 與 API key 會在下次請求時自動失效',
          '把 session 壽命縮短成 5 分鐘、API key 改成 90 天到期，讓離職的影響自然結束',
          '用 SCIM 或定期對帳收到停用，再撤銷他的 session、refresh token 與 API key',
          '離職時由主管寄信通知報表系統管理者，管理者當天手動刪除帳號與 API key',
        ],
        answer: 2,
        explain: 'IdP 停用只保證他不能再「登入」，應用程式已經發出去的 session、refresh token、API key 不會自己失效，要有人把停用這件事告訴應用程式：SCIM 是 IdP 主動推送，沒有 SCIM 時用定期同步與對帳。縮短 session 與設 API key 到期日都只是縮短窗口，90 天的 key 在離職後還能用將近三個月；靠寄信的手動流程遲早會漏，這正是自動化要解決的問題。',
      },
    ],
  },
  {
    skill: 'security-operations',
    questions: [
      {
        q: '掃描報告裡有兩筆弱點，CVSS 分別是 9.8 與 7.5。只憑這兩個分數，可以確定什麼？',
        options: [
          '9.8 的那筆要先修，因為 CVSS 就是修補的優先序',
          '9.8 的那筆近期被利用的機率比較高，因為 EPSS 會跟著 CVSS 變高',
          '9.8 那筆技術上較嚴重；先修哪筆還要看暴露面、是否被利用與資產重要性',
          '7.5 的那筆一定不在 CISA KEV 清單上，可以排到例行更新',
        ],
        answer: 2,
        explain: 'CVSS 的基本分數描述弱點本身的技術特性，不知道它在哪一台資產上。7.5 分的弱點如果在對外的重要服務上而且已知被利用，應該排在內網一般主機的 9.8 分前面。KEV 回答「有沒有已知被實際利用」、EPSS 估計「近期被利用的可能性」，兩者都是獨立於 CVSS 的資料，不能從 CVSS 推出來。',
      },
      {
        q: '計分規則：CVSS 9.0 以上 3 分、7.0 以上 2 分、4.0 以上 1 分；已知被利用加 2 分、資產對外加 1 分、重要資產加 1 分，總分越高越先處理。下面四筆哪一筆排第一？',
        code: '[\n  {"id": "A", "cvss": 9.8, "known_exploited": false, "exposure": "internal", "criticality": "normal"},\n  {"id": "B", "cvss": 7.5, "known_exploited": true,  "exposure": "internet", "criticality": "high"},\n  {"id": "C", "cvss": 9.1, "known_exploited": false, "exposure": "internet", "criticality": "normal"},\n  {"id": "D", "cvss": 8.8, "known_exploited": false, "exposure": "internal", "criticality": "high"}\n]',
        lang: 'json',
        options: [
          'B：已知被利用、對外、重要資產，共 6 分',
          'A：CVSS 9.8 是四筆裡最高的，共 3 分也應該排第一',
          'C：CVSS 9.1 落在最高一級而且對外，共 4 分',
          'D：CVSS 8.8 而且在重要資產上，共 3 分',
        ],
        answer: 0,
        explain: '逐筆算：A 是 3 分（只有嚴重度）、B 是 2 + 2 + 1 + 1 = 6 分、C 是 3 + 1 = 4 分、D 是 2 + 1 = 3 分，所以順序是 B、C，再來才是 A 與 D。只看 CVSS 的話 A 會排第一、B 排最後，人力會先花在內網的一般主機上，而對外、正被利用的那一筆繼續開著。',
      },
      {
        q: '對外服務有一筆高優先的弱點，修正版要等兩週後的維護時段才能上線。團隊先在 WAF 加了一條規則擋掉相關的請求。這張弱點工單接下來該怎麼處理？',
        options: [
          '結案：WAF 已經擋住相關請求，弱點碰不到；修正版上線時再開新工單追蹤',
          '把等級降到最低，併入下一季的例行更新，因為 WAF 已經把風險降下來',
          '先移除 WAF 規則，避免誤擋正常使用者，等兩週後修正版上線再一起處理',
          '維持開啟、照原期限修補；WAF 規則登記為有負責人與到期日的補償控制',
        ],
        answer: 3,
        explain: '虛擬修補爭取到的是時間，弱點還在：規則只涵蓋已知的樣式，也只保護經過 WAF 的那條路，所以不能結案也不能降級。補償控制要有對應的弱點、負責人與到期日，否則會變成永久的例外。移除規則等於把這兩週的保護拿掉；擔心誤判的做法是先用只記錄的模式觀察，再切成阻擋。修正版上線後重新掃描，以掃描結果結案。',
      },
    ],
  },
]
