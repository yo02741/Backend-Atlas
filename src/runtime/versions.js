/* 前端沙箱自架的 vendor 檔：版本與檔名。scripts/copy-vendor.mjs 依這裡複製到 public/vendor/<套件>@<版本>/，
   src/runtime/frame.js 依這裡組網址；validate 檢查版本和 package.json、node_modules 一致。Node 可以直接 import。 */
export const VERSIONS = { vue: '3.5.45' }

// dev 版有模板編譯器與 [Vue warn] 開發警告（題目與 Playground 用這個）；prod 版也有編譯器，但沒有警告
export const VENDOR_FILES = {
  vue: { dev: 'dist/vue.esm-browser.js', prod: 'dist/vue.esm-browser.prod.js' },
}

/* 站內相對路徑，例如 vendor/vue@3.5.45/vue.esm-browser.js */
export function vendorPath(pkg, build = 'dev') {
  const file = VENDOR_FILES[pkg][build].split('/').pop()
  return `vendor/${pkg}@${VERSIONS[pkg]}/${file}`
}
