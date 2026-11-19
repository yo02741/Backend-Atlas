/* 前端沙箱自架的 vendor 檔：版本與檔名。scripts/copy-vendor.mjs 依這裡複製到 public/vendor/<套件>@<版本>/，
   src/runtime/frame.js 依這裡組網址與 import map（key 就是 import 的名稱）；validate 檢查版本和 package.json、node_modules 一致。
   Node 可以直接 import。 */
export const VERSIONS = { vue: '3.5.45', pinia: '4.1.0', 'vue-router': '5.5.1', 'element-plus': '2.14.8', '@tailwindcss/browser': '4.3.5' }

/* 不經 import map、以 classic script 插進 srcdoc 的套件。@tailwindcss/browser 是 IIFE（dist/index.global.js），
   載入後掃 DOM 的 class 與 <style type="text/tailwindcss">，把產生的 CSS 放進 <head> 的一個 <style>。 */
export const CLASSIC_VENDORS = ['@tailwindcss/browser']
/* 經 import map 載入的 ES module 套件（import 的名稱） */
export const MODULE_VENDORS = Object.keys(VERSIONS).filter((p) => !CLASSIC_VENDORS.includes(p))

// vue：dev 版有模板編譯器與 [Vue warn] 開發警告（題目與 Playground 用這個）；prod 版也有編譯器，但沒有警告。
// pinia、vue-router 只用 prod 版：只 import vue。非 prod 版另外 import @vue/devtools-api 與 nostics，import map 裡沒有它們。
export const VENDOR_FILES = {
  vue: { dev: 'dist/vue.esm-browser.js', prod: 'dist/vue.esm-browser.prod.js' },
  pinia: { prod: 'dist/pinia.esm-browser.prod.js' },
  'vue-router': { prod: 'dist/vue-router.esm-browser.prod.js' },
  // 瀏覽器 ESM 建置（已壓縮，約 900 KB），只 import vue
  'element-plus': { prod: 'dist/index.full.min.mjs' },
  // 只有一個 build（已經壓縮過），dev 與 prod 指同一個檔
  '@tailwindcss/browser': { dev: 'dist/index.global.js', prod: 'dist/index.global.js' },
}

/* 套件另外的 module 檔：{ 套件: { import 的名稱: 檔案 } }。用到套件時一起放進 import map，
   題目照真實專案寫 import zhTw from 'element-plus/es/locale/lang/zh-tw'（npm 套件裡是 es/ 的 .mjs，這裡指到 dist 的單檔版） */
export const VENDOR_SUBMODULES = {
  'element-plus': { 'element-plus/es/locale/lang/zh-tw': 'dist/locale/zh-tw.min.mjs' },
}
/* 套件的樣式檔：用到套件時以 <link rel="stylesheet"> 插進 srcdoc（樣式表不受 CORS 限制，opaque origin 也載得到） */
export const VENDOR_STYLES = {
  'element-plus': 'dist/index.css',
}

/* 套件有這個 build 就用它，沒有（pinia、vue-router 沒有 dev）就用 prod */
export function vendorBuild(pkg, build = 'dev') {
  return VENDOR_FILES[pkg][build] ? build : 'prod'
}

/* 站內相對路徑，例如 vendor/vue@3.5.45/vue.esm-browser.js、vendor/pinia@4.1.0/pinia.esm-browser.prod.js */
export function vendorPath(pkg, build = 'dev') {
  const file = VENDOR_FILES[pkg][vendorBuild(pkg, build)].split('/').pop()
  return `vendor/${pkg}@${VERSIONS[pkg]}/${file}`
}

/* 套件裡某個檔（VENDOR_SUBMODULES、VENDOR_STYLES）的站內相對路徑，例如 vendor/element-plus@2.14.8/index.css */
export function vendorFilePath(pkg, file) {
  return `vendor/${pkg}@${VERSIONS[pkg]}/${file.split('/').pop()}`
}
