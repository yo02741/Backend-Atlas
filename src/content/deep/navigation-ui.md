## 從一個具體問題開始：按上一頁，回到第 1 頁

櫃台用後台的「門診管理」查預約：切到「已報到」分頁，翻到第 4 頁，點進一位病患看詳細資料，再按瀏覽器的上一頁。畫面回到「預約」分頁的第 1 頁，捲動位置在最上面。一個早上重複幾十次，櫃台開始改用開新分頁的方式看詳細資料，結果發現詳細資料的連結是 `<div @click>`，按中鍵與右鍵都沒有「在新分頁開啟」。

同一個後台還有幾個導覽的問題：

- 頂端的「預約」「病患」「報表」用 `role="tab"` 做，螢幕閱讀器使用者按下去以為只是切換分頁內容，不知道已經換了一頁。
- 側欄的目前頁只換了底色，沒有 `aria-current`，螢幕閱讀器不知道現在在哪一頁。
- 病患清單用無限捲動，頁尾的「聯絡資訊室」連結永遠點不到。

導覽元件要回答兩件事：使用者現在在哪裡、可以去哪裡。答案要同時出現在畫面、網址與輔助科技讀到的資訊裡。

## 運作原理

### 七種導覽元件

| 元件 | 換頁還是同頁切換 | 結構 | 目前位置 |
|---|---|---|---|
| Navbar | 換頁 | `<nav aria-label="主要導覽">` 加連結清單 | `aria-current="page"` |
| Sidebar | 換頁 | 同上；收合按鈕是 disclosure（`aria-expanded`） | `aria-current="page"` |
| Breadcrumb | 換頁 | `<nav aria-label="Breadcrumb">` 加 `<ol>` | 最後一項 `aria-current="page"` |
| Tabs | 同頁切換 | `tablist`、`tab`、`tabpanel` | `aria-selected="true"` |
| Stepper | 流程中的步驟 | 有序清單，已完成的步驟可以是連結或按鈕 | `aria-current="step"` |
| Pagination | 換頁（換 query） | `<nav aria-label="分頁">` 加連結 | `aria-current="page"` |
| 無限捲動、載入更多 | 同一頁加資料 | 清單；APG 有 Feed 模式 | 無 |

同一頁有兩個以上的 `<nav>` 時，用 `aria-label` 區分，螢幕閱讀器的地標清單才分得出哪個是哪個。

### 連結、Tabs 與選單

判斷的方式只看一件事：按下去網址會不會變、是不是在看另一頁的內容。

- 會換網址：連結。外觀做成分頁的樣子也一樣是連結，目前那一個加 `aria-current="page"`。
- 不換網址、在同一頁切換幾塊內容：Tabs。
- 網站導覽的下拉選單：APG 的 Disclosure Navigation Menu 範例用一顆 disclosure 按鈕（`aria-expanded`）展開一串連結，並特別註明它沒有用 `role="menu"`，因為一般的網站導覽不需要 menu 角色要求的那整套鍵盤操作。`role="menu"` 留給應用程式裡「一串動作」的選單（編輯、複製、刪除）。

### `aria-current` 的值

| 值 | 用在 |
|---|---|
| `page` | 導覽、Breadcrumb、Pagination 裡的目前頁 |
| `step` | Stepper 的目前步驟 |
| `location` | 流程圖、地圖上的目前位置 |
| `date` | 日曆裡的今天 |
| `time` | 時刻表裡的目前時段 |
| `true` | 以上都不適合時 |

`aria-current` 和 `aria-selected` 不同：`aria-selected` 用在可以選取的元件（Tabs、listbox 的選項、Grid 的格子），`aria-current` 標的是「一組項目裡目前的那一個」。

樣式也掛在這個屬性上（`[aria-current="page"] { … }`），畫面上的「目前」和螢幕閱讀器念出的「目前」來自同一個地方。Vue Router 的 `<RouterLink>` 在連結完全符合目前路由時，自動加上 `aria-current="page"` 與 `router-link-exact-active` 這個 class；部分符合（例如在 `/clinics/101` 時的 `/clinics`）只加 `router-link-active`。

### 導覽狀態與網址

| 狀態 | 放網址嗎 | 理由 |
|---|---|---|
| 目前在哪一頁（路由） | 放在 path | 本來就是 |
| 頁碼、每頁筆數 | 放 query | 上一頁、重新整理、分享都回得到 |
| 目前的 Tab | 多半放 query | 分享連結時對方看到同一個分頁 |
| 排序、篩選條件 | 放 query | 同上 |
| Sidebar 收合 | 不放，放 localStorage | 個人偏好，不屬於內容 |
| Dialog 開著 | 多半不放 | 重新整理時通常不需要重開 |

寫進網址時要決定用 `push` 還是 `replace`：換頁碼通常用 `push`，按上一頁回到上一頁碼；Tab 切換如果用方向鍵連續切換，每次都 `push` 會讓上一頁要按很多次，可以用 `replace`。這是設計決定，規格寫清楚即可。

捲動位置：瀏覽器的上一頁會嘗試還原捲動位置，SPA 換頁時由路由器處理。Vue Router 的 `scrollBehavior(to, from, savedPosition)` 在按上一頁時拿得到 `savedPosition`，回傳它就會捲回去；但清單的資料如果是回到頁面後才重新抓，捲動的那一刻頁面還不夠長，捲不到原位。

### Tabs 的鍵盤

APG 的 Tabs 模式：

| 按鍵 | 行為 |
|---|---|
| Tab（進入分頁列） | 停在目前的 Tab |
| Tab（在分頁列裡） | 離開分頁列，進入目前的 tabpanel |
| → 、← | 移到下一個、上一個 Tab，到頭時繞回另一端；自動切換時也顯示它的內容 |
| Home、End | （選用）第一個、最後一個 Tab |
| Space、Enter | 手動切換的版本：顯示目前聚焦的 Tab 的內容 |

只有目前的 Tab 是 `tabindex="0"`，其他是 `tabindex="-1"`，焦點移動時跟著換，這個做法叫 roving tabindex。APG 建議 tabpanel 的內容能立刻顯示時用自動切換（焦點移到哪個 Tab 就顯示哪個）；內容要等 API 才出得來時，自動切換會讓方向鍵每移一格就送一個請求，改用手動切換。

AI 有時會產生 `focusgroup="tablist"` 屬性，由瀏覽器處理方向鍵與 roving tabindex。依 2026-11 的 web-features 資料它只有 Chrome 150、Edge 150 起支援，Firefox 與 Safari 都沒有，用了就要載入 polyfill 或保留自己寫的方向鍵處理，不能當成唯一的寫法。

tabpanel 裡沒有可聚焦的元素時，tabpanel 本身加 `tabindex="0"`，按 Tab 才進得去。

### 分頁、載入更多、無限捲動

| | Pagination | 載入更多 | 無限捲動 |
|---|---|---|---|
| 跳到特定位置 | 可以（第 7 頁） | 不行 | 不行 |
| 頁尾 | 到得了 | 到得了 | 到不了，或很難到 |
| 回上一頁的位置 | 頁碼在網址裡，好還原 | 要記住載入了幾批 | 要記住載入了幾批與捲動位置 |
| 適合 | 管理、查詢類清單 | 動態、瀏覽類清單 | 連續瀏覽的內容 |

後端怎麼分頁（offset 或 cursor）會影響前端：cursor 分頁沒有「第 7 頁」，只能上一批、下一批。API 那一側的設計見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。

無限捲動要讓輔助科技讀得懂，APG 有 Feed 模式：容器 `role="feed"`，每一筆是 `article`，帶 `aria-posinset` 與 `aria-setsize`（總數不知道時用 `-1`），載入新資料的過程中容器設 `aria-busy="true"`、完成後改回 `false`。

## 實際程式

把目前的 Tab 寫進網址的 Tabs：

```vue
<script setup>
import { computed, ref, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const TABS = [
  { key: 'booked', label: '預約' },
  { key: 'checked-in', label: '已報到' },
  { key: 'cancelled', label: '已取消' },
]
const route = useRoute()
const router = useRouter()
const current = computed(() => TABS.some((t) => t.key === route.query.tab) ? route.query.tab : 'booked')
const tabEls = ref([])

async function select(key, moveFocus = false) {
  await router.replace({ query: { ...route.query, tab: key, page: undefined } })   // 換 Tab 時頁碼回到第 1 頁
  if (moveFocus) {
    await nextTick()
    tabEls.value[TABS.findIndex((t) => t.key === key)]?.focus()
  }
}

function onKeydown(e, i) {
  const n = TABS.length
  const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key]
  if (next === undefined) return
  e.preventDefault()
  select(TABS[next].key, true)            // 自動切換：焦點移到哪個 Tab 就顯示哪個
}
</script>

<template>
  <div role="tablist" aria-label="預約狀態">
    <button v-for="(t, i) in TABS" :id="`tab-${t.key}`" :key="t.key" ref="tabEls"
            type="button" role="tab"
            :aria-selected="current === t.key" :aria-controls="`panel-${t.key}`"
            :tabindex="current === t.key ? 0 : -1"
            @click="select(t.key)" @keydown="onKeydown($event, i)">
      {{ t.label }}
    </button>
  </div>
  <div :id="`panel-${current}`" role="tabpanel" :aria-labelledby="`tab-${current}`" tabindex="0">
    <AppointmentList :status="current" />
  </div>
</template>
```

Pagination 用連結，頁碼放在 query：

```vue
<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const props = defineProps({ total: { type: Number, required: true }, perPage: { type: Number, default: 20 } })
const route = useRoute()
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.perPage)))
const page = computed(() => Math.min(pages.value, Math.max(1, Number(route.query.page) || 1)))
const to = (p) => ({ query: { ...route.query, page: p === 1 ? undefined : p } })
</script>

<template>
  <nav aria-label="分頁">
    <ol class="pager">
      <li><RouterLink v-if="page > 1" :to="to(page - 1)">上一頁</RouterLink></li>
      <li v-for="p in pages" :key="p">
        <!-- RouterLink 比對時不看 query，每個分頁連結都會被它加上 aria-current；這裡用自己的值蓋過去 -->
        <RouterLink :to="to(p)" :aria-current="p === page ? 'page' : undefined">
          <span class="visually-hidden">第 </span>{{ p }}<span class="visually-hidden"> 頁</span>
        </RouterLink>
      </li>
      <li><RouterLink v-if="page < pages" :to="to(page + 1)">下一頁</RouterLink></li>
    </ol>
  </nav>
</template>
```

`<RouterLink>` 判斷「完全符合」時比的是路由與 params，query 不列入（Vue Router 5.5 的原始碼）；同一個路由、不同 `?page=` 的連結會全部被當成目前頁，全都帶 `aria-current="page"` 與 `router-link-exact-active`。所以分頁自己決定 `aria-current`，樣式也掛在 `[aria-current="page"]` 上，不用那個 class。頁數很多時只顯示目前頁前後幾頁加第一頁、最後一頁，中間用「…」。

:::stop 讀到這裡可以先停：會分辨連結與 Tabs、用 `aria-current` 標目前位置，並把 Tab 與頁碼寫進網址。後面的捲動還原在清單回來時停在頂端才需要，到時再回來讀。

按上一頁時捲回原位，資料要先載完：

```js
const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      // 清單回到頁面後要重新抓資料；等資料出現再捲，否則頁面太短捲不到
      return new Promise((resolve) => {
        window.addEventListener('list-ready', () => resolve(savedPosition), { once: true })
        setTimeout(() => resolve(savedPosition), 1000)     // 最多等 1 秒
      })
    }
    return { top: 0 }
  },
})
```

`list-ready` 是自訂事件，由清單元件在資料載完後 `window.dispatchEvent(new Event('list-ready'))`。另一個做法是把清單資料放進快取（例如 Pinia），回到頁面時先用快取畫出來，捲動就有東西可以捲。

## 常見錯誤

- **主選單做成 Tabs**：會換網址的導覽用了 `role="tab"`，螢幕閱讀器使用者以為沒換頁；Tab 鍵也只停一次，要用方向鍵才能移動，和一般網站的習慣不同。
- **連結用 `div @click` 或 `button` 加 `router.push`**：不能中鍵開新分頁、不能複製網址、右鍵選單沒有「在新分頁開啟」。換頁用 `<RouterLink>`。
- **目前頁只換 class**：Elements 分頁搜尋不到 `aria-current`。
- **Tabs 的每個分頁都是 `tabindex="0"`**：Tab 鍵要一個一個走過所有分頁才進得了內容。
- **自動切換的 Tabs 每次都打 API**：方向鍵移過三個分頁送出三個請求，畫面還可能顯示慢回來的那一個。內容要等 API 時改成手動切換，或先快取。
- **頁碼只在元件狀態裡**：上一頁、重新整理、分享連結都回到第 1 頁。
- **換篩選條件沒有重設頁碼**：在第 5 頁換了篩選，結果只有 2 頁，畫面變成空的。改篩選或 Tab 時把 `page` 拿掉。
- **無限捲動沒擋重複載入**：捲動事件連續觸發，同一頁送出三次，清單出現重複的病患。用 `IntersectionObserver` 觀察清單底部，載入中不再觸發。

AI 產生的導覽常見兩個問題：所有導覽都用 `button` 加 `router.push`，以及分頁狀態只放在 `ref` 裡。描述需求時寫出哪些狀態要進網址，以及每個導覽是連結還是 Tabs。

## 動手

1. 打開自己的專案，Elements 分頁按 Ctrl+F（Mac 是 Cmd+F）搜尋 `aria-current`，數一數每個導覽元件是不是剛好一個。
2. 在一個清單頁切到第 3 頁、換一個 Tab，複製網址開新分頁，比較兩個分頁的畫面；不一樣的地方就是沒寫進網址的狀態。
3. 只用鍵盤操作一組 Tabs：Tab 進入、方向鍵切換、Tab 進入內容、Shift+Tab 回到分頁列，對照上面的鍵盤表。
4. 裝置模式切到 390px，看 Navbar、Sidebar、Tabs 各怎麼收；在 Console 執行 `document.documentElement.scrollWidth > innerWidth` 確認整頁沒有左右滑。
5. 清單本身的排序、篩選與手機上的表格，接著讀 [資料顯示元件](#/skill/data-display)。
