// 設計情境：使用者上傳檔案
export default {
  id: 'upload',
  order: 6,
  group: 'api',
  title: '使用者上傳檔案',
  en: 'File upload',
  level: 2,
  skills: ['input-validation', 'cloud-basics', 'rest-design'],
  week: 13,
  lab: 'UploadScenarioLab',
  summary: '100 MB 的影片要進物件儲存、還要產縮圖，API 只有兩台小機器。檔案該不該經過 API？',
  situation: '使用者上傳圖片與影片，單檔上限 100 MB。API 跑在 2 台小機器（各 1 GB 記憶體、4 個 worker），檔案最終存到 S3 相容的物件儲存，上傳完成後由背景 worker 產縮圖。使用者多在行動網路，上傳中斷很常見。',
  constraints: [
    'API 機器記憶體 1 GB、每台 4 個 worker：同時 10 個 100 MB 上傳就撐不住',
    '檔案必須驗證大小與真實類型；客戶端宣告的檔名與 Content-Type 不可信',
    '上傳完成要有紀錄（誰、何時、哪個物件），縮圖 worker 才知道要處理什麼',
    '行動網路傳到 70% 斷線，不該從頭再來',
  ],
  options: [
    {
      id: 'through-api', name: '經過 API（multipart）',
      summary: '瀏覽器 `POST /files`（multipart/form-data）把整個檔案送到 API，API 驗證後再寫進物件儲存。',
      pros: ['最直覺，一個端點做完；驗證在 API 內同步完成，壞檔案不會落地', '客戶端不需要知道物件儲存的存在'],
      cons: ['每個位元組進 API 一次、出去一次：頻寬與 worker 時間花兩倍', '大檔案在 API 記憶體或暫存磁碟裡等，同時上傳人數受機器規格限制', '中斷就整包重來'],
    },
    {
      id: 'presigned', name: 'Presigned URL 直傳',
      summary: 'API 只做兩件事：`POST /uploads` 簽出限時、限大小、限類型的 URL；客戶端把檔案直接送到物件儲存，完成後 `POST /uploads/{id}/complete` 通知 API。',
      pros: ['檔案完全不經過 API：worker 只花幾毫秒簽名與紀錄', '物件儲存本來就為大量並行上傳設計，擴展不用管', '簽名內含大小上限、Content-Type、到期時間，由物件儲存代為執行'],
      cons: ['客戶端多兩步（取 URL、回報完成），瀏覽器要允許對物件儲存的 CORS', '內容驗證（magic bytes、掃毒）只能在落地後由 worker 做，壞檔會先存進去', '單一 PUT 中斷仍要整個檔案重傳'],
    },
    {
      id: 'chunked', name: '分段上傳與續傳',
      summary: '物件儲存的 multipart upload：API 起始上傳並為每個分段簽 URL，客戶端 5–10 MB 一段傳，斷線後從缺的那段續傳，最後由 API 呼叫 complete 合併。',
      pros: ['斷線只重傳一段；分段可以平行傳，大檔更快', '單一物件可到 TB 等級'],
      cons: ['客戶端邏輯最複雜：切段、記錄進度、續傳、合併', 'API 要清理「未完成的上傳」（生命週期規則或排程），否則垃圾分段一直計費', '小檔案用這套是浪費：多好幾次來回'],
    },
  ],
  tradeoffs: {
    axes: ['API 負載', '同步驗證內容', '斷線續傳', '客戶端複雜度', '適合的檔案大小'],
    rows: [
      { option: 'through-api', cells: ['差：整個檔案經過 API 兩次', '好：落地前就檢查', '無', '最低', '幾 MB 以下'] },
      { option: 'presigned', cells: ['好：只有簽名與紀錄', '差：落地後才能檢查', '無：整檔重傳', '中', '幾 MB 到數百 MB'] },
      { option: 'chunked', cells: ['好', '差：合併後才能檢查', '好：只補缺的段', '高', '數百 MB 以上'] },
    ],
  },
  decisions: [
    { id: 'avatar', situation: '頭像上傳，最大 200 KB，要立刻裁成正方形回傳顯示；每天幾千次。', options: ['through-api', 'presigned', 'chunked'], answer: 'through-api',
      explain: '200 KB 進 API 沒有負擔：同步驗 magic bytes、裁切、回傳新頭像 URL，一個請求做完體驗最好。presigned 多兩次來回，對這個大小沒有好處。' },
    { id: 'video', situation: '影片上傳，最大 100 MB，尖峰 50 人同時傳，API 就是那兩台小機器。', options: ['through-api', 'presigned', 'chunked'], answer: 'presigned',
      explain: '50 × 100 MB 經過 API 會把記憶體與 worker 吃光；presigned URL 讓物件儲存承接頻寬，API 只簽名與記錄。100 MB 單一 PUT 在行動網路斷線要整檔重傳，若使用者抱怨再升級成分段。' },
    { id: 'enterprise', situation: '企業客戶每晚批次上傳 5 GB 的原始資料檔，走的是不穩定的辦公室網路。', options: ['through-api', 'presigned', 'chunked'], answer: 'chunked',
      explain: '單一 PUT 有大小上限（S3 為 5 GB），斷線整檔重來對 5 GB 不能接受。multipart upload 每段 100 MB、可平行、斷了補段。搭配生命週期規則清掉 7 天未完成的上傳。' },
    { id: 'csv-import', situation: '匯入 CSV（幾 MB），要先驗欄位格式，格式錯要立刻告訴使用者第幾行有問題。', options: ['through-api', 'presigned', 'chunked'], answer: 'through-api',
      explain: '需求是同步驗證內容，檔案必須在 API 手上才能解析。幾 MB 經過 API 沒問題：限制 body 大小、串流解析、驗完再決定要不要存。' },
  ],
  implementation: [
    { title: '簽出限時、限大小、限類型的上傳 URL（boto3 風格示意）', lang: 'python', code: `ALLOWED = {"image/jpeg", "image/png", "video/mp4"}
MAX_BYTES = 100 * 1024 * 1024

def create_upload(user_id: int, content_type: str, size: int) -> dict:
    if content_type not in ALLOWED:
        raise HTTPError(415)
    if size > MAX_BYTES:
        raise HTTPError(413)
    key = f"uploads/{user_id}/{uuid7()}"            # 隨機物件名；不用使用者給的檔名
    db.execute("INSERT INTO uploads (key, user_id, size, status) VALUES (%s, %s, %s, 'pending')",
               (key, user_id, size))
    signed = s3.generate_presigned_post(             # 條件寫進簽名，物件儲存代為檢查
        Bucket=BUCKET, Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[{"Content-Type": content_type},
                    ["content-length-range", 1, MAX_BYTES]],
        ExpiresIn=300,                              # 5 分鐘內要開始傳
    )
    return {"key": key, "url": signed["url"], "fields": signed["fields"]}` },
    { title: '上傳完成回報：API 不信任客戶端，自己去物件儲存確認', lang: 'http', code: `POST /uploads/01J9Q3.../complete HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{}

HEAD uploads/42/01J9Q3... (API → 物件儲存)
HTTP/1.1 200 OK
Content-Length: 83886080
Content-Type: video/mp4

HTTP/1.1 202 Accepted
Content-Type: application/json

{"id": "01J9Q3...", "status": "processing", "size": 83886080,
 "thumbnail_url": null}` },
    { title: '看檔案開頭的 magic bytes，不看副檔名', lang: 'python', code: `MAGIC = {
    b"\\xff\\xd8\\xff": "image/jpeg",
    b"\\x89PNG\\r\\n\\x1a\\n": "image/png",
}

def sniff(head: bytes) -> str | None:
    for sig, mime in MAGIC.items():
        if head.startswith(sig):
            return mime
    if head[4:8] == b"ftyp":                        # MP4 / MOV 家族：第 4 位元組起是 'ftyp'
        return "video/mp4"
    return None

# 經過 API：讀前 4 KB 就能判斷，不用等整個檔案
head = await upload.read(4096)
if sniff(head) != declared_type:
    raise HTTPError(415, "檔案內容與宣告的類型不符")

# presigned / 分段：檔案已在物件儲存，由 worker 只抓前 4 KB 檢查
head = s3.get_object(Bucket=BUCKET, Key=key, Range="bytes=0-4095")["Body"].read()
if sniff(head) is None:
    s3.delete_object(Bucket=BUCKET, Key=key)        # 不合法就刪，並把 uploads 標成 rejected` },
  ],
  exercise: 'input-validation-1',
  refs: [],
}
