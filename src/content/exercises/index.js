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
import project from './project.js'
import p11p3 from './p11-p3.js'
import p11p2 from './p11-p2.js'
import p11p1 from './p11-p1.js'
import p11n4 from './p11-n4.js'
import p11n3 from './p11-n3.js'
import p11n2 from './p11-n2.js'
import p11n1 from './p11-n1.js'
import p10m6 from './p10-m6.js'
import p10m5 from './p10-m5.js'
import p10m4 from './p10-m4.js'
import p10x3 from './p10-x3.js'
import p10x2 from './p10-x2.js'
import p10x1 from './p10-x1.js'
import p10m3 from './p10-m3.js'
import p10m2 from './p10-m2.js'
import p10m1 from './p10-m1.js'
import p9l1 from './p9-l1.js'
import p9l2 from './p9-l2.js'
import p9l3 from './p9-l3.js'
import p9l4 from './p9-l4.js'

export const EXERCISES = [...language, ...web, ...data, ...auth, ...security, ...deploy, ...cicd, ...algo, ...devops, ...devopsConfig, ...ai, ...knowledge, ...p9l1, ...p9l2, ...p9l3, ...p9l4, ...p10m1, ...p10m2, ...p10m3, ...p10x1, ...p10x2, ...p10x3, ...p10m4, ...p10m5, ...p10m6, ...p11n1, ...p11n2, ...p11n3, ...p11n4, ...p11p1, ...p11p2, ...p11p3, ...scenarios, ...project]

export const KINDS = {
  sql: { label: 'SQL', runtime: 'sql' },
  python: { label: 'Python', runtime: 'python' },
  js: { label: 'JavaScript', runtime: 'js' },
  // 設定檔題（Dockerfile、.gitlab-ci.yml、nginx.conf…）：不執行，交卷時把內容當成字串 `source`（另有 `lines`）交給 JS 測試檢查
  config: { label: '設定檔', runtime: 'js' },
}

export function findExercise(id) { return EXERCISES.find((e) => e.id === id) || null }
// 實作路線的題（帶 project）放在實作路線頁，不出現在技能頁的驗收區
export function exercisesForSkill(skillId) { return EXERCISES.filter((e) => e.skill === skillId && !e.project) }
export function exercisesForStage(stageId) { return EXERCISES.filter((e) => e.project === stageId) }
