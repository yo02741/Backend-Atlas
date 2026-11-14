// 複習頁 UI 端到端：固定 seed 抽題可重現；作答、交卷、分數與解析；錯題記進 localStorage、答對後移除；
// 「上次答錯的題」「已完成的課」「選領域」各範圍；localStorage 壞掉或被停用時頁面照常運作；入口連結；390px 不橫向溢出。
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const { DOMAINS } = await import(fileURLToPath(new URL('../src/content/roadmap.js', import.meta.url)))
const domainOf = (skillId) => DOMAINS.find((d) => d.skills.some((s) => s.id === skillId))?.id
mkdirSync('e2e/shots', { recursive: true })
const browser = await chromium.launch()
const errs = []
let failed = 0
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`) }

async function open(hash, { init, width = 1200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`CONSOLE(${m.type()}) ` + m.text().slice(0, 200)) })
  await page.goto(base + hash, { waitUntil: 'networkidle' })
  return page
}
const qids = (page) => page.$$eval('.quiz-q', (es) => es.map((e) => e.dataset.qid))
const stored = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('atlas-review-v1')) } catch { return 'THROWS' } })
const scopeInput = (s) => `.rv-scope input[value="${s}"]`
async function start(page) {
  await page.click('.rv-start-btn')
  await page.waitForSelector('.rv-quiz .quiz-q')
  return qids(page)
}
// pick(qid, i) 回傳要選第幾個選項
async function answer(page, pick) {
  const ids = await qids(page)
  for (const [i, id] of ids.entries()) await page.click(`.quiz-q:nth-child(${i + 1}) .quiz-opt:nth-child(${pick(id, i) + 1}) input`)
}
async function submit(page) {
  await page.click('.rv-quiz .btn.submit')
  await page.waitForSelector('.rv-result')
  return page.$$eval('.quiz-q', (qs) => qs.map((q) => ({
    id: q.dataset.qid, right: q.classList.contains('right'),
    correct: [...q.querySelectorAll('.quiz-opt')].findIndex((o) => o.classList.contains('correct')),
    href: q.querySelector('.rv-lesson a')?.getAttribute('href'),
  })))
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const sameSet = (a, b) => same([...a].sort(), [...b].sort())

/* ── 設定畫面 ── */
let page = await open('#/review?seed=42')
await page.waitForSelector('.rv-setup')
t('page title', await page.title() === '複習 · Backend Atlas', await page.title())
t('nav still has 7 links, none to review', await page.$$eval('.topnav-links a', (as) => as.length === 7 && !as.some((a) => a.getAttribute('href').includes('review'))))
t('「已完成的課」disabled without finished lessons, with a reason', await page.$eval(scopeInput('done'), (i) => i.disabled) && (await page.textContent('.rv-scope:has(input[value="done"])')).includes('還沒有完成的課'))
t('「上次答錯的題」disabled without records, with a reason', await page.$eval(scopeInput('wrong'), (i) => i.disabled) && (await page.textContent('.rv-scope:has(input[value="wrong"])')).includes('沒有答錯紀錄'))
t('default scope is 全部', await page.$eval(scopeInput('all'), (i) => i.checked))
t('local-only note shown', (await page.textContent('.rv-setup .rv-note')).includes('只存在這個瀏覽器'))
t('count options are 10 / 20, default 10', same(await page.$$eval('.rv-count input', (is) => is.map((i) => `${i.value}:${i.checked}`)), ['10:true', '20:false']))

/* ── 固定 seed 可重現 ── */
const first = await start(page)
t('10 questions drawn, no duplicates', first.length === 10 && new Set(first).size === 10, first.join(','))
t('section carries the seed', await page.$eval('.rv-quiz', (e) => e.dataset.seed) === '42')
t('submit disabled before answering', await page.$eval('.rv-quiz .btn.submit', (b) => b.disabled))
{
  const p2 = await open('#/review?seed=42')
  t('same seed → same questions in the same order', same(await start(p2), first))
  await p2.context().close()
  const p3 = await open('#/review?seed=43')
  t('different seed → different draw', !same(await start(p3), first))
  await p3.context().close()
  const p4 = await open('#/review'), p5 = await open('#/review')
  await start(p4); await start(p5)
  const [s4, s5] = [await p4.$eval('.rv-quiz', (e) => e.dataset.seed), await p5.$eval('.rv-quiz', (e) => e.dataset.seed)]
  t('no seed in URL → random seed each visit', /^\d+$/.test(s4) && s4 !== s5, `${s4} vs ${s5}`)
  await p4.context().close(); await p5.context().close()
}

/* ── 作答（鍵盤）→ 交卷 → 分數、解析、回到這一課、依領域小結 ── */
await page.focus('.quiz-q:nth-child(1) .quiz-opt:nth-child(1) input')
await page.keyboard.press('Space')
t('radio answers by keyboard (Space)', await page.$eval('.quiz-q:nth-child(1) .quiz-opt:nth-child(1) input', (i) => i.checked))
await page.keyboard.press('ArrowDown')
t('arrow key moves within the radio group', await page.$eval('.quiz-q:nth-child(1) .quiz-opt:nth-child(2) input', (i) => i.checked))
await answer(page, () => 0)   // 全部選 A
t('submit enabled once all answered', !(await page.$eval('.rv-quiz .btn.submit', (b) => b.disabled)))
const r1 = await submit(page)
const wrong1 = r1.filter((r) => !r.right).map((r) => r.id)
const rightN = r1.length - wrong1.length
t('explanations shown for every question', (await page.$$('.quiz-explain')).length === 10)
t('correct options marked', r1.every((r) => r.correct >= 0))
t('answering all A gets some wrong (needed for the rest of this script)', wrong1.length >= 2, `wrong=${wrong1.length}`)
t('score matches per-question marks', (await page.textContent('.rv-score-num')).replace(/\s/g, '') === `${rightN}/10`, await page.textContent('.rv-score-num'))
t('radios locked after submit', await page.$$eval('.quiz-q input', (is) => is.every((i) => i.disabled)))
t('each question links back to its lesson', r1.every((r) => r.href === `#/skill/${r.id.split('#')[0]}`))
const rows = await page.$$eval('.rv-domains li', (ls) => ls.map((l) => ({ name: l.querySelector('.rv-dname').textContent, num: l.querySelector('.rv-dnum').textContent })))
const byDomain = {}
for (const r of r1) { const d = DOMAINS.find((x) => x.id === domainOf(r.id.split('#')[0])).title; (byDomain[d] ||= [0, 0])[1]++; if (r.right) byDomain[d][0]++ }
t('per-domain summary matches', rows.length === Object.keys(byDomain).length && rows.every((r) => byDomain[r.name] && r.num.replace(/\s/g, '') === byDomain[r.name].join('/')), JSON.stringify(rows))
let rec = await stored(page)
t('wrong questions remembered in localStorage', sameSet(rec?.wrong || [], wrong1), JSON.stringify(rec?.wrong))
t('score saved to history', rec?.history?.length === 1 && rec.history[0].correct === rightN && rec.history[0].total === 10 && rec.history[0].scope === 'all')
t('review does not touch synced progress', await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('atlas-progress-v1') || 'null'); return !p || Object.keys(p.quizzes || {}).length === 0 }))
await page.screenshot({ path: 'e2e/shots/review-result.png' })
const correctOf = Object.fromEntries(r1.map((r) => [r.id, r.correct]))

/* ── 只重做答錯的：第一題故意再錯，其餘答對 ── */
await page.click(`.rv-actions button:has-text("只重做答錯的")`)
await page.waitForFunction(() => !document.querySelector('.rv-result') && document.querySelector('.rv-quiz .quiz-q'))
const redo = await qids(page)
t('retry round holds exactly the wrong questions', sameSet(redo, wrong1), redo.join(','))
const keep = redo[0]
await answer(page, (id) => (id === keep ? (correctOf[id] + 1) % 4 : correctOf[id]))
const r2 = await submit(page)
t('retry scored', r2.filter((r) => r.right).length === redo.length - 1)
rec = await stored(page)
t('answered right → removed from wrong list; still wrong → stays', same(rec.wrong, [keep]), JSON.stringify(rec.wrong))
t('history keeps newest first', rec.history.length === 2 && rec.history[0].scope === 'retry' && rec.history[0].total === redo.length)

/* ── 「上次答錯的題」模式 ── */
await page.click('.rv-actions button:has-text("改範圍")')
await page.waitForSelector('.rv-setup')
t('「上次答錯的題」now enabled, shows 1 題', !(await page.$eval(scopeInput('wrong'), (i) => i.disabled)) && (await page.textContent('.rv-scope:has(input[value="wrong"])')).includes('1 題'))
t('recent scores listed', (await page.$$('.rv-history li')).length === 2)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.rv-setup')
t('wrong list survives reload', !(await page.$eval(scopeInput('wrong'), (i) => i.disabled)))
await page.check(scopeInput('wrong'))
const wr = await start(page)
t('wrong-only round draws the remembered question', same(wr, [keep]), wr.join(','))
await answer(page, (id) => correctOf[id])
const r3 = await submit(page)
t('wrong-only round all correct', r3.every((r) => r.right) && (await page.textContent('.rv-result .ex-verdict')).includes('全對'))
rec = await stored(page)
t('wrong list empty after answering right', rec.wrong.length === 0, JSON.stringify(rec.wrong))
t('再來一輪 disabled when the wrong list is empty', await page.$eval('.rv-actions button:has-text("再來一輪")', (b) => b.disabled))
await page.click('.rv-actions button:has-text("改範圍")')
await page.waitForSelector('.rv-setup')
t('「上次答錯的題」disabled again', await page.$eval(scopeInput('wrong'), (i) => i.disabled))
await page.context().close()

/* ── 已完成的課 ── */
page = await open('#/review?seed=7', { init: () => { localStorage.setItem('atlas-progress-v1', JSON.stringify({ done: ['sql-joins', 'jwt'] })) } })
await page.waitForSelector('.rv-setup')
t('「已完成的課」enabled and preselected when lessons are done', await page.$eval(scopeInput('done'), (i) => !i.disabled && i.checked))
const dn = await start(page)
t('done scope: only questions from finished lessons (2 課 × 3 題, fewer than 10 → all)', dn.length === 6 && dn.every((id) => ['sql-joins', 'jwt'].includes(id.split('#')[0])), dn.join(','))

/* ── 選領域 + 20 題 + 再來一輪 ── */
await page.click('.rv-quiz button:has-text("改範圍")')
await page.waitForSelector('.rv-setup')
await page.check(scopeInput('domains'))
t('domain chips listed', (await page.$$('.rv-domain-pick .chip.tinted')).length === DOMAINS.length, `${DOMAINS.length}`)
t('start disabled until a domain is picked', await page.$eval('.rv-start-btn', (b) => b.disabled))
await page.focus('.rv-domain-pick .chip:has-text("資安")')
await page.keyboard.press('Enter')
t('domain chip toggles by keyboard', await page.$eval('.rv-domain-pick .chip:has-text("資安")', (b) => b.getAttribute('aria-pressed') === 'true'))
await page.click('.rv-domain-pick .chip:has-text("資料儲存")')
await page.check('.rv-count input[value="20"]')
const dm = await start(page)
t('domain scope: 20 unique questions, all from the picked domains', dm.length === 20 && new Set(dm).size === 20 && dm.every((id) => ['security', 'data'].includes(domainOf(id.split('#')[0]))))
await answer(page, () => 1)
await submit(page)
t('summary lists only the picked domains', sameSet(await page.$$eval('.rv-dname', (es) => es.map((e) => e.textContent)), ['資安', '資料儲存']))
await page.click('.rv-actions button:has-text("再來一輪")')
await page.waitForFunction(() => !document.querySelector('.rv-result') && document.querySelector('.rv-quiz .quiz-q'))
const dm2 = await qids(page)
t('再來一輪: same scope and count, new draw', dm2.length === 20 && !same(dm2, dm) && dm2.every((id) => ['security', 'data'].includes(domainOf(id.split('#')[0]))))
await page.context().close()

/* ── localStorage 內容壞掉 ── */
page = await open('#/review?seed=42', { init: () => { localStorage.setItem('atlas-review-v1', '{not json') } })
await page.waitForSelector('.rv-setup')
t('corrupted record → page still works, treated as empty', await page.$eval(scopeInput('wrong'), (i) => i.disabled) && !(await page.$('.rv-history')))
t('corrupted record → same draw as a clean browser', same(await start(page), first))
await page.context().close()

/* ── localStorage 讀寫都丟例外（被停用） ── */
page = await open('#/review?seed=42', { init: () => {
  Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError') }
  Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
} })
await page.waitForSelector('.rv-setup')
t('storage disabled → setup renders', await page.$eval(scopeInput('all'), (i) => i.checked))
t('storage disabled → same draw', same(await start(page), first))
await answer(page, () => 0)
const r4 = await submit(page)
t('storage disabled → grading and explanations still work', r4.length === 10 && (await page.$$('.quiz-explain')).length === 10)
t('storage disabled → nothing persisted', (await stored(page)) === 'THROWS')
await page.click('.rv-actions button:has-text("改範圍")')
await page.waitForSelector('.rv-setup')
t('storage disabled → wrong list still usable within this tab', !(await page.$eval(scopeInput('wrong'), (i) => i.disabled)))
await page.context().close()

/* ── 入口：練習題頁的入口卡、首頁、技能頁；首頁不下載複習頁的 chunk ── */
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
page = await ctx.newPage()
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
const loaded = new Set()
page.on('response', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js')) loaded.add(u.split('/').pop()) })
await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForSelector('.metro')
t('home does not load the Review chunk', ![...loaded].some((n) => /^Review-/.test(n)), [...loaded].join(','))
const homeJs = loaded.size
await page.goto(base + '#/exercises', { waitUntil: 'networkidle' })
await page.waitForSelector('.rv-entry')
t('entry card sits above the exercise filters', await page.evaluate(() => document.querySelector('.rv-entry').getBoundingClientRect().top < document.querySelector('.toolbar').getBoundingClientRect().top))
await page.click('.rv-entry')
await page.waitForSelector('.rv-setup')
t('entry card opens the review page', (await page.evaluate(() => location.hash)) === '#/review')
t('Review chunk loaded on demand', [...loaded].some((n) => /^Review-/.test(n)) && loaded.size > homeJs)
await page.goto(base + '#/skill/sql-joins', { waitUntil: 'networkidle' })
await page.waitForSelector('.quiz')
t('skill page: link under the quiz', await page.$eval('.quiz + .rv-after a', (a) => a.getAttribute('href')) === '#/review')
await ctx.close()

/* ── 390px：設定畫面、作答中、交卷後都不橫向溢出 ── */
page = await open('#/review?seed=42', { width: 390 })
await page.waitForSelector('.rv-setup')
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
await page.check(scopeInput('domains'))
t('390px setup (with domain chips): no horizontal overflow', (await overflow()) <= 0, `${await overflow()}px`)
await page.check(scopeInput('all'))
await page.check('.rv-count input[value="20"]')
await start(page)
t('390px quiz: no horizontal overflow', (await overflow()) <= 0, `${await overflow()}px`)
await answer(page, () => 2)
await submit(page)
t('390px result: no horizontal overflow', (await overflow()) <= 0, `${await overflow()}px`)
await page.context().close()

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)
