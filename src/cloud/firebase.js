/* Firebase SDK 只在這支檔案 import，整支懶載入：沒登入過的訪客不會下載它。
   Firestore 用 lite 版（REST，不含離線快取與即時監聽）：進度只需要登入時拉一次、改動時寫回，體積小很多。 */
import { initializeApp } from 'firebase/app'
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut as fbSignOut, onAuthStateChanged, connectAuthEmulator,
} from 'firebase/auth'
import { getFirestore, doc, runTransaction, deleteDoc, serverTimestamp, connectFirestoreEmulator } from 'firebase/firestore/lite'
import { firebaseConfig, emulatorHost } from './config.js'

const app = initializeApp(firebaseConfig)
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
})
const db = getFirestore(app)
if (emulatorHost) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, emulatorHost, 8080)
}

/* 只取畫面要用的欄位；雲端文件不存姓名、email，只以 uid 當文件 id */
export function watchUser(cb) {
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null))
}

/* 用彈出視窗，不用 redirect：redirect 在擋第三方儲存的瀏覽器（Safari、新版 Chrome）上，authDomain 與站台不同網域時會失敗 */
export async function signIn() {
  if (emulatorHost && window.__atlasEmulatorAccount) {
    // e2e：彈出視窗要從 apis.google.com 載 gapi，測試環境不一定連得到；Emulator 接受假的 Google id token，直接用它登入。
    // 正式 build 沒有 emulatorHost，這段會在 build 時被剪掉。
    const a = window.__atlasEmulatorAccount
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: a.sub, email: a.email, email_verified: true, name: a.name })))
    return
  }
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithPopup(auth, provider)
}
export const signOut = () => fbSignOut(auth)

const ref = (uid) => doc(db, 'users', uid)

/* 讀雲端 → decide(remote) 算出要寫的內容 → 寫回，整段是一個 transaction：
   兩台裝置同時上傳時，後到的會重跑 decide（拿到對方剛寫的版本再合併），不會互相蓋掉。
   decide 回傳 { write, next }：write 為 true 才寫入 next；回傳值原樣交回呼叫端。 */
export function sync(uid, decide) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref(uid))
    const d = decide(snap.exists() ? snap.data().progress ?? null : null)
    if (d.write) tx.set(ref(uid), { v: 1, progress: d.next, updatedAt: serverTimestamp() })
    return d
  })
}
export async function remove(uid) {
  await deleteDoc(ref(uid))
}
