// src/focus.js：換頁之後更新標題、把焦點移到新頁面的 h1（第 6 階段；main.js 在 app.use(router) 之前 import）
import { nextTick } from 'vue'
import { router } from '@/router'

router.afterEach(async (to, from, failure) => {
  if (failure) return                                  // 導航被取消或重複：畫面沒換
  document.title = `${to.meta.title ?? '門診系統'}｜門診系統`
  if (!from.matched.length || to.path === from.path) return   // 第一次載入、只改 query（篩選）：焦點不動
  await nextTick()
  document.querySelector('main h1')?.focus()           // h1 要有 tabindex="-1"
})
