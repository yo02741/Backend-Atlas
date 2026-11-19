// 題庫：P11 新課（p3 批）：spa-containers
export default [
  {
    skill: 'spa-containers',
    questions: [
      {
        q: '前端程式用 `import.meta.env.VITE_SSO_URL` 取得登入網址。CI 用測試環境的值建好映像，測試通過後把同一個映像部署到正式環境，正式環境的 Pod 也設定了正確的環境變數 `VITE_SSO_URL`，使用者卻還是被導到測試的 SSO。原因是什麼？',
        options: [
          'Pod 的環境變數只在容器啟動時讀一次，要 `kubectl rollout restart` 才會讀到新值',
          'nginx 預設不把容器的環境變數傳給前端，要在設定裡加 `env VITE_SSO_URL;`',
          '`VITE_` 開頭的變數在 `npm run build` 時就被換成字串寫進 bundle，執行時的環境變數不會改變它',
          '瀏覽器快取了舊的 bundle，正式環境的使用者清除快取後就會導到正確的網址',
        ],
        answer: 2,
        explain: 'Vite 在建置時把 `import.meta.env.VITE_*` 直接替換成當時的值，bundle 裡留下的是字串，容器執行時根本不看環境變數，重啟、改 nginx 或清快取都沒用。要讓同一個映像跑在不同環境，改用執行期設定：由 nginx 送 `/config.js`，內容來自每個環境的 ConfigMap。`env` 指令只是讓 nginx 的 worker 保留環境變數，不會送給瀏覽器。',
      },
      {
        q: '下面這份設定裡，瀏覽器請求 `/assets/index-3f9c2a1b.js`（檔案存在）時，回應會帶哪些標頭？',
        code: 'server {\n    root /usr/share/nginx/html;\n    add_header X-Content-Type-Options "nosniff" always;\n\n    location /assets/ {\n        try_files $uri =404;\n        add_header Cache-Control "public, max-age=31536000, immutable" always;\n    }\n\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}',
        lang: 'nginx',
        options: [
          '只有 Cache-Control；server 層的 X-Content-Type-Options 不會出現',
          'Cache-Control 與 X-Content-Type-Options 兩個都有，server 層的設定會套到每個 location',
          '只有 X-Content-Type-Options；location 裡的 add_header 要寫在 try_files 前面才會生效',
          '兩個都沒有，因為 add_header 對 try_files 找到的靜態檔不起作用',
        ],
        answer: 0,
        explain: 'nginx 的 add_header 只有在「目前這一層完全沒有 add_header」時才繼承上一層。`/assets/` 自己寫了一個 Cache-Control，server 層的 nosniff 就不算了；反而是沒有任何 add_header 的 `location /` 會繼承到 nosniff。指令在 location 裡的書寫順序不影響 add_header，靜態檔的回應也會帶標頭。修法是在 `/assets/` 再寫一次 nosniff、用 include 共用，或 nginx 1.29.3 起用 `add_header_inherit merge;`。',
      },
      {
        q: '原本 nginx 站在最前面轉發 `/api`，upstream 的 `keepalive_timeout` 是 60 秒、gunicorn 的 `--keep-alive` 是 75 秒（gthread worker），一直相安無事。搬上 K8s 後改成由 Envoy Gateway 的 HTTPRoute 直接把 `/api` 送到後端，之後在離峰時段偶發 503，訊息是 `upstream connect error or disconnect/reset before headers. reset reason: connection termination`。最合適的處理是？',
        options: [
          '把 gunicorn 的 `--keep-alive` 調成 0，讓每個請求都開新連線，避免重用連線',
          '把 HTTPRoute 的 `/api` 規則加上 `ReplacePrefixMatch: /`，讓後端收到正確的路徑',
          '把 clinic-api 的 readinessProbe 間隔調短，讓 Gateway 更快發現後端不可用',
          '用 BackendTrafficPolicy 把 Gateway 對後端的連線閒置逾時調到比 75 秒短，例如 60 秒',
        ],
        answer: 3,
        explain: '直接連 gunicorn 的那一層從 nginx（60 秒）換成了 Envoy，Envoy Gateway 對上游的閒置逾時預設 1 小時，比 gunicorn 的 75 秒長；gunicorn 先關掉閒置連線，Envoy 拿那條連線送請求就被重設，離峰時閒置連線多，所以更常發生。規則跟原本一樣：前面那一層的閒置逾時要比 gunicorn 的 keep-alive 短。調成 0 是讓 gunicorn 不再保留閒置連線，每個請求多一次建立連線的成本，只是避開問題；改寫路徑處理的是 404；readiness 管的是 Pod 是否在後端清單裡，和重用已關閉的連線無關。',
      },
    ],
  },
]
