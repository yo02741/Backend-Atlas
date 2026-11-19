// 領域內文（d6-deploy，p3 批）：以技能 id 為 key，由 body/d6-deploy.js 合併。只放這些技能：spa-containers
export default {
  'spa-containers': {
    map: {
      names: [
        { n: '多階段建置', t: 'node 階段 `npm ci`、`npm run build`，nginx 階段只 `COPY --from=build /app/dist` 到 `root` 指向的目錄；最終映像只有 nginx 與靜態檔，tag 對應前端版本。' },
        { n: '`nginx/nginx-unprivileged`', t: 'NGINX 官方維護的非 root 變體，預設聽 8080、以 UID 101 執行；沿用 `listen 80;` 在不允許非 root 綁低 port 的環境會啟動失敗，Service 的 `targetPort` 也要跟著改。' },
        { n: 'SPA fallback', t: '`try_files $uri $uri/ /index.html`：找不到檔案的路徑（`/patients/123`）交給前端路由。這是內部轉址，回應帶的是 `location = /index.html` 的標頭。' },
        { n: 'index.html 與帶 hash 的 assets', t: '`index.html` 檔名固定，用 `no-cache` 每次驗證；`/assets/` 的檔名帶內容 hash，給 `public, max-age=31536000, immutable`，找不到回 404。' },
        { n: '`add_header` 繼承', t: '一個 location 只要寫了 `add_header`，上一層的就全部不算；共用的安全標頭要每層重寫、用 `include`，或 1.29.3 起的 `add_header_inherit merge`。' },
        { n: '執行期設定（`/config.js`）', t: '`VITE_` 開頭的變數在 `npm run build` 時寫進 bundle，換環境就要重建；環境之間不同的值改由 nginx 送 `/config.js`，內容來自 ConfigMap。誰都讀得到，不放秘密。' },
        { n: '保留 nginx 當入口／HTTPRoute 依路徑分流', t: '前者 Gateway 只到 nginx，`/api` 由 nginx 轉給後端的 Service；後者 `/api` 直接到後端、`/` 到只送靜態檔的 nginx，前後端各自更新。' },
        { n: '上游閒置逾時', t: '直接連 gunicorn 的那一層（nginx 的 `keepalive_timeout` 或 Gateway 的設定）要比 gunicorn 的 `--keep-alive` 短，否則偶發 502 或 503；Envoy Gateway 預設 1 小時。' },
      ],
      ask: [
        'dist 在建置時打包進映像、tag 用 commit SHA，以及怎麼查正式環境跑的是哪一版（例如 `/version.json`）。',
        '`index.html`、`/config.js`、`/assets/`、SPA fallback 各自的 `Cache-Control`，以及每個回應都要帶的安全標頭。',
        '哪些值每個環境不同（SSO 網址、環境名稱），放執行期設定，不用 `VITE_` 變數。',
        '`/api` 由誰轉給後端：保留 nginx 當入口，還是 HTTPRoute 依路徑分流；後端路由有沒有 `/api` 前綴、要不要改寫。',
        '直接連 gunicorn 的那一層的閒置逾時設多少，要比 gunicorn 的 `--keep-alive` 短。',
        '以非 root 執行時聽哪個 port，唯讀根檔案系統要另外掛哪些可寫目錄（例如 `/tmp`）。',
      ],
      prompt: '門診掛號的前端（Vue 3 + Vite）用多階段 Dockerfile 建成映像：build 階段 `npm ci`、`npm run build`，runtime 用 `nginx/nginx-unprivileged` 聽 8080，tag 用 commit SHA。nginx 的 `location = /index.html` 與 `/config.js` 給 `no-cache`，`/assets/` 給 `public, max-age=31536000, immutable` 並 `try_files $uri =404`，其他路徑走 SPA fallback；有自己 `add_header` 的 location 都要再寫一次 `X-Content-Type-Options: nosniff`。SSO 網址不用 `VITE_` 變數，由 ConfigMap 掛成目錄、nginx 送出 `/config.js`。路由用 HTTPRoute 依路徑分流：`/api` 到 `clinic-api`（後端路由本來就有 `/api`，不改寫），`/` 到 `clinic-web`；Envoy Gateway 對後端的閒置逾時設 60 秒，比 gunicorn 的 `--keep-alive` 75 秒短。',
      verify: [
        { c: '快取標頭', t: '`curl -sI` 打 `/patients/123`、`/assets/<某個檔名>`、`/config.js`，`Cache-Control` 應該依序是 `no-cache`、`public, max-age=31536000, immutable`、`no-cache`；`/assets/not-exist.js` 要回 404，回 200 加 HTML 代表 fallback 套到了 assets。' },
        { c: '第二次開頁', t: '開發者工具 Network 分頁（不勾 Disable cache）重新整理，assets 要顯示 `(disk cache)` 或 `(memory cache)`、`index.html` 回 304；每次整包重新下載，代表 `no-store` 套到了 `/assets/`。' },
        { c: '少了的標頭', t: '對 `/`、`/assets/` 底下的檔案、`/config.js` 各打一次 `curl -sI`，確認 server 層設的 `X-Content-Type-Options` 都在；少了的那個 location 自己寫了 `add_header`。' },
        { c: '設定沒寫進 bundle', t: '`grep -o \'https://sso[^"]*\' dist/assets/*.js` 不該找到網址；改 ConfigMap 後過一陣子 `curl /config.js` 內容要跟著變，不必重建映像。用 `subPath` 掛的檔案不會更新。' },
        { c: '分流', t: '`curl -i` 打 `/api/health`、`/api-docs/`、`/patients/123`，只有第一個由後端回應；`/api-docs/` 跑到後端，代表 nginx 寫成沒有結尾斜線的 `location /api`。' },
        { c: '偶發 503', t: '分流後偶發 `upstream connect error or disconnect/reset before headers`，先比對 Gateway 對後端的閒置逾時和 gunicorn 的 `--keep-alive`，前者較長就要調短。' },
      ],
    },
    points: [
      { b: 'nginx 是整個系統的入口', t: '`/` 自己送 Vue 建置出的靜態檔，`/api` 轉給後端（gunicorn）。前一半跟著前端改（dist、快取規則），後一半跟著後端改（路徑、逾時、轉發標頭）。搬上 K8s 時要決定這兩個角色要不要拆開。' },
      { b: 'dist 在建置時打包進映像', t: '多階段 Dockerfile：node 階段先複製 `package.json` 與 lock 檔再 `npm ci`，接著 `npm run build`；nginx 階段只 `COPY --from=build /app/dist` 到和 `root` 相同的目錄。映像的 tag 對應前端版本，回滾換 tag。`.dockerignore` 排除 `node_modules` 與 `dist`。非 root 用 `nginx/nginx-unprivileged`（聽 8080、UID 101）。' },
      { b: 'index.html 每次驗證，帶 hash 的 assets 存一年', t: '`location = /index.html` 給 `no-cache`（SPA fallback 是內部轉址，也會落到這裡），`/assets/` 給 `public, max-age=31536000, immutable` 並 `try_files $uri =404`。一個 location 只要寫了 `add_header`，就不再繼承上一層的 `add_header`；共用的標頭每層重寫、用 include，或 1.29.3 起的 `add_header_inherit merge`。' },
      { b: '環境之間不同的值放執行期設定', t: '`VITE_` 開頭的變數在 `npm run build` 時被換成字串寫進 bundle，換環境就要重建。改由 nginx 送 `/config.js`，內容來自 ConfigMap（掛整個目錄，改了會自動更新），或用官方映像的 templates 在啟動時 envsubst 產生。這個檔案誰都讀得到，不能放秘密。' },
      { b: '搬上 K8s 的兩條路', t: '保留 nginx 當入口：upstream 改指 `clinic-api` 的 Service，Gateway 只到 nginx，設定少改但路由分在兩層。由 HTTPRoute 依路徑分流：`/api` 直接到後端、`/` 到只送靜態檔的 nginx，前後端各自更新；要不要去掉 `/api` 看後端的路由，`URLRewrite` 屬於 Extended 支援。不論哪條路，直接連 gunicorn 的那一層，閒置逾時都要比 `--keep-alive` 短（Envoy Gateway 預設 1 小時）。' },
    ],
    checklist: [
      '能寫出前端的多階段 Dockerfile 與 .dockerignore，並說明怎麼從映像的 tag 與 /version.json 查出正式環境跑的是哪一版前端',
      '能寫出 index.html、/assets/ 與 SPA fallback 分開快取的 nginx 設定，並指出哪些 location 會因為自己有 add_header 而少了 server 層的標頭',
      '能比較「保留 nginx 當入口」與「HTTPRoute 依路徑分流」，寫出各自的 manifest，並說出換了前面那一層之後，要調哪個閒置逾時才能避免偶發的 502 或 503',
    ],
    refs: [
      { label: 'nginx：ngx_http_headers_module（add_header）', url: 'https://nginx.org/en/docs/http/ngx_http_headers_module.html' },
      { label: 'Vite：Env Variables and Modes', url: 'https://vite.dev/guide/env-and-mode' },
      { label: 'Docker Hub：nginx 官方映像（templates 與非 root 執行）', url: 'https://hub.docker.com/_/nginx' },
      { label: 'Kubernetes：Gateway API', url: 'https://kubernetes.io/docs/concepts/services-networking/gateway/' },
    ],
  },
}
