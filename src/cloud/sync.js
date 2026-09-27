import { useSyncExternalStore } from 'react'
import { cloudEnabled } from './config.js'
import { getProgress, replaceProgress, onLocalChange } from '../progress.js'
import { emptyProgress, mergeProgress3, normalizeProgress, sameProgress } from '../progressData.js'

/* 進度同步（登入是選配，沒登入一切照舊只存本機）。
   每次同步都是同一個動作：在 Firestore transaction 裡讀雲端、跟本機做三方合併（mergeProgress3）、有差才寫回。
   三方合併的 base 是「這台裝置上次同步完成時的內容」（存在 atlas-sync-base-v1）：
   - 本機沒改的項目取雲端 → 別台取消完成、清掉勾選會傳過來；本機改過的項目留本機 → 離線時的取消也不會被加回來。
   - 這台第一次登入某個帳號時沒有 base（當作空的）→ 等於聯集，兩邊做過的事都不丟。
   觸發時機：登入 / 開站還原登入、使用者改動後 1.5 秒、切回分頁、連上網路、按「立即同步」、分頁切到背景（有未上傳改動時）。
   失敗或離線就留著「未上傳」標記（atlas-sync-v1 的 dirty），下次觸發時補上。
   雲端文件在別台裝置被刪掉：這台也登出，本機進度保留。
   atlas-sync-v1 的 uid 有值代表這台上次是登入狀態，開站時才去載 Firebase SDK；沒登入過的訪客完全不會下載 SDK。
   所有網路操作排成一條佇列，不會交錯。 */

const META = 'atlas-sync-v1'
const PUSH_DELAY = 1500   // 改動後等 1.5 秒沒有新改動才上傳（打字時不會每個字送一次）
const REFRESH_GAP = 15000   // 切回分頁時，距上次同步不到 15 秒就不再拉

function readMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META) || '{}')
    return { uid: typeof m.uid === 'string' ? m.uid : '', dirty: Boolean(m.dirty) }
  } catch { return { uid: '', dirty: false } }
}
let meta = readMeta()
function setMeta(patch) {
  meta = { ...meta, ...patch }
  try { localStorage.setItem(META, JSON.stringify(meta)) } catch { /* ignore */ }
}
const BASE = 'atlas-sync-base-v1'
function readBase() {
  try { return normalizeProgress(JSON.parse(localStorage.getItem(BASE) || 'null')) } catch { return emptyProgress() }
}
function writeBase(p) {
  try { if (p) localStorage.setItem(BASE, JSON.stringify(p)); else localStorage.removeItem(BASE) } catch { /* ignore */ }
}
function unlink() {
  clearTimeout(timer)
  setMeta({ uid: '', dirty: false })
  writeBase(null)
}

/* 畫面用的狀態
   status：off（沒設定 Firebase）| signed-out | restoring（還原上次的登入）| signing-in | signed-in
   sync：  idle | pending（有改動等上傳）| syncing | synced | offline | error */
let snap = {
  status: !cloudEnabled ? 'off' : meta.uid ? 'restoring' : 'signed-out',
  user: null, sync: 'idle', syncedAt: 0, error: '', notice: '',
  ready: false,   // SDK 已載入、登入視窗要用的 iframe 已備好：這之後按登入，視窗會在同一個點擊裡開出來
}
const subs = new Set()
function update(patch) {
  snap = { ...snap, ...patch }
  subs.forEach((f) => f())
}
const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
export function useCloud() { return useSyncExternalStore(subscribe, () => snap) }

let fb = null
let loading = null
function loadFirebase() {
  if (!loading) {
    loading = import('./firebase.js').then((m) => { fb = m; m.watchUser(onUser); return m })
    loading.catch(() => { loading = null })
  }
  return loading
}
/* 滑到、聚焦、點「登入」時先載 SDK。Firebase 在手機與 Safari 上初始化時會順便把登入視窗要用的 iframe 備好，
   完成後才回報第一次登入狀態；其他瀏覽器由 warmUp 補做。都好了 ready 才是 true，面板裡的登入按鈕才能按 */
let warming = null
export function preloadCloud() {
  if (!cloudEnabled || warming) return
  if (snap.error && !snap.user) update({ error: '' })
  warming = loadFirebase()
    .then((m) => m.warmUp())
    .then(() => update({ ready: true }))
    .catch(() => { warming = null; update({ error: '連不上登入服務，請確認網路後再試。' }) })
}

let chain = Promise.resolve()
function queue(op) {
  const p = chain.then(op)
  chain = p.catch(() => {})
  return p
}

let version = 0     // 本機改動次數：上傳期間若又有改動，完成時不清掉「未上傳」標記
let timer = 0
let signingIn = false
let lastSync = 0

export function initCloud() {
  if (!cloudEnabled) return
  onLocalChange(() => {
    version++
    if (!meta.uid && !snap.user) return          // 沒登入：只存本機
    setMeta({ dirty: true })
    if (snap.user) schedulePush()
  })
  if (meta.uid) {
    loadFirebase().catch(() => update({ status: 'signed-out', error: '連不上登入服務，這次進度先存在這台裝置，下次開站會再同步。' }))
  }
  document.addEventListener('visibilitychange', () => {
    if (!snap.user) return
    if (document.visibilityState === 'hidden') { if (meta.dirty) syncSoon() }
    else if (meta.dirty || Date.now() - lastSync > REFRESH_GAP) syncSoon()
  })
  window.addEventListener('online', () => { if (snap.user) syncSoon() })
}

function onUser(u) {
  if (u) {
    signingIn = false
    update({ status: 'signed-in', user: u, error: '' })
    syncSoon()
    return
  }
  if (signingIn) return                            // 登入視窗還開著：按鈕先不要切回「登入」
  unlink()
  update({ status: 'signed-out', user: null, sync: 'idle' })
}

function syncSoon() {
  clearTimeout(timer)
  const uid = snap.user?.uid
  if (uid) return queue(() => doSync(uid))
}
function schedulePush() {
  clearTimeout(timer)
  update({ sync: 'pending' })
  timer = setTimeout(syncSoon, PUSH_DELAY)
}

async function doSync(uid) {
  if (!fb || snap.user?.uid !== uid) return
  const linked = meta.uid === uid
  const base = linked ? readBase() : emptyProgress()
  const v = version
  const local = getProgress()
  if (navigator.onLine === false) { update({ sync: 'offline' }); return }   // 離線時 transaction 會一直重試，直接等 online 事件
  update({ sync: 'syncing' })
  try {
    const d = await fb.sync(uid, (remote) => {
      if (linked && !remote) return { deleted: true }          // 這台同步過、雲端卻沒有文件：在別台刪掉了
      const next = mergeProgress3(base, local, remote)
      return { next, write: !remote || !sameProgress(next, remote) }
    })
    if (snap.user?.uid !== uid) return
    if (d.deleted) {
      unlink()
      await fb.signOut()
      update({ notice: '雲端進度已在其他裝置刪除，這台裝置也已登出；本機進度保留。' })
      return
    }
    // 同步期間使用者又改了東西：以同步前的本機為 base，把那些新改動疊在同步結果上
    const now = getProgress()
    const merged = version === v ? d.next : mergeProgress3(local, now, d.next)
    if (!sameProgress(merged, now)) replaceProgress(merged)
    writeBase(d.next)
    setMeta({ uid, dirty: version !== v })
    lastSync = Date.now()
    update({ sync: meta.dirty ? 'pending' : 'synced', syncedAt: lastSync, error: '' })
    if (meta.dirty) schedulePush()
  } catch (e) { fail(e) }
}

function fail(e) {
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || e?.code === 'unavailable'
  update({ sync: offline ? 'offline' : 'error', error: offline ? '' : describe(e) })
}
function describe(e) {
  const code = e?.code || ''
  if (code === 'auth/popup-blocked') return '瀏覽器擋下了登入視窗。再按一次「使用 Google 帳號登入」；還是不行的話，請允許這個網站開彈出視窗。'
  if (code === 'auth/unauthorized-domain') return '這個網址還沒加進 Firebase 的授權網域，暫時無法登入。'
  if (code === 'auth/operation-not-allowed') return 'Firebase 專案還沒啟用 Google 登入。'
  if (code === 'auth/network-request-failed' || code === 'unavailable') return '連不上網路，稍後再試。'
  if (code === 'permission-denied') return '雲端拒絕了這次存取（權限規則）。'
  return `登入或同步失敗（${code || e?.message || '未知錯誤'}）。`
}

/* ===== 給畫面用的動作 ===== */

export async function signIn() {
  if (!cloudEnabled || snap.user) return
  signingIn = true
  update({ status: 'signing-in', error: '', notice: '' })
  try {
    const m = fb || await loadFirebase()
    await m.signIn()                               // 成功後由 onUser 接手
  } catch (e) {
    signingIn = false
    const quiet = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(e?.code)
    update({ status: snap.user ? 'signed-in' : 'signed-out', error: quiet ? '' : describe(e) })
  }
}

/* 登出：先把還沒上傳的改動送出。clearLocal＝一併清掉這台裝置的進度（共用電腦用），此時若還有沒送出的改動就不登出 */
export async function signOut({ clearLocal = false } = {}) {
  if (!fb || !snap.user) return
  if (meta.dirty) await syncSoon()
  if (clearLocal && meta.dirty) {
    update({ error: '還有改動沒上傳到雲端（目前連不上），連上網路後再登出並清除。' })
    return
  }
  await queue(async () => {
    unlink()
    await fb.signOut()
  })
  if (clearLocal) replaceProgress(emptyProgress())
}

/* 刪除雲端進度並登出；這台裝置上的進度保留 */
export function deleteCloudData() {
  const uid = snap.user?.uid
  if (!fb || !uid) return
  return queue(async () => {
    clearTimeout(timer)
    update({ sync: 'syncing' })
    try {
      await fb.remove(uid)
      unlink()
      await fb.signOut()
      update({ notice: '雲端進度已刪除並登出；這台裝置上的進度保留。' })
    } catch (e) { fail(e) }
  })
}

export function syncNow() { return syncSoon() }
export function dismissMessage() { update({ error: '', notice: '' }) }
