// 設計情境：元件自己做、用元件庫，還是 headless（前端路線，畫面與互動）
export default {
  id: 'ui-library',
  order: 34,
  group: 'screen',
  title: '元件自己做、用元件庫，還是 headless',
  en: 'Build, library or headless components',
  level: 2,
  skills: ['design-tokens', 'a11y-basics', 'select-combobox', 'overlays', 'bundles-chunks', 'a11y-components'],
  week: 9,
  lab: 'UiLibraryScenarioLab',
  summary: '門診系統新版後台約 40 個畫面，院方有自己的視覺規範，也要求無障礙。元件自己做、用 Element Plus 這類元件庫，還是用 Reka UI 這類 headless 元件自己套外觀？',
  situation: '門診系統要重做後台：掛號、排班、報表約 40 個畫面，前端 3 人，系統預計用 5 年以上。設計師照院方識別做了一套設計稿，顏色、圓角、邊框、表格密度都和常見元件庫的預設外觀差很多。需要的元件除了按鈕與輸入框，還有 Dialog、Tabs、Toast、Combobox（找病人）、Date picker（選診次日期）與資料表格。院方的採購規範要求符合 WCAG 2.1 AA；掛號櫃台用的是舊電腦。版本以 2026-11 的 npm 為準：Element Plus 2.14、Vuetify 4.3、Reka UI 2.11。',
  constraints: [
    '外觀要照院方的設計稿，不是元件庫的預設樣子',
    '鍵盤操作與螢幕閱讀器要過 WCAG 2.1 AA；Combobox、Dialog、Tabs 的按鍵規則照 WAI-ARIA APG',
    '3 個前端，兩季內做完 40 個畫面',
    '系統要用 5 年以上，期間至少會遇到一次元件庫或 Vue 的大版本升級',
    '櫃台的舊電腦上掛號頁要快，不能為了幾個元件載入整套元件庫',
  ],
  options: [
    {
      id: 'self', name: '自己做',
      summary: '從原生 HTML 開始：`<button>`、`<dialog>`、`<input>`；Combobox、Date picker、資料表格照 WAI-ARIA APG 自己實作。',
      pros: ['外觀與行為完全照設計稿，沒有要對抗的預設樣式', '沒有上游的大版本升級，程式只跟著 Vue 與瀏覽器走', 'bundle 只有用到的東西'],
      cons: ['Combobox、Date picker、資料表格的鍵盤、焦點、ARIA 與瀏覽器差異都要自己做、自己測，是最耗工的部分', '3 個人兩季做 40 個畫面，時間大多花在元件上'],
    },
    {
      id: 'library', name: '元件庫（Element Plus、Vuetify 這類）',
      summary: '外觀、行為、鍵盤與 ARIA 都現成，用主題變數改顏色與圓角，用 `unplugin-vue-components` 這類外掛按需引入。',
      pros: ['第一天就有 Date picker、資料表格、Tree 這類複雜元件', '設計稿接近預設外觀時最快，3 個人專心做畫面'],
      cons: ['設計稿和預設外觀差越多，越要覆寫元件內部的 class；大版本升級時，這些覆寫最先失效', '鍵盤與 ARIA 的品質由元件庫決定，驗收時仍要逐項檢查，有缺漏要等上游修或自己包一層', '整套註冊（`app.use(ElementPlus)`）會把沒用到的元件也打包進去'],
    },
    {
      id: 'headless', name: 'headless 元件（Reka UI 這類）',
      summary: '元件只提供行為、焦點管理、鍵盤與 ARIA，沒有樣式，外觀用專案的 design token 自己寫。Reka UI（前身是 Radix Vue）有 Dialog、Combobox、Date picker、Tabs、Toast，沒有資料表格。',
      pros: ['外觀完全照設計稿，又不用自己實作 APG 的按鍵規則', '樣式寫在自己的 class 上，升級不會讓外觀跑掉', '只引入用到的元件'],
      cons: ['每個元件的外觀都要自己寫，起步比元件庫慢', '資料表格不在裡面，要搭 TanStack Table 這類 headless 表格或自己做', '元件拆成 Root、Trigger、Content 這類組合，團隊要有人熟悉這種寫法'],
    },
  ],
  tradeoffs: {
    axes: ['照設計稿', '鍵盤與 ARIA', '起步速度', '大版本升級', 'bundle'],
    rows: [
      { option: 'self', cells: ['好：全部自己的', '差：全部自己做、自己測', '差：最慢', '好：沒有上游', '好：只有用到的'] },
      { option: 'library', cells: ['差：差距大就要覆寫內部 class', '中：現成，但要驗收', '好：最快', '差：覆寫越多越痛', '中：要按需引入'] },
      { option: 'headless', cells: ['好：樣式自己寫', '好：行為現成', '中：外觀要自己寫', '中：API 會變，樣式不受影響', '好：只引入用到的'] },
    ],
  },
  decisions: [
    { id: 'internal', situation: '資訊室自用的設定後台：20 個畫面、使用者 10 人，沒有設計師，用預設外觀就好，需要資料表格與 Tree。', options: ['self', 'library', 'headless'], answer: 'library',
      explain: '沒有設計稿要照，元件庫的兩個缺點（覆寫、升級時覆寫失效）幾乎不存在，資料表格與 Tree 這類最貴的元件第一天就有。用主題變數換成院方的主色即可，不要覆寫內部 class；驗收時照 APG 用鍵盤走一遍常用元件。' },
    { id: 'patient-site', situation: '病患用的線上掛號網站：設計稿完全照院方識別，要符合 WCAG 2.1 AA，需要 Dialog、Combobox、Date picker、Tabs。', options: ['self', 'library', 'headless'], answer: 'headless',
      explain: '外觀和預設差很多，用元件庫會變成大量覆寫；自己做 Combobox 與 Date picker 的按鍵規則又很耗工。headless 元件把行為與 ARIA 做好，外觀用 token 自己寫，兩個需求都照顧到。' },
    { id: 'kiosk', situation: '報到機的觸控畫面：只有大按鈕、數字鍵盤與一個確認 Dialog，跑在很舊的平板上，程式越小越好。', options: ['self', 'library', 'headless'], answer: 'self',
      explain: '元件少又簡單：原生 `<button>` 已經有鍵盤與焦點，`<dialog>` 的 `showModal()` 處理焦點與 Esc。引入整套元件庫或 headless 套件，帶進來的大多是用不到的程式。自己做的成本集中在複雜元件，這裡一個都沒有。' },
    { id: 'legacy', situation: '已經用 Vuetify 做了 60 個畫面的舊後台，這季要再加 5 個畫面。', options: ['self', 'library', 'headless'], answer: 'library',
      explain: '同一個系統兩套元件，外觀與行為會不一致：使用者在兩種 Dialog、兩種日期選擇器之間切換。新畫面沿用現有的元件庫，才和舊畫面一樣；要換掉元件庫是另一個專案，不在加 5 個畫面時順便做。' },
  ],
  implementation: [
    { title: 'Element Plus 按需引入', lang: 'ts', code: `// vite.config.ts：只打包用到的元件與它們的樣式，不用 app.use(ElementPlus) 整套註冊
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),   // 模板裡寫 <el-button> 就自動引入
  ],
})` },
    { title: '元件庫的主題變數指向專案的 token', lang: 'css', code: `/* theme.css：改元件庫公開的變數，不覆寫它的內部 class */
:root {
  --color-primary: #1d6b5f;                  /* 專案的語意 token */
  --radius-control: 6px;

  --el-color-primary: var(--color-primary);  /* Element Plus 讀這些變數 */
  --el-border-radius-base: var(--radius-control);
  /* hover、active 用的 --el-color-primary-light-*、-dark-* 是另外幾個變數，要一起設 */
}

/* 不要這樣寫：.el-input__wrapper 是元件的內部結構，大版本升級可能改名或拿掉，
   選擇器對不到元素時不會有任何錯誤，樣式就靜靜消失
.el-input__wrapper { box-shadow: none; border: 2px solid var(--color-border-strong); }
*/` },
    { title: 'headless：Reka UI 的 Dialog，外觀全部自己寫', lang: 'vue', code: `<script setup lang="ts">
// Reka UI 2.11：開關狀態、焦點陷阱、Esc 關閉、焦點回到觸發按鈕、aria-* 由元件處理
import { DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent,
  DialogTitle, DialogDescription, DialogClose } from 'reka-ui'

defineProps<{ patient: string }>()
const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <DialogRoot>
    <DialogTrigger class="btn danger">取消掛號</DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="overlay" />
      <DialogContent class="dialog">
        <DialogTitle class="dialog-title">取消 {{ patient }} 的掛號？</DialogTitle>
        <DialogDescription>取消後名額會釋出，無法復原。</DialogDescription>
        <div class="actions">
          <DialogClose class="btn">返回</DialogClose>
          <DialogClose class="btn danger" @click="emit('confirm')">確定取消</DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/* 只用專案的 token；元件庫升級碰不到這些 class */
.overlay { position: fixed; inset: 0; background: var(--color-backdrop); }
.dialog {
  position: fixed; inset-block-start: 50%; inset-inline-start: 50%; translate: -50% -50%;
  inline-size: min(92vw, 26rem); padding: var(--space-5);
  border: var(--border-strong); border-radius: var(--radius-lg); background: var(--color-surface);
}
.dialog-title { font: var(--font-title); }
.actions { display: flex; gap: var(--space-3); justify-content: flex-end; }
</style>` },
  ],
  exercise: null,
  refs: [],
}
