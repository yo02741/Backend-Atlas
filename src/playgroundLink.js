// 「在 Playground 開啟」：把程式碼放進網址（#/playground?lang=python&code=<base64url>），Playground 讀到就載入。
const toB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))

export const PLAYGROUND_LANGS = { python: 'python', py: 'python', sql: 'sql', js: 'js', javascript: 'js' }

export function playgroundHref(lang, code) {
  return `#/playground?lang=${PLAYGROUND_LANGS[lang] || lang}&code=${toB64(code)}`
}

export function decodePlaygroundCode(param) {
  if (!param) return null
  try { return fromB64(param) } catch { return null }
}
