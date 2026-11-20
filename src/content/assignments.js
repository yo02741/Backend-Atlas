// 跨課作業：把幾堂課接成一次完整的任務（#/assignments、#/assignment/<id>）。
// 此檔要能被 Node 直接 import（校驗與 e2e 用）。格式見 docs/CONTRIBUTING-lessons.md 的「跨課作業」。
//   lessons    用到的課（存在的課 id，至少一個）
//   stages     相關的實作路線階段 id（選填）
//   scenarios  相關的設計情境 id（選填）
//   steps      每一步：title、do（markdown，可以有站內連結）、deliver（交付物，一句）、check（驗收條件 1–4 條，勾選記在這個瀏覽器）
//   twist      需求變化（選填）：做完才展開
export const ASSIGNMENTS = [
  {
    id: 'vue-vite-upgrade', track: 'frontend', title: '升級 Vite 主版本的 PR',
    summary: '把門診前端從 Vite 6 升到 Vite 8：說明 lock 檔的差異，做乾淨安裝、型別檢查、production build 與預覽驗收，並重現一組本機會過、CI 會失敗的版本組合。',
    lessons: ['npm-packages', 'vite-basics', 'lint-typecheck', 'frontend-ci', 'browser-support', 'ai-review-diff'],
    stages: ['fe-deploy'],
    steps: [
      {
        title: '列出要改的地方',
        do: '讀 [Vite：開發與建置](#/skill/vite-basics) 的「Vite 6 與 Vite 8」對照表與官方的 Migration 文件，對照專案的 `vite.config.*`、`package.json` 的 `engines`、`.nvmrc` 與 CI 設定裡的 Node 版本。',
        deliver: '一張表：設定項、目前的值、Vite 8 的要求、要不要改。',
        check: ['`build.rollupOptions`、`manualChunks`、Node 版本、`build.target` 各有一列', '每一列對得到 Migration 文件或對照表的一段', 'Node 版本同時寫出本機與 CI 兩處的值'],
      },
      {
        title: '升級並說明 lock 檔',
        do: '在分支上只升 Vite 與它要求一起升的套件（例如 `@vitejs/plugin-vue`），刪掉 `node_modules` 之後 `npm ci`（[套件管理與供應鏈](#/skill/npm-packages)）。用 `git diff package-lock.json` 找出版本變了的套件，分成直接依賴與間接依賴。',
        deliver: '`package.json` 的 diff，加上一段 lock 檔差異說明：哪些套件變了、哪些是跟著 Vite 進來的。',
        check: ['lock 檔裡 `vite` 的版本落在 `package.json` 寫的範圍內', '`npm ci` 從空的 `node_modules` 安裝成功', '主版本有變的套件都寫出是誰帶進來的', '沒有順手升級無關的套件'],
      },
      {
        title: '型別檢查、建置與預覽',
        do: '依序執行 `npm run typecheck`（`vue-tsc --noEmit`，見 [lint 與型別檢查](#/skill/lint-typecheck)）、`npm run build`、`npx vite preview`。在預覽裡打開首頁、一個懶載入的頁面與一個深層網址，並比較升級前後 `dist/assets/` 的檔案數與最大的 JS 檔。',
        deliver: '三個指令的結尾輸出，加上升級前後 `dist/assets/` 的對照（檔案數、最大的 JS 檔大小）。',
        check: ['型別檢查與建置的結束碼都是 0', '懶載入的頁面在預覽裡打得開，Console 沒有錯誤', '最大的 JS 檔大小變化超過 10% 時寫出原因', '寫出一件預覽驗不到、要留給 [建置與部署](#/project/fe-deploy) 的 nginx 驗收的事'],
      },
      {
        title: '本機會過、CI 會失敗',
        do: '重現一組組合並修好。兩個常見的來源：CI 的 Node 版本低於 Vite 8 要求的 20.19 或 22.12；`typescript` 寫成 `latest`，lock 檔被更新到 7.0，本機的 `node_modules` 還停在 6.0，`vue-tsc` 只在 CI 失敗（[前端的 CI](#/skill/frontend-ci)）。',
        deliver: 'CI 失敗那一步的錯誤訊息，加上修正的 diff（`.nvmrc` 與 `node-version-file`，或固定 `typescript` 的範圍）。',
        check: ['失敗的 CI 紀錄與修正後成功的紀錄都附上', '修正後本機與 CI 從同一個檔讀版本', '寫出本機為什麼沒有先發現'],
      },
      {
        title: '審 PR',
        do: '改動若由 AI 產生，照 [審 AI 的改動](#/skill/ai-review-diff) 逐檔看。設定檔裡出現 Vite 8 不認得或已標為 deprecated 的選項時，查文件確認，不照 AI 的說明直接接受。',
        deliver: '一段 PR 評語：哪些改動必要、哪些要退回，附 CI 結果的連結。',
        check: ['評語指出至少一個不必要或要確認的改動，或寫明逐檔看過沒有', '每個要退回的改動都附理由'],
      },
    ],
    twist: '升級合併後，櫃台一台還在用 Safari 15 的電腦打開是白畫面，其他電腦正常。先預測是哪個預設值改變造成的、要看哪裡確認（Console 的 `SyntaxError`、建置產物裡的語法），再決定改 `build.target` 還是更新那台電腦的瀏覽器（[瀏覽器支援與 Baseline](#/skill/browser-support)）。',
  },
  {
    id: 'ward-list-freshness', track: 'backend', title: '護理站清單的資料新鮮度',
    summary: '病房清單、病人基本資料、即時狀態各有不同的「最多舊多久」。定下承諾，在畫面上驗收切站、登出與背景更新，再把 API 改成四個 worker，比較瀏覽器快取、各程序快取與共享快取。',
    lessons: ['http-caching', 'data-caching', 'redis-cache', 'lru-cache', 'process-servers', 'auth-frontend', 'scaling'],
    stages: ['cache-ratelimit', 'fe-login', 'fe-sessions'],
    scenarios: ['cache', 'edge-cache', 'list-fetching', 'state-placement'],
    steps: [
      {
        title: '寫下新鮮度承諾',
        do: '虛構一個護理站系統：病房代碼 `W-07`、`W-08`，病人識別碼從 `P-0001` 起，除了姓名不放其他個資。三種資料：病房清單（床號與病人識別碼）、病人基本資料（遮罩後的姓名、過敏註記）、即時狀態（呼叫鈴、警示）。每一種寫下最多可以舊多久、什麼事件發生時要立刻失效、API 回什麼快取標頭（[HTTP 快取與條件請求](#/skill/http-caching)）。',
        deliver: '一張表：資料、最多舊多久、失效事件、`Cache-Control` 與 `ETag` 的設定、前端快取的 key。',
        check: ['每一列都寫具體的秒數', '即時狀態的承諾不靠任何一層快取的 TTL 達成', '帶使用者資料的回應是 `private` 或 `no-store`', '前端快取的 key 含病房代碼；基本資料的 key 也含登入的使用者'],
      },
      {
        title: '在畫面上驗收三個操作',
        do: '在 Playground 的 Vue 模式用 `api.get` 加三條路由（`/api/wards/:id/patients`、`/api/patients/:id`、`/api/wards/:id/alerts`），照第 1 步的承諾做一個最小的前端快取（[前端的資料快取](#/skill/data-caching)）。依序驗收：從 `W-07` 切到 `W-08`；登出後換另一個人登入；分頁放在背景超過承諾的時間再回到前景。',
        deliver: '三個操作各一張截圖，加上預覽下方的網路紀錄與一句觀察。',
        check: ['切站時不會先閃出上一站的病人', '換人登入後第一個畫面沒有上一位使用者的基本資料', '回到前景時舊資料留在畫面上並標出時間，新資料回來才換掉', '即時狀態每次都有請求，不從快取顯示'],
      },
      {
        title: '改成四個 worker',
        do: '後端改成四個 worker 行程（例如 `uvicorn --workers 4`，見 [應用伺服器與程序管理](#/skill/process-servers)）。先在 Playground 的 Python 模式模擬：四個 dict 當各程序的快取、一個 dict 當 Redis，請求輪流分給四個 worker；修改一位病人的過敏註記之後連續讀 8 次。三種配置各跑一次：只有瀏覽器快取（`max-age=60`）；各程序的 LRU 快取，TTL 60 秒（[LRU 與快取淘汰](#/skill/lru-cache)）；共享快取，修改後刪 key（[Redis 與快取策略](#/skill/redis-cache)）。',
        deliver: '三種配置各一列：8 次讀取各拿到新值還是舊值，旁邊是執行前寫下的預測。',
        check: ['預測在執行前寫下，和結果並排', '各程序快取那一列看得出只有處理修改的 worker 拿到新值，或寫出為什麼不是', '共享快取那一列在刪 key 之後 8 次都是新值', '指出哪些配置違反第 1 步的承諾'],
      },
      {
        title: '決定每一層放什麼',
        do: '對照 [API 快取](#/scenario/cache) 與 [快取到期的瞬間](#/scenario/edge-cache) 兩個情境，替三種資料各選一層快取，或不快取，寫成一頁決定。',
        deliver: '一頁決定：每種資料放在哪一層、失效怎麼觸發、什麼負載下要重新評估。',
        check: ['各程序快取只放晚幾十秒也沒關係的資料', '寫出多一個 worker 或多一台機器時，哪一層的不一致會變多', '寫出 Redis 掛掉時每種資料的行為'],
      },
    ],
    twist: '院方加一條：病人轉床後 3 秒內，所有護理站都要看到新床位。先預測第 3 步的三種配置哪些會違反，再決定要縮短 TTL、修改後刪 key，還是改成推送（[報到看板的即時更新](#/scenario/realtime-board)）。',
  },
  {
    id: 'stale-data-incident', track: 'frontend', title: '「資料沒更新」的三種原因',
    summary: '同一個症狀，分別由舊 chunk、較早的請求較晚回、讀副本延遲造成。只看畫面與時間線，先選出分辨三者的證據，再重現、選修法，最後寫成事故紀錄。',
    lessons: ['devtools', 'spa-deploy', 'bundles-chunks', 'cancel-race', 'scaling', 'observability', 'incident-response'],
    stages: ['fe-deploy', 'fe-sessions', 'fe-appointments', 'observe'],
    scenarios: ['replica-consistency', 'list-fetching', 'incident-drill'],
    steps: [
      {
        title: '讀三份回報，先選證據',
        do: '三位櫃台各回報一次「資料沒更新」：\n\n- **A**：09:00 打開系統，12:00 部署了新版。14:00 點「報到看板」，畫面停在載入中，按重新整理就好了。\n- **B**：在診次清單把醫師從林醫師快速換成張醫師，標題寫張醫師，清單卻是林醫師的診次。\n- **C**：取消一筆掛號，畫面顯示成功；馬上重新整理「我的掛號」，那筆還是「已掛號」，十秒後再整理才變成已取消。\n\n動手查之前，替每一份選一個能把它和另外兩份分開的證據，寫出去哪裡看（[開發者工具](#/skill/devtools)的哪個面板、後端的哪種紀錄）。',
        deliver: '一張表：回報、選的證據、去哪裡看、看到什麼就能排除另外兩種。',
        check: ['每一份的證據都能排除另外兩種原因，而不只是符合自己那一種', '證據是看得到的紀錄，不是推論', '每個證據寫出一種會誤判的情況（例如 HTTP 快取也會讓 C 看起來像讀副本延遲）'],
      },
      {
        title: '重現三種原因',
        do: 'A：照 [建置與部署](#/project/fe-deploy) 串接驗收的第 3 步，開著舊分頁重新建置。B：照 [診次清單](#/project/fe-sessions) 串接驗收的第 1 步，讓一個條件的回應比較慢。C：在 [讀寫分離後的「我剛存的怎麼不見了」](#/scenario/replica-consistency) 的模擬器選「最終一致」，把副本延遲調大，按「寫入然後立刻重整」。',
        deliver: '三段重現各一張截圖或錄影，附上第 1 步選的證據實際長什麼樣。',
        check: ['每一段都能照寫下的步驟再重現一次', '第 1 步選的證據在重現時出現；沒出現就回頭改第 1 步'],
      },
      {
        title: '選修法並交叉驗收',
        do: '替每一種選修法並驗收：A 用 `vite:preloadError` 重新載入一次；B 換條件時取消上一輪（[取消請求與競態](#/skill/cancel-race)）；C 從讀寫分離情境的做法裡選一個 read-your-writes 的做法。每個修法都拿另外兩種的重現再跑一次。',
        deliver: '一張表：修法、修好了哪一種、對另外兩種有沒有效、為什麼。',
        check: ['每個修法在自己的重現上驗收通過', '寫出 B 的修法對 C 為什麼沒有效', '寫出 C 的修法要動前端、後端還是兩邊'],
      },
      {
        title: '寫事故紀錄',
        do: '挑一種寫成事故紀錄（[事故處理、on-call 與 postmortem](#/skill/incident-response)）：時間線、怎麼發現、證據、修法、防止再發生的測試或告警。',
        deliver: '一頁事故紀錄。',
        check: ['時間線每一列都有時間與來源（誰看到、哪一筆紀錄）', '至少一項後續行動是測試或告警，不是「提醒大家注意」', '沒有真實的人名或主機名稱'],
      },
    ],
    twist: '第四份回報：同樣的症狀只發生在一台櫃台電腦，其他電腦正常。先預測三種原因各自會不會只影響一台，再列出要多收的證據（被快取住的 `index.html`、瀏覽器版本、那個分頁開了多久）。',
  },
  {
    id: 'pre-release-usability', track: 'frontend', title: '上線前的可用性審查',
    summary: '用完整的掛號流程走四種條件：只用鍵盤、放大字級、慢網路、API 回欄位錯誤。交出可重現的步驟、受影響的使用者、修正與回歸結果。',
    lessons: ['a11y-basics', 'a11y-components', 'forms', 'form-submit', 'rwd', 'units-typography', 'devtools', 'e2e-playwright'],
    stages: ['fe-booking', 'fe-appointments', 'fe-a11y-rwd'],
    scenarios: ['validation-placement'],
    steps: [
      {
        title: '定流程與條件',
        do: '流程固定為：登入 → 在診次清單選日期與醫師 → 掛號 → 在我的掛號取消一筆。前端用自己做的[實作路線](#/project?track=frontend)，後端接參考專案或站上的假 API。四種條件：只用鍵盤、瀏覽器放大到 200%、DevTools 的網路節流（例如 3G）、讓掛號回 422（病歷號填 0）。',
        deliver: '一張測試表：條件 × 流程的每一步，每一格寫預期的結果。',
        check: ['每一格的預期都是看得到或聽得到的結果（焦點在哪、念出什麼、畫面顯示什麼）', '慢網路那一列寫出送出中與載入中各顯示什麼'],
      },
      {
        title: '照表走一遍，記下問題',
        do: '照第 1 步的表逐格操作，鍵盤與螢幕閱讀器的檢查方式見 [無障礙基礎](#/skill/a11y-basics)。結果和預期不符的格子，各記成一筆問題。',
        deliver: '問題清單：每一筆有可重現的步驟、實際結果、預期結果、受影響的使用者。',
        check: ['別人照步驟能重現每一筆', '受影響的使用者寫出具體的人（只用鍵盤、用螢幕閱讀器、放大字級、網路慢的櫃台），不寫「所有人」', '每一筆標出嚴重程度：擋住流程、多一步、外觀'],
      },
      {
        title: '修正',
        do: '先修擋住流程的問題，每一筆對照相關的課：[元件的鍵盤操作與 ARIA](#/skill/a11y-components)、[表單送出與驗證錯誤](#/skill/form-submit)、[單位與文字](#/skill/units-typography)。',
        deliver: '每一筆問題一個 diff，加上修正後同一處的截圖或念出的文字。',
        check: ['擋住流程的問題都修完，或寫出不修的理由與暫時的替代方式', '修正沒有用 `outline: none` 或大於 0 的 `tabindex`'],
      },
      {
        title: '回歸測試',
        do: '把每個修好的問題寫成 [Playwright](#/skill/e2e-playwright) 測試：鍵盤流程用 `toBeFocused()`；放大字級用較窄的 viewport；422 用 `page.route` 回固定的 body；慢網路在 `page.route` 的 handler 裡延後回應。',
        deliver: '測試檔，加上兩次執行結果：拿掉修正時失敗、加回修正後通過。',
        check: ['每個測試在拿掉修正時會失敗', '測試不用 `waitForTimeout` 等固定時間', '測試放進前端的 CI'],
      },
    ],
    twist: '櫃台改用條碼槍輸入病歷號：條碼槍一瞬間打完號碼並送出 Enter。先預測第 1 步的表裡哪些格子的結果會變（送出的時機、重複送出、焦點移動），再補一列「條碼槍」的條件。',
  },
  {
    id: 'ai-tool-upgrade-rollback', track: 'ai', title: 'AI 工具升版後放行還是退版',
    summary: '用一組固定、有該完成也有該拒答的評測資料，比較升版前後的成本、完成率與過度授權，先寫好放行與退版的門檻，再做一次決定。',
    lessons: ['harness-engineering', 'agent-delivery', 'acceptance-design', 'llm-observability', 'ai-gateway', 'key-scope-lifetime', 'finops'],
    stages: ['mcp'],
    scenarios: ['mcp-gateway', 'model-hosting-choice'],
    steps: [
      {
        title: '先寫門檻',
        do: '跑任何評測之前，寫下放行與退版的門檻並 commit：完成率、該拒答案例的拒答率、過度授權次數、每筆任務的成本各自的條件，以及哪些案例必過（[把 agent 當軟體交付](#/skill/agent-delivery)）。',
        deliver: '一個門檻檔與它的 commit。',
        check: ['門檻檔的 commit 時間早於任何評測結果檔', '每個門檻都是數字或「0 次」這種能直接判斷的條件', '寫出門檻不過時退回哪個版本、改哪個設定'],
      },
      {
        title: '建評測集',
        do: '從自己用的一個 AI 工作流程挑 20 筆虛構案例，例如透過 [第 9 階段](#/project/mcp) 的 MCP server 查 staging 的 agent：約 12 筆該完成、5 筆該拒答（要求寫入、查不在 allowlist 的表、要原始的身分證字號）、3 筆邊界。每一筆寫可以機器判定的期望（[Harness Engineering](#/skill/harness-engineering) 的評分器）。',
        deliver: '評測集檔（JSONL 或 YAML），每一筆有 id、輸入、期望、判定方式、是否必過。',
        check: ['至少 16 筆用精確比對、規則或工具呼叫檢查判定，不用模型評分', '該拒答的案例裡至少一筆會誘使 agent 呼叫超出範圍的工具或要求更大的 scope', '資料全部虛構'],
      },
      {
        title: '跑舊版與新版',
        do: '固定溫度與其他參數，舊版與新版各跑 3 次；次數對通過率的影響可以先在 [同一個 Prompt 跑 N 次](#/lab/HarnessLab) 看。每次記下完整的模型或工具版本、每一筆的判定結果、token 用量與費用；月成本可以用 [Agent 工作流一個月花多少](#/lab/TokenCostLab) 換算。',
        deliver: '逐案例的對照表：案例、舊版 3 次、新版 3 次，加上兩版的完成率、拒答率與每筆平均成本。',
        check: ['版本寫完整的版本字串，不用別名', '看得出逐案例的變化，不只總數', '單價註明來源與查詢日期'],
      },
      {
        title: '量過度授權',
        do: '過度授權從紀錄判定，不看模型自己的說明：工具呼叫紀錄裡超出案例需要的呼叫、要求比 `clinic:read` 更大的 scope、MCP server 稽核紀錄裡 `allowed: false` 的查詢（[金鑰的範圍與壽命](#/skill/key-scope-lifetime)）。',
        deliver: '兩版各一個次數，每一次附一行紀錄當證據。',
        check: ['每一次都對得到一行工具呼叫或稽核紀錄', '被權限擋下與沒被擋下的呼叫分開計數', '寫出擋下的是哪一層（allowlist、唯讀帳號、scope）'],
      },
      {
        title: '做決定',
        do: '拿第 3、4 步的結果對第 1 步的門檻，決定放行或退版。退版時照門檻檔寫的方式操作一次（例如把 [AI Gateway](#/skill/ai-gateway) 的路由指回舊版），再跑一次必過案例確認。',
        deliver: '一頁決定：結果與門檻的對照、決定、放行或退版的操作紀錄。',
        check: ['決定由門檻直接推得出來，中途沒有改門檻', '退版後必過案例全部通過', '寫出下一次升版前要補進評測集的案例'],
      },
    ],
    twist: '新版的完成率高 8 個百分點、每筆成本低 20%，但在一筆該拒答的案例上呼叫了寫入工具，被唯讀帳號擋下。先預測你的門檻會放行還是退版，再說明「被擋下」該不該算過度授權、門檻要不要改，以及改門檻要經過誰審查。',
  },
]

export const findAssignment = (id) => ASSIGNMENTS.find((a) => a.id === id) || null
export const assignmentsOf = (track) => (!track || track === 'all' ? ASSIGNMENTS : ASSIGNMENTS.filter((a) => a.track === track))
