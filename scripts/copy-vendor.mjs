// 把前端沙箱用的 Vue 從 node_modules 複製到 public/vendor/vue@<版本>/（自架，不依賴 CDN）。
// 只複製 dist 檔，外殼不 import vue；iframe 經 import map 載入（src/runtime/frame.js）。public/vendor 已 gitignore。
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSIONS, VENDOR_FILES, vendorPath } from '../src/runtime/versions.js'

const here = dirname(fileURLToPath(import.meta.url))
let total = 0
for (const [pkg, version] of Object.entries(VERSIONS)) {
  const pkgJson = resolve(here, '../node_modules', pkg, 'package.json')
  if (!existsSync(pkgJson)) { console.error(`缺少 node_modules/${pkg}：先 npm ci`); process.exit(1) }
  const installed = JSON.parse(readFileSync(pkgJson, 'utf8')).version
  if (installed !== version) { console.error(`node_modules/${pkg} 是 ${installed}，src/runtime/versions.js 寫 ${version}：兩者要一致`); process.exit(1) }
  for (const build of Object.keys(VENDOR_FILES[pkg])) {
    const from = resolve(here, '../node_modules', pkg, VENDOR_FILES[pkg][build])
    const to = resolve(here, '../public', vendorPath(pkg, build))
    if (!existsSync(from)) { console.error(`缺少 ${from}`); process.exit(1) }
    mkdirSync(dirname(to), { recursive: true })
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to)
    total += statSync(to).size
  }
}
console.log(`vendor → public/vendor (${Object.entries(VERSIONS).map(([p, v]) => `${p}@${v}`).join(', ')}, ${(total / 1024).toFixed(0)} KB)`)
