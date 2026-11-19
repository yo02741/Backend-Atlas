/* 前端沙箱自架的 vendor 檔：版本與檔名。scripts/copy-vendor.mjs 依這裡複製到 public/vendor/<套件>@<版本>/，
   src/runtime/frame.js 依這裡組網址與 import map（key 就是 import 的名稱）；validate 檢查版本和 package.json、node_modules 一致。
   Node 可以直接 import。 */
export const VERSIONS = { vue: '3.5.45', pinia: '4.1.0', 'vue-router': '5.5.1' }

// vue：dev 版有模板編譯器與 [Vue warn] 開發警告（題目與 Playground 用這個）；prod 版也有編譯器，但沒有警告。
// pinia、vue-router 只用 prod 版：只 import vue。非 prod 版另外 import @vue/devtools-api 與 nostics，import map 裡沒有它們。
export const VENDOR_FILES = {
  vue: { dev: 'dist/vue.esm-browser.js', prod: 'dist/vue.esm-browser.prod.js' },
  pinia: { prod: 'dist/pinia.esm-browser.prod.js' },
  'vue-router': { prod: 'dist/vue-router.esm-browser.prod.js' },
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
