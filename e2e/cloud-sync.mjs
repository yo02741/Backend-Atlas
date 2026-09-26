// 登入與進度同步：跑在 Firebase Emulator（demo-backend-atlas，不連任何真實 Google 服務）。
//   ① firestore.rules：本人才能讀寫、文件形狀不對就拒絕
//   ② 兩台「裝置」（兩個獨立的瀏覽器 context）登入同一帳號：首次登入合併不丟資料、取消勾選會傳到另一台、
//      離線改動連線後補傳、關分頁前的改動下次開站補傳、登出 / 登出並清除 / 刪除雲端進度、session 還原、沒登入不下載 SDK
// 用法：npm run e2e:cloud（build --mode e2e → 起 emulator → 本腳本自己開 preview :4174）
//   已經有 emulator 與 preview 在跑時：E2E_CLOUD_BASE=http://localhost:4174/ node e2e/cloud-sync.mjs
// 這個環境連不到 apis.google.com，所以瀏覽器端的登入走 Emulator 的假 id token（見 src/cloud/firebase.js），不測真正的 Google 彈出視窗。
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore/lite'
setLogLevel('silent')   // 被規則拒絕是預期結果，不要讓 SDK 把每次拒絕都印出來

const PROJECT = 'demo-backend-atlas'
const FS = 'http://127.0.0.1:8080'
const AUTH = 'http://127.0.0.1:9099'
let failed = 0
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : extra}`) }
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v
// 進度比較：done 是集合（合併後順序不固定），其餘照結構比
const canon = (p) => (p && Array.isArray(p.done) ? { ...p, done: [...p.done].sort() } : p)
const same = (a, b) => JSON.stringify(sortDeep(canon(a))) === JSON.stringify(sortDeep(canon(b)))

// 清空 emulator
await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })

/* ================= ① security rules ================= */
let appN = 0
async function client(sub) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, `c${appN++}`)
  const auth = getAuth(app)
  connectAuthEmulator(auth, AUTH, { disableWarnings: true })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  let uid = null
  if (sub) uid = (await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true })))).user.uid
  return { db, uid, ref: (u) => doc(db, 'users', u) }
}
const denied = async (p) => { try { await p; return false } catch (e) { return e.code === 'permission-denied' } }
const allowed = async (p) => { try { await p; return true } catch (e) { console.log('   ', e.code, e.message.slice(0, 120)); return false } }
const good = { done: ['sql-joins'], checks: { 'sql-joins': [true, false] }, exercises: { x: 'pass' }, quizzes: {}, scenarios: {}, rationales: { 'cache:d1': '理由' } }

const u1 = await client('rules-user-1')
const u2 = await client('rules-user-2')
const anon = await client(null)
t('rules: owner can create a valid document', await allowed(setDoc(u1.ref(u1.uid), { v: 1, progress: good, updatedAt: serverTimestamp() })))
t('rules: owner can read it', await allowed(getDoc(u1.ref(u1.uid))))
t('rules: another user cannot read it', await denied(getDoc(u2.ref(u1.uid))))
t('rules: another user cannot overwrite it', await denied(setDoc(u2.ref(u1.uid), { v: 1, progress: good, updatedAt: serverTimestamp() })))
t('rules: another user cannot delete it', await denied(deleteDoc(u2.ref(u1.uid))))
t('rules: signed-out client cannot read', await denied(getDoc(anon.ref(u1.uid))))
t('rules: signed-out client cannot write', await denied(setDoc(anon.ref('someone'), { v: 1, progress: good, updatedAt: serverTimestamp() })))
t('rules: extra top-level field rejected', await denied(setDoc(u1.ref(u1.uid), { v: 1, progress: good, updatedAt: serverTimestamp(), email: 'x@y' })))
t('rules: unknown progress key rejected', await denied(setDoc(u1.ref(u1.uid), { v: 1, progress: { ...good, admin: true }, updatedAt: serverTimestamp() })))
t('rules: client-supplied timestamp rejected', await denied(setDoc(u1.ref(u1.uid), { v: 1, progress: good, updatedAt: new Date(0) })))
t('rules: wrong schema version rejected', await denied(setDoc(u1.ref(u1.uid), { v: 2, progress: good, updatedAt: serverTimestamp() })))
t('rules: done must be a list', await denied(setDoc(u1.ref(u1.uid), { v: 1, progress: { ...good, done: 'sql-joins' }, updatedAt: serverTimestamp() })))
t('rules: other collections are closed', await denied(setDoc(doc(u1.db, 'admin', 'x'), { a: 1 })))
t('rules: owner can delete', await allowed(deleteDoc(u1.ref(u1.uid))))

/* ================= ② 瀏覽器：兩台裝置同一個帳號 ================= */
let preview = null
let base = process.env.E2E_CLOUD_BASE
if (!base) {
  base = 'http://localhost:4174/'
  preview = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', '4174', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { try { await fetch(base); break } catch { await new Promise((r) => setTimeout(r, 500)) } }
}

// 雲端文件（emulator 的 owner token 繞過規則直接讀）
async function remote(uid) {
  const r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`, { headers: { Authorization: 'Bearer owner' } })
  if (r.status === 404) return null
  const j = await r.json()
  return decode({ mapValue: { fields: j.fields } }).progress
}
function decode(v) {
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]))
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode)
  if ('stringValue' in v) return v.stringValue
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('timestampValue' in v) return v.timestampValue
  return null
}

const browser = await chromium.launch()
const errs = []
// 故意斷網的區段裡，網路類錯誤是預期的（資源載入失敗、Firestore RPC 失敗、懶載入的 lab chunk 抓不到）
let offlineWindow = false
const expectedOffline = /ERR_INTERNET_DISCONNECTED|Failed to fetch dynamically imported module|RPC_ERROR|Failed to fetch/
const alice = { sub: 'alice-google-sub', email: 'alice@example.com', name: 'Alice Chen' }
async function device(tag, account, width = 1200) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 } })
  await ctx.addInitScript((a) => { window.__atlasEmulatorAccount = a }, account)
  const chunks = new Set()
  ctx.on('response', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js')) chunks.add(u.split('/').pop()) })
  const open = async (hash = '') => {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errs.push(`[${tag}] PAGEERROR ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`))
    page.on('console', (m) => {
      if (m.type() !== 'error' || (offlineWindow && expectedOffline.test(m.text()))) return
      errs.push(`[${tag}] CONSOLE ${m.text().slice(0, 200)}`)
    })
    await page.goto(base + hash, { waitUntil: 'networkidle' })
    return page
  }
  return { ctx, chunks, open, tag }
}
const progressOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('atlas-progress-v1') || 'null'))
const metaOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('atlas-sync-v1') || '{}'))
const seed = (page, p) => page.evaluate((p) => localStorage.setItem('atlas-progress-v1', JSON.stringify(p)), p)
const waitSynced = (page) => page.waitForSelector('.account[data-status="signed-in"][data-sync="synced"]', { timeout: 15000 })
// 改動之後：先等進入「等待上傳 / 同步中」，再等回到「已同步」（不然會抓到改動前的已同步）
async function waitPushed(page) {
  await page.waitForSelector('.account[data-sync="pending"], .account[data-sync="syncing"]', { timeout: 3000 })
  await waitSynced(page)
}
async function signInVia(page) {
  await page.click('.account-btn')
  await waitSynced(page)
}
async function menu(page, label) {
  if (!(await page.$('.account-pop'))) await page.click('.account-btn.avatar')
  await page.click(`.account-pop button:has-text("${label}")`)
}
const hasFirebase = (d) => [...d.chunks].some((n) => /^firebase-/.test(n))

// --- 裝置 A：沒登入時不下載 SDK；登入後本機進度整份上傳 ---
const A = await device('A', alice)
let a = await A.open()
t('signed-out visitor sees 登入 button', (await a.textContent('.account-btn')) === '登入')
t('signed-out visitor does not download the Firebase SDK', !hasFirebase(A), [...A.chunks].join(','))
t('footer mentions account sync', /登入後同步到你的帳號/.test(await a.textContent('.colophon')))
const localA = { done: ['sql-joins', 'http-basics'], checks: { 'sql-joins': [true, false, true] }, exercises: { 'sql-joins-1': 'fail' }, quizzes: { jwt: 'pass' }, scenarios: {}, rationales: { 'cache:d1': 'A 的理由' } }
await seed(a, localA)
await a.reload({ waitUntil: 'networkidle' })
await signInVia(a)
const uid = (await metaOf(a)).uid
t('first sign-in links this device (meta.uid set, not dirty)', !!uid && (await metaOf(a)).dirty === false, JSON.stringify(await metaOf(a)))
t('first sign-in uploads local progress as-is', same(await remote(uid), localA), JSON.stringify(await remote(uid)))
t('avatar shows initial when there is no photo', (await a.textContent('.account-btn.avatar')).trim() === 'A')

// --- 裝置 B：同帳號，有自己的本機進度 → 合併，兩邊都不丟 ---
const B = await device('B', alice)
let b = await B.open()
const localB = { done: ['indexes'], checks: { 'sql-joins': [false, true] }, exercises: { 'sql-joins-1': 'pass' }, quizzes: {}, scenarios: { cache: 'fail' }, rationales: { 'cache:d1': 'B 的理由', 'cache:d2': 'B2' } }
await seed(b, localB)
await b.reload({ waitUntil: 'networkidle' })
await signInVia(b)
const merged = {
  done: ['indexes', 'sql-joins', 'http-basics'], checks: { 'sql-joins': [true, true, true] }, exercises: { 'sql-joins-1': 'pass' },
  quizzes: { jwt: 'pass' }, scenarios: { cache: 'fail' }, rationales: { 'cache:d1': 'B 的理由', 'cache:d2': 'B2' },
}
t('second device merges: union of done, OR of checks, pass wins, local rationale kept', same(await progressOf(b), merged), JSON.stringify(await progressOf(b)))
t('merged result uploaded', same(await remote(uid), merged), JSON.stringify(await remote(uid)))

// --- A 立即同步：沒有未上傳改動 → 以雲端為準 ---
await menu(a, '立即同步')
await a.waitForFunction(() => JSON.parse(localStorage.getItem('atlas-progress-v1')).done.includes('indexes'), null, { timeout: 10000 })
t('device A picks up device B progress on sync', same(await progressOf(a), await remote(uid)))

// --- B 取消完成 sql-joins（用畫面上的按鈕）→ 上傳 → A 同步後也取消（不是聯集把它加回來） ---
await b.goto(base + '#/skill/sql-joins', { waitUntil: 'networkidle' })
await b.waitForSelector('.done-btn.is-done')
await b.click('.done-btn')
await waitPushed(b)
t('un-marking on B is uploaded', !(await remote(uid)).done.includes('sql-joins'))
await menu(a, '立即同步')
await a.waitForFunction(() => !JSON.parse(localStorage.getItem('atlas-progress-v1')).done.includes('sql-joins'), null, { timeout: 10000 }).catch(() => {})
t('un-marking propagates to A (remote wins when A has no pending changes)', !(await progressOf(a)).done.includes('sql-joins'))

// --- 決策題理由：登入時標示會同步；打字後上傳 ---
await a.goto(base + '#/scenario/cache', { waitUntil: 'networkidle' })
await a.waitForSelector('.dec-rationale textarea')
t('rationale label says it syncs when signed in', /會同步到你的帳號/.test(await a.textContent('.dec-rationale .kicker')))
const decKey = await a.evaluate(() => document.querySelector('.decisions input[type=radio]')?.name.replace('-', ':'))
await a.fill('.dec-rationale textarea', '同步測試的理由')
await waitSynced(a)
await a.waitForTimeout(300)
t('typed rationale reaches the cloud', Object.values((await remote(uid)).rationales).includes('同步測試的理由'), `${decKey} ${JSON.stringify((await remote(uid)).rationales)}`)

// --- 離線時取消完成：顯示離線；連上網路後補傳，而且合併不會把取消的項目加回來 ---
// （用沒有實驗室與程式題的技能頁：斷網時不會有執行環境在背景下載失敗）
await a.goto(base + '#/skill/testing', { waitUntil: 'networkidle' })
await a.waitForSelector('.done-btn')
await a.click('.done-btn')               // 線上標記完成
await waitPushed(a)
t('marking done online is uploaded', (await remote(uid)).done.includes('testing'))
offlineWindow = true
await A.ctx.setOffline(true)
await a.click('.done-btn')               // 離線取消
await a.waitForSelector('.account[data-sync="offline"]', { timeout: 8000 }).catch(() => {})
t('offline change shows offline state', (await a.getAttribute('.account', 'data-sync')) === 'offline', await a.getAttribute('.account', 'data-sync'))
t('offline change stays marked dirty', (await metaOf(a)).dirty === true)
await A.ctx.setOffline(false)
await waitSynced(a).catch(() => {})
offlineWindow = false
t('offline un-mark uploaded after reconnect (not resurrected by the merge)', !(await remote(uid)).done.includes('testing') && !(await progressOf(a)).done.includes('testing'), JSON.stringify((await remote(uid)).done))
t('dirty flag cleared after upload', (await metaOf(a)).dirty === false)

// --- 改動後馬上關分頁（1.5 秒延遲上傳之前、而且離線送不出去）：下次開站補傳 ---
await a.goto(base + '#/skill/code-quality', { waitUntil: 'networkidle' })
await a.waitForSelector('.done-btn')
offlineWindow = true
await A.ctx.setOffline(true)
await a.click('.done-btn')
await a.close()
await A.ctx.setOffline(false)
offlineWindow = false
a = await A.open()
t('reopen with pending change restores the session without clicking', !!(await a.waitForSelector('.account[data-status="signed-in"]', { timeout: 15000 }).catch(() => null)))
await waitSynced(a)
t('change made just before closing is uploaded on next visit', (await remote(uid)).done.includes('code-quality'), JSON.stringify((await remote(uid)).done))
t('restored session loads the Firebase SDK', hasFirebase(A))

// --- 兩台同時改不同項目：transaction 讓兩邊的改動都留下 ---
await b.goto(base + '#/skill/openapi', { waitUntil: 'networkidle' })
await a.goto(base + '#/skill/resilience', { waitUntil: 'networkidle' })
await Promise.all([a.waitForSelector('.done-btn'), b.waitForSelector('.done-btn')])
await Promise.all([a.click('.done-btn'), b.click('.done-btn')])
await Promise.all([waitPushed(a), waitPushed(b)])
const both = (await remote(uid)).done
t('concurrent edits on two devices are both kept', both.includes('openapi') && both.includes('resilience'), JSON.stringify(both))

// --- 登出：本機進度保留、按鈕回到「登入」、理由欄改回只存本機；重新整理不再下載 SDK ---
await menu(a, '登出')
await a.waitForSelector('.account[data-status="signed-out"]')
t('sign-out keeps local progress', (await progressOf(a)).done.includes('code-quality'))
t('sign-out clears the device link', (await metaOf(a)).uid === '')
await a.close()
const A2 = await device('A2', alice)
await A2.ctx.addCookies([])       // 新 context 模擬登出後的新分頁（SDK 快取不共用，量得到下載）
const a2 = await A2.open('#/scenario/cache')
await a2.waitForSelector('.dec-rationale .kicker')
t('signed-out rationale label says browser-only', /只存在這個瀏覽器/.test(await a2.textContent('.dec-rationale .kicker')))
t('signed-out fresh visit does not download the SDK', !hasFirebase(A2))
await A2.ctx.close()

// --- 登出並清除這台裝置的進度：本機清空、雲端不動 ---
a = await A.open()
await signInVia(a)
const before = await remote(uid)
await menu(a, '登出並清除這台裝置的進度')
await a.waitForSelector('.account[data-status="signed-out"]')
t('sign-out-and-clear empties local progress', same(await progressOf(a), { done: [], checks: {}, exercises: {}, quizzes: {}, scenarios: {}, rationales: {} }), JSON.stringify(await progressOf(a)))
t('sign-out-and-clear leaves the cloud copy', same(await remote(uid), before))

// --- 刪除雲端進度（B），另一台已連結的裝置（A）下次同步時也登出、本機保留 ---
await signInVia(a)                        // A 重新登入：本機是空的 → 拿回雲端那份
t('signing in on a cleared device restores progress from the cloud', same(await progressOf(a), before))
await b.goto(base, { waitUntil: 'networkidle' })
await waitSynced(b)
const bLocal = await progressOf(b)
await b.click('.account-btn.avatar')
await b.click('.account-pop button:has-text("刪除雲端進度")')
t('delete asks for a second click', !!(await b.$('.account-pop button:has-text("再按一次")')))
await b.click('.account-pop button:has-text("再按一次")')
await b.waitForSelector('.account[data-status="signed-out"]')
t('cloud document deleted', (await remote(uid)) === null)
t('device B keeps its local progress after deleting cloud copy', same(await progressOf(b), bLocal))
t('device B shows a notice', /雲端進度已刪除/.test(await b.textContent('.account-msg')))
await menu(a, '立即同步')
await a.waitForSelector('.account[data-status="signed-out"]', { timeout: 10000 }).catch(() => {})
t('device A signs out when the cloud copy was deleted elsewhere', (await a.getAttribute('.account', 'data-status')) === 'signed-out')
t('device A keeps local progress and explains why', same(await progressOf(a), before) && /其他裝置刪除/.test(await a.textContent('.account-msg')))
t('nothing re-uploaded after delete', (await remote(uid)) === null)

// --- 手機寬度：頂端列不溢出，選單在畫面內 ---
const M = await device('M', alice, 390)
const m = await M.open()
await signInVia(m)
await m.click('.account-btn.avatar')
const box = await m.$eval('.account-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right } })
t('mobile: account menu fits the screen', box.l >= 0 && box.r <= 390, JSON.stringify(box))
t('mobile: no horizontal overflow', await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
if (process.env.E2E_SHOTS) await m.screenshot({ path: 'e2e/shots/cloud-mobile-menu.png' })

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
preview?.kill()
process.exit(failed || errs.length ? 1 : 0)
