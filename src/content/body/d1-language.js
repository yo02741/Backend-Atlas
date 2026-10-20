// 領域 1：語言與工程實踐（以 Python 為範例） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d1-language.js
export default {
  'python-backend': {
    points: [
      { b: '型別提示是文件也是防線', t: '`def get_user(user_id: int) -> User | None` 一眼看出輸入輸出；搭配 pyright / mypy 在存檔時就抓到錯，和 TypeScript 的型別直覺一致。' },
      { b: '資料用 dataclass / pydantic 裝', t: '不要用 dict 到處傳。pydantic `BaseModel` 會驗證、轉型、產生 JSON schema——FastAPI 的請求/回應模型就是它。' },
      { b: '例外是控制流的一部分', t: '自訂例外類別（`class NotFound(Exception)`），在最外層統一轉成 HTTP 狀態碼；不要在每個函式裡 try/except 吞掉。' },
      { b: '標準庫比你想的強', t: '`pathlib`、`datetime`（永遠帶時區 `timezone.utc`）、`logging`、`json`、`functools.lru_cache`、`itertools`——先查標準庫再裝套件。' },
      { b: '可變預設參數與 late binding', t: '`def f(items=[])` 是經典地雷；用 `None` 再在函式內建新 list。這類「Python 特有陷阱」值得花一小時掃一遍。' },
    ],
    checklist: [
      '能用型別提示與 pydantic model 定義一個 API 的請求與回應',
      '能解釋 `Optional[int]`、`int | None`、`list[str]` 的差異與用法',
      '知道 datetime 要帶時區，並能用 `datetime.now(timezone.utc)`',
      '能設計自訂例外並在單一位置轉成 HTTP 錯誤',
    ],
    refs: [
      { label: 'Python 官方文件', url: 'https://docs.python.org/3/' },
      { label: 'typing 模組', url: 'https://docs.python.org/3/library/typing.html' },
      { label: 'pydantic', url: 'https://docs.pydantic.dev/' },
    ],
  },
  'how-programs-run': {
    points: [
      { b: '行程分資源，執行緒分 CPU', t: '行程有自己的記憶體、PID 與 fd 表，彼此隔離；同一行程的執行緒共用記憶體與 fd，各有自己的 stack。`uvicorn --workers 4` 是 4 個行程，記憶體與全域快取各一份。' },
      { b: 'stack 放呼叫、heap 放物件', t: '每次函式呼叫在 stack 推一個 frame；CPython 的物件都在 heap，變數只是指向物件的名字。Python 的記憶體洩漏通常是「還有人參照著」，例如只增不減的全域快取。' },
      { b: 'socket 也是檔案描述子', t: '檔案、socket、pipe、每條進來的連線都佔一個 fd，上限看 `ulimit -n` 與 `/proc/<pid>/limits`。`Errno 24 Too many open files` 多半是連線或檔案沒關，先查洩漏再調上限。' },
      { b: '阻塞 I/O 不燒 CPU，燒的是執行緒', t: '等資料時核心讓執行緒睡眠、CPU 去跑別人；但那個執行緒什麼都不能做。epoll / asyncio 讓一個執行緒同時等很多 fd，前提是不在 loop 上做阻塞呼叫或長時間計算。' },
      { b: 'GIL：I/O 用執行緒、CPU 用行程', t: '預設 CPython 同一時間只有一個執行緒跑 bytecode，等 I/O 時會釋放；純 Python 的 CPU 運算要用多行程才能用到多核心，代價是記憶體與序列化成本。' },
    ],
    checklist: [
      '能用 `ps`、`top`、`/proc/<pid>/fd` 看出一個服務有幾個行程、執行緒與開著的 fd',
      '能解釋 `Too many open files` 的成因，以及為什麼 HTTP client 要共用、用完要關',
      '能說明一個 I/O 密集與一個 CPU 密集的工作，在 Python 裡各該用執行緒、asyncio 還是多行程',
    ],
    refs: [
      { label: 'threading 官方文件', url: 'https://docs.python.org/3/library/threading.html' },
      { label: 'multiprocessing 官方文件', url: 'https://docs.python.org/3/library/multiprocessing.html' },
      { label: 'Python 詞彙表：GIL', url: 'https://docs.python.org/3/glossary.html#term-global-interpreter-lock' },
      { label: 'Linux man-pages：syscalls(2)', url: 'https://man7.org/linux/man-pages/man2/syscalls.2.html' },
    ],
  },
  'data-representation': {
    points: [
      { b: 'str 是字元、bytes 是位元組', t: 'UTF-8 裡 ASCII 1 個位元組、常用中文 3 個、emoji 4 個。在邊界明確 `encode` / `decode` 並指定 `encoding="utf-8"`；亂碼是同一串位元組被用錯的編碼解讀。' },
      { b: 'JSON 沒有日期、Decimal、bytes', t: '`json.dumps` 遇到 datetime、Decimal 直接 TypeError；tuple 變 list、int key 變字串、NaN 輸出成不合法的 JSON。格式要自己決定並寫進 API 規格。' },
      { b: '超過 2^53 的整數用字串傳', t: 'JavaScript 的 Number 只能精確表示到 `Number.MAX_SAFE_INTEGER`（2^53 − 1）。Python 的 int 不會失準，問題出在前端 `JSON.parse`；64 位元 ID 一律當字串。' },
      { b: '存 UTC、傳 ISO 8601、顯示時才轉時區', t: '用 `datetime.now(timezone.utc)` 與 PostgreSQL `timestamptz`，傳 `2026-10-20T01:30:00Z` 這種帶偏移的字串。台灣固定 UTC+8；有日光節約的地區要用 IANA 時區名稱。' },
      { b: '金額用 Decimal 或整數分', t: '`0.1 + 0.2 != 0.3`。`Decimal` 要從字串建立、用 `quantize` 指定捨入規則；或存整數的最小單位加幣別。秒與毫秒時間戳記看位數分辨（10 位與 13 位）。' },
    ],
    checklist: [
      '能說出一段文字的字元數與 UTF-8 位元組數為何不同，並從錯誤訊息判斷亂碼的來源編碼',
      '能把含 datetime、Decimal 與大整數 ID 的物件轉成前端可以安全解析的 JSON',
      '能把一個 UTC 時間轉成台灣時間顯示，並正確處理「今天的訂單」這類依日期分組的查詢',
    ],
    refs: [
      { label: 'Python Unicode HOWTO', url: 'https://docs.python.org/3/howto/unicode.html' },
      { label: 'datetime 官方文件', url: 'https://docs.python.org/3/library/datetime.html' },
      { label: 'decimal 官方文件', url: 'https://docs.python.org/3/library/decimal.html' },
      { label: 'RFC 8259：JSON', url: 'https://www.rfc-editor.org/rfc/rfc8259' },
      { label: 'RFC 3339：網路上的日期與時間', url: 'https://www.rfc-editor.org/rfc/rfc3339' },
      { label: 'MDN：Number.MAX_SAFE_INTEGER', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER' },
    ],
  },
  'project-layering': {
    points: [
      { b: '三層各管一種改動', t: 'handler 管 HTTP（路徑、狀態碼、schema）、service 管業務規則、repository 管資料怎麼存。HTTP 格式、規則、資料庫各自因不同理由改，分開後改一種只動一層。' },
      { b: '領域邏輯不碰框架與資料庫', t: 'service 裡不出現 `HTTPException`、`Request`、SQL 或 ORM session；錯誤丟自訂例外，在邊界轉成狀態碼。同一個 service 才能被 API、批次工作、CLI 共用。' },
      { b: '依賴從建構子傳進來', t: '`OrderService(repo, mailer)` 一眼看出需要什麼，誰建立、建立哪一種由外層（composition root）決定。「今天幾點」「隨機值」也是依賴，傳進來測試才能固定。' },
      { b: 'Protocol 定義 repository 介面', t: '`typing.Protocol` 是結構型別：方法對得上就算實作，不用繼承。正式環境放 PostgreSQL 版，測試放記憶體版 fake，service 一行不改。' },
      { b: 'FastAPI 的 Depends 是每個請求的組裝點', t: 'handler 宣告需要什麼，框架依 provider 鏈（連線 → repository → service）組出來；測試用 `app.dependency_overrides` 換掉其中一層。' },
    ],
    checklist: [
      '能把一個什麼都寫在 handler 裡的 endpoint 拆成 handler / service / repository，並說出每層不該 import 什麼',
      '能用 Protocol 定義 repository 介面，寫一個記憶體版實作，替 service 寫不需要資料庫的測試',
      '能用 FastAPI 的 Depends 串起依賴鏈，並在測試中用 dependency_overrides 替換',
    ],
    refs: [
      { label: 'typing.Protocol', url: 'https://docs.python.org/3/library/typing.html#typing.Protocol' },
      { label: 'PEP 544：Protocols', url: 'https://peps.python.org/pep-0544/' },
      { label: 'FastAPI：Dependencies', url: 'https://fastapi.tiangolo.com/tutorial/dependencies/' },
      { label: 'FastAPI：Testing Dependencies with Overrides', url: 'https://fastapi.tiangolo.com/advanced/testing-dependencies/' },
    ],
  },
  'error-design': {
    points: [
      { b: '預期內錯誤 vs 程式錯誤', t: 'Email 已註冊、找不到訂單是使用者能處理的，回 4xx、記 info；KeyError、連不上資料庫是 bug，回 500、記 stack trace、告警。不要在中間 `except Exception` 吞掉 bug。' },
      { b: '例外階層帶著狀態碼與代碼', t: '`AppError` → `NotFound` / `Conflict` / `ValidationFailed` → `EmailTaken`…，每類帶 HTTP 狀態、穩定代碼、標題；基礎設施例外在 repository 翻譯成領域例外，用 `raise ... from e` 保留原因。' },
      { b: 'RFC 9457 Problem Details', t: '`application/problem+json`，欄位 `type`（類型的主要識別）、`title`、`status`、`detail`（這一次的說明）、`instance`，可加擴充欄位。RFC 9457 取代了 RFC 7807。' },
      { b: '前端依穩定代碼判斷，不解析文字', t: '用 `type` 或一對一的 `code` 擴充欄位（`email_taken`）；代碼公開後只增不改。`detail` 與 `title` 會改、會翻譯，不能拿來判斷。' },
      { b: '內部資訊不外流，用 request id 對日誌', t: '回應裡不放例外原文、stack trace、SQL、資料表名稱。回應帶 request id，log 每行也帶，使用者回報時維運直接查到完整原因。' },
    ],
    checklist: [
      '能替一個 API 列出預期內錯誤，各自對應到正確的 4xx 狀態碼與錯誤代碼',
      '能寫出全域例外處理器：預期內錯誤轉成 Problem Details，未預期錯誤回通用 500 並完整記 log',
      '能說明 `type`、`title`、`detail`、`instance` 各放什麼，以及前端該依哪個欄位判斷',
    ],
    refs: [
      { label: 'RFC 9457：Problem Details for HTTP APIs', url: 'https://www.rfc-editor.org/rfc/rfc9457' },
      { label: 'RFC 9110：HTTP Semantics（狀態碼）', url: 'https://www.rfc-editor.org/rfc/rfc9110' },
      { label: 'Python 教學：錯誤與例外', url: 'https://docs.python.org/3/tutorial/errors.html' },
      { label: 'FastAPI：Handling Errors', url: 'https://fastapi.tiangolo.com/tutorial/handling-errors/' },
    ],
  },
  'uv-packaging': {
    points: [
      { b: 'pyproject.toml 記「你要什麼」，uv.lock 記「實際裝了什麼」', t: '前者是直接依賴與版本範圍，後者是完整解析結果（含間接依賴、精確版本、hash）。兩個都進版控。' },
      { b: '`uv run` 是新的入口', t: '不用 activate。`uv run pytest`、`uv run uvicorn app:app` 會先確保 .venv 與 lock 同步再執行。' },
      { b: '`--locked` 給 CI、`--frozen` 給 Docker', t: '`uv sync --locked`：lock 與 pyproject 不一致就失敗（CI 用它抓「忘了更新 lock」）；`uv sync --frozen`：不檢查、不更新，照 lock 裝（Docker build 用它）。兩者都不會「順便升級」，這是可重現的保證。' },
      { b: 'dev 依賴分組', t: '`uv add --dev pytest ruff` 進 `[dependency-groups]`，正式環境 `--no-dev` 就不會裝。' },
      { b: '.python-version 釘版本', t: 'uv 會自動下載對應的 Python，團隊不再各用各的 3.10 / 3.12。' },
    ],
    checklist: [
      '能從零 `uv init` 一個專案、加依賴、跑起來',
      '能說明 pyproject.toml 與 uv.lock 的分工，以及為何 lock 要進版控',
      '知道 `uv sync --locked`、`uv sync --frozen` 與 `uv lock --upgrade` 分別在什麼情境用',
    ],
    refs: [
      { label: 'uv 官方文件', url: 'https://docs.astral.sh/uv/' },
    ],
  },
  'python-async': {
    points: [
      { b: '`await` 是「讓出控制權」', t: '碰到 I/O 就把執行權還給 event loop 去跑別人，I/O 完成再回來。單執行緒也能同時處理很多請求——但 CPU 密集運算會霸住 loop。' },
      { b: 'GIL 的實際意義', t: '預設的 CPython 同一時間只有一個執行緒在跑 Python bytecode；等 I/O 時會釋放 GIL，所以多執行緒對 I/O 密集有效、對 CPU 密集無效（要用多程序）。3.13 起有實驗性的 free-threaded build，但生態系還在跟上。' },
      { b: '別在 async 函式裡用同步 driver', t: '`psycopg2`、`requests` 會阻塞整個 loop。要用 `asyncpg`、`httpx.AsyncClient`、`motor`，或把同步呼叫丟到 threadpool。' },
      { b: 'FastAPI 的 def 與 async def 差別', t: '`def` handler 會自動在 threadpool 執行（不會卡 loop）；`async def` 才真的跑在 loop 上，裡面就不能有阻塞呼叫。' },
    ],
    checklist: [
      '能畫出 6 個 I/O 請求在同步 / 多執行緒 / async 三種模式下的時間軸',
      '能說出「在 async 裡呼叫同步 DB driver」會發生什麼事',
      '知道 CPU 密集工作在 Python 該怎麼處理',
    ],
    refs: [
      { label: 'asyncio 官方文件', url: 'https://docs.python.org/3/library/asyncio.html' },
      { label: 'FastAPI：Concurrency and async / await', url: 'https://fastapi.tiangolo.com/async/' },
    ],
  },
  'web-framework': {
    points: [
      { b: '一個請求的路徑', t: 'ASGI server（uvicorn）→ middleware（CORS、log、trace id）→ 路由比對 → 依賴注入（DB session、目前使用者）→ 參數驗證（pydantic）→ handler → 回應序列化 → middleware 收尾。' },
      { b: '依賴注入不是魔法', t: '`Depends(get_db)` 就是「執行這個函式、把結果塞給我」。把「取得目前使用者」「開 DB session」寫成依賴，handler 只剩商業邏輯。' },
      { b: '分層：router / service / repository', t: 'router 管 HTTP、service 管商業規則、repository 管資料庫。小專案可以合併，但界線要在腦中存在。' },
      { b: '設定與生命週期', t: '啟動時建立連線池、關閉時釋放（lifespan）；設定從環境變數讀（pydantic-settings）。' },
    ],
    checklist: [
      '能畫出一個請求從 uvicorn 到 handler 再回去的每一層',
      '能用 Depends 抽出「目前使用者」與「DB session」',
      '知道 middleware 適合做什麼、不適合做什麼',
    ],
    refs: [
      { label: 'FastAPI 官方文件', url: 'https://fastapi.tiangolo.com/' },
    ],
  },
  'testing': {
    points: [
      { b: 'fixture 是依賴注入', t: '`def test_x(client, db)`：pytest 依名字找 fixture 提供。DB session、測試用 client、假資料都這樣給，測試本身很乾淨。' },
      { b: '整合測試用真的資料庫', t: '用 docker-compose 起一個測試用 PostgreSQL，每個測試在 transaction 裡跑、結束 rollback。SQLite 假裝 Postgres 會漏掉真正的 bug。' },
      { b: 'mock 外部服務，不 mock 自己的資料庫', t: '第三方 API、寄信、付款用 mock 或 fake；自己的資料層要真的測。' },
      { b: 'API 測試用 TestClient', t: 'FastAPI 的 `TestClient` 直接打 handler 不用起 server，一個測試幾毫秒。' },
    ],
    checklist: [
      '能為一個 API endpoint 寫「正常」「驗證失敗」「未授權」三種測試',
      '能設定測試資料庫 fixture，每個測試互不污染',
      '知道什麼該 mock、什麼不該',
    ],
    refs: [
      { label: 'pytest 官方文件', url: 'https://docs.pytest.org/' },
      { label: 'FastAPI：Testing', url: 'https://fastapi.tiangolo.com/tutorial/testing/' },
    ],
  },
  'code-quality': {
    points: [
      { b: 'ruff 一個工具取代五個', t: 'lint（flake8 規則集）、import 排序、格式化（black 相容）都是它，快到可以每次存檔跑。設定寫在 pyproject.toml 的 `[tool.ruff]`。' },
      { b: '型別檢查的嚴格度漸進', t: '先 `basic`，新檔案用 `strict`。回報的錯誤多半是真的 bug（None 沒處理、回傳型別不一致）。' },
      { b: 'pre-commit 讓規則自動執行', t: 'commit 時自動跑 ruff / pyright；CI 再跑一次當最後防線。' },
    ],
    checklist: [
      '專案有 ruff + 型別檢查設定，且 CI 會跑',
      '能讀懂型別檢查器的錯誤並修正，而不是加 `# type: ignore`',
    ],
    refs: [
      { label: 'ruff', url: 'https://docs.astral.sh/ruff/' },
      { label: 'mypy', url: 'https://mypy.readthedocs.io/' },
    ],
  },
  'logging-config': {
    points: [
      { b: '結構化 log（JSON）', t: '每行 log 帶 `request_id`、`user_id`、`path`、`duration_ms`，才能在 log 系統裡查詢與聚合。人讀的格式只留給本機開發。' },
      { b: '錯誤分三層', t: '預期的商業錯誤（回 4xx、不記 error log）、未預期的例外（回 500、記 stack trace、送告警）、驗證錯誤（回 422、附欄位）。' },
      { b: '設定來自環境變數', t: '同一份 image 靠環境變數跑在 dev / staging / prod；secret 不寫進程式碼與 repo。這是 12-factor 的核心。' },
      { b: 'request id 貫穿全程', t: 'middleware 產生或沿用 `X-Request-ID`，寫進每行 log 與回應標頭，前後端對問題時才對得上。' },
    ],
    checklist: [
      '服務的每行 log 都是 JSON 且帶 request_id',
      '有一個全域例外處理器，未預期錯誤不會把 stack trace 回給客戶端',
      '所有設定（DB URL、secret）都從環境變數讀',
    ],
    refs: [
      { label: 'logging 官方文件', url: 'https://docs.python.org/3/library/logging.html' },
      { label: 'The Twelve-Factor App', url: 'https://12factor.net/' },
    ],
  },
}
