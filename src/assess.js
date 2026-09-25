import { exercisesForSkill } from './content/exercises/index.js'
import { quizFor } from './content/quizzes/index.js'

/* 一個技能的驗收狀態：程式題 + 選擇題 */
export function assessmentFor(skillId, progress) {
  const exercises = exercisesForSkill(skillId)
  const quiz = quizFor(skillId)
  const items = exercises.length + (quiz ? 1 : 0)
  const passedEx = exercises.filter((e) => progress.exercises?.[e.id] === 'pass').length
  const passedQuiz = quiz && progress.quizzes?.[skillId] === 'pass' ? 1 : 0
  const passed = passedEx + passedQuiz
  return { exercises, quiz, total: items, passed, complete: items > 0 && passed === items }
}
