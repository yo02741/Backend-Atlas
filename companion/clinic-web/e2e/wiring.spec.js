// 登入 → 掛號 → 報到看板更新；接著讓後端停掉一次，核對看板與掛號表單怎麼恢復。
//
// 需要：clinic-api 剛 seed 好的資料（同一位病患在同一個診次只能掛一次，重跑前先 docker compose down -v 再走三步驟）。
// 停掉與恢復後端的指令可以用 API_STOP、API_START 換掉；預設是 clinic-api 的 compose 裡的 api 服務。
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const API_DIR = fileURLToPath(new URL('../../clinic-api/', import.meta.url))
const API_STOP = process.env.API_STOP ?? 'docker compose stop api'
const API_START = process.env.API_START ?? 'docker compose up -d --wait api'
const PASSWORD = process.env.SEED_PASSWORD ?? 'local-dev-only'
const POLL_MS = 500                                   // 看板的輪詢間隔：正式是 10 秒，這裡調短（上限是 12 倍）

const sh = (cmd) => execSync(cmd, { cwd: API_DIR, stdio: 'inherit' })

// 和後端一樣用台北時間決定「今天」與時段（契約：13:30 起下午、18:00 起晚上）
function taipeiNow() {
  const iso = new Date(Date.now() + 8 * 3600_000).toISOString()
  const hm = iso.slice(11, 16)
  return {
    date: iso.slice(0, 10),
    period: hm >= '18:00' ? '夜間' : hm >= '13:30' ? '下午' : '上午',
    nearBoundary: (hm >= '13:25' && hm < '13:30') || (hm >= '17:55' && hm < '18:00') || hm >= '23:55',
  }
}

test('登入 → 掛號 → 看板更新；後端停掉一次之後，看板與掛號表單都恢復', async ({ page, context, baseURL }) => {
  test.skip(taipeiNow().nearBoundary, '換時段（或換日）前 5 分鐘內不跑：看板會在測試中途換到下一個時段')
  // 只換掉執行時設定的 config.js（不是 src/config.js 那個模組）
  await context.route(new URL('config.js', baseURL).href, (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.__CLINIC_CONFIG__ = { apiBase: '/api', envName: '接線測試', showDebug: false, boardIntervalMs: ${POLL_MS} }`,
  }))
  const { date, period } = taipeiNow()

  // ── 報到看板：另一個分頁，不用登入 ──
  const board = await context.newPage()
  await board.goto('board')
  const room = board.getByRole('listitem').filter({ hasText: '林醫師' })
  await expect(room).toContainText('候診')
  const waiting = async () => Number((await room.textContent()).match(/候診 (\d+) 人/)[1])
  const before = await waiting()

  // ── 登入：深層網址先被導去登入頁，登入後回到原本的網址 ──
  await page.goto(`sessions?date=${date}&doctor_id=1`)
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel('帳號').fill('desk1')
  await page.getByLabel('密碼').fill(PASSWORD)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page).toHaveURL(/\/sessions\?doctor_id=1$/)   // 回到原本的頁面；date 是今天（預設值），被拿掉

  // ── 掛號：今天目前這個時段的診次 ──
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `${date} ${period}診 林醫師` }) })
  await card.getByRole('link', { name: '掛號' }).click()
  await expect(page.getByRole('heading', { name: '掛號', level: 1 })).toBeFocused()   // 換頁後焦點在 h1
  const keys = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/sessions/')) keys.push(r.headers()['idempotency-key']) })
  await page.getByLabel('病歷號').fill('3')
  await page.getByRole('button', { name: '掛號' }).click()
  await expect(page.getByRole('status'), '要剛 seed 的資料：已經掛過時先 docker compose down -v，再走 clinic-api README 的三步驟')
    .toHaveText(/^掛號成功：第 \d+ 號$/)

  // ── 看板更新：下一輪輪詢就看到多一位候診 ──
  await expect.poll(waiting).toBe(before + 1)

  // ── 後端停掉 ──
  sh(API_STOP)
  try {
    // 看板：舊資料留著，標出最後更新的時間
    await expect(board.getByRole('status')).toHaveText(/^更新失敗，顯示的是 \d{1,2}:\d{2}:\d{2} 的資料$/)
    expect(await waiting()).toBe(before + 1)

    // 掛號：5xx 時保留輸入，提示再送一次
    await page.getByLabel('病歷號').fill('2')
    await page.getByRole('button', { name: '掛號' }).click()
    await expect(page.getByRole('alert')).toHaveText('系統暫時無法處理，請再送出一次')
    await expect(page.getByLabel('病歷號')).toHaveValue('2')
  } finally {
    sh(API_START)
  }

  // ── 後端恢復 ──
  // 看板：退避之後自己恢復（連續失敗時最久等 12 × POLL_MS），提示清空
  await expect(board.getByRole('status')).toHaveText('', { timeout: 20_000 })
  await expect.poll(waiting).toBe(before + 1)

  // 掛號：再送一次，帶的是同一個 Idempotency-Key
  await page.getByRole('button', { name: '掛號' }).click()
  await expect(page.getByRole('status')).toHaveText(/^掛號成功：第 \d+ 號$/)
  expect(keys).toHaveLength(3)
  expect(keys[0]).not.toBe(keys[1])                      // 第一次成功之後換了新的鍵
  expect(keys[2]).toBe(keys[1])                          // 5xx 之後的重送沿用同一個
  await expect.poll(waiting).toBe(before + 2)
})
