// 把前端沙箱用的 Vue、Pinia、Vue Router、Element Plus、@tailwindcss/browser 從 node_modules 複製到 public/vendor/<套件>@<版本>/（自架，不依賴 CDN）。
// 套件與檔案列在 src/runtime/versions.js（Element Plus 另有語系檔與樣式檔：VENDOR_SUBMODULES、VENDOR_STYLES；pinia、vue-router 只有 prod 檔；@tailwindcss/browser 的 dev、prod 是同一個檔）。只複製 dist 檔，外殼不 import 它們；
// iframe 經 import map 載入，@tailwindcss/browser 以 classic script 載入（src/runtime/frame.js）。public/vendor 已 gitignore。
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSIONS, VENDOR_FILES, VENDOR_SUBMODULES, VENDOR_STYLES, vendorPath, vendorFilePath } from '../src/runtime/versions.js'

const here = dirname(fileURLToPath(import.meta.url))
let total = 0
const copied = new Set()
for (const [pkg, version] of Object.entries(VERSIONS)) {
  const pkgJson = resolve(here, '../node_modules', pkg, 'package.json')
  if (!existsSync(pkgJson)) { console.error(`缺少 node_modules/${pkg}：先 npm ci`); process.exit(1) }
  const installed = JSON.parse(readFileSync(pkgJson, 'utf8')).version
  if (installed !== version) { console.error(`node_modules/${pkg} 是 ${installed}，src/runtime/versions.js 寫 ${version}：兩者要一致`); process.exit(1) }
  // 每個 build 的主檔，加上同一個套件的其他 module 檔（語系）與樣式檔
  const files = [
    ...Object.keys(VENDOR_FILES[pkg]).map((build) => [VENDOR_FILES[pkg][build], vendorPath(pkg, build)]),
    ...Object.values(VENDOR_SUBMODULES[pkg] || {}).map((f) => [f, vendorFilePath(pkg, f)]),
    ...(VENDOR_STYLES[pkg] ? [[VENDOR_STYLES[pkg], vendorFilePath(pkg, VENDOR_STYLES[pkg])]] : []),
  ]
  for (const [file, path] of files) {
    const from = resolve(here, '../node_modules', pkg, file)
    const to = resolve(here, '../public', path)
    if (copied.has(to)) continue   // dev 與 prod 指同一個檔
    copied.add(to)
    if (!existsSync(from)) { console.error(`缺少 ${from}`); process.exit(1) }
    mkdirSync(dirname(to), { recursive: true })
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to)
    total += statSync(to).size
  }
}
console.log(`vendor → public/vendor (${Object.entries(VERSIONS).map(([p, v]) => `${p}@${v}`).join(', ')}, ${(total / 1024).toFixed(0)} KB)`)
