import React, { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { python } from '@codemirror/lang-python'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'

/* CodeMirror 6 編輯器：主題全走 CSS token（亮暗自動），語言 python / sql / js。
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
  { tag: t.invalid, color: 'var(--critical)' },
])

function langExt(lang) {
  if (lang === 'python') return python()
  if (lang === 'sql') return sql({ dialect: PostgreSQL, upperCaseKeywords: true })
  if (lang === 'js' || lang === 'javascript') return javascript()
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
