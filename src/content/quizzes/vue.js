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
          '丟出 `TypeError: Assignment to constant variable.`',
          '`count` 變成 1，`double` 也跟著重算成 2，畫面一起更新',
          '`count` 變成 1，`double` 要等下一次渲染讀到它時才重算成 2',
          'Vue 在編譯時把 `count++` 改寫成 `count.value++`，所以結果正確',
        ],
        answer: 0,
        explain: '`count` 是 `const` 宣告的 ref 物件，`count++` 是對常數重新指定值，JavaScript 直接丟出 TypeError，`count` 與 `double` 都不變。在 script 裡要寫 `count.value++`；只有模板裡的頂層 ref 會自動拆開。Vue 不會改寫 script 裡的運算子，lint 規則 `vue/no-ref-as-operand` 可以事先抓到這個錯。',
      },
      {
        q: 'AI 產出的元件用 `watch(appointments, () => { checkedInCount.value = appointments.value.filter((a) => a.status === \'checked_in\').length }, { deep: true })` 維護已報到人數。最合適的改法是？',
        options: [
          '加上 `{ immediate: true }`，讓第一次進頁面時也先算一次人數',
          '改成 `watchEffect`，讓 Vue 自動收集依賴，不用再寫 `deep`',
          '改成在模板裡呼叫 `countCheckedIn()` 方法，每次渲染時現算人數，不留狀態',
          '拿掉 watch，改用 `computed` 從 `appointments` 算出人數',
        ],
        answer: 3,
        explain: '寫成 `const checkedInCount = computed(() => appointments.value.filter(…).length)`。「A 變了就重算 B」是 computed 的工作：沒有第二份要同步的狀態、第一次就會算、依賴沒變時用快取。加 `immediate` 只修好第一次，仍然多一份狀態；`watchEffect` 一樣是在副作用裡寫入另一個 ref；方法在每次重新渲染都會重算，就算改的是不相干的資料。',
      },
    ],
  },
  {
    skill: 'template-syntax',
    questions: [
      {
        q: '預約清單上方的篩選面板會被頻繁開關，而且要保留使用者已勾選的條件。用哪一個指令控制它的顯示？',
        options: [
          '`v-if`：條件為假時移除元素，再次出現時 Vue 會自動還原勾選狀態',
          '`v-show`：元素一直在 DOM 裡，只切換 `display`，勾選狀態保留',
          '`v-if` 加上固定的 `key`，讓 Vue 在重建時沿用面板原本那份勾選狀態',
          '`v-for` 只渲染一次面板，再用 `:class` 切換一個隱藏用的樣式',
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
          '`v-for` 先執行，再對每一筆判斷 `v-if`，已取消的預約被正確篩掉',
          '編譯失敗：模板編譯器不允許同一個元素同時有 `v-if` 與 `v-for`',
          '`v-if` 先執行，這時還沒有 `a`，警告後丟出 TypeError',
          '只渲染第一筆，`v-if` 算出 false 之後就停止 `v-for` 的迴圈',
        ],
        answer: 2,
        explain: 'Vue 3 裡同一個元素上的 `v-if` 優先於 `v-for`（Vue 2 相反），條件運算式讀 `a` 時 `v-for` 還沒開始，Vue 警告 `Property "a" was accessed during render but is not defined on instance`，接著讀 `undefined.status` 丟出 TypeError。編譯本身會通過。篩選要用 computed，或把 `v-for` 放在外層的 `<template>`。',
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
          '`Parent` 的先：父元件先建立，`onMounted` 也就先執行',
          '`Child` 的先，`Parent` 的在同步子元件都掛載後才執行',
          '兩個在同一個 tick 裡執行，誰先誰後不固定',
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
          'Vue 卸載元件時，會自動清掉元件裡建立的 `setInterval` 與事件監聽',
          '計時器隨元件卸載停止，但掛在 `window` 的 `resize` 監聽還在',
          '`resize` 監聽隨元件一起被移除，但 `setInterval` 計時器還在',
          '計時器與 `resize` 監聽都還在；每次重新進入頁面又多一組',
        ],
        answer: 3,
        explain: 'Vue 只會自動停止在 setup 裡同步建立的 watcher 與 computed；`setInterval` 與 `window.addEventListener` 是瀏覽器的東西，要在 `onUnmounted` 自己 `clearInterval` 與 `removeEventListener`。這裡的監聽用的是匿名箭頭函式，就算加了移除也移除不掉，要改成具名函式並傳入同一個參考。',
      },
      {
        q: '看板元件的輪詢寫在 `onMounted` 開始、`onUnmounted` 停止。後來外層加了 `<KeepAlive>`，切到其他分頁後 Network 分頁顯示輪詢沒停。怎麼改？',
        options: [
          '暫停放 `onDeactivated`、恢復放 `onActivated`；`onActivated` 第一次掛載也會執行',
          '把 `clearInterval` 搬到 `onBeforeUnmount`，它在 `<KeepAlive>` 底下切走時也會執行',
          '在 `onUpdated` 裡檢查元件是否還在畫面上，不在就停止輪詢',
          '`<KeepAlive>` 下沒有辦法停止，只能拿掉 `<KeepAlive>`',
        ],
        answer: 0,
        explain: '`<KeepAlive>` 讓切走的元件留在記憶體、不卸載，所以 `onBeforeUnmount` 與 `onUnmounted` 都不會執行；切走時呼叫 `onDeactivated`，切回來（包含第一次掛載）呼叫 `onActivated`。`onUpdated` 只在重新渲染後執行，切走時不會觸發。',
      },
    ],
  },
  {
    skill: 'props-emits-model',
    questions: [
      {
        q: '父元件寫 `<DatePicker v-model:date="selectedDate" />`，Vue 會把它展開成什麼？',
        options: [
          '`:date="selectedDate"` 加上 `@update:date="(v) => (selectedDate = v)"`',
          '`:modelValue="selectedDate"` 加上 `@update:modelValue="(v) => (selectedDate = v)"`',
          '`:date="selectedDate"`，子元件改 `props.date` 時自動同步回父元件',
          '`:date="selectedDate"` 加上 `@change="(v) => (selectedDate = v)"`',
        ],
        answer: 0,
        explain: '有名稱的 `v-model:date` 用 `date` 這個 prop 與 `update:date` 事件；不寫名稱的 `v-model` 才用 `modelValue` 與 `update:modelValue`。props 是唯讀的，子元件改 `props.date` 只會得到警告，不會同步回去；元件上的 `v-model` 用的是 `update:` 事件，不是 `change`。',
      },
      {
        q: '父元件寫 `<DatePicker v-model:date="selected" @confirm="onConfirm" />`，`selected` 原本是 `2026-11-20`。使用者點了 11/21，`onConfirm` 收到什麼？',
        code: `<script setup>
const date = defineModel('date')
const emit = defineEmits(['confirm'])

function pick(d) {
  date.value = d
  emit('confirm', date.value)
}
</script>`,
        lang: 'vue',
        options: [
          '`2026-11-21`：`defineModel` 的 ref 一寫入，馬上讀到的就是新值',
          '`2026-11-20`：父元件更新 prop 之前，`date.value` 仍是舊值',
          '`undefined`：`defineModel` 的 ref 在發事件時會被清空',
          '收不到：同一個函式裡連續發出的第二個事件會被 Vue 合併掉',
        ],
        answer: 1,
        explain: '父元件有綁 `v-model` 時，寫入 `defineModel` 回傳的 ref 等於 `emit(\'update:date\', d)`，新值要等父元件改了 `selected`、重新渲染傳下新的 prop 才會出現，所以緊接著讀到的是舊值。要送新值就用參數 `d`。同一個函式可以發好幾個事件。',
      },
      {
        q: 'AI 產出的預約列元件在按「取消」時寫 `props.appointment.status = \'cancelled\'`，畫面上的狀態變了，Console 也沒有警告。這段程式的問題是什麼？',
        options: [
          '沒有問題：Vue 3 允許改物件 prop 的內部屬性，官方文件也建議這樣寫',
          '它會丟出 TypeError，只是錯誤被 Vue 的 `errorHandler` 攔下來沒有顯示',
          '改到父元件持有的物件，取消的 API 沒有呼叫；應該 `emit(\'cancel\', id)`',
          '只要再用 `defineEmits` 宣告 `cancel` 事件，這一行就變成合法的寫法',
        ],
        answer: 2,
        explain: 'props 只有第一層是唯讀的，物件裡的屬性仍然是父元件那一份資料，改了不會警告，畫面也會變，但父元件不知道發生了什麼，沒有機會檢查或呼叫取消的 API，伺服器上的預約還在。lint 規則 `vue/no-mutating-props` 會抓到這種寫法。宣告事件不會讓修改 props 變得合法，要把「取消」交給持有資料的父元件。',
      },
    ],
  },
  {
    skill: 'slots-provide',
    questions: [
      {
        q: '表格元件 `DataTable` 負責列與欄，但每個頁面要自己決定「狀態」這一格怎麼畫（有的畫 Badge、有的加按鈕）。最合適的做法是？',
        options: [
          '加一個 `statusType` prop，在 DataTable 裡用 `v-if` 判斷每一種畫法',
          '狀態格放作用域 slot，把 `row` 交出去，頁面在 `#cell-status` 自己畫',
          '每個頁面用 `provide` 把畫狀態格的函式傳給 DataTable 呼叫',
          '每個頁面複製一份 DataTable，各自修改狀態格的那一段模板',
        ],
        answer: 1,
        explain: '表格寫 `<slot name="cell-status" :row="row">`，頁面用 `#cell-status="{ row }"` 取資料。作用域 slot 讓表格決定有哪些列、把每一列的資料交出去，頁面決定那一格的畫面；新增頁面不用改表格元件。用 prop 加 `v-if` 會讓元件隨需求越長越大；provide 適合跨層共用的設定，不適合傳一塊畫面；複製元件會讓同一個 bug 要修好幾次。',
      },
      {
        q: '父元件這樣使用 `AppointmentList`，執行時會發生什麼？',
        code: `<!-- AppointmentList.vue 的模板 -->
<li v-for="a in items" :key="a.id">
  <slot :appointment="a">{{ a.patientName }}</slot>
</li>

<!-- 父元件 -->
<AppointmentList :items="items">
  <b>{{ a.patientName }}</b>
</AppointmentList>`,
        lang: 'vue',
        options: [
          '每一列顯示粗體的病患姓名，`a` 從子元件的 `v-for` 取得',
          '每一列顯示子元件的備用內容 `a.patientName`，因為父元件沒寫 `#default`',
          '編譯失敗：slot 內容裡不能讀任何變數，只能放靜態的 HTML',
          '警告找不到 `a` 並出錯；要用 `#default="{ appointment }"` 取 slot 參數',
        ],
        answer: 3,
        explain: 'slot 內容寫在父元件的模板裡，屬於父元件的作用域，讀不到子元件 `v-for` 的變數 `a`，所以 Vue 警告 `Property "a" was accessed during render but is not defined on instance`，接著讀 `undefined.patientName` 出錯。子元件交出的資料要從作用域 slot 的參數拿：`<template #default="{ appointment }">`。沒有包 `<template>` 的內容會進預設 slot，不會顯示備用內容；編譯本身會通過。',
      },
      {
        q: '`App.vue` 寫 `provide(\'clinic\', clinic.value)`（`clinic` 是 ref）。管理者在設定頁換了院區（`clinic.value = newClinic`），深層的 `TimeCell` 顯示的時區沒有更新。原因與修法是？',
        options: [
          'provide 的是當下的物件；改成 provide ref 本身（可包 `readonly`）',
          '`inject` 只在元件建立時讀一次，要在 `TimeCell` 裡用 `watch` 監看 inject 的回傳值',
          'provide 的 key 要用 `Symbol` 才會有響應式，字串 key 不會更新',
          'provide 只能傳給直接的子元件，`TimeCell` 隔了太多層所以收不到更新',
        ],
        answer: 0,
        explain: '`clinic.value` 是當下那個物件，整個換掉 `.value` 之後，後代手上仍是舊物件。提供 ref 本身，例如 `provide(clinicKey, readonly(clinic))`，後代讀 `.value` 時就會追蹤到更換；包 `readonly` 讓後代只能讀。key 用 Symbol 是為了避免撞名，和響應式無關；inject 拿到 ref 就會更新，不需要另外 watch；provide 對任何一層後代都有效。',
      },
    ],
  },
  {
    skill: 'watchers',
    questions: [
      {
        q: '下列哪一個需求適合用 `watch`，而不是 `computed`？',
        options: [
          '使用者輸入搜尋字串時，篩選出符合的病患清單',
          '預約清單有變動時，重新計算今天已報到的人數',
          '科別或日期改變時，呼叫 API 重抓時段，並把條件寫進網址 query',
          '生日欄位改變時，把它格式化成「2026 年 11 月 20 日」的字串顯示',
        ],
        answer: 2,
        explain: '呼叫 API 與改網址是「資料變了要做的事」（副作用），用 watch。篩選、計數、格式化都能從現有狀態算出來，用 computed：有快取、不需要第二份狀態同步，第一次渲染就有值。用 watch 去維護這些值，會多一份要同步的狀態。',
      },
      {
        q: '這段程式執行後，Console 會印出什麼？',
        code: `const selected = ref([])

watch(selected, (list) => {
  console.log('已選', list.length)
})

selected.value.push(101)`,
        lang: 'js',
        options: [
          '什麼都不印：`push` 沒有換掉 `.value`，監看 ref 預設不深層',
          '`已選 1`：Vue 3 的 Proxy 追蹤得到陣列的 `push`，監看 ref 也一樣',
          '`已選 0`：callback 在 `push` 之前就執行，讀到的是空陣列',
          '`已選 1` 印兩次：watch 建立時一次，`push` 之後再一次',
        ],
        answer: 0,
        explain: '直接監看 ref 時，Vue 只在 `.value` 換成另一個值時觸發；`push` 改的是陣列內容，陣列本身還是同一個。要加 `{ deep: true }`，或監看 `() => selected.value.length`。監看 reactive 物件才會自動深層。`watch` 預設也不會在建立時執行，需要的話加 `immediate: true`。',
      },
      {
        q: '時段查詢頁寫 `watch(dept, async (d) => { slots.value = await fetchSlots(d) })`。使用者快速切換科別時，偶爾顯示前一個科別的時段。怎麼改？',
        options: [
          '加上 `immediate: true`，讓 watcher 一建立就先抓一次',
          '改成 `watchEffect`，讓 Vue 自動收集依賴並依序執行',
          '加上 `flush: \'post\'`，等 DOM 更新完成之後才送出請求',
          '用 `onWatcherCleanup` 取消上一次的請求',
        ],
        answer: 3,
        explain: '多個請求同時在路上，回應順序不保證，慢的舊請求會在新請求之後寫入。在 callback 開頭建立 `AbortController`，在第一個 `await` 之前寫 `onWatcherCleanup(() => controller.abort())`；它在下一次觸發前執行，取消上一個請求；被取消的 `await` 丟出 `AbortError`，`catch` 裡略過它。`immediate` 只影響第一次；`watchEffect` 一樣有競態；`flush` 改的是 callback 相對於 DOM 更新的時機。',
      },
    ],
  },
  {
    skill: 'forms',
    questions: [
      {
        q: '手機號碼欄位要在手機上叫出數字鍵盤，送到後端的值要保留開頭的 0。哪一種寫法正確？',
        options: [
          '`<input v-model.number="phone" inputmode="numeric">`',
          '`<input type="number" v-model="phone" autocomplete="tel">`',
          '`<input v-model="phone" inputmode="numeric" autocomplete="tel">`',
          '`<input type="tel" v-model.number="phone" autocomplete="tel">`',
        ],
        answer: 2,
        explain: '`inputmode="numeric"` 只改鍵盤，`v-model` 綁出來仍是字串，`0912345678` 保持原樣。`.number` 用 `parseFloat` 轉成數字，開頭的 0 不見，`type="tel"` 也救不回來；`type="number"` 的輸入框也會自動轉成數字，還會出現上下調整的箭頭。電話、郵遞區號這類「長得像數字的字串」都該保留字串。',
      },
      {
        q: '使用者勾了「發燒」，會發生什麼？',
        code: `<script setup>
import { ref } from 'vue'
const symptoms = ref('')
</script>

<template>
  <label><input type="checkbox" value="fever" v-model="symptoms"> 發燒</label>
  <label><input type="checkbox" value="cough" v-model="symptoms"> 咳嗽</label>
</template>`,
        lang: 'vue',
        options: [
          '`symptoms` 變成 `\'fever\'`，只有發燒被勾選',
          '`symptoms` 變成 `[\'fever\']`，Vue 會自動把字串換成陣列',
          'Console 警告 `v-model` 的型別不符，勾選沒有作用',
          '`symptoms` 變成 `true`，兩個 checkbox 都顯示成已勾選',
        ],
        answer: 3,
        explain: '多個 checkbox 綁同一個值時，Vue 依初始值的型別決定行為：是陣列才當成多選，把勾選項目的 `value` 放進陣列；不是陣列就當成單一 checkbox，綁布林值。所以勾一個後值變成 `true`，每個 checkbox 都顯示勾選。Vue 不會自動轉型，也不會警告；多選要把初始值寫成 `ref([])`。',
      },
      {
        q: '掛號表單一打開，每個欄位下方都是紅字「必填」。需求是錯誤在使用者離開欄位後才出現，按送出時再全部顯示。最合適的做法是？',
        options: [
          '把驗證掛在 `@input`，使用者每打一個字就重新檢查並顯示錯誤',
          '用 `@blur` 記下 touched，touched 或按過送出後才顯示錯誤',
          '改用 `v-model.lazy`，值在 `change` 時才同步，錯誤自然晚一點出現',
          '拿掉前端驗證，送出後等後端回 `422` 再把錯誤顯示在欄位下',
        ],
        answer: 1,
        explain: '錯誤該不該顯示，除了值合不合法，還要看使用者碰過這個欄位沒有；按送出時全部標成 touched，並把焦點移到第一個錯的欄位。`@input` 會讓錯誤在打字途中就出現；`.lazy` 只改同步的時機，空欄位一開始就不合法，紅字照樣出現；只靠後端驗證要等送出才有回饋。前端驗證是即時回饋，後端驗證仍然要做。',
      },
    ],
  },
  {
    skill: 'composables',
    questions: [
      {
        q: '一個 composable 回傳 `reactive({ data: null, loading: false })`，元件寫 `const { data, loading } = useFetch(url)`。結果是？',
        options: [
          '拿到當下的 `null` 與 `false`，資料回來後畫面不更新',
          '正常運作：reactive 物件解構後的屬性仍然是響應式的',
          '編譯錯誤：Vue 不允許 composable 回傳 reactive 物件',
          '正常運作，只是 Console 會出現解構 reactive 的效能警告',
        ],
        answer: 0,
        explain: '解構 reactive 物件時，讀屬性的那一刻拿到的是普通值，之後和原物件沒有關係。Vue 官方的慣例是回傳 `{ data, loading }` 這種一般物件、每個值是 ref，解構後仍連著 composable 裡的狀態。Vue 不會因此報錯或警告，畫面只是不更新。',
      },
      {
        q: '使用者把日期改成 `2026-11-21` 之後，會發生什麼？',
        code: `// 元件裡
const date = ref('2026-11-20')
const { data } = useFetch('/api/slots?date=' + date.value)

// useFetch 內部
export function useFetch(url) {
  const data = ref(null)
  watchEffect(async () => {
    const res = await fetch(toValue(url))
    data.value = await res.json()
  })
  return { data }
}`,
        lang: 'js',
        options: [
          '`watchEffect` 追蹤到 `date`，重新抓 11/21 的資料',
          '`toValue` 會把字串轉回 ref，所以會重新抓',
          '不會重抓：傳進去的是算好的字串，沒有響應式依賴',
          '丟出錯誤：`toValue` 只接受 ref，不接受字串',
        ],
        answer: 2,
        explain: '`\'/api/slots?date=\' + date.value` 在呼叫 `useFetch` 時就算成字串，`date` 的讀取發生在 composable 外面，沒有被任何 effect 追蹤。改傳 getter `() => \'/api/slots?date=\' + date.value` 後，`toValue(url)` 在 `watchEffect` 裡呼叫它、讀到 `date.value`，日期一改就重新執行。`toValue` 對字串原樣回傳，不會出錯。',
      },
      {
        q: '一個 composable 在模組頂層宣告 `const draft = ref(\'\')`，函式裡回傳它。兩個掛號 Dialog 同時開啟時，在其中一個打的字出現在另一個。原因是？',
        options: [
          'Vue 的 ref 預設全域共用，同名的 ref 會指到同一份',
          'composable 同時只能掛在一個元件上，第二個會沿用第一個',
          '兩個 Dialog 沒有各自呼叫一次 composable',
          'ref 宣告在函式外面，所有呼叫者共用同一份',
        ],
        answer: 3,
        explain: '模組頂層的程式只在第一次 import 時執行一次，那個 ref 被所有呼叫者共用。composable 函式裡宣告的 ref 才會每次呼叫各建一份，要每個元件一份就把 ref 移進函式裡。ref 本身沒有全域或局部之分，要看它在哪裡建立；就算兩個 Dialog 各呼叫一次，回傳的仍是同一個頂層 ref。',
      },
    ],
  },
  {
    skill: 'pinia',
    questions: [
      {
        q: '下列狀態，哪一個最適合放進 Pinia store？',
        options: [
          '預約清單目前的頁碼與排序方式，換頁回來時要還原',
          '目前登入的醫師與他的權限，頁首、選單與路由守衛都要讀',
          '掛號表單輸入到一半的姓名與電話，送出前都要保留',
          '某一個確認 Dialog 是否開啟，父子元件都要知道',
        ],
        answer: 1,
        explain: '登入者與權限跨好幾個頁面與元件共用，換頁後還要在，適合放 store。頁碼與排序放網址 query，才能分享連結、按上一頁回得去；輸入到一半的表單與 Dialog 開關只屬於一個元件，留在元件裡。',
      },
      {
        q: '頁首元件已經顯示之後，使用者才完成登入（store 的 `user` 被設定）。頁首會怎樣？',
        code: `<script setup>
import { useSessionStore } from '@/stores/session'
const { user, logout } = useSessionStore()
</script>

<template>
  <span>{{ user ? user.name : '訪客' }}</span>
  <button v-if="user" type="button" @click="logout">登出</button>
</template>`,
        lang: 'vue',
        options: [
          '顯示醫師的名字和登出按鈕，因為 store 是全域共用的',
          '丟出錯誤：store 的 action 不能解構，要寫 `store.logout()`',
          '登出按鈕出現，名字仍然顯示「訪客」，只有 action 會更新',
          '仍然顯示「訪客」、沒有登出按鈕：解構拿到當下的 `null`',
        ],
        answer: 3,
        explain: 'store 是 reactive 物件，直接解構 state 拿到的是當下的值，之後不會變，所以名字與按鈕都停在未登入的樣子。`storeToRefs(store)` 把 state 與 getter 轉成 ref；action 綁在 store 上，可以直接解構。',
      },
      {
        q: '`src/router.ts` 的最外層寫了 `const session = useSessionStore()`，`main.ts` 先 `import { router } from \'./router\'`，之後才 `app.use(createPinia())`。啟動時丟出 `"getActivePinia()" was called but there was no active Pinia`。怎麼改？',
        options: [
          '把 `useSessionStore()` 移到 `router.beforeEach` 的函式裡呼叫',
          '把 session store 從 setup store 改寫成 option store',
          '在 `router.ts` 裡另外呼叫 `createPinia()` 建立一個實例',
          '把 store 的 id 改成和檔名一樣的 `router`，讓 Pinia 找得到',
        ],
        answer: 0,
        explain: '模組最外層的程式在 import 時就執行，這時還沒 `app.use(pinia)`。把呼叫移進守衛函式，等到真的導航時才執行，那時 Pinia 已經安裝好了。另外 `createPinia()` 會得到和 App 不同的實例，兩邊的狀態對不起來；store 的寫法與 id 都和這個錯誤無關。',
      },
    ],
  },
  {
    skill: 'vue-router',
    questions: [
      {
        q: '使用者從 `/patients/7` 點到 `/patients/8`，兩個網址都對到 `PatientPage`。下列哪一個敘述正確？',
        options: [
          'Vue Router 卸載舊的 PatientPage 再掛載新的，`onMounted` 會再執行一次',
          '沿用同一個元件實例，`onMounted` 不會再執行',
          '網址會改變，但 `route.params` 要重新整理頁面後才會更新',
          '要在路由設定加上 `reuse: false`，畫面才會更新',
        ],
        answer: 1,
        explain: '同一個路由只換參數時，Vue Router 沿用原本的元件實例，只更新 `route.params`（`props: true` 時是 prop），所以只在 `onMounted` 抓資料的頁面會停在舊資料；要用 `watch` 監看參數或 `onBeforeRouteUpdate` 重抓。`route.params` 會立刻更新；路由設定沒有 `reuse` 這個選項，要強迫重建可以在 `<RouterView>` 加 `key`。',
      },
      {
        q: '沒登入的使用者打開 `/appointments`，會發生什麼？',
        code: `router.beforeEach((to) => {
  const session = useSessionStore()
  if (!session.user) return '/login'
})`,
        lang: 'js',
        options: [
          '導向 `/login` 一次，顯示登入頁，使用者可以登入',
          '停在 `/appointments`，因為守衛沒有呼叫 `next()`',
          '一直導向 `/login`，Vue Router 偵測到無窮導向後中止並警告',
          '顯示空白頁，因為守衛只能回傳 `true` 或 `false`，不能回傳字串',
        ],
        answer: 2,
        explain: '回傳位置會觸發一次新的導航，新的導航同樣經過 `beforeEach`；`/login` 也沒登入，於是又回傳 `/login`。Vue Router 偵測到後中止並警告 `Detected a possibly infinite redirection in a navigation guard…`。要先排除 `/login` 這類不需要登入的頁面。守衛可以回傳字串或位置物件，不需要 `next`。',
      },
      {
        q: '部署到 nginx 後，從首頁點進 `/patients/7` 正常，在這一頁按重新整理卻出現 nginx 的 404。最可能的原因與修法是？',
        options: [
          '前端路由少了 `/:pathMatch(.*)*` 的 404 頁，加上之後重新整理就正常',
          '只能改用 `createWebHashHistory()`，history 模式沒有辦法重新整理',
          '`PatientPage` 是懶載入的，chunk 找不到，改成直接 import 就好',
          '伺服器沒有 `/patients/7` 這個檔；nginx 要回 `index.html` 當 fallback',
        ],
        answer: 3,
        explain: '從首頁點進去時，換頁由前端的 History API 處理，伺服器不知道；重新整理時瀏覽器向伺服器要 `/patients/7`，沒有 fallback 就回 404；nginx 加 `try_files $uri $uri/ /index.html`。前端的 404 路由只有在 `index.html` 載入之後才派得上用場；hash 模式是一種替代方案，不是唯一解；懶載入與這個 404 無關。',
      },
    ],
  },
  {
    skill: 'react-mapping',
    questions: [
      {
        q: 'Vue 的 `const available = computed(() => slots.value.filter((s) => s.left > 0))`，在 React 19 最直接的寫法是？',
        options: [
          '`useEffect(() => setAvailable(slots.filter((s) => s.left > 0)), [slots])`',
          '在元件函式裡直接寫 `const available = slots.filter((s) => s.left > 0)`',
          '`const [available] = useState(slots.filter((s) => s.left > 0))`',
          '`const available = useRef(slots.filter((s) => s.left > 0))`',
        ],
        answer: 1,
        explain: 'React 每次渲染都重新執行元件函式，衍生值直接算就會是最新的，計算成本高時才包 `useMemo`。用 `useEffect` 加 `setState` 同步，會多一次渲染，第一次渲染還拿到舊值；`useState` 的初始值只在第一次使用，之後 `slots` 改變也不會更新；`useRef` 的值不會觸發渲染。',
      },
      {
        q: '這個元件跑了幾秒之後，畫面顯示什麼？',
        code: `function Counter() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <p>{count}</p>
}`,
        lang: 'js',
        options: [
          '停在 1：callback 記住的是第一次渲染的 `count`（0）',
          '每秒加一：1、2、3……，`setCount` 每次都讀到最新的 `count`',
          '一直是 0：`setInterval` 裡不能呼叫 setter',
          'Console 出現 `Too many re-renders`，畫面停止更新',
        ],
        answer: 0,
        explain: '依賴陣列是空的，effect 只在第一次渲染後執行，裡面的箭頭函式記住了那一次的 `count`，也就是 0。之後每秒都呼叫 `setCount(1)`，值沒變。更新函式 `setCount((c) => c + 1)` 由 React 傳入目前的值。Vue 寫 `count.value++` 每次都讀最新的值，沒有這個問題。',
      },
      {
        q: '把 Vue 的 `watch(dept, load, { immediate: true })` 改寫成 React，AI 產出 `useEffect(() => { load(dept) })`（沒有第二個參數），`load` 抓完資料會 `setSlots`。上線後會發生什麼？',
        options: [
          '只在 `dept` 改變時抓一次，和 Vue 的行為相同',
          '只在第一次渲染後抓一次，之後切換 `dept` 不會重抓',
          'Console 出現 `Rendered more hooks than during the previous render.`',
          '每次渲染後都執行，`setSlots` 又引起渲染，請求停不下來',
        ],
        answer: 3,
        explain: '沒有依賴陣列的 effect 在每次渲染後都執行，資料回來 `setSlots` 又引起渲染，形成迴圈。要加依賴陣列 `[dept]`，它才相當於 Vue 的「指定來源」；空陣列 `[]` 才是只在第一次執行。`Rendered more hooks…` 是 hook 寫在條件式裡的錯誤，和依賴陣列無關。',
      },
    ],
  },
]
