/* 沙箱執行環境的載入狀態（Vue vendor 檔）。獨立成小檔：Output.jsx 的 RuntimeStatus 讀狀態時不必把 frame.js 拉進來。 */
let status = 'idle' // idle | loading | ready | error
const listeners = new Set()
export function frameStatus() { return status }
export function onFrameStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function setFrameStatus(s) { if (s !== status) { status = s; listeners.forEach((fn) => fn(s)) } }
