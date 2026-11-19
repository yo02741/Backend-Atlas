// 領域內文（d6-deploy，p3 批）：以技能 id 為 key，由 body/d6-deploy.js 合併。只放這些技能：spa-containers
export default {
  'spa-containers': {
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
