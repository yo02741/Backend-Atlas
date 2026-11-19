// 題庫：元件與框架（Vue）
export default [
  {
    skill: 'components-sfc',
    questions: [
      {
        q: '在 `<script setup>` 裡 import 了 `AppointmentRow.vue`，模板要怎麼使用它？',
        options: [
          '要在 `export default { components: { AppointmentRow } }` 裡註冊之後才能用',
          '直接在模板寫 `<AppointmentRow />`，import 進來的元件不需要再註冊',
          '要先在 `main.js` 用 `app.component(\'AppointmentRow\', …)` 全域註冊',
          '要在 `defineProps` 裡宣告 `AppointmentRow`，模板才找得到它',
        ],
        answer: 1,
        explain: '`<script setup>` 頂層的變數、函式與 import 進來的元件，模板都直接用得到，不用 `components` 選項，也不用全域註冊。`components: {}` 是 Options API 或 `setup()` 函式的寫法；全域註冊可以用但會讓每個元件都依賴它；`defineProps` 宣告的是這個元件收的資料，和使用子元件無關。',
      },
      {
        q: '這段模板執行時，Console 出現 `Invalid prop: type check failed for prop "item". Expected Object, got String with value "a".`，原因是什麼？',
        code: `<!-- AppointmentList.vue -->
<template>
  <ul>
    <AppointmentRow v-for="a in items" :key="a.id" item="a" />
  </ul>
</template>`,
        lang: 'vue',
        options: [
          '`v-for` 與 props 不能寫在同一個元素上，要包一層 `<template>`',
          '`key` 應該用 index，Vue 才能把 props 配對到正確的列',
          '`AppointmentRow` 沒有用 `defineEmits` 宣告事件，props 才會驗證失敗',
          '`item` 前面少了冒號，傳進去的是字串 `"a"`，要寫成 `:item="a"`',
        ],
        answer: 3,
        explain: '沒有 `:`（`v-bind`）的屬性值是字面字串，`item="a"` 傳的就是一個字母 `a`，所以型別檢查說收到 String。`v-for` 與 props 可以寫在同一個元素；`key` 用 index 會造成錯位而不是型別錯誤；`defineEmits` 和 props 的型別檢查無關。',
      },
      {
        q: '父元件寫 `<AppointmentList class="highlight" />`，樣式沒有套上，Console 出現 `Extraneous non-props attributes (class) were passed to component but could not be automatically inherited…`。子元件的模板是 `<h2>…</h2><ul>…</ul>`。該怎麼處理？',
        options: [
          '在要接收的元素（例如 `<ul>`）寫 `v-bind="$attrs"`，自己決定透傳屬性套在哪裡',
          '在子元件 `defineProps([\'class\'])`，把 `class` 當成一般的 prop 接收',
          '父元件改寫成 `:class="\'highlight\'"`，用 v-bind 就會自動套上',
          '子元件改用 `<style scoped>`，父元件的 class 才能穿透進來',
        ],
        answer: 0,
        explain: '子元件有兩個根元素時，Vue 不知道沒宣告的屬性要加在哪一個上，所以警告並且不套用；在指定的元素寫 `v-bind="$attrs"` 就解決。`class` 是保留的屬性名，不該宣告成 prop；`:class` 與 `class` 一樣是透傳屬性，結果相同；scoped 樣式管的是選擇器範圍，和屬性透傳無關。',
      },
    ],
  },
  {
    skill: 'reactivity',
    questions: [
      {
        q: '`const state = reactive({ keyword: \'\' })`，之後哪一種寫法，畫面不會跟著 `state.keyword` 改變？',
        options: [
          '`const { keyword } = toRefs(state)`，模板用 `keyword`',
          '`const kw = computed(() => state.keyword)`，模板用 `kw`',
          '`const { keyword } = state`，模板用 `keyword`',
          '模板直接寫 `state.keyword`',
        ],
        answer: 2,
        explain: '直接解構 `reactive` 物件，拿到的是當下的字串值，沒有經過 Proxy 的讀取，Vue 追蹤不到，之後改 `state.keyword` 畫面不會變。`toRefs` 把每個屬性轉成連著原物件的 ref；computed 在讀 `state.keyword` 時會追蹤；模板直接讀 `state.keyword` 也會追蹤。',
      },
      {
        q: '按下按鈕呼叫 `add()` 會發生什麼？',
        code: `import { ref, computed } from 'vue'

const count = ref(0)
const double = computed(() => count.value * 2)

function add() {
  count++
}`,
        lang: 'js',
        options: [
          '丟出 `TypeError: Assignment to constant variable.`，`count` 與 `double` 都不變',
          '`count` 變成 1，`double` 自動變成 2',
          '`count` 變成 1，`double` 要等下一次渲染才會更新',
          'Vue 在編譯時把 `count++` 改寫成 `count.value++`，所以結果正確',
        ],
        answer: 0,
        explain: '`count` 是 `const` 宣告的 ref 物件，`count++` 是對常數重新指定值，JavaScript 直接丟出 TypeError。在 script 裡要寫 `count.value++`；只有模板裡的頂層 ref 會自動拆開。Vue 不會改寫 script 裡的運算子，lint 規則 `vue/no-ref-as-operand` 可以事先抓到這個錯。',
      },
      {
        q: 'AI 產出的元件用 `watch(appointments, () => { checkedInCount.value = appointments.value.filter((a) => a.status === \'checked_in\').length }, { deep: true })` 維護已報到人數。最合適的改法是？',
        options: [
          '加上 `{ immediate: true }`，讓第一次進頁面也算一次',
          '改成 `watchEffect`，讓依賴自動收集',
          '改成每次在模板裡呼叫 `countCheckedIn()` 方法',
          '改成 `const checkedInCount = computed(() => appointments.value.filter(…).length)`',
        ],
        answer: 3,
        explain: '「A 變了就重算 B」是 computed 的工作：沒有第二份要同步的狀態、第一次就會算、依賴沒變時用快取。加 `immediate` 只修好第一次，仍然多一份狀態；`watchEffect` 一樣是在副作用裡寫入另一個 ref；方法在每次重新渲染都會重算，就算改的是不相干的資料。',
      },
    ],
  },
  {
    skill: 'template-syntax',
    questions: [
      {
        q: '預約清單上方的篩選面板會被頻繁開關，而且要保留使用者已勾選的條件。用哪一個指令控制它的顯示？',
        options: [
          '`v-if`：條件為假時移除，再次出現時 Vue 會還原勾選狀態',
          '`v-show`：元素一直在 DOM 裡，只切換 `display`，勾選狀態保留',
          '`v-if` 加上固定的 `key`，讓 Vue 記住面板的狀態',
          '`v-for` 渲染一次，再用 `:class` 加上隱藏的樣式',
        ],
        answer: 1,
        explain: '`v-show` 只切換 `display: none`，元素與裡面的輸入值都還在，適合頻繁開關。`v-if` 條件為假時整個移除，再出現時重新建立，勾選狀態歸零；加 `key` 不會讓被移除的元素保留狀態；用 `v-for` 做開關是誤用。',
      },
      {
        q: '這段模板在 Vue 3 執行時會怎樣？',
        code: `<li v-for="a in appointments" v-if="a.status !== 'cancelled'" :key="a.id">
  {{ a.patientName }}
</li>`,
        lang: 'vue',
        options: [
          '`v-for` 先執行，已取消的預約被正確篩掉',
          '編譯失敗：同一個元素不能同時有兩個結構指令',
          '`v-if` 先執行，這時還沒有 `a`：出現 `Property "a" was accessed during render` 警告並丟出 TypeError',
          '只渲染第一筆，之後的都被 `v-if` 擋掉',
        ],
        answer: 2,
        explain: 'Vue 3 裡同一個元素上的 `v-if` 優先於 `v-for`（Vue 2 相反），條件運算式讀 `a` 時 `v-for` 還沒開始，Vue 警告找不到 `a`，接著讀 `undefined.status` 丟出 TypeError。編譯本身會通過。篩選要用 computed，或把 `v-for` 放在外層的 `<template>`。',
      },
      {
        q: '清單用 `:key="index"`，每一列有一個沒有綁定資料的備註輸入框。使用者在第二列打了字，接著刪掉第一筆，畫面會怎樣？',
        options: [
          'Vue 偵測到 key 改變，整個清單重新建立，所有備註清空',
          '刪除失敗，Console 出現 `Duplicate keys found during update` 警告',
          '備註跟著資料一起往上移，每一列仍然正確',
          '打的字留在原本的位置，變成下一位病人那一列的備註，最後一列消失',
        ],
        answer: 3,
        explain: '用 index 當 key 時，刪除後 key 0、1 仍然存在，Vue 就地重用這兩個元素、只更新文字，最後一個 key 消失。輸入框裡的字屬於 DOM，不在資料裡，所以留在原本的位置，對到了別人。key 沒有重複，不會出現 Duplicate keys 警告；也不會整個重建。',
      },
    ],
  },
  {
    skill: 'lifecycle',
    questions: [
      {
        q: '父元件 `Parent` 的模板裡有同步的子元件 `Child`，兩者都有 `onMounted`。掛載時誰先執行？',
        options: [
          '`Parent` 的先，因為它先建立',
          '`Child` 的先：父元件的 `onMounted` 執行時，同步的子元件都已經掛載完成',
          '兩個同時執行，順序不固定',
          '只有 `Parent` 的會執行，`Child` 的要等 `nextTick` 才會觸發',
        ],
        answer: 1,
        explain: '建立的順序是父先子後（Parent setup → Child setup），但掛載完成的順序相反：Child mounted → Parent mounted。所以父元件在 `onMounted` 裡讀得到子元件的 DOM。順序是固定的；`nextTick` 和 `onMounted` 是否執行無關。',
      },
      {
        q: '使用者離開這個頁面（元件卸載）之後，會發生什麼？',
        code: `<script setup>
import { onMounted } from 'vue'

let timer
onMounted(() => {
  timer = setInterval(load, 30000)
  window.addEventListener('resize', () => resize())
})
</script>`,
        lang: 'vue',
        options: [
          'Vue 卸載元件時自動清掉元件裡建立的計時器與事件監聽',
          '計時器會停，但 `resize` 監聽還在',
          '`resize` 監聽會被移除，但計時器還在',
          '計時器與 `resize` 監聽都還在；每次重新進入頁面又多一組',
        ],
        answer: 3,
        explain: 'Vue 只會自動停止在 setup 裡同步建立的 watcher 與 computed；`setInterval` 與 `window.addEventListener` 是瀏覽器的東西，要在 `onUnmounted` 自己 `clearInterval` 與 `removeEventListener`。這裡的監聽用的是匿名箭頭函式，就算加了移除也移除不掉，要改成具名函式並傳入同一個參考。',
      },
      {
        q: '看板元件的輪詢寫在 `onMounted` 開始、`onUnmounted` 停止。後來外層加了 `<KeepAlive>`，切到其他分頁後 Network 分頁顯示輪詢沒停。怎麼改？',
        options: [
          '暫停放 `onDeactivated`、恢復放 `onActivated`；`onActivated` 第一次掛載也會執行',
          '把 `clearInterval` 搬到 `onBeforeUnmount`，它在 `<KeepAlive>` 下會執行',
          '在 `onUpdated` 裡檢查元件是否還在畫面上，不在就停止輪詢',
          '`<KeepAlive>` 下沒有辦法停止，只能拿掉 `<KeepAlive>`',
        ],
        answer: 0,
        explain: '`<KeepAlive>` 讓切走的元件留在記憶體、不卸載，所以 `onBeforeUnmount` 與 `onUnmounted` 都不會執行；切走時呼叫 `onDeactivated`，切回來（包含第一次掛載）呼叫 `onActivated`。`onUpdated` 只在重新渲染後執行，切走時不會觸發。',
      },
    ],
  },
]
