// 程式題總索引
import data from './data.js'
import language from './language.js'
import auth from './auth.js'
import security from './security.js'
import algo from './algo.js'
import web from './web.js'
import scenarios from './scenarios.js'

export const EXERCISES = [...language, ...web, ...data, ...auth, ...security, ...algo, ...scenarios]

export const KINDS = {
  sql: { label: 'SQL', runtime: 'sql' },
  python: { label: 'Python', runtime: 'python' },
  js: { label: 'JavaScript', runtime: 'js' },
}

export function findExercise(id) { return EXERCISES.find((e) => e.id === id) || null }
export function exercisesForSkill(skillId) { return EXERCISES.filter((e) => e.skill === skillId) }
