// 程式題：品質（html 題在沙箱 iframe 裡執行，fetch 由假 API 回應）
const LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='32'%3E%3Crect width='120' height='32' rx='6' fill='%231d4ed8'/%3E%3Ctext x='60' y='21' font-size='14' text-anchor='middle' fill='%23fff'%3E總院區%3C/text%3E%3C/svg%3E"
const WAVE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='12'%3E%3Cpath d='M0 6q30-6 60 0t60 0 60 0 60 0 60 0 60 0' stroke='%2393c5fd' fill='none' stroke-width='2'/%3E%3C/svg%3E"
const CLEAR_ICON = '<svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3 4.4 4.4 3 8 6.6 11.6 3 13 4.4 9.4 8 13 11.6 11.6 13 8 9.4 4.4 13 3 11.6 6.6 8z"/></svg>'

export default [
  {
    id: 'a11y-basics-1', skill: 'a11y-basics', kind: 'html', level: 2, serial: true,
    title: '掛號表單的無障礙：名稱、錯誤、狀態訊息與焦點',
    prompt: '預約掛號表單用滑鼠看起來沒問題，但只用鍵盤與螢幕閱讀器走不完：欄位沒有 label、必填只靠紅色星號；「清除日期」是只有圖示的 `span`；院徽沒有 `alt`；錯誤訊息只把文字變紅；送出成功的訊息和容器同時插進頁面，螢幕閱讀器不會念；`tabindex` 寫了正數；全站 `*:focus { outline: none }`。改成：\n\n- 「姓名」「看診日期」有 `<label>`，label 裡用文字寫「（必填）」\n- 「清除日期」是 `<button type="button" aria-label="清除日期">`，圖示 `aria-hidden="true"`；按了清空日期\n- 院徽 `.logo` 的 `alt` 是「總院區門診」；分隔用的裝飾圖 `.divider` 寫 `alt=""`\n- 按「送出掛號」時檢查必填：沒填的欄位設 `aria-invalid="true"`，錯誤訊息（「請輸入姓名」「請選擇看診日期」）用 `aria-describedby` 連到欄位，焦點移到第一個有錯的欄位；改正後再送出，那個欄位的 `aria-invalid` 與訊息要清掉\n- 都填了就送出 `POST /api/appointments`（回 201 與 `{ number }`），在頁面一開始就有、內容是空的 `role="status"` 容器裡寫入「已完成掛號，號碼 A012」\n- 不用大於 0 的 `tabindex`；焦點框不要拿掉：`:focus-visible` 畫至少 2px 的 `outline`',
    api: "api.post('/api/appointments', () => ({ status: 201, body: { id: 501, number: 'A012' } }))",
    starter: `<header><img class="logo" src="${LOGO}" width="120" height="32"></header>
<form id="booking" novalidate>
  <h1>預約掛號</h1>
  <div class="field">
    <span>姓名 <span class="req">*</span></span>
    <input name="name" tabindex="2">
    <p class="error" hidden></p>
  </div>
  <div class="field">
    <span>看診日期 <span class="req">*</span></span>
    <input name="date" type="date" tabindex="1">
    <span class="clear">${CLEAR_ICON}</span>
    <p class="error" hidden></p>
  </div>
  <img class="divider" src="${WAVE}" width="360" height="12">
  <button type="submit">送出掛號</button>
</form>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  *:focus { outline: none; }
  .req, .error { color: #b91c1c; }
  .error { margin: 0; }
  .clear { cursor: pointer; }
</style>
<script type="module">
  const form = document.querySelector('#booking')
  const MESSAGES = { name: '請輸入姓名', date: '請選擇看診日期' }

  document.querySelector('.clear').addEventListener('click', () => { form.date.value = '' })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    let ok = true
    for (const name of ['name', 'date']) {
      const error = form[name].closest('.field').querySelector('.error')
      const empty = !form[name].value.trim()
      error.hidden = !empty
      error.textContent = empty ? MESSAGES[name] : ''
      if (empty) ok = false
    }
    if (!ok) return
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name.value, date: form.date.value }),
    })
    const data = await res.json()
    form.insertAdjacentHTML('afterend', \`<p role="status">已完成掛號，號碼 \${data.number}</p>\`)
  })
</script>
`,
    solution: `<header><img class="logo" src="${LOGO}" width="120" height="32" alt="總院區門診"></header>
<form id="booking" novalidate>
  <h1>預約掛號</h1>
  <div class="field">
    <label for="name">姓名（必填）</label>
    <input id="name" name="name" autocomplete="name">
    <p class="error" id="name-error"></p>
  </div>
  <div class="field">
    <label for="date">看診日期（必填）</label>
    <input id="date" name="date" type="date">
    <!-- 只有圖示的按鈕：名稱寫在 aria-label，圖示不念 -->
    <button type="button" class="clear" aria-label="清除日期">${CLEAR_ICON.replace('<svg ', '<svg aria-hidden="true" focusable="false" ')}</button>
    <p class="error" id="date-error"></p>
  </div>
  <img class="divider" src="${WAVE}" width="360" height="12" alt="">
  <button type="submit">送出掛號</button>
</form>
<!-- 一開始就在頁面上、內容是空的；之後只換文字，螢幕閱讀器才會念 -->
<p role="status" id="result"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  :focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
  .error { color: #b91c1c; margin: 0; }
  .error:empty { display: none; }
</style>
<script type="module">
  const form = document.querySelector('#booking')
  const MESSAGES = { name: '請輸入姓名', date: '請選擇看診日期' }

  form.querySelector('.clear').addEventListener('click', () => { form.date.value = '' })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const invalid = []
    for (const name of ['name', 'date']) {
      const field = form[name]
      const error = document.getElementById(name + '-error')
      if (field.value.trim()) {
        field.removeAttribute('aria-invalid')
        field.removeAttribute('aria-describedby')
        error.textContent = ''
      } else {
        field.setAttribute('aria-invalid', 'true')
        field.setAttribute('aria-describedby', error.id)   // 錯誤訊息連到欄位，聚焦時一起念
        error.textContent = MESSAGES[name]
        invalid.push(field)
      }
    }
    if (invalid.length) { invalid[0].focus(); return }   // 焦點移到第一個有錯的欄位
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name.value, date: form.date.value }),
    })
    const data = await res.json()
    document.querySelector('#result').textContent = \`已完成掛號，號碼 \${data.number}\`
  })
</script>
`,
    tests: [
      { name: '欄位與按鈕都有名稱', code: "const field = (name) => $$('label').find((l) => l.textContent.trim().startsWith(name))?.control\nfor (const [label, name] of [['姓名', 'name'], ['看診日期', 'date']]) {\n  const f = field(label)\n  assert(f && f.name === name, '「' + label + '」沒有用 <label> 對到欄位')\n  assert([...f.labels].some((l) => l.textContent.includes('必填')), '「' + label + '」的 label 要用文字寫「（必填）」，不能只靠紅色星號')\n}\nconst clear = $$('button').find((b) => b.getAttribute('aria-label') === '清除日期')\nassert(clear, '找不到 aria-label=\"清除日期\" 的 <button>')\nassertEqual(clear.type, 'button', '「清除日期」的 type（submit 會送出表單）')\nconst svg = clear.querySelector('svg')\nassert(!svg || svg.getAttribute('aria-hidden') === 'true', '「清除日期」的圖示要 aria-hidden=\"true\"')\ninput('[name=date]', '2026-11-20')\nclick(clear)\nawait tick()\nassertEqual($('[name=date]').value, '', '按「清除日期」之後的日期')" },
      { name: '圖片的替代文字', code: "assertEqual($('.logo').getAttribute('alt'), '總院區門診', '院徽的 alt')\nassert($('.divider').hasAttribute('alt') && $('.divider').alt === '', '裝飾圖要寫 alt=\"\"（沒有 alt 屬性時，部分螢幕閱讀器會念出檔名）')" },
      { name: '送出時標出錯誤，焦點移到第一個有錯的欄位', code: "click($$('button').find((b) => b.textContent.trim() === '送出掛號'))\nawait tick()\nfor (const [name, msg] of [['name', '請輸入姓名'], ['date', '請選擇看診日期']]) {\n  const f = $('[name=' + name + ']')\n  assertEqual(f.getAttribute('aria-invalid'), 'true', name + ' 的 aria-invalid')\n  const ids = (f.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)\n  const desc = ids.map((id) => document.getElementById(id)?.textContent.trim() || '').join(' ')\n  assert(desc.includes(msg), name + ' 的 aria-describedby 要連到「' + msg + '」（現在連到：' + (desc || '沒有') + '）')\n}\nassertEqual(document.activeElement && document.activeElement.name, 'name', '送出失敗後焦點所在的欄位')\nassertEqual(api.calls.length, 0, '有錯時不要送出請求')" },
      { name: '改正後清掉那個欄位的錯誤', code: "input('[name=name]', '王小明')\nclick($$('button').find((b) => b.textContent.trim() === '送出掛號'))\nawait tick()\nconst name = $('[name=name]')\nassert(name.getAttribute('aria-invalid') !== 'true', '姓名填了之後 aria-invalid 要清掉')\nconst ids = (name.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)\nassert(!ids.some((id) => (document.getElementById(id)?.textContent || '').includes('請輸入姓名')), '姓名填了之後錯誤訊息要清掉')\nassertEqual($('[name=date]').getAttribute('aria-invalid'), 'true', '日期還沒填，aria-invalid 要留著')\nassertEqual(document.activeElement && document.activeElement.name, 'date', '這次焦點要移到日期')" },
      { name: '送出成功時寫進一直存在的 role="status"', code: "const status = $('[role=status]')\nassert(status, '頁面一開始就要有 role=\"status\" 的容器：和訊息同時插進頁面，螢幕閱讀器不會念')\nassertEqual(text(status), '', '一開始 role=\"status\" 要是空的')\ninput('[name=name]', '王小明')\ninput('[name=date]', '2026-11-20')\nclick($$('button').find((b) => b.textContent.trim() === '送出掛號'))\nawait waitFor(() => text('[role=status]'))\nassertEqual($$('[role=status]').length, 1, 'role=\"status\" 的元素數')\nassertEqual($('[role=status]'), status, '要寫進原本那個容器，不是插入新的')\nassertEqual(text(status), '已完成掛號，號碼 A012')" },
      { name: '焦點框看得見，沒有正數 tabindex', code: "const pos = $$('[tabindex]').filter((e) => e.tabIndex > 0)\nassert(!pos.length, '大於 0 的 tabindex 會打亂整頁的 Tab 順序：' + pos.map((e) => e.outerHTML.slice(0, 50)).join(', '))\nfor (const sel of ['[name=name]', '[name=date]']) {\n  focus(sel)\n  const w = parseFloat(css(sel, 'outline-width'))\n  assert(css(sel, 'outline-style') !== 'none' && w >= 2, sel + ' 聚焦時的焦點框：outline-style ' + css(sel, 'outline-style') + '、寬 ' + css(sel, 'outline-width') + '（至少 2px）')\n}\nconst btn = $$('button').find((b) => b.textContent.trim() === '送出掛號')\nfocus(btn)\nassert(btn.matches(':focus-visible'), '用程式聚焦的按鈕應該符合 :focus-visible')\nassert(css(btn, 'outline-style') !== 'none' && parseFloat(css(btn, 'outline-width')) >= 2, '「送出掛號」聚焦時的焦點框：outline-style ' + css(btn, 'outline-style'))" },
    ],
    hints: ['錯誤訊息的元素一直留在頁面上、給它 `id`；有錯時欄位設 `aria-invalid="true"` 與 `aria-describedby`，沒錯時移除。', '`role="status"` 的容器寫在 HTML 裡、內容是空的，成功時只改它的 `textContent`。', '拿掉 `*:focus { outline: none }`，改寫 `:focus-visible { outline: 2px solid …; }`；`tabindex` 只用 `0` 或 `-1`。'],
  },
]
