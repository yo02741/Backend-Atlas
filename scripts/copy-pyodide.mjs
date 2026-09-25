// 把 Pyodide 執行環境從 node_modules 複製到 public/pyodide/（自架，不依賴 CDN）。
// public/ 內容會原封不動進 build 產物；public/pyodide 已 gitignore。
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../node_modules/pyodide')
const dst = resolve(here, '../public/pyodide')
const files = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
mkdirSync(dst, { recursive: true })
let total = 0
for (const f of files) {
  const from = resolve(src, f), to = resolve(dst, f)
  if (!existsSync(from)) { console.error(`缺少 ${from}`); process.exit(1) }
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to)
  total += statSync(to).size
}
console.log(`pyodide → public/pyodide (${(total / 1024 / 1024).toFixed(1)} MB)`)
