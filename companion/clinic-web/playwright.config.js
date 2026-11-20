// 接線測試：真的瀏覽器 → 這個前端 → clinic-api（真的 PostgreSQL 與 Redis）。clinic-api 要先照它的 README 起好並 seed。
// WEB_URL 沒設時，這裡自己起 Vite 的 dev server（/api 由 proxy 轉給 CLINIC_API，預設 http://127.0.0.1:8000）。
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 5173)
const WEB_URL = process.env.WEB_URL

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL ?? `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: WEB_URL ? undefined : {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
