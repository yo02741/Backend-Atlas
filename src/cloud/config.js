/* Firebase 設定：build 時從環境變數帶入（.env.production、CI 的 env，或 e2e 用的 .env.e2e）。
   沒設定＝不顯示登入，全站照舊只存本機。
   這幾個值會出現在前端程式裡，本來就是公開的；資料安全靠 firestore.rules（每個人只能讀寫自己的文件）。
   每個值都寫完整的 import.meta.env.VITE_…，build 時才會被直接替換成字串（沒設定時整段登入程式會被剪掉）。 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}
export const cloudEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId)

/* e2e：指向本機 Firebase Emulator（auth :9099、firestore :8080），正式站不設 */
export const emulatorHost = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || ''
