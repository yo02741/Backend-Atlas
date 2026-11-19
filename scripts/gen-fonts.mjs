// 從 @fontsource 的 CSS 產生 src/fonts.css：只留 woff2（不帶 woff 備援，build 產物少一半），
// 網址改成相對 node_modules 的路徑，交給 Vite 打包並加上 hash。
//   node scripts/gen-fonts.mjs
// 字體：Bricolage Grotesque 800（英文標題、數字）、昭源甜圓體 Chiron GoRound TC 800（中文標題）。
// 中文字體依 unicode-range 分成約 120 片，瀏覽器只下載頁面上用到的字所在的那幾片。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = [
  '@fontsource/bricolage-grotesque/latin-800.css',
  '@fontsource/bricolage-grotesque/latin-ext-800.css',
  '@fontsource/chiron-goround-tc/800.css',
]
let out = '/* 由 scripts/gen-fonts.mjs 產生，不要手改。授權：SIL Open Font License 1.1 */\n'
for (const src of SOURCES) {
  const file = path.join(root, 'node_modules', src)
  const dir = path.dirname(src)
  const css = fs.readFileSync(file, 'utf8')
    .replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '')
    .replace(/url\(\.\/files\//g, `url(../node_modules/${dir}/files/`)
  if (/\.woff\)/.test(css)) throw new Error(`${src}: 還有 woff 網址沒拿掉`)
  out += `\n/* ${src} */\n${css.trim()}\n`
}
fs.writeFileSync(path.join(root, 'src/fonts.css'), out)
console.log(`src/fonts.css：${(out.match(/@font-face/g) || []).length} 個 @font-face`)
