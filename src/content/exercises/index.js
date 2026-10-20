// 程式題總索引
import data from './data.js'
import language from './language.js'
import auth from './auth.js'
import security from './security.js'
import algo from './algo.js'
import web from './web.js'
import scenarios from './scenarios.js'
import deploy from './deploy.js'
import cicd from './cicd.js'
import devops from './devops.js'
import devopsConfig from './devops-config.js'
import ai from './ai.js'
import knowledge from './knowledge.js'

export const EXERCISES = [...language, ...web, ...data, ...auth, ...security, ...deploy, ...cicd, ...algo, ...devops, ...devopsConfig, ...ai, ...knowledge, ...scenarios]

export const KINDS = {
  sql: { label: 'SQL', runtime: 'sql' },
  python: { label: 'Python', runtime: 'python' },
  js: { label: 'JavaScript', runtime: 'js' },
  // 設定檔題（Dockerfile、.gitlab-ci.yml、nginx.conf…）：不執行，交卷時把內容當成字串 `source`（另有 `lines`）交給 JS 測試檢查
  config: { label: '設定檔', runtime: 'js' },
}

export function findExercise(id) { return EXERCISES.find((e) => e.id === id) || null }
export function exercisesForSkill(skillId) { return EXERCISES.filter((e) => e.skill === skillId) }
