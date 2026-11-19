// 設計情境：多環境的設定放建置時還是執行時（VITE_ 變數、config.js、伺服器注入）
export default {
  id: 'env-config-choice',
  order: 41,
  group: 'delivery',
  title: '多環境的設定放哪裡',
  en: 'Build-time vs runtime config',
  level: 2,
  skills: ['env-config', 'vite-basics', 'spa-deploy', 'spa-containers', 'config-12factor', 'frontend-ci'],
  week: 13,
  lab: 'EnvConfigScenarioLab',
  related: ['first-k8s-service'],
  summary: '門診前端要上測試、預備、正式三個環境，還有一家合作醫院自己部署。SSO 網址、院名、功能開關放建置時的 `VITE_` 變數、執行時的 `config.js`，還是由伺服器寫進頁面？',
  situation: '門診前端（Vue + Vite）部署在測試、預備、正式三個環境，另外北區的合作醫院在自己的機房部署同一套，不跑我們的 CI。各環境不同的值：API 網址、SSO 網址、院名、「線上掛號」功能開關。CI 每次合併建置一個映像，測試環境驗證過後推到預備與正式。線上掛號出問題時，正式環境要能在 5 分鐘內把它關掉；建置加部署約 15 分鐘（示意）。資安要求預備與正式的 CSP 是 `script-src \'self\'`，不允許沒有 nonce 的 inline script。',
  constraints: [
    '正式環境跑的，要是測試環境驗證過的那一份建置',
    '正式環境臨時關掉一個功能，5 分鐘內要生效',
    '合作醫院自己部署，只能改設定，不能要它重新建置',
    'CSP 是 `script-src \'self\'`：inline script 沒有 nonce 或 hash 就不執行',
    '前端拿到的每個值都要假設會被看到，不能放金鑰或 client secret',
  ],
  options: [
    {
      id: 'build-time', name: '建置時（`VITE_` 變數）',
      summary: '`.env.staging`、`.env.production` 各放一份，`vite build --mode staging`；`import.meta.env.VITE_SSO_URL` 在建置時被換成字串常數。',
      pros: ['程式最簡單，沒有額外的請求', '值在建置時就確定，打錯名字 TypeScript 會報錯（`vite-env.d.ts`）', '適合版本號、建置時間、git commit 這類每次建置本來就不同的值'],
      cons: ['每個環境要各建一次：正式跑的不是測試過的那一份；只建一次推上去，正式就連到測試的網址', '改一個值就要重新建置、部署', '值一律是字串：`VITE_FLAG=false` 進來是 truthy 的 `\'false\'`'],
    },
    {
      id: 'config-js', name: '執行時：`/config.js`',
      summary: '`index.html` 在 module script 之前放 `<script src="/config.js">`；各環境的伺服器送各自的檔案（例如 K8s 的 ConfigMap 掛進 nginx）。',
      pros: ['同一份建置跑每個環境，合作醫院只要換一個檔', '改值不用重建：換檔案，使用者下一次載入就生效', '外部檔案符合 `script-src \'self\'`'],
      cons: ['多一個同步載入的請求，擋在應用程式之前', '`config.js` 要 `Cache-Control: no-cache`，不然改了之後瀏覽器還拿著舊的', '缺欄位或型別不對時，前端要自己檢查並給預設值'],
    },
    {
      id: 'server-inject', name: '執行時：伺服器寫進 `index.html`',
      summary: '送 `index.html` 的伺服器（BFF 或 nginx）在回應時把設定寫進頁面，寫成 `<script type="application/json" id="clinic-config">` 資料區塊，前端用 `JSON.parse` 讀。',
      pros: ['同一份建置；首頁不多一個請求', '設定可以依每個請求決定，例如依網域選醫院', 'JSON 資料區塊不會被執行，CSP 不擋'],
      cons: ['要有一個會改 HTML 的伺服器；純靜態託管做不到', '值要跳脫：內容裡有 `</script>` 就會跳出區塊（把 `<` 寫成 `\\u003c`）', '寫成會執行的 inline script（`window.__CONFIG__ = …`），遇到 CSP 就被擋，要每次回應產生 nonce'],
    },
  ],
  tradeoffs: {
    axes: ['建置次數', '上線的是測試過的那份', '改一個值', '啟動成本', '要注意的'],
    rows: [
      { option: 'build-time', cells: ['每個環境一次', '否：每份都重建', '重建 + 部署', '無', '值寫死在 bundle；`\'false\'` 是字串'] },
      { option: 'config-js', cells: ['一次', '是', '換檔案，下次載入生效', '多一個同步 script', '`no-cache`、缺欄位的預設值'] },
      { option: 'server-inject', cells: ['一次', '是', '改伺服器設定（多半要重啟）', '無', '要有伺服器；跳脫；CSP 用資料區塊'] },
    ],
  },
  decisions: [
    { id: 'version', situation: '頁尾要顯示版本號與 git commit，回報問題時客服請使用者念給他聽。', options: ['build-time', 'config-js', 'server-inject'], answer: 'build-time',
      explain: '版本號本來就屬於那一次建置，在 CI 裡 `VITE_APP_VERSION=$(git rev-parse --short HEAD) npm run build` 寫進 bundle，和程式碼一起走。放執行時設定反而會出錯：換了映像忘了改設定，頁尾顯示的就不是正在跑的版本。' },
    { id: 'promote', situation: '同一個映像從測試推到預備、正式，再交給合作醫院自己部署；各環境的 SSO 網址與功能開關都不同，正式環境要能 5 分鐘內關掉線上掛號。', options: ['build-time', 'config-js', 'server-inject'], answer: 'config-js',
      explain: '同一份建置跑每個環境，差異只在各環境自己送的 `config.js`：K8s 用 ConfigMap 掛進 nginx，合作醫院改一個檔案。改開關不用重建，`config.js` 設了 `no-cache`，使用者下一次載入就拿到新值。建置時的變數要每個環境各建一次，也趕不上 5 分鐘。' },
    { id: 'tenant-host', situation: '已經有一個 Node BFF 在送 `index.html`；同一套部署依網域服務兩家院區（`north.clinic.example`、`south.clinic.example`），院名與 SSO 網址不同，首頁不想多一個請求。', options: ['build-time', 'config-js', 'server-inject'], answer: 'server-inject',
      explain: '設定取決於每個請求的網域，而 BFF 本來就在產生回應：依 `Host` 選設定，寫進 JSON 資料區塊，首頁不多一個請求，CSP 也不擋。`config.js` 也能由 BFF 依網域產生，只是多一個請求；建置時的變數做不到「同一份建置、兩個網域不同值」。' },
    { id: 'static-site', situation: '公開的衛教網站：只有一個正式環境，放在只能放靜態檔的託管上，API 網址一年改不到一次。', options: ['build-time', 'config-js', 'server-inject'], answer: 'build-time',
      explain: '只有一個環境，「同一份建置跑多個環境」的好處用不上；值幾乎不變，重建一次的成本可以接受。靜態託管沒有伺服器可以改 HTML；`config.js` 做得到，但多一個請求、多一個要記得設快取的檔案，換不到什麼。' },
  ],
  implementation: [
    { title: 'index.html：config.js 放在 module script 之前；程式只從一個模組讀設定', lang: 'html', code: `<!doctype html>
<html lang="zh-Hant-TW">
  <head><meta charset="utf-8"><title>門診系統</title></head>
  <body>
    <div id="app"></div>
    <!-- 一般的 script 同步執行：main.js 跑的時候 window.__CLINIC_CONFIG__ 已經在了 -->
    <script src="/config.js"></script>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>

<!-- public/config.js（開發用的值；Vite 原樣複製到 dist/，正式環境由伺服器換掉）
window.__CLINIC_CONFIG__ = { envName: '開發', apiBase: '/api', ssoUrl: 'http://localhost:5174/authorize', onlineBooking: true }
-->` },
    { title: 'nginx：config.js 從 ConfigMap 掛載的目錄送出，不快取', lang: 'nginx', code: `location = /config.js {
    alias /etc/clinic-web/config.js;          # ConfigMap 以目錄掛在 /etc/clinic-web/，更新後檔案會跟著換
    add_header Cache-Control "no-cache" always;
}

location = /index.html {
    add_header Cache-Control "no-cache" always;
}

location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable" always;   # 檔名帶 hash
}` },
    { title: '伺服器注入：BFF 依網域把設定寫進 JSON 資料區塊（Express，節錄）', lang: 'js', code: `// dist/index.html 裡放一個佔位：<script type="application/json" id="clinic-config">__CLINIC_CONFIG__</script>
import express from 'express'
import { readFileSync } from 'node:fs'

const TENANTS = {
  'north.clinic.example': { hospital: '北區院區', apiBase: '/api', ssoUrl: 'https://sso.north.example/authorize', onlineBooking: true },
  'south.clinic.example': { hospital: '南區院區', apiBase: '/api', ssoUrl: 'https://sso.south.example/authorize', onlineBooking: false },
}
const template = readFileSync('dist/index.html', 'utf8')
const app = express()
app.use('/assets', express.static('dist/assets', { immutable: true, maxAge: '1y' }))
app.use((req, res) => {
  const cfg = TENANTS[req.hostname]
  if (!cfg) return res.status(404).send('unknown host')
  const json = JSON.stringify(cfg).replace(/</g, '\\\\u003c')    // 值裡有 </script> 也跳不出資料區塊
  res.set('Cache-Control', 'no-cache')
  res.type('html').send(template.replace('__CLINIC_CONFIG__', json))
})
app.listen(8080)

// 前端：const cfg = JSON.parse(document.getElementById('clinic-config').textContent)` },
  ],
  exercise: null,
  refs: [],
}
