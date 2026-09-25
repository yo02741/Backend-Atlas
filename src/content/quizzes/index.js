// 題庫索引：自動收集同目錄下各領域的題庫檔（language.js、data.js…）
const mods = import.meta.glob('./*.js', { eager: true })

export const QUIZZES = {}
for (const [path, m] of Object.entries(mods)) {
  if (path.endsWith('/index.js')) continue
  for (const entry of m.default || []) QUIZZES[entry.skill] = entry.questions
}

export function quizFor(skillId) { return QUIZZES[skillId] || null }
export function quizCount() { return Object.values(QUIZZES).reduce((n, q) => n + q.length, 0) }
