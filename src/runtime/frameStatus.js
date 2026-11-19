/* 沙箱執行環境的載入狀態（vendor 檔：Vue，用到時加上 Pinia、Vue Router、Element Plus）。獨立成小檔：Output.jsx 的 RuntimeStatus 讀狀態時不必把 frame.js 拉進來。 */
let status = 'idle' // idle | loading | ready | error
const listeners = new Set()
export function frameStatus() { return status }
export function onFrameStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }
/* html 程式碼裡有 <style type="text/tailwindcss"> 就載入 Tailwind（沒有題目設定時：Playground、深入內容）。frame.js 與 Playground 共用 */
export const TAILWIND_STYLE_RE = /<style\b[^>]*\btype\s*=\s*["']?text\/tailwindcss\b/i
/* 程式碼 import 了 element-plus（含 element-plus/… 的子路徑）。frame.js 判斷要不要下載，RuntimeStatus 用它決定標籤 */
export const ELEMENT_PLUS_RE = /\bfrom\s*['"]element-plus(?:\/[^'"]*)?['"]|\bimport\s*\(?\s*['"]element-plus(?:\/[^'"]*)?['"]/
export function setFrameStatus(s) { if (s !== status) { status = s; listeners.forEach((fn) => fn(s)) } }
