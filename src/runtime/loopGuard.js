/* 迴圈保護：組 srcdoc 前，在使用者 JS 的每個迴圈插入檢查 __lp()。
   沙箱 iframe 和主頁面可能在同一個執行緒（各瀏覽器不保證把沙箱 iframe 放到另一個程序），
   無窮迴圈會讓整頁卡住、外殼的逾時計時器也不會觸發，所以要在 iframe 裡自己中止。

   做法：一個小型 tokenizer（跳過字串、樣板字串、註解、regex），找到 while ( 與 for (，改寫「條件」：
     while (cond)               → while (__lp() && (cond))        （do … while 的尾巴也一樣）
     for (init; test; update)   → for (init; __lp() && (test); update)；test 是空的就放 __lp()
     for (x of xs) { … }        → for (x of xs) { __lp(); … }     （沒有大括號的 for…of / for…in 不處理）
   只在同一行裡插入文字，不加換行：錯誤訊息的行號和使用者看到的一樣。
   __lp 由 prelude 提供：主執行緒連續被占用超過上限（沒有讓出給計時器）就丟出錯誤。
   不用 parser（acorn 之類要新增依賴）；已知的誤判：用 for / while 當方法名稱、`)` 之後直接接 regex 字面值。 */

const ID_START = /[\p{ID_Start}$_\\]/u
const ID_PART = /[\p{ID_Continue}$‌‍\\]/u
// 這些關鍵字後面出現 / 是 regex，不是除號
const EXPR_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends'])

export function tokenize(src) {
  const toks = []
  const n = src.length
  const tpl = []      // 樣板字串 ${ } 開始時的大括號深度
  let depth = 0
  let prev = null
  let i = 0
  const push = (t, v, s, e) => { const tok = { t, v, s, e }; toks.push(tok); if (t !== 'comment') prev = tok; return tok }
  const regexOK = () => {
    if (!prev) return true
    if (prev.t === 'num' || prev.t === 'str' || prev.t === 're') return false
    if (prev.t === 'tpl') return prev.v === '${'
    if (prev.t === 'id') return EXPR_KW.has(prev.v)
    return !(prev.v === ')' || prev.v === ']')
  }
  // 樣板字串：從 i（` 或 } 之後）讀到 ` 或 ${
  const readTemplate = (start) => {
    let j = start
    while (j < n) {
      const c = src[j]
      if (c === '\\') { j += 2; continue }
      if (c === '`') { push('tpl', '`', start, j + 1); return j + 1 }
      if (c === '$' && src[j + 1] === '{') { push('tpl', '${', start, j + 2); tpl.push(depth); depth++; return j + 2 }
      j++
    }
    push('tpl', '`', start, n)
    return n
  }
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿' || c === ' ' || c === ' ') { i++; continue }
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? n : j; push('comment', '', i, e); i = e; continue }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? n : j + 2; push('comment', '', i, e); i = e; continue }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      push('str', '', i, Math.min(n, j + 1)); i = j + 1; continue
    }
    if (c === '`') { i = readTemplate(i + 1); continue }
    if (c === '}' && tpl.length && tpl[tpl.length - 1] === depth - 1) { tpl.pop(); depth--; i = readTemplate(i + 1); continue }
    if (c === '/' && regexOK()) {
      let j = i + 1, cls = false
      while (j < n && src[j] !== '\n') {
        const d = src[j]
        if (d === '\\') { j += 2; continue }
        if (d === '[') cls = true
        else if (d === ']') cls = false
        else if (d === '/' && !cls) break
        j++
      }
      j++
      while (j < n && /[a-z]/i.test(src[j])) j++
      push('re', '', i, j); i = j; continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1
      while (j < n && /[\w.]/.test(src[j])) j++
      push('num', '', i, j); i = j; continue
    }
    if (ID_START.test(c) || c === '#') {
      let j = i + 1
      while (j < n && ID_PART.test(src[j])) j += src[j] === '\\' ? 2 : 1
      push('id', src.slice(i, j), i, j); i = j; continue
    }
    if (c === '?' && src[i + 1] === '.' && !/[0-9]/.test(src[i + 2] || '')) { push('punc', '?.', i, i + 2); i += 2; continue }
    if (c === '{') depth++
    if (c === '}') depth--
    push('punc', c, i, i + 1); i++
  }
  return toks
}

export function guardLoops(src, guard = '__lp') {
  let toks
  try { toks = tokenize(src) } catch { return src }
  const code = toks.filter((t) => t.t !== 'comment')
  const ins = []
  for (let k = 0; k < code.length; k++) {
    const tok = code[k]
    if (tok.t !== 'id' || (tok.v !== 'for' && tok.v !== 'while')) continue
    const before = code[k - 1]
    if (before && before.t === 'punc' && (before.v === '.' || before.v === '?.')) continue
    let j = k + 1
    let forAwait = false
    if (tok.v === 'for' && code[j]?.t === 'id' && code[j].v === 'await') { forAwait = true; j++ }
    if (code[j]?.t !== 'punc' || code[j].v !== '(') continue
    // 找對應的 ) 與這一層的分號
    let d = 0, close = -1
    const semis = []
    for (let m = j; m < code.length; m++) {
      const t = code[m]
      if (t.t !== 'punc') continue
      if (t.v === '(' || t.v === '[' || t.v === '{') d++
      else if (t.v === ')' || t.v === ']' || t.v === '}') { d--; if (d === 0) { close = m; break } }
      else if (t.v === ';' && d === 1) semis.push(m)
    }
    if (close < 0) continue
    if (tok.v === 'while') {
      ins.push([code[j].e, `${guard}() && (`], [code[close].s, ')'])
    } else if (semis.length === 2 && !forAwait) {
      const a = code[semis[0]], b = code[semis[1]]
      const empty = semis[1] === semis[0] + 1
      if (empty) ins.push([a.e, ` ${guard}() `])
      else ins.push([a.e, ` ${guard}() && (`], [b.s, ')'])
    } else if (semis.length === 0) {
      const body = code[close + 1]
      if (body && body.t === 'punc' && body.v === '{') ins.push([body.e, ` ${guard}();`])
    }
  }
  if (!ins.length) return src
  ins.sort((x, y) => x[0] - y[0])
  let out = '', last = 0
  for (const [pos, text] of ins) { out += src.slice(last, pos) + text; last = pos }
  return out + src.slice(last)
}

/* html 題：只改 <script> 裡的程式（有 src 的、type 不是 JS 的不動） */
export function guardHtml(html, guard = '__lp') {
  return html.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi, (all, open, attrs, body, close) => {
    if (/\bsrc\s*=/i.test(attrs)) return all
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase()
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) return all
    return open + guardLoops(body, guard) + close
  })
}
