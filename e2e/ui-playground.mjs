// Playground 的操作與輔助科技：只用鍵盤切換五種語言、選範例、離開編輯器（Esc 後 Tab）、執行、跳到結果；
// 錯誤由常駐的 live region 念出；載入範例可復原、草稿與輸出重新整理後還在、localStorage 不能用時照常運作；
// HTML、Vue 的假 API 固定情境（成功、失敗、空資料、亂序）；SQL 的影響列數；390px 下輸出不讓整頁橫向捲動。
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const errs = []
let failed = 0
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`) }
async function newPage(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
  return page
}
const editorText = (page) => page.evaluate(() => document.querySelector('.pg-editor .cm-content').cmView?.view?.state.doc.toString() ?? [...document.querySelectorAll('.pg-editor .cm-line')].map((l) => l.textContent).join('\n'))
const active = (page) => page.evaluate(() => { const a = document.activeElement; return { id: a?.id || '', cls: a?.className || '', inEditor: !!a?.closest('.cm-editor'), tag: a?.tagName } })
const status = (page) => page.textContent('.pg-statusbar')
async function setCode(page, code) {
  await page.evaluate(() => document.querySelector('.pg-editor .cm-content').focus())
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.keyboard.insertText(code)
}
const waitStatus = (page, re, timeout = 30000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.pg-statusbar')?.textContent || ''), re.source, { timeout })

// ── 鍵盤：語言分頁（方向鍵、Home、End），焦點留在分頁上 ──
{
  const page = await newPage()
  await page.goto(base + '#/playground?lang=js', { waitUntil: 'networkidle' })
  await page.focus('#pg-tab-js')
  const seen = []
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'Home', 'End']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(80)
    seen.push(await page.$eval('[id^=pg-tab-][aria-selected=true]', (e) => e.id.replace('pg-tab-', '')))
  }
  t('arrow keys switch all five languages', seen.join(',') === 'html,vue,python,python,vue', seen.join(','))
  t('focus follows the selected tab', (await active(page)).id === 'pg-tab-vue')
  t('only the selected tab is in the tab order', (await page.$$eval('[id^=pg-tab-]', (es) => es.filter((e) => e.tabIndex === 0).map((e) => e.id))).join() === 'pg-tab-vue')
  t('tabpanel is labelled by the selected tab', (await page.getAttribute('#pg-panel', 'aria-labelledby')) === 'pg-tab-vue')
  t('language switch shows in the status bar', /已切到 Vue/.test(await status(page)))
  t('url keeps the language for reload', page.url().includes('lang=vue'))
  await page.context().close()
}

// ── 鍵盤：編輯器 Tab 縮排、Esc 後 Tab 離開；Ctrl+Enter 執行；跳到結果；錯誤念出來 ──
{
  const page = await newPage()
  await page.goto(base + '#/playground?lang=js', { waitUntil: 'networkidle' })
  t('editor has a label and the Esc hint', (await page.getAttribute('.pg-editor .cm-content', 'aria-label')) === 'JavaScript 程式碼' && (await page.getAttribute('.pg-editor .cm-content', 'aria-describedby')) === 'pg-editor-keys' && /Esc/.test(await page.textContent('#pg-editor-keys')))
  await setCode(page, 'console.log("hi")')
  await page.keyboard.press('Tab')
  t('Tab inside the editor indents and keeps focus', (await active(page)).inEditor)
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab')
  t('Esc then Tab leaves the editor', !(await active(page)).inEditor, JSON.stringify(await active(page)))
  await setCode(page, 'console.log("hi")')
  await page.keyboard.press('Control+Enter')
  await waitStatus(page, /執行完成/)
  t('Ctrl+Enter runs from the editor', (await page.textContent('.pg-output')).includes('hi'))
  await page.focus('.pg-toolbar button:has-text("跳到結果")')
  await page.keyboard.press('Enter')
  t('跳到結果 moves focus to the output', (await active(page)).cls.includes('pg-output'))
  const region = await page.$('.pg-sr[aria-live=assertive]')
  await page.evaluate((el) => { el.dataset.mark = '1' }, region)
  await setCode(page, 'throw new Error("boom-1")')
  await page.keyboard.press('Control+Enter')
  await page.waitForFunction(() => /boom-1/.test(document.querySelector('.pg-sr[aria-live=assertive]')?.textContent || ''), null, { timeout: 15000 }).catch(() => {})
  t('new error is announced in the live region', /boom-1/.test(await page.textContent('.pg-sr[aria-live=assertive]')))
  await setCode(page, 'throw new Error("boom-2")')
  await page.click('.pg-toolbar button:has-text("執行")')
  await page.waitForFunction(() => /boom-2/.test(document.querySelector('.pg-sr[aria-live=assertive]')?.textContent || ''), null, { timeout: 15000 }).catch(() => {})
  t('live region is the same node across runs', (await page.$eval('.pg-sr[aria-live=assertive]', (e) => e.dataset.mark)) === '1' && /boom-2/.test(await page.textContent('.pg-sr[aria-live=assertive]')))
  t('status bar shows the error', /執行出錯/.test(await status(page)) && (await page.getAttribute('.pg-statusbar', 'role')) === 'status')

  // ── 範例：鍵盤選、蓋掉草稿時可復原、重設成範例 ──
  await setCode(page, '// 我的草稿\nconsole.log(1)')
  await page.focus('.pg-sample select')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  t('keyboard picks a sample', (await editorText(page)).includes('fakeDb'), (await editorText(page)).slice(0, 40))
  t('sample menu says JS needs 執行', /執行/.test(await page.textContent('#pg-sample-note')))
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  t('arrow again goes to the next sample', (await editorText(page)).includes('class LRU'))
  t('undo offered after overwriting a draft', (await page.$$('.pg-undo')).length === 1)
  await page.focus('.pg-undo button'); await page.keyboard.press('Enter')
  t('undo restores the original draft (not the previous sample)', (await editorText(page)).includes('我的草稿'))
  t('reset-to-sample appears for a modified draft', (await page.$$('.pg-toolbar button:has-text("重設成範例")')).length === 1)
  await page.click('.pg-toolbar button:has-text("重設成範例")')
  t('reset-to-sample loads the sample and offers undo', (await editorText(page)).includes('class LRU') && (await page.$$('.pg-undo')).length === 1)
  await page.click('.pg-undo button')

  // ── 草稿與輸出：重新整理、切語言再回來 ──
  await setCode(page, 'console.log("kept-output")')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.pg-output')
  t('draft survives reload', (await editorText(page)).includes('kept-output'))
  t('output survives reload', (await page.textContent('.pg-output')).includes('kept-output') && /已載回上次的程式與輸出/.test(await status(page)))
  await page.click('#pg-tab-python'); await page.click('#pg-tab-js')
  t('draft and output survive a language switch', (await editorText(page)).includes('kept-output') && (await page.textContent('.pg-output')).includes('kept-output'))
  await page.context().close()
}

// ── localStorage 不能用：照常載入與執行 ──
{
  const page = await newPage({}, () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } }) })
  await page.goto(base + '#/playground?lang=js', { waitUntil: 'networkidle' })
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/)
  t('works without localStorage', (await page.textContent('.pg-output')).includes('user1'))
  await page.selectOption('.pg-sample select', '1')
  t('samples load without localStorage', (await editorText(page)).includes('class LRU'))
  await page.context().close()
}

// ── SQL：影響列數只標在 DML；交易範例同時看得到扣到幾列與最終庫存 ──
{
  const page = await newPage()
  await page.goto(base + '#/playground?lang=sql', { waitUntil: 'networkidle' })
  await page.waitForSelector('.rt-status.ready', { timeout: 120000 })
  await page.selectOption('.pg-sample select', '4')
  t('SQL sample menu says to press 執行', /執行/.test(await page.textContent('#pg-sample-note')))
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/, 60000)
  const txt = await page.textContent('.pg-output')
  t('transaction sample shows 0 rows deducted and final stock', /第 2 句 · 0 列/.test(txt) && /第 3 句 · 1 列/.test(txt) && /耳機0/.test(txt), txt.slice(0, 300))
  t('ROLLBACK does not claim affected rows', /第 5 句：執行完成。/.test(txt))
  await page.selectOption('.pg-sample select', '3')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/, 60000)
  const ex = await page.textContent('.pg-output')
  t('EXPLAIN sample: index chosen after the larger seed', /Index Scan on idx_orders_user|Index Scan using idx_orders_user/.test(ex))
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/, 60000)
  t('EXPLAIN sample reruns (ROLLBACK restored the index state)', !/already exists/.test(await page.textContent('.pg-output')))
  await setCode(page, 'BEGIN;\nSELECT 1/0;')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行出錯/, 30000)
  await setCode(page, 'SELECT count(*) AS n FROM orders;')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/, 30000)
  t('an error inside a transaction does not break the next run', (await page.textContent('.pg-output')).includes('6'))
  await page.context().close()
}

// ── HTML、Vue：選範例就建立預覽、預覽就緒的狀態、固定情境重播 ──
{
  const page = await newPage()
  const frame = () => page.frames().find((f) => f.url() === 'about:srcdoc')
  await page.goto(base + '#/playground?lang=vue', { waitUntil: 'networkidle' })
  t('Vue sample menu says it builds the preview', /預覽/.test(await page.textContent('#pg-sample-note')))
  await page.selectOption('.pg-sample select', '1')
  await waitStatus(page, /預覽就緒/)
  t('choosing a Vue sample builds the preview', (await page.$$('.fp iframe.sbx-frame')).length === 1)
  const appText = async () => { await page.waitForTimeout(150); return (await frame()?.textContent('#app').catch(() => '')) || '' }
  await page.click('.pg-scen button:has-text("空資料")'); await page.waitForTimeout(1200)
  t('scenario 空資料 → empty state', /沒有門診/.test(await appText()))
  t('scenario disables the error-rate slider', await page.isDisabled('.pg-api label:nth-of-type(2) input'))
  await page.click('.pg-scen button:has-text("失敗")'); await page.waitForTimeout(1200)
  t('scenario 失敗 → error state', /讀取失敗/.test(await appText()))
  await frame().click('button:has-text("重試")'); await page.waitForTimeout(900)
  t('retry after 失敗 succeeds', /剩 \d+ 位/.test(await appText()))
  await page.click('.pg-scen button:has-text("失敗")'); await page.waitForTimeout(1200)
  t('replaying 失敗 gives the same first response', /讀取失敗/.test(await appText()))
  await page.click('.pg-scen button:has-text("亂序")'); await page.waitForTimeout(1500)
  t('scenario 亂序 → list reversed', /剩 30 位.*剩 2 位/.test(await appText()))
  await page.click('.pg-scen button:has-text("成功")'); await page.waitForTimeout(1200)
  t('scenario 成功 → list', /剩 2 位.*剩 30 位/.test(await appText()))
  t('scenario buttons expose pressed state', (await page.getAttribute('.pg-scen button:has-text("成功")', 'aria-pressed')) === 'true')
  await page.selectOption('.pg-sample select', '3')
  await waitStatus(page, /預覽就緒/)
  await page.waitForTimeout(300)
  await frame().click('button')
  await waitStatus(page, /警告/, 5000).catch(() => {})
  t('props sample: Console shows the readonly warning', /Attempting to mutate prop "count"/.test(await page.textContent('.fp-console')))
  await page.click('#pg-tab-html')
  await page.selectOption('.pg-sample select', '1')
  await waitStatus(page, /預覽就緒/)
  await page.click('.pg-scen button:has-text("失敗")'); await page.waitForTimeout(1200)
  const ht = async () => (await frame()?.textContent('body').catch(() => '')) || ''
  t('HTML fetch sample: 失敗 then retry recovers', /讀取失敗/.test(await ht()) && (await frame().click('#retry').then(() => page.waitForTimeout(900)).then(ht).then((x) => /剩 \d+ 位/.test(x))))
  await setCode(page, '<script>null.x</script>')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /錯誤/)
  await page.waitForFunction(() => /Console 錯誤/.test(document.querySelector('.pg-sr[aria-live=assertive]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {})
  t('preview error is announced', /Console 錯誤：TypeError/.test(await page.textContent('.pg-sr[aria-live=assertive]')))
  await page.context().close()
}

// ── 390px：輸出與比較表不讓整頁橫向捲動 ──
{
  const page = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.goto(base + '#/playground?lang=sql', { waitUntil: 'networkidle' })
  await page.waitForSelector('.rt-status.ready', { timeout: 120000 })
  await setCode(page, 'SELECT u.*, o.*, u.email || \' / \' || u.city AS very_long_combined_column_name FROM users u LEFT JOIN orders o ON o.user_id = u.id;')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/, 60000)
  t('390px: wide SQL result does not scroll the page', (await overflow()) <= 0, `+${await overflow()}px`)
  await page.selectOption('.pg-sample select', '3')
  await page.click('.pg-toolbar button:has-text("執行")')
  await waitStatus(page, /執行完成/, 60000)
  t('390px: EXPLAIN output does not scroll the page', (await overflow()) <= 0, `+${await overflow()}px`)
  for (const lang of ['vue', 'html']) {
    await page.click(`#pg-tab-${lang}`)
    await page.selectOption('.pg-sample select', '1')
    await waitStatus(page, /預覽就緒/)
    await page.click('.fp-tabs button:has-text("網路")')
    t(`390px: ${lang} preview, scenarios and network table fit`, (await overflow()) <= 0, `+${await overflow()}px`)
  }
  await page.context().close()
}

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)
