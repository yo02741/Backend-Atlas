// src/config.js：執行時設定。index.html 在應用程式之前載入 /config.js（設定 window.__CLINIC_CONFIG__）
// 和第 7 階段的寫法相同，另外多一個數字欄位 boardIntervalMs（看板的輪詢間隔；接線測試把它調短）
const DEFAULTS = { apiBase: '/api', envName: '正式', showDebug: false, boardIntervalMs: 10_000 }

function readConfig(raw) {
  const cfg = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') {
    console.warn('[config] 找不到 __CLINIC_CONFIG__，全部使用預設值')
    return cfg
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) { console.warn(`[config] 缺少 ${key}，使用預設值 ${JSON.stringify(DEFAULTS[key])}`); continue }
    const d = DEFAULTS[key]
    if (typeof d === 'boolean') cfg[key] = raw[key] === true || raw[key] === 'true'
    else if (typeof d === 'number') cfg[key] = Number(raw[key]) > 0 ? Number(raw[key]) : d
    else cfg[key] = String(raw[key])
  }
  return cfg
}

export const config = Object.freeze(readConfig(window.__CLINIC_CONFIG__))
