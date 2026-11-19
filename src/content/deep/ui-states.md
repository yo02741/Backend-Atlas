## 從一個具體問題開始：同一個時段掛了兩次號

掛號頁的「確認掛號」按鈕上線一週，客服收到三件「同一個人在同一個診次有兩筆掛號」。重現方式：Network 分頁的節流選 `3G`，按下按鈕，畫面兩秒沒有任何變化，使用者以為沒按到，又按了一次，兩個 `POST` 都成功。

同一個畫面還有兩個問題：

- 用鍵盤操作的使用者按 Tab 看不到焦點在哪，因為樣式表裡有一行 `button:focus { outline: none; }`，當初是為了拿掉滑鼠點擊後的外框。
- 「確認掛號」在必填欄位沒填完時是 `disabled`，使用者只看到一顆淡灰色的按鈕，不知道為什麼不能按；用螢幕閱讀器的使用者 Tab 不到它。

三個問題都出在「狀態」沒有被定義：送出中長什麼樣、焦點長什麼樣、停用時怎麼說明。規格裡只畫了按鈕平常的樣子，其他狀態由寫程式的人（或 AI）臨時決定。

## 運作原理：狀態從哪裡來

元件的狀態有兩種來源：

- **瀏覽器管理**：滑鼠在不在上面、有沒有焦點、是不是正按著、有沒有 `disabled` 屬性。CSS 用偽類選得到：`:hover`、`:focus`、`:focus-visible`、`:active`、`:disabled`。
- **程式管理**：送出中、驗證失敗、被選取、展開。瀏覽器不知道這些，要由程式改 class 或 ARIA 屬性，CSS 再依屬性換樣式。

| 狀態 | CSS 選擇器 | 誰設定 | 輔助科技讀到的 |
|---|---|---|---|
| hover | `:hover` | 瀏覽器（滑鼠移上去） | 無 |
| focus | `:focus`、`:focus-visible` | 瀏覽器（Tab、點擊、`el.focus()`） | 焦點所在的元素 |
| active | `:active` | 瀏覽器（按住時） | 無 |
| disabled | `:disabled` 或 `[aria-disabled="true"]` | 程式設定屬性 | disabled |
| loading | `.is-loading` 或 `[aria-busy="true"]` | 程式 | `aria-busy` 的區塊忙碌中；按鈕文字改成「送出中…」 |
| error | `[aria-invalid="true"]` | 程式（驗證後） | invalid，加上 `aria-describedby` 指向的訊息 |
| selected、current、pressed | `[aria-selected="true"]`、`[aria-current="page"]`、`[aria-pressed="true"]` | 程式 | selected、current、pressed |

用 ARIA 屬性當樣式的依據有個好處：畫面看起來的狀態和螢幕閱讀器念出來的狀態來自同一個屬性，不會一個改了另一個忘了改。

### :focus 與 :focus-visible

`:focus` 只要元素有焦點就成立，滑鼠點按鈕也算，所以點完會留一圈外框，常常被要求拿掉。`:focus-visible` 由瀏覽器判斷「這時候該不該顯示焦點」：

- 用 Tab 移動焦點時成立。
- 用滑鼠點按鈕時通常不成立。
- 文字輸入框就算用滑鼠點，也會成立，因為接下來要用鍵盤打字。

所以正確的做法是不碰 `:focus` 的預設外框，或只針對 `:focus-visible` 寫明顯的樣式。`:focus-visible` 在 2022 年 3 月進入 Baseline，2024 年 9 月起列為廣泛可用。

WCAG 2.2 的 2.4.7 Focus Visible（AA）要求鍵盤操作時看得到焦點；1.4.11 Non-text Contrast（AA）要求元件邊界與狀態指示和相鄰顏色的對比至少 3:1，焦點外框也包含在內。

### disabled 與 aria-disabled

| | `disabled` 屬性 | `aria-disabled="true"` |
|---|---|---|
| 拿得到焦點（Tab） | 拿不到 | 拿得到 |
| 點擊 | 不觸發 `click` | 照樣觸發，處理函式要自己擋 |
| 表單送出 | 欄位值不會送出 | 照常送出 |
| 螢幕閱讀器 | 用 Tab 走不到；瀏覽模式讀得到 | 念出「已停用」，並讀得到旁邊的說明 |
| 樣式 | `:disabled` | `[aria-disabled="true"]` |

短暫的停用（送出中的那兩秒）用 `disabled` 很合適。長時間停用、而且使用者需要知道原因時（必填欄位沒填完、名額已滿），有兩個做法：按鈕保持可按，按下後列出缺什麼並把焦點移到第一個錯誤欄位；或用 `aria-disabled="true"` 並在按鈕旁寫出原因。

### 狀態疊在一起時

一個按鈕可能同時是 focus 又是 hover，一列可能同時是 selected 又是 hover。規格要寫出優先順序，常見的排法是：disabled > loading > error > active > focus > hover > default。寫成 CSS 時用 `:not(:disabled)` 避免停用的按鈕還有 hover 效果：`.btn:hover:not(:disabled) { … }`。

### 觸控裝置沒有 hover

手機上沒有滑鼠移上去這回事。只在 hover 時出現的資訊（例如列上的「取消」按鈕要 hover 才看得到）在手機上找不到。CSS 的 `@media (hover: hover)` 只在主要輸入裝置能 hover 時成立，可以把 hover 才顯示的設計限制在這種裝置，其他裝置一律顯示。

### 狀態表

描述元件時把狀態寫成表，寫程式與驗收都照它：

| 狀態 | 外觀 | 行為 |
|---|---|---|
| default | `--color-primary` 底、白字 | 可按 |
| hover | 底色加深一階 | 可按；只在 `(hover: hover)` 的裝置 |
| focus-visible | 2px 外框、和背景對比至少 3:1、外推 2px | 可按 |
| active | 往下位移 1px | 可按 |
| loading | spinner 加「送出中…」，寬度不變 | `disabled`，不會送出第二次 |
| disabled | 透明度 0.6、游標 `not-allowed` | 不可按 |

## 實際程式：不會送兩次的按鈕

```vue
<script setup>
import { ref } from 'vue'

const props = defineProps({ sessionId: { type: Number, required: true } })
const emit = defineEmits(['booked'])

const submitting = ref(false)
const error = ref('')

async function submit() {
  if (submitting.value) return     // 第二道防線：就算按鈕還沒停用，也不重送
  submitting.value = true          // 在 await 之前同步設定，下一次點擊前畫面就停用了
  error.value = ''
  try {
    const res = await fetch(`/api/sessions/${props.sessionId}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: props.sessionId }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    emit('booked', await res.json())
  } catch {
    error.value = '掛號沒有成功，請再試一次'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <button type="button" class="btn" :disabled="submitting" @click="submit">
    <span v-if="submitting" class="spinner" aria-hidden="true"></span>
    {{ submitting ? '送出中…' : '確認掛號' }}
  </button>
  <p v-if="error" role="alert" class="error">{{ error }}</p>
</template>

<style scoped>
.btn {
  min-width: 8rem;                       /* 文字變成「送出中…」時寬度不跳 */
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: 0;
  border-radius: var(--radius);
  padding: 0.6rem 1rem;
}
@media (hover: hover) {
  .btn:hover:not(:disabled) { background: var(--color-primary-strong); }
}
.btn:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.spinner { display: inline-block; width: 1em; height: 1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
```

前端的停用只擋得住同一個分頁裡的連點。網路逾時後使用者重新整理再送、或兩個分頁各送一次，伺服器一樣會收到兩筆；要擋住這些，請求要帶冪等鍵（Idempotency-Key），伺服器那一側的做法見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。

切換按鈕（例如「只看未報到」）用 `aria-pressed` 表示開關，樣式也依它切換：

```vue
<button type="button" class="toggle" :aria-pressed="onlyWaiting" @click="onlyWaiting = !onlyWaiting">
  只看未報到
</button>

<style scoped>
.toggle[aria-pressed="true"] { background: var(--color-selected-bg); border-color: var(--color-primary); }
.toggle[aria-pressed="true"]::before { content: "✓ "; }   /* 不只靠顏色 */
</style>
```

## 常見錯誤

- **`outline: none` 沒有替代樣式**：鍵盤使用者看不到焦點。在 Styles 窗格搜尋 `outline`，改成只對 `:focus-visible` 寫樣式。
- **停用寫在 `await` 之後**：`await fetch(…)` 之後才設 `submitting = true`，請求進行中按鈕還能按。設定要在 `await` 前面。
- **只改樣式、沒有停用**：加了 `.is-loading` 讓按鈕變灰，`disabled` 卻沒設，點擊照樣觸發。
- **用了 `aria-disabled` 卻沒擋點擊**：`aria-disabled` 只改變輔助科技讀到的狀態，`click` 事件照常觸發，處理函式第一行要檢查。
- **停用的按鈕旁邊沒有原因**：`disabled` 的按鈕拿不到焦點，靠 Tooltip 說明時鍵盤與螢幕閱讀器使用者看不到。
- **只靠顏色**：選取列只換底色、錯誤只把框變紅；色覺障礙或戶外強光下分不出來。加圖示、色條或文字。
- **hover 才出現的操作**：手機上找不到列上的「取消」按鈕。
- **送出中的按鈕寬度跳動**：「確認掛號」變成「送出中…」，按鈕變窄，旁邊的元素跟著移動。設 `min-width`。

AI 產生的元件常見的模式是：只寫 default 與 hover，focus 沿用瀏覽器預設或直接拿掉，loading 只換文字不停用。描述需求時把狀態表一起給，驗收時逐列檢查。

## 動手

1. 打開一個自己做的表單，在 Elements 分頁選取送出按鈕，按 Styles 窗格的 `:hov`，逐一勾選 `:hover`、`:active`、`:focus-visible`，對照上面的狀態表，記下哪些狀態沒有樣式。
2. 只用 Tab、Shift+Tab、Enter、Space 走完整個表單，焦點消失的地方，多半是寫了 `outline: none` 的元件。
3. Network 分頁的節流選 `3G`，快速連點送出按鈕三次，在 `Fetch/XHR` 篩選下數 `POST` 的筆數；把停用移到 `await` 之前再數一次。
4. Rendering 分頁的 `Emulate vision deficiencies` 選 `Achromatopsia (no color)`，檢查選取、錯誤、停用是否還分得出來。
5. 送出之後的成功與失敗怎麼告訴使用者，接著讀 [回饋：Toast、Alert、Skeleton、Empty state](#/skill/feedback)。
