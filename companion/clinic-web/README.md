# clinic-web：門診掛號前端的最小接線版本

前端實作路線「從零做完一個門診掛號前端」的五個畫面接上後端參考專案 [`companion/clinic-api`](../clinic-api/)：登入、診次清單、掛號、我的掛號、報到看板。程式是各階段說明裡的「關鍵程式」，兩邊照同一份契約 [`../clinic-api/docs/contract.md`](../clinic-api/docs/contract.md)。

只求接得起來、測得到；外觀與無障礙的細節以網站的第 6 階段為準。這個目錄是獨立的 npm 專案，和網站的建置無關。

## 版本

Node.js 22；依賴是精確版本，`package-lock.json` 鎖住整棵樹：Vue 3.5.45、Vue Router 5.5.1、Pinia 4.1.0、Vite 7.3.8、`@vitejs/plugin-vue` 6.0.10、`@playwright/test` 1.56.1。

## 兩個終端機跑起來

終端機 1，後端（`companion/clinic-api/`，照它的 README 三步驟）：

```bash
cd companion/clinic-api
docker compose up -d --build --wait
docker compose exec api alembic upgrade head
docker compose exec -e SEED_PASSWORD=local-dev-only api python -m clinic.seed
```

終端機 2，前端（這個目錄）：

```bash
cd companion/clinic-web
npm ci
npm run dev            # http://localhost:5173/，/api 由 Vite 的 proxy 轉給 http://127.0.0.1:8000
```

後端不在 8000 時用 `CLINIC_API=http://127.0.0.1:8080 npm run dev`。帳號是 seed 建的 `patient1`、`patient2`、`desk1`、`doctor1`，密碼是 `SEED_PASSWORD`。

| 畫面 | 網址 | 誰 |
|---|---|---|
| 登入 | `/login` | 所有人 |
| 診次清單 | `/sessions?date=&doctor_id=` | 登入後；不帶 `doctor_id` 是全部醫師 |
| 掛號 | `/sessions/:id/book` | 櫃台版的表單（輸入病歷號）；用 `desk1` |
| 我的掛號 | `/appointments?status=` | 登入後；病患看到自己的、櫃台看到全部 |
| 報到看板 | `/board` | 不用登入；顯示今天目前這個時段的診次 |

seed 會建立今天的上午、下午、晚上診，所以任何時間打開看板都有林醫師（101 診）與張醫師（102 診）兩列。看板每 10 秒更新一次；`public/config.js` 的 `boardIntervalMs` 可以調。

## 和網站上的程式不一樣的地方

- `apiFetch` 與登入頁的網址前綴是 `config.apiBase`（第 7 階段的寫法），第 1 到第 6 階段的程式寫死 `/api`。
- `src/config.js` 多一個數字欄位 `boardIntervalMs`，看板的 `usePolling` 讀它（上限是它的 12 倍）；接線測試把它調成 500 ms。
- `sessionQuery.js` 的 `today()` 用台北時間（UTC+8），和後端算的「今天」一致；第 2 階段的寫法用瀏覽器的時區。
- 診次卡片多了醫師名字：不帶 `doctor_id` 時兩位醫師的上午診標題一樣。
- 看板在這個時段沒有門診時多一行「目前這個時段沒有門診」。

## 用 nginx 跑（第 7 階段的部署方式）

```bash
BASE_PATH=/clinic/ npm run build
docker run --rm -p 8080:8080 --network clinic_default \
  -v "$PWD/dist:/usr/share/nginx/html/clinic:ro" \
  -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27
```

打開 `http://localhost:8080/clinic/`。`nginx.conf` 是第 7 階段的設定：`/clinic/assets/` 找不到回 404、頁面路徑 fallback 到 `/clinic/index.html`、`/api/` 原樣轉給 compose 裡的 `api:8000`（`clinic_default` 是 clinic-api 的 compose 建的網路）。

## 接線測試

`e2e/wiring.spec.js` 用 Playwright 在 Chromium 裡走一遍，後端要先照上面起好，而且是剛 seed 的資料（同一位病患在同一個診次只能掛一次；重跑之前 `docker compose down -v` 再走三步驟）：

```bash
npx playwright install chromium     # 第一次
npm run test:e2e                    # 自己起 Vite 的 dev server（PORT 預設 5173）
WEB_URL=http://127.0.0.1:8080/clinic/ npm run test:e2e   # 改測 nginx 那一版
```

| 步驟 | 檢查 |
|---|---|
| 1. 另開一個分頁打開看板 | 不用登入就有林醫師那一列，記下候診人數 |
| 2. 沒登入打開 `/sessions?date=<今天>&doctor_id=1` | 先被導去 `/login?redirect=…`；`desk1` 登入後回到 `/sessions?doctor_id=1`（今天是預設值，網址上拿掉） |
| 3. 從今天目前這個時段的林醫師診次點「掛號」，替病歷號 3 掛號 | 焦點在 `h1`；`role="status"` 是「掛號成功：第 N 號」 |
| 4. 看板 | 下一輪輪詢後候診多 1 人 |
| 5. 停掉後端（`docker compose stop api`） | 看板：舊的號碼與人數留著，`role="status"` 是「更新失敗，顯示的是 HH:MM:SS 的資料」。掛號：替病歷號 2 送出，`role="alert"` 是「系統暫時無法處理，請再送出一次」，病歷號保留 |
| 6. 恢復後端（`docker compose up -d --wait api`） | 看板在退避之後自己恢復、提示清空。掛號：再按一次送出就成功，這次的 `Idempotency-Key` 和失敗那次相同（和第一筆不同）；看板候診再多 1 人 |

後端停掉時，Vite 的 proxy 回 500、nginx 回 502，兩種都是 5xx，畫面一樣。停掉與恢復後端的指令可以用 `API_STOP`、`API_START` 換掉，例如後端直接跑在主機上（不用容器）時改成 kill 與重新啟動 uvicorn 的腳本。

看板只顯示目前這個時段，測試在換時段（13:30、18:00）與換日前 5 分鐘內會略過，不然看板可能在測試中途換成下一個時段。

GitHub Actions 的 `Companion` workflow 有一個 `clinic-web` job：`npm ci`、建置，接著起 clinic-api 的 compose、migration、seed，跑這個測試。
