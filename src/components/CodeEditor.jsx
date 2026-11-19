import React, { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, indentUnit, StreamLanguage } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { python } from '@codemirror/lang-python'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'

/* CodeMirror 6 編輯器：主題全走 CSS token（亮暗自動），語言 python / sql / js / vue（JS）/ html / css。
   html 與 css 用下面的小型 StreamLanguage 上色（沒有 @codemirror/lang-html、lang-css 依賴）。
   props: value, onChange, lang, onRun(Ctrl/Cmd+Enter), readOnly, minHeight */

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface-2)', color: 'var(--ink-1)', fontSize: '0.86rem', borderRadius: 'var(--radius)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0', caretColor: 'var(--ink-1)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--ink-3)', border: 'none', borderRight: '1px solid var(--hairline)', fontFamily: 'var(--mono)' },
  '.cm-gutterElement': { padding: '0 8px 0 12px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ink-1) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--ink-1) 6%, transparent)', color: 'var(--ink-2)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink-1)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)', outline: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)' },
  '.cm-placeholder': { color: 'var(--ink-3)', fontStyle: 'italic' },
  '.cm-scroller': { lineHeight: '1.6', overflow: 'auto' },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--c-violet)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--c-green)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--c-orange)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--c-blue)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--c-aqua)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--c-aqua)' },
  { tag: [t.operator, t.punctuation], color: 'var(--ink-2)' },
  { tag: t.tagName, color: 'var(--c-red)' },
  { tag: [t.bracket, t.angleBracket, t.meta], color: 'var(--ink-3)' },
  { tag: t.invalid, color: 'var(--critical)' },
])

/* HTML：標籤、屬性、字串、註解；<script>、<style> 的內容不上色 */
const htmlLang = StreamLanguage.define({
  name: 'html',
  startState: () => ({ tag: null, name: '', comment: false, quote: null, raw: null }),
  token(stream, s) {
    if (s.comment) { if (stream.skipTo('-->')) { stream.match('-->'); s.comment = false } else stream.skipToEnd(); return 'comment' }
    if (s.quote) { while (!stream.eol()) { if (stream.next() === s.quote) { s.quote = null; break } } return 'string' }
    if (s.raw) {
      if (stream.match(new RegExp(`^</(?=${s.raw})`, 'i'))) { s.raw = null; s.tag = 'name'; return 'bracket' }
      stream.next(); while (!stream.eol() && stream.peek() !== '<') stream.next()
      return null
    }
    if (!s.tag) {
      if (stream.match('<!--')) { s.comment = true; return 'comment' }
      if (stream.match(/^<!\w[^>]*>?/)) return 'meta'
      if (stream.match(/^<\/?(?=[A-Za-z])/)) { s.tag = 'name'; return 'bracket' }
      stream.next(); while (!stream.eol() && stream.peek() !== '<') stream.next()
      return null
    }
    if (stream.eatSpace()) return null
    if (s.tag === 'name') {
      s.tag = 'attrs'
      const m = stream.match(/^[\w-]+/)
      if (m) { s.name = m[0].toLowerCase(); return 'tag' }
    }
    if (stream.match(/^\/?>/)) { s.raw = s.name === 'script' || s.name === 'style' ? s.name : null; s.tag = null; s.name = ''; return 'bracket' }
    if (stream.match(/^[^\s=>"'/]+/)) return 'attribute'
    const q = stream.peek()
    if (q === '"' || q === "'") { stream.next(); s.quote = q; while (!stream.eol()) { if (stream.next() === q) { s.quote = null; break } } return 'string' }
    stream.next()
    return null
  },
})

/* CSS：選擇器、屬性、數值與單位、at-rule、註解 */
const cssLang = StreamLanguage.define({
  name: 'css',
  startState: () => ({ depth: 0, comment: false, value: false }),
  token(stream, s) {
    if (s.comment) { if (stream.skipTo('*/')) { stream.match('*/'); s.comment = false } else stream.skipToEnd(); return 'comment' }
    if (stream.eatSpace()) return null
    if (stream.match('/*')) { s.comment = true; return 'comment' }
    const ch = stream.peek()
    if (ch === '"' || ch === "'") { stream.next(); let c; while ((c = stream.next()) != null) { if (c === '\\') stream.next(); else if (c === ch) break } return 'string' }
    if (ch === '{') { stream.next(); s.depth++; s.value = false; return 'bracket' }
    if (ch === '}') { stream.next(); s.depth = Math.max(0, s.depth - 1); s.value = false; return 'bracket' }
    if (ch === ';') { stream.next(); s.value = false; return null }
    if (stream.match(/^@[\w-]+/) || stream.match(/^!important/i)) return 'keyword'
    if (s.value && stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'atom'
    if (stream.match(/^-?(\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw|dvh|svh|fr|ch|s|ms|deg)?/)) return 'number'
    if (s.depth > 0 && !s.value) {
      if (stream.match(/^[\w-]+(?=\s*:)/)) return 'property'
      if (ch === ':') { stream.next(); s.value = true; return null }
    }
    if (s.value) { if (stream.match(/^[\w-]+/)) return 'atom' }
    else {
      if (stream.match(/^[.#][\w-]+/)) return 'qualifier'
      if (stream.match(/^::?[\w-]+/)) return 'meta'
      if (stream.match(/^[\w-]+/)) return 'tag'
    }
    stream.next()
    return null
  },
})

function langExt(lang) {
  if (lang === 'python') return python()
  if (lang === 'sql') return sql({ dialect: PostgreSQL, upperCaseKeywords: true })
  if (lang === 'js' || lang === 'javascript' || lang === 'vue') return javascript()
  if (lang === 'html') return htmlLang
  if (lang === 'css') return cssLang
  return []
}

export default function CodeEditor({ value, onChange, lang = 'python', onRun, readOnly = false, minHeight = 180, placeholder = '' }) {
  const host = useRef(null)
  const view = useRef(null)
  const onChangeRef = useRef(onChange)
  const onRunRef = useRef(onRun)
  onChangeRef.current = onChange
  onRunRef.current = onRun
  const langComp = useRef(new Compartment())
  const roComp = useRef(new Compartment())

  useEffect(() => {
    const runKey = keymap.of([{ key: 'Mod-Enter', run: () => { onRunRef.current?.(); return true } }])
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
        indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(),
        indentUnit.of(lang === 'python' ? '    ' : '  '),
        runKey,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        langComp.current.of(langExt(lang)),
        roComp.current.of(EditorState.readOnly.of(readOnly)),
        theme, syntaxHighlighting(highlight),
        EditorView.lineWrapping, // 長行換行，手機上不用左右滑
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current?.(u.state.doc.toString()) }),
      ],
    })
    view.current = new EditorView({ state, parent: host.current })
    return () => { view.current?.destroy(); view.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部重設內容（例如「重設」按鈕）：只有內容真的不同時才覆寫，避免打字時被蓋掉
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (value !== cur) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
  }, [value])

  useEffect(() => { view.current?.dispatch({ effects: langComp.current.reconfigure(langExt(lang)) }) }, [lang])
  useEffect(() => { view.current?.dispatch({ effects: roComp.current.reconfigure(EditorState.readOnly.of(readOnly)) }) }, [readOnly])

  return <div className="code-editor" ref={host} style={{ minHeight }} />
}
