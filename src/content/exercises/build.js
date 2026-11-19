// 程式題：建置與部署（設定檔題：使用者內容是 `source`，`lines` 是去掉 # 註解與空行的各行）
// 測試碼用 String.raw 寫；測試碼裡不要出現 `${` 與反引號。
import { NGINX_SIM } from './nginx-sim.js'
const R = String.raw

// spa-deploy-1 的假 dist：dist/ 的內容放在 /usr/share/nginx/html/clinic/
const CLINIC = NGINX_SIM + R`
const FILES = new Set(['/clinic/index.html', '/clinic/config.js', '/clinic/favicon.svg', '/clinic/assets/index-CmXrpQpe.js', '/clinic/assets/vendor-C8Rcc4dC.js', '/clinic/assets/Reports-Ck84vTFL.js', '/clinic/assets/index-W1erjkBN.css'])
const DIRS = new Set(['/', '/clinic/', '/clinic/assets/'])
const ROOT = '/usr/share/nginx/html'
`

export default [
  {
    id: 'spa-deploy-1', skill: 'spa-deploy', kind: 'config', level: 2, file: 'nginx.conf',
    title: '子路徑上的 SPA：fallback 只給頁面，index.html 不快取',
    prompt: '門診前端部署在 `https://portal.example/clinic/`，Vite 設了 `base: \'/clinic/\'`，Vue Router 用 `createWebHistory(import.meta.env.BASE_URL)`，`dist/` 的內容放在 `/usr/share/nginx/html/clinic/`。現在的 nginx 設定有三個問題：重新整理 `/clinic/appointments/42` 拿到 404（fallback 寫成根目錄的 `/index.html`）；fallback 改對之後，`/clinic/assets/` 底下不存在的舊 chunk 也會被換成 `index.html`；`index.html` 和 assets 一樣被快取一年，部署後使用者一直拿到舊版。\n\n改成：\n\n- `/clinic/`、`/clinic/index.html` 與 `/clinic/appointments/42` 這類頁面路徑（找不到檔案時 fallback 到 `/clinic/index.html`）：`Cache-Control: no-cache`\n- `/clinic/assets/` 底下存在的檔案：`Cache-Control: public, max-age=31536000, immutable`；不存在的回 **404**，不 fallback\n- 執行時設定 `/clinic/config.js` 照樣送出，`no-cache`\n\n快取標頭用 `add_header … always` 設定。檢查器會用一份假的 dist 實際走一遍 location 的選擇、`try_files` 的內部轉址與 `add_header` 的繼承規則。',
    starter: `server {
    listen 8080;
    server_name _;
    # dist/ 的內容放在 /usr/share/nginx/html/clinic/
    root /usr/share/nginx/html;

    location /clinic/ {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
`,
    solution: `server {
    listen 8080;
    server_name _;
    # dist/ 的內容放在 /usr/share/nginx/html/clinic/
    root /usr/share/nginx/html;

    # 檔名帶 hash：快取一年；找不到就 404，不 fallback
    location /clinic/assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # 頁面路徑：找不到檔案時回 /clinic/index.html（帶 base 的路徑），每次向伺服器確認
    location /clinic/ {
        try_files $uri $uri/ /clinic/index.html;
        add_header Cache-Control "no-cache" always;
    }
}
`,
    hints: [
      '`try_files` 最後一個參數是內部轉址：網站在 `/clinic/` 底下，fallback 要寫 `/clinic/index.html`。',
      '另開 `location /clinic/assets/`，寫 `try_files $uri =404;`：比 `/clinic/` 長的前綴會先被選中。',
      '長效快取只給 `/clinic/assets/`；`location /clinic/` 改成 `add_header Cache-Control "no-cache" always;`。',
    ],
    tests: [
      { name: '首頁與深層連結：送出 /clinic/index.html，no-cache', code: CLINIC + R`
for (const uri of ['/clinic/', '/clinic/index.html', '/clinic/appointments/42', '/clinic/reports']) {
  const r = handle(uri)
  assert(r.kind === 'file' && r.file === '/clinic/index.html', uri + ' 應該送出 /clinic/index.html：' + describe(r))
  const cc = cacheOf(r)
  assert(cc.includes('no-cache'), uri + ' 的 Cache-Control 要是 no-cache：' + describe(r))
  assert(!cc.includes('immutable') && !cc.some((v) => /^max-age=[1-9]/.test(v)), uri + ' 不能長效快取：index.html 決定載入哪一版的 chunk（' + describe(r) + '）')
}` },
      { name: '/clinic/assets/ 底下存在的檔案：長效快取加 immutable', code: CLINIC + R`
for (const uri of ['/clinic/assets/index-CmXrpQpe.js', '/clinic/assets/Reports-Ck84vTFL.js', '/clinic/assets/index-W1erjkBN.css']) {
  const r = handle(uri)
  assert(r.kind === 'file' && r.file === uri, uri + ' 應該送出檔案本身：' + describe(r))
  const cc = cacheOf(r)
  assert(cc.includes('public') && cc.includes('max-age=31536000') && cc.includes('immutable'), uri + ' 的 Cache-Control 要是 public, max-age=31536000, immutable：' + describe(r))
  assert(!cc.includes('no-cache') && !cc.includes('no-store'), uri + ' 不能同時有 no-cache 或 no-store：' + describe(r))
}` },
      { name: '/clinic/assets/ 底下不存在的檔案回 404', code: CLINIC + R`
for (const uri of ['/clinic/assets/Reports-BiVi8Bpn.js', '/clinic/assets/nope.css']) {
  const r = handle(uri)
  assert(r.kind === 'status' && r.status === 404, uri + ' 要回 404，不能換成 index.html（瀏覽器拿到 text/html 當 JS，錯誤變成 MIME type 不符）：' + describe(r))
}` },
      { name: '執行時設定 /clinic/config.js：送出檔案，no-cache', code: CLINIC + R`
const r = handle('/clinic/config.js')
assert(r.kind === 'file' && r.file === '/clinic/config.js', '/clinic/config.js 應該送出檔案本身：' + describe(r))
const cc = cacheOf(r)
assert(cc.includes('no-cache') && !cc.includes('immutable'), '/clinic/config.js 換環境就會改，要 no-cache：' + describe(r))` },
      { name: '快取標頭加 always', code: CLINIC + R`
const top = parseConf(lines.join('\n'))
const all = []
const walk = (list) => { for (const d of list) { if (d.name === 'add_header' && /^cache-control$/i.test(d.args[0] || '')) all.push(d); if (d.block) walk(d.block) } }
walk(top)
assert(all.length >= 2, '至少要有兩條 add_header Cache-Control：index.html 與 /clinic/assets/ 各一條')
for (const d of all) assert(d.args[2] === 'always', 'add_header Cache-Control "' + d.args[1] + '" 後面要加 always（沒有 always 時，nginx 只在 200、304 這類狀態碼加上標頭）')` },
    ],
  },
]
