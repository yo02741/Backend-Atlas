// 題庫：JavaScript 與 TypeScript
export default [
  {
    skill: 'js-essentials',
    questions: [
      {
        q: '這段程式執行後，`labels` 的內容是什麼？',
        code: `const clinics = [
  { room: '101', waiting: 12 },
  { room: '112', waiting: 0 },
  { room: '108' },
]
const labels = clinics.map((c) => \`\${c.room}：\${c.waiting || '未提供'}\`)`,
        lang: 'js',
        options: [
          '`["101：12", "112：0", "108：未提供"]`',
          '`["101：12", "112：未提供", "108：未提供"]`',
          '`["101：12", "112：0", "108：undefined"]`',
          '`["101：12", "112：未提供", "108：undefined"]`',
        ],
        answer: 1,
        explain: '`||` 在左邊是任何 falsy 值時都換成右邊，0 也算，所以 112 診顯示「未提供」；108 沒有 `waiting`，值是 `undefined`，同樣被換掉。要讓 0 照樣顯示、只有缺值時才寫「未提供」，改用 `??`，它只在 `null` 與 `undefined` 時換成預設值。',
      },
      {
        q: '這段想把每筆掛號轉成 `{ id, label }` 的程式，執行時會怎樣？',
        code: `const rows = appointments.map((a) => {
  id: a.id,
  label: \`\${a.dept} \${a.time}\`,
})`,
        lang: 'js',
        options: [
          '`rows` 是物件陣列，每筆都有 `id` 與 `label`',
          '`rows` 的每一筆都是 `undefined`，不會有錯誤訊息',
          '解析時就丟出 `SyntaxError`，這個檔案完全不會執行',
          '`rows` 的每一筆都是只有 `id` 欄位的物件',
        ],
        answer: 2,
        explain: '箭頭函式後面的大括號被當成函式本體，`id:` 被當成 label，接著的 `, label:` 不是合法的語法，Chrome 報 `SyntaxError: Unexpected token \':\'`。只有一個欄位時（`(a) => { id: a.id }`）不會報錯，而是每筆都回傳 `undefined`，更難發現。回傳物件要包一層括號：`(a) => ({ id: a.id, label: … })`。',
      },
      {
        q: '掛號清單元件收到 props `appointments`，AI 寫了 `const sorted = computed(() => props.appointments.sort((a, b) => a.time.localeCompare(b.time)))`。這段的問題是什麼？',
        options: [
          '`sort` 直接改了父元件傳進來的陣列，父元件與其他用到它的地方順序都會變；改用 `toSorted`',
          '沒有問題，`computed` 會先把陣列複製一份，再交給 `sort` 排序',
          '`sort` 不接受比較函式，比較字串時要把 `sort` 換成 `localeCompare`',
          '`computed` 裡不能呼叫陣列方法，排序要改放在 `watch` 的回呼裡',
        ],
        answer: 0,
        explain: '`sort` 就地排序並回傳原陣列。props 的陣列屬於父元件，在子元件的 computed 裡排序，父元件的清單、共用同一個陣列的下拉選單順序都會被改掉，Vue 也不會警告。`toSorted`（ES2023）或 `[...list].sort(…)` 先複製再排。computed 不會自動複製；`sort` 本來就接受比較函式。',
      },
    ],
  },
  {
    skill: 'values-references',
    questions: [
      {
        q: '這段程式最後印出什麼？',
        code: `const appt = { id: 501, status: 'booked', patient: { name: '王小明' } }
const copy = { ...appt }
copy.status = 'cancelled'
copy.patient.name = '王大明'
console.log(appt.status, appt.patient.name)`,
        lang: 'js',
        options: [
          '`booked 王小明`',
          '`cancelled 王大明`',
          '`booked 王大明`',
          '`cancelled 王小明`',
        ],
        answer: 2,
        explain: '展開只複製第一層：`copy.status` 是新的欄位，改它不影響 `appt`；`copy.patient` 和 `appt.patient` 指向同一個物件，改名字就改到原資料。要改內層又不動原資料，逐層展開 `{ ...appt, patient: { ...appt.patient, name } }`，或用 `structuredClone` 整份複製。',
      },
      {
        q: '編輯 Dialog 開啟時寫 `const draft = structuredClone(props.appointment)`，而 `props.appointment` 是父元件 `reactive` 清單裡的一筆。會發生什麼事？',
        options: [
          '正常複製出一份深拷貝，每一層都是新的物件',
          '丟出 `DataCloneError`：拿到的是 Vue 的 Proxy，要先 `toRaw()` 再複製',
          '複製成功，但複本仍是 reactive，改它會一起改到父元件',
          '只複製第一層，效果和展開語法 `{ ...obj }` 一樣',
        ],
        answer: 1,
        explain: '`reactive` 清單裡的物件透過 Proxy 交出來，`structuredClone` 複製不了 Proxy，訊息是 `DataCloneError: … #<Object> could not be cloned.`。寫成 `structuredClone(toRaw(props.appointment))` 才會得到每一層都是新物件的一般資料。`structuredClone` 成功時會複製每一層。',
      },
      {
        q: '門診看板用 `const clinics = shallowRef([])` 存 API 回來的資料。新增一個診間時寫 `clinics.value.push(newClinic)`，畫面沒有出現新的那一筆。怎麼改最直接？',
        options: [
          '改成 `clinics.value = [...clinics.value, newClinic]`，換成一個新陣列',
          '在 `push` 之後 `await nextTick()`，等 Vue 把 DOM 更新完',
          '把 `push` 搬進 `watch(clinics, …)` 的回呼裡執行',
          '改寫成 `clinics.value.concat(newClinic)`，不用 `push`',
        ],
        answer: 0,
        explain: '`shallowRef` 只追蹤 `.value` 本身有沒有被換掉；`push` 改的是同一個陣列，Vue 不知道有變更。換成新陣列才會觸發更新（或改完呼叫 `triggerRef(clinics)`）。`nextTick` 只等已經排好的更新，這裡沒有更新被排進去；`concat` 回傳新陣列卻沒有指定回 `.value`，等於沒做。',
      },
    ],
  },
  {
    skill: 'modules',
    questions: [
      {
        q: '報表頁打開是白的。Console 最可能出現哪個錯誤？',
        code: `// src/utils/date.js
export default function formatDate(d) { /* … */ }

// src/views/ReportView.vue 的 <script setup>
import { formatDate } from '@/utils/date.js'`,
        lang: 'js',
        options: [
          '`TypeError: formatDate is not a function`，在呼叫的那一行才出現',
          '`SyntaxError: The requested module … does not provide an export named \'formatDate\'`，載入時就失敗',
          '`ReferenceError: formatDate is not defined`，在呼叫的那一行才出現',
          '不會出錯：找不到具名匯出時，瀏覽器會改拿預設匯出',
        ],
        answer: 1,
        explain: '`date.js` 只有預設匯出，`ReportView` 卻用大括號要具名匯出 `formatDate`。瀏覽器在執行任何一行之前就檢查匯入與匯出，對不上就丟出 SyntaxError，整個模組圖都不執行，所以畫面是白的。修法是改成 `import formatDate from …`，或把 `date.js` 改成 `export function formatDate`。',
      },
      {
        q: 'AI 加了一個套件，PR 裡只有 `package.json` 多了一行，`package-lock.json` 沒有變更。CI 用 `npm ci` 安裝時會怎樣？',
        options: [
          '依 `package.json` 的版本範圍安裝新套件，裝完自動更新 lock 檔',
          '略過 lock 檔裡沒有的套件，建置到 import 那一行才失敗',
          '直接失敗，訊息說 `package.json` 與 `package-lock.json` 沒有同步',
          '照 lock 檔安裝其他套件，新套件改從 CDN 載入',
        ],
        answer: 2,
        explain: '`npm ci` 完全照 lock 檔安裝、不會修改 lock 檔；兩個檔對不上時以 `EUSAGE` 失敗，訊息是 `can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync`。在本機跑 `npm install` 更新 lock 檔，兩個檔一起提交。',
      },
      {
        q: '報表頁用到一個 400 KB 的圖表套件，其他頁都用不到。要讓首頁不必下載它，應該怎麼要求？',
        options: [
          '把圖表套件從 `dependencies` 移到 `devDependencies`',
          '在 `main.js` 用 `import * as charts from` 取代具名匯入',
          '在 `index.html` 加一個 `<script type="module" defer>` 載入它',
          '報表頁的路由改成 `() => import(\'./views/ReportView.vue\')`，圖表套件只在那一頁 import',
        ],
        answer: 3,
        explain: '動態 `import()` 讓 Vite 把報表頁與只有它用到的套件拆成獨立的 chunk，進那一頁才下載。放在哪一區不影響 bundle，Vite 只看程式 import 了什麼；`import * as` 仍是靜態匯入，照樣打進主 bundle；在 HTML 另外載入則每一頁都會下載，還繞過了 Vite 的打包。',
      },
    ],
  },
  {
    skill: 'async-js',
    questions: [
      {
        q: '三支 API 互不相依。這個 `load()` 大約要多久，怎麼改最直接？',
        code: `async function load() {
  const me = await getMe()                // 約 300 ms
  const list = await getAppointments()    // 約 500 ms
  const notices = await getNotices()      // 約 200 ms
  return { me, list, notices }
}`,
        lang: 'js',
        options: [
          '約 500 ms；`await` 會讓三個請求自動平行',
          '約 1000 ms；先呼叫三個函式送出請求，再用 `Promise.all` 一起等',
          '約 1000 ms；把三個 `await` 拿掉就會平行，結果也拿得到',
          '約 200 ms；`await` 只會等最快的那一個',
        ],
        answer: 1,
        explain: '一行一個 `await` 時，下一個請求等上一個回來才送出，總時間是相加的約 1000 ms。先把三個函式都呼叫（請求同時送出）再用 `Promise.all` 一起等，總時間約等於最慢的 500 ms。拿掉 `await` 雖然會平行，但變數拿到的是 Promise 本身，不是資料。',
      },
      {
        q: '首頁的公告服務失敗時，掛號清單與個人資料仍要照常顯示。三個請求該用哪一個組合函式？',
        options: [
          '`Promise.all`，失敗時其他成功的結果仍會放在陣列裡',
          '`Promise.race`，取最快回來的那一個結果',
          '`Promise.any`，取第一個成功的結果',
          '`Promise.allSettled`，等全部結束後逐一看每個結果的 `status`',
        ],
        answer: 3,
        explain: '`allSettled` 不會失敗，等每個請求都結束後回傳 `fulfilled` 或 `rejected` 與各自的值或原因，各區塊可以分別處理。`Promise.all` 只要一個失敗就整體失敗，拿不到其他結果；`race` 與 `any` 都只給一個結果，另外兩份資料就沒了。',
      },
      {
        q: '這段儲存多筆掛號的程式有什麼問題？',
        code: `async function saveAll(items) {
  loading.value = true
  items.forEach(async (item) => {
    await api.post('/api/appointments', item)
  })
  loading.value = false
  toast('全部已儲存')
}`,
        lang: 'js',
        options: [
          '`forEach` 不等 `async` 回呼：loading 立刻關掉，Toast 在請求完成前就出現，失敗也接不到',
          '沒有問題，`forEach` 會依序等每一個 `await` 完成才往下',
          '`api.post` 不能放在迴圈裡，瀏覽器一次只允許送一個請求',
          '`async` 箭頭函式不能當 `forEach` 的回呼，執行時會出現 SyntaxError',
        ],
        answer: 0,
        explain: '`forEach` 呼叫每個回呼後不管它回傳的 Promise，所有請求一起丟出去，接著馬上關 loading、顯示「全部已儲存」，任何一筆失敗都會變成 `Uncaught (in promise)`。要依序用 `for...of` 加 `await`，要平行用 `await Promise.all(items.map(...))`，再把 loading 放進 `finally`。瀏覽器可以同時送多個請求，語法上也沒有錯。',
      },
    ],
  },
  {
    skill: 'event-loop',
    questions: [
      {
        q: 'Console 依序印出什麼？',
        code: `console.log('A')
setTimeout(() => console.log('B'), 0)
Promise.resolve().then(() => console.log('C'))
;(async () => {
  console.log('D')
  await null
  console.log('E')
})()
console.log('F')`,
        lang: 'js',
        options: [
          'A F D C E B',
          'A D F C E B',
          'A D F E C B',
          'A D E F C B',
        ],
        answer: 1,
        explain: '同步的部分先跑完：A、D（async 函式在第一個 `await` 之前是同步執行的）、F。接著清空 microtask：`then` 的 C 先排進去，`await null` 之後的 E 後排進去，所以 C 在 E 前面。`setTimeout` 的 B 是 task，等 microtask 全部跑完才輪到。',
      },
      {
        q: '按鈕的處理函式先把狀態列的文字改成「處理中…」，接著 `await Promise.resolve()`，再跑一段 800 ms 的同步計算。使用者會看到「處理中…」嗎？',
        options: [
          '會，`await` 讓函式暫停，瀏覽器趁這段空檔渲染',
          '會，但只在 Chrome；Safari 要改用 `setTimeout` 才會',
          '不會，`await Promise.resolve()` 只讓出到 microtask，microtask 清空前不渲染',
          '不會，事件處理函式裡的 `await` 沒有作用，要改用 `.then()`',
        ],
        answer: 2,
        explain: '`await` 一個已完成的 Promise，後面的程式排進 microtask queue；處理函式這個 task 一結束，瀏覽器先清 microtask，800 ms 的計算就在渲染之前跑掉了，畫面直接從原本的文字跳到結果。要讓「處理中…」先畫出來，得讓出到 task 並等過一次繪製，例如 `await new Promise((r) => requestAnimationFrame(() => setTimeout(r)))`。這是事件迴圈的規則，各瀏覽器一致。',
      },
      {
        q: '櫃台反映搜尋框打字要過一秒才出現。Performance 分頁錄下來，每次按鍵後都有一個約 900 ms、標著紅色三角形的 task，裡面是 `filterPatients` 在 2 萬筆資料上逐筆比對。哪個做法對症？',
        options: [
          '輸入加 300 ms 的 debounce，比對切段並讓出主執行緒，或搬到 Web Worker、交給後端搜尋',
          '把 `filterPatients` 改成 `async function`，在函式開頭加一行 `await`',
          '用 `setTimeout(filterPatients, 0)` 包起來，讓比對晚一點才執行',
          '把資料改存進 `shallowRef`，減少 Vue 響應式追蹤的開銷',
        ],
        answer: 0,
        explain: '900 ms 花在同步的比對上，只能少做、切段或移出主執行緒：debounce 減少執行次數，切段讓輸入事件能插進來，Worker 或後端則完全不佔主執行緒。改成 async 不會讓同步迴圈變短，整段仍是一個長 task；`setTimeout` 只是把同一個 900 ms 的 task 往後延；`shallowRef` 省下的追蹤成本遠小於比對本身。',
      },
    ],
  },
  {
    skill: 'ts-basics',
    questions: [
      {
        q: '這段程式在型別檢查與執行時各會怎樣？',
        code: `interface Appointment {
  id: number
  checkedInAt: string | null
}
function checkInTime(a: Appointment) {
  return a.checkedInAt!.slice(11, 16)
}`,
        lang: 'ts',
        options: [
          '型別檢查報 `TS18047`，因為 `checkedInAt` 可能是 `null`',
          '型別檢查通過；遇到未報到（`null`）的資料，執行時丟出 TypeError',
          '型別檢查通過；`!` 會在執行時把 `null` 換成空字串再呼叫 `slice`',
          '型別檢查通過；遇到 `null` 時 `slice` 回傳 `undefined`，不會出錯',
        ],
        answer: 1,
        explain: '`!` 是非空斷言，只叫編譯器把值當成不是 `null`，所以 `TS18047` 不會出現；轉成 JavaScript 後 `!` 直接消失，執行時遇到 `null` 就是 `TypeError: Cannot read properties of null (reading \'slice\')`。正確的寫法是先判斷：`a.checkedInAt === null ? \'未報到\' : a.checkedInAt.slice(11, 16)`。',
      },
      {
        q: 'Vite + Vue + TypeScript 的專案，`npm run dev` 跑起來一切正常，畫面也都能操作。這代表什麼？',
        options: [
          '沒有型別錯誤：Vite 轉譯 `.ts` 時會一併檢查型別',
          '沒有型別錯誤：有錯的話瀏覽器 Console 會印出 TS 錯誤代碼',
          '不代表沒有型別錯誤，但之後的 `vite build` 一定會擋下來',
          '不代表沒有型別錯誤：Vite 只轉譯不檢查，要另外跑 `vue-tsc --noEmit`',
        ],
        answer: 3,
        explain: 'Vite 只把型別拿掉、轉成 JavaScript，不做型別檢查，dev 與 `vite build` 都一樣；型別資訊也不會進到瀏覽器。檢查要跑 `vue-tsc --noEmit`，create-vite 的 Vue + TS 範本把它寫進建置指令 `vue-tsc -b && vite build`，CI 跑 `npm run build` 才會擋下型別錯誤。',
      },
      {
        q: '後端新增了 `\'no-show\'`（未到診）狀態，你在 `Status` 加上它，卻忘了改 `statusText`。執行 `vue-tsc --noEmit` 會怎樣？',
        code: `type Status = 'booked' | 'checked-in' | 'cancelled'

function statusText(s: Status): string {
  switch (s) {
    case 'booked': return '已預約'
    case 'checked-in': return '已報到'
    case 'cancelled': return '已取消'
    default: {
      const unreachable: never = s
      return unreachable
    }
  }
}`,
        lang: 'ts',
        options: [
          '`never` 那一行報 `TS2322`：`"no-show"` 不能指定給 `never`',
          '沒有錯誤；執行時 `statusText(\'no-show\')` 回傳 `undefined`',
          '`switch` 那一行報錯，指出少了 `case \'no-show\'`',
          '沒有錯誤；`default` 分支會在執行時丟出錯誤提醒',
        ],
        answer: 0,
        explain: '處理完三個 `case` 之後，`default` 裡的 `s` 原本只剩 `never`；加了 `\'no-show\'` 之後它變成 `"no-show"`，指定給 `never` 型別的變數就報 `TS2322: Type \'"no-show"\' is not assignable to type \'never\'`。窮舉檢查讓漏處理的狀態在編譯時就被找到。TypeScript 不會在 `switch` 那一行報錯，也不會在執行時自動丟錯。',
      },
    ],
  },
  {
    skill: 'js-debugging',
    questions: [
      {
        q: '開發環境的 Console 出現下面這段。要從哪裡開始查？',
        code: `Uncaught TypeError: Cannot read properties of undefined (reading 'name')
    at ClinicRow.vue:18:42
    at renderComponentRoot (runtime-core.esm-bundler.js:…)
    at ReportView.vue:31:7
    at async loadReport (api.js:12:18)`,
        lang: 'js',
        options: [
          '`api.js:12`：最下面那一行是整串呼叫的源頭',
          '`runtime-core.esm-bundler.js`：錯誤是在 Vue 的渲染裡丟出的',
          '`ClinicRow.vue:18`：第一個自己的 frame，看那一行讀了哪個值的 `name`',
          '`ReportView.vue:31`：錯誤訊息指的是呼叫端，不是被呼叫的元件',
        ],
        answer: 2,
        explain: 'stack trace 最上面是丟出錯誤的地方，`ClinicRow.vue` 第 18 行讀了某個 `undefined` 值的 `name`。從那裡開始，在那一行下中斷點看是哪個值、再往下看呼叫者，追它從哪裡來。Vue runtime 的 frame 是框架內部，通常不是問題所在；最下面的 `api.js` 是最早的呼叫者，離出錯的地方最遠。',
      },
      {
        q: '`vite.config.js` 設了 `build: { sourcemap: \'hidden\' }`。`vite build` 的結果是什麼？',
        options: [
          '不產生 `.map` 檔，正式環境的 stack trace 只有壓縮後的位置',
          '產生 `.map` 檔，但 JS 檔尾不加 `sourceMappingURL`，DevTools 不會自動載入',
          '把 source map 寫進 JS 檔本身，檔案變大但不用另外部署 `.map`',
          '只有開發伺服器提供 source map，`vite build` 一律不產生',
        ],
        answer: 1,
        explain: '`hidden` 和 `true` 一樣產生獨立的 `.map` 檔，差別在 JS 檔尾不加 `//# sourceMappingURL=` 註解，瀏覽器不知道去哪裡找。常見做法是把 `.map` 上傳給錯誤監控服務、不部署到公開網站。寫進 JS 檔本身的是 `inline`；預設的 `false` 才是不產生。',
      },
      {
        q: '`main.js` 已設定 `app.config.errorHandler` 回報錯誤。下面哪一個錯誤不會送到 errorHandler？',
        options: [
          '`onMounted(async () => { await load() })` 裡 `load()` 失敗',
          '`@click="save"` 綁定的 `save` 函式同步丟出錯誤',
          '元件模板渲染時讀了 `undefined` 的屬性',
          '`onMounted` 裡 `setTimeout(() => { throw new Error(\'x\') }, 0)` 的回呼丟出錯誤',
        ],
        answer: 3,
        explain: 'errorHandler 只收得到 Vue 自己呼叫的函式丟出的錯：渲染、生命週期鉤子、事件處理函式，以及它們回傳的 Promise 被拒絕。`setTimeout` 的回呼由瀏覽器在之後的 task 呼叫，不經過 Vue，錯誤會變成 `Uncaught Error`，要用 `window` 的 `error` 事件接。第一個選項的 async 鉤子回傳了 Promise，Vue 會接住它的失敗。',
      },
    ],
  },
  {
    skill: 'ts-runtime-boundary',
    questions: [
      {
        q: '後端把 `roomNo` 改成 `\'3A\'` 這樣的字串。`vue-tsc --noEmit` 與執行時各會怎樣？',
        code: `interface Appointment { id: number; roomNo: number }

const res = await fetch('/api/appointments')
const list: Appointment[] = await res.json()
list.sort((a, b) => a.roomNo - b.roomNo)`,
        lang: 'ts',
        options: [
          '型別檢查通過；執行時也沒有錯誤，只是排序結果錯亂',
          '型別檢查失敗：`res.json()` 的型別和 `Appointment[]` 不符',
          '型別檢查通過；執行時丟出 `TypeError`，指出 `roomNo` 不是數字',
          '型別檢查通過；TypeScript 在執行時把 `\'3A\'` 轉成數字',
        ],
        answer: 0,
        explain: '`res.json()` 回傳 `Promise<any>`，`any` 指定給 `Appointment[]` 不會有型別錯誤。型別在執行時已經不存在，`\'3A\' - 5` 得到 `NaN`，`sort` 拿到 `NaN` 不會丟錯，只是順序沒有意義。要在拿到資料的地方用 schema 檢查，錯誤才會在 API 層出現。',
      },
      {
        q: 'zod 4 的 `z.object({ id: z.number() })` 收到 `{ id: 1, extra: true }`，`safeParse` 的結果是？',
        options: [
          '`success` 是 `false`，錯誤是 `Unrecognized key: "extra"`',
          '丟出 `ZodError`，因為多了沒宣告的欄位',
          '`success` 是 `true`，`data` 是 `{ id: 1 }`，沒宣告的欄位被拿掉',
          '`success` 是 `true`，`data` 原樣保留 `extra`',
        ],
        answer: 2,
        explain: '`z.object()` 預設會移除沒宣告的欄位，結果通過、`data` 只有 `id`。要把多餘欄位當成錯誤用 `z.strictObject()`（錯誤訊息是 `Unrecognized key: "extra"`），要保留用 `z.looseObject()`。`safeParse` 不會丟錯，失敗時回傳 `{ success: false, error }`。',
      },
      {
        q: 'Vite 8 的專案裡，`import.meta.env.VITE_API_BAES` 拼錯了，`vue-tsc` 卻沒有報錯。怎麼讓它報錯？',
        options: [
          '在 `tsconfig` 打開 `strict`',
          '在 `.env` 加一行 `VITE_API_BAES=`',
          '在 `tsconfig` 打開 `noUncheckedIndexedAccess`',
          '在 `env.d.ts` 宣告 `ImportMetaEnv` 的欄位，並在 `ViteTypeOptions` 加上 `strictImportMetaEnv`',
        ],
        answer: 3,
        explain: 'Vite 8 的 `vite/client` 讓沒宣告的 `import.meta.env.XXX` 是 `any`，`strict` 與 `noUncheckedIndexedAccess` 都不會改變這一點。宣告 `ImportMetaEnv` 的欄位並開 `strictImportMetaEnv` 之後，拼錯的名稱會報 `TS2551 … Did you mean \'VITE_API_BASE\'?`。在 `.env` 補一個拼錯的變數，只是讓錯誤更難發現。',
      },
    ],
  },
  {
    skill: 'npm-packages',
    questions: [
      {
        q: 'registry 上有 0.4.9、0.5.0、1.0.0 三個版本。重新解析時，最多會裝到哪一版？',
        code: `"dependencies": {
  "date-tw": "^0.4.2"
}`,
        lang: 'json',
        options: [
          '0.4.9',
          '0.5.0',
          '1.0.0',
          '0.4.2，`^` 在 `0.x` 不允許任何更新',
        ],
        answer: 0,
        explain: '`^` 允許「不改最左邊那個非 0 的數字」的更新。`0.x` 的最左邊非 0 數字是 minor，所以 `^0.4.2` 是 `>=0.4.2 <0.5.0-0`，最多到 0.4.9。0.5.0 與 1.0.0 都超出範圍；patch 更新仍然允許，所以不會停在 0.4.2。',
      },
      {
        q: 'Dockerfile 在 `npm ci` 之前寫了 `ENV NODE_ENV=production`，接著 `npm run build` 失敗，訊息是 `vite: not found`。原因與修法是？',
        options: [
          '`npm ci` 不會建立 `node_modules/.bin`，要改用 `npm install`',
          '`NODE_ENV=production` 時 npm 預設不裝 devDependencies，建置階段不要設它，或用 `npm ci --include=dev`',
          '把 `vite` 移到 `dependencies`，否則 Vite 不會被打包進 bundle',
          'Alpine 的映像沒有 shell，要改用完整的 `node:24` 映像',
        ],
        answer: 1,
        explain: '`NODE_ENV=production` 時，npm 的 `omit` 設定預設是 `dev`，Vite、vue-tsc 這些 devDependencies 都沒裝。`npm ci` 照樣會建立 `.bin`；Vite 是建置工具，本來就不會進 bundle，bundle 的內容只看程式 import 了什麼；Alpine 映像有 shell。正式環境的設定放在建置之後的階段。',
      },
      {
        q: '升級到 npm 12 之後，`npm install` 結束時出現下面的警告，套件的功能也壞了。該怎麼處理？',
        code: `npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   @clinic/thumbs@2.1.0 (install: node-gyp rebuild)`,
        lang: 'bash',
        options: [
          '在 CI 加上 `--dangerously-allow-all-scripts`，恢復 npm 11 的行為',
          '把 npm 降回 11 版，避免安裝腳本被擋',
          '加上 `--ignore-scripts`，警告會消失，功能不受影響',
          '先看這個腳本做什麼，確定需要後執行 `npm approve-scripts @clinic/thumbs`，把允許清單寫進 `package.json` 的 `allowScripts`',
        ],
        answer: 3,
        explain: 'npm 12 預設不執行依賴的安裝腳本，只有 `allowScripts` 允許的才會跑；`npm approve-scripts` 會寫入這個欄位，預設釘住目前的版本，升版時要重新審查。`--dangerously-allow-all-scripts` 與降版都讓所有套件的腳本照樣執行，等於放棄這道防線；`--ignore-scripts` 讓這個需要編譯原生模組的套件一樣壞掉。',
      },
    ],
  },
]
