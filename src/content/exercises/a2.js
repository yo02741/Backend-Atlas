// 程式題（第三批）：呼叫後端的檔案上傳（在沙箱 iframe 裡執行，fetch 由假 API 回應，見 src/runtime/fakeApi.js）

// 測試共用：把檔案放進 <input type="file">（DataTransfer 建立 FileList），再發出 input 與 change
const PICK = `const pick = (file) => {
  const dt = new DataTransfer()
  if (file) dt.items.add(file)
  const el = $('#file')
  el.files = dt.files
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
const pdf = () => new File(['%PDF-1.7 轉診單'], '轉診單.pdf', { type: 'application/pdf' })
const describedBy = () => ($('#file').getAttribute('aria-describedby') || '').split(/\\s+/)
`

export default [
  {
    id: 'file-upload-frontend-1', skill: 'file-upload-frontend', kind: 'html', level: 2,
    title: '上傳轉診單：FormData、前端檢查與欄位錯誤',
    prompt: '「上傳轉診單」是 AI 產生的第一版：手動寫了 `Content-Type: multipart/form-data`，每次都回 400；沒有先檢查檔案；失敗只跳 `alert`；上傳中還能再按一次。改寫 `<script>`（需要時可以改欄位的屬性，`id` 不要改）：\n\n- 送出用 `fetch(\'/api/attachments\', { method: \'POST\', body: new FormData(form) })`，帶表單裡的 `appointmentId` 與 `file`；body 是 `FormData` 時不要自己設 `Content-Type`，boundary 由瀏覽器產生\n- 送出前在前端檢查（選檔時就檢查也可以）：沒選檔案顯示「請選擇檔案」；類型不是 `application/pdf`、`image/png`、`image/jpeg` 顯示「只接受 PDF、PNG、JPEG」；超過 5 MB（5 × 1024 × 1024 位元組）顯示「檔案太大：上限 5 MB」。有錯時不送出請求\n- 錯誤顯示在欄位下方的 `#file-error`，欄位加 `aria-invalid="true"`，`aria-describedby` 加上 `file-error`（保留 `file-hint`）；改成正確的檔案之後錯誤清掉、`aria-invalid` 拿掉或設成 `false`\n- 送出中停用「上傳」按鈕，回應之後恢復；連按兩次只送出一個請求\n- 成功（201）：`#upload-status` 顯示「已上傳：檔名」，例如「已上傳：轉診單.pdf」\n- 413、415 回 Problem Details：把 `detail` 顯示在 `#file-error`，欄位一樣標成 invalid\n\n前端檢查只是提早回饋：`type` 來自副檔名，伺服器還是會自己驗內容，所以 415 要能顯示。',
    api: "// 假後端：記下收到的 Content-Type 與欄位；手動設了 multipart 卻沒有 boundary 時，和真的伺服器一樣回 400\nwindow.uploads = []\napi.post('/api/attachments', (req) => {\n  const contentType = req.headers['content-type'] || null\n  const form = req.body instanceof FormData ? req.body : null\n  const file = form && form.get('file')\n  uploads.push({ contentType, formData: !!form, file: file && file.name, appointmentId: form && form.get('appointmentId') })\n  if (contentType && !/boundary=/.test(contentType)) return { status: 400, body: api.problem(400, 'Missing boundary in multipart.') }\n  if (!(file instanceof File) || !file.name) return { status: 422, body: api.problem(422, '沒有收到檔案（欄位 file）') }\n  return { status: 201, delay: 300, body: { id: 77, appointment_id: 501, name: file.name, size: file.size } }\n})",
    starter: `<form id="upload">
  <input type="hidden" name="appointmentId" value="501">
  <label for="file">轉診單</label>
  <p id="file-hint">PDF、PNG 或 JPEG，5 MB 以內</p>
  <input type="file" id="file" name="file" accept="application/pdf,image/png,image/jpeg" aria-describedby="file-hint">
  <p id="file-error"></p>
  <button type="submit">上傳</button>
</form>
<p id="upload-status" role="status"></p>

<script type="module">
  const form = document.getElementById('upload')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const file = form.elements.file.files[0]
    const res = await fetch('/api/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: new FormData(form),
    })
    if (res.ok) document.getElementById('upload-status').textContent = '已上傳：' + file.name
    else alert('上傳失敗')
  })
</script>
`,
    solution: `<form id="upload">
  <input type="hidden" name="appointmentId" value="501">
  <label for="file">轉診單</label>
  <p id="file-hint">PDF、PNG 或 JPEG，5 MB 以內</p>
  <input type="file" id="file" name="file" accept="application/pdf,image/png,image/jpeg" aria-describedby="file-hint">
  <p id="file-error"></p>
  <button type="submit">上傳</button>
</form>
<p id="upload-status" role="status"></p>

<script type="module">
  const MAX_BYTES = 5 * 1024 * 1024
  const TYPES = ['application/pdf', 'image/png', 'image/jpeg']
  const form = document.getElementById('upload')
  const input = document.getElementById('file')
  const error = document.getElementById('file-error')
  const status = document.getElementById('upload-status')
  const button = form.querySelector('button[type=submit]')

  // 前端檢查：給使用者提早回饋；file.type 來自副檔名，伺服器還要自己驗內容
  function check(file) {
    if (!file) return '請選擇檔案'
    if (!TYPES.includes(file.type)) return '只接受 PDF、PNG、JPEG'
    if (file.size > MAX_BYTES) return '檔案太大：上限 5 MB'
    return ''
  }

  // 錯誤顯示在欄位旁；有錯時 aria-describedby 才指向錯誤訊息
  function showError(message) {
    error.textContent = message
    input.setAttribute('aria-invalid', message ? 'true' : 'false')
    input.setAttribute('aria-describedby', message ? 'file-hint file-error' : 'file-hint')
  }

  input.addEventListener('change', () => {
    status.textContent = ''
    showError(check(input.files[0]))
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (button.disabled) return
    const file = input.files[0]
    const message = check(file)
    showError(message)
    if (message) { input.focus(); return }

    button.disabled = true            // 先停用再 await，第二次點擊才擋得住
    status.textContent = '上傳中…'
    try {
      // body 是 FormData：不設 Content-Type，瀏覽器會帶 multipart/form-data; boundary=…
      const res = await fetch('/api/attachments', { method: 'POST', body: new FormData(form) })
      if (res.ok) {
        status.textContent = '已上傳：' + file.name
        return
      }
      status.textContent = ''
      const isJson = (res.headers.get('Content-Type') || '').includes('json')
      const problem = isJson ? await res.json() : null
      showError(problem?.detail || '上傳失敗（' + res.status + '）')   // 413、415：顯示伺服器的 detail
    } catch {
      status.textContent = ''
      showError('無法連線，請稍後再試')
    } finally {
      button.disabled = false
    }
  })
</script>
`,
    tests: [
      { name: '超過 5 MB：欄位旁顯示錯誤，不送出', code: PICK + "pick(new File([new Uint8Array(5 * 1024 * 1024 + 1)], '影像報告.pdf', { type: 'application/pdf' }))\nsubmit('#upload')\nawait waitFor(() => text('#file-error'))\nawait wait(50)\nassertEqual(text('#file-error'), '檔案太大：上限 5 MB', '#file-error 的文字')\nassertEqual($('#file').getAttribute('aria-invalid'), 'true', '欄位的 aria-invalid')\nassert(describedBy().includes('file-error'), '欄位的 aria-describedby 要加上 file-error（現在是 ' + describedBy().join(' ') + '）')\nassert(describedBy().includes('file-hint'), 'aria-describedby 要保留 file-hint')\nassertEqual(uploads.length, 0, '前端檢查沒過時送出的請求數')" },
      { name: '類型不對與沒選檔案：顯示錯誤，不送出', code: PICK + "pick(new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }))\nsubmit('#upload')\nawait waitFor(() => text('#file-error'))\nassertEqual(text('#file-error'), '只接受 PDF、PNG、JPEG', '#file-error 的文字')\nassertEqual($('#file').getAttribute('aria-invalid'), 'true', '欄位的 aria-invalid')\npick(null)\nsubmit('#upload')\nawait waitFor(() => text('#file-error') === '請選擇檔案')\nawait wait(50)\nassertEqual(uploads.length, 0, '前端檢查沒過時送出的請求數')" },
      { name: '送出 FormData，不自己設 Content-Type', code: PICK + "pick(pdf())\nsubmit('#upload')\nawait waitFor(() => text('#upload-status') === '已上傳：轉診單.pdf', { timeout: 2000 })\nassertEqual(uploads.length, 1, '請求數')\nconst u = uploads[0]\nassert(u.formData, 'body 要是 FormData')\nassert(!u.contentType || /boundary=/.test(u.contentType), '不要自己設 Content-Type（現在是 ' + u.contentType + '）：手動寫 multipart/form-data 會蓋掉瀏覽器產生的 boundary')\nassertEqual({ file: u.file, appointmentId: u.appointmentId }, { file: '轉診單.pdf', appointmentId: '501' }, 'FormData 的欄位')\nassertEqual(text('#file-error'), '', '成功時 #file-error 要是空的')" },
      { name: '改選正確的檔案後，錯誤清掉', code: PICK + "pick(new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }))\nsubmit('#upload')\nawait waitFor(() => text('#file-error'))\npick(pdf())\nsubmit('#upload')\nawait waitFor(() => text('#upload-status') === '已上傳：轉診單.pdf', { timeout: 2000 })\nassertEqual(text('#file-error'), '', '#file-error 的文字')\nassert($('#file').getAttribute('aria-invalid') !== 'true', '改正之後 aria-invalid 要拿掉或設成 false')" },
      { name: '送出中停用按鈕，連按兩次只送一個請求', code: PICK + "pick(pdf())\nconst btn = $('#upload button[type=submit]')\nclick(btn)\nawait tick()\nassert(btn.disabled || btn.getAttribute('aria-disabled') === 'true', '送出中「上傳」要停用')\nclick(btn)\nawait waitFor(() => text('#upload-status') === '已上傳：轉診單.pdf', { timeout: 2000 })\nassertEqual(uploads.length, 1, '連按兩次送出的請求數')\nawait waitFor(() => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true')" },
      { name: '413：顯示 Problem Details 的 detail', api: "api.post('/api/attachments', { status: 413, body: api.problem(413, '這次就診的附件已達 20 MB 上限，請先刪除不需要的附件', { title: 'Content Too Large' }) })", code: PICK + "pick(pdf())\nsubmit('#upload')\nawait waitFor(() => text('#file-error'), { timeout: 2000 })\nassertEqual(text('#file-error'), '這次就診的附件已達 20 MB 上限，請先刪除不需要的附件', '#file-error 的文字')\nassertEqual($('#file').getAttribute('aria-invalid'), 'true', '欄位的 aria-invalid')\nassert(describedBy().includes('file-error'), 'aria-describedby 要加上 file-error')\nassert(!text('#upload-status').startsWith('已上傳'), '失敗時不能顯示已上傳')\nawait waitFor(() => !$('#upload button[type=submit]').disabled)" },
      { name: '415：伺服器判斷內容不符', api: "api.post('/api/attachments', { status: 415, body: api.problem(415, '檔案內容不是 PDF、PNG 或 JPEG', { title: 'Unsupported Media Type' }) })", code: PICK + "pick(new File(['MZ…'], '檢驗報告.pdf', { type: 'application/pdf' }))\nsubmit('#upload')\nawait waitFor(() => text('#file-error'), { timeout: 2000 })\nassertEqual(text('#file-error'), '檔案內容不是 PDF、PNG 或 JPEG', '#file-error 的文字')\nassertEqual($('#file').getAttribute('aria-invalid'), 'true', '欄位的 aria-invalid')" },
    ],
    hints: [
      '`fetch(url, { method: \'POST\', body: new FormData(form) })` 不寫 `headers`：瀏覽器看到 body 是 `FormData`，會自己帶 `multipart/form-data; boundary=…`。',
      '`input.files[0]` 是 `File`，`size` 是位元組數、`type` 是瀏覽器依副檔名判斷的 MIME 類型。',
      '停用按鈕要寫在 `await fetch()` 之前，`finally` 裡恢復；錯誤時 `setAttribute(\'aria-invalid\', \'true\')`，`aria-describedby` 改成 `file-hint file-error`。',
    ],
  },
]
