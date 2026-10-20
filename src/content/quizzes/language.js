// 題庫：語言與工程實踐
export default [
  {
    skill: 'python-backend',
    questions: [
      {
        q: '在 Python 3.12 專案裡寫 `def get_user(user_id: int) -> User | None`，回傳型別標註 `User | None` 對程式的實際影響是？',
        options: [
          '執行時若回傳其他型別會拋 TypeError，等於多了一層 runtime 防護',
          '等同 `Optional[User]`，但只有 `Optional[...]` 寫法會被 pyright / mypy 檢查',
          '會讓函式在回傳 None 時自動轉成 NotFound 例外',
          '執行時完全不檢查；它是給 pyright / mypy 與讀程式的人看的，靜態分析會要求呼叫端先處理 None 才能取屬性',
        ],
        answer: 3,
        explain: 'Python 的型別提示在 runtime 不會被強制執行（選項一、三錯），價值在靜態檢查與可讀性：pyright 看到 `User | None` 會在你直接寫 `user.name` 時報錯，逼你處理找不到的情況。`User | None` 與 `Optional[User]` 完全等價（3.10+ 建議用 `|`），兩種寫法檢查器都懂，選項二錯。',
      },
      {
        q: '執行這段程式會印出什麼？',
        code: `def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags

print(add_tag("a"))
print(add_tag("b"))`,
        lang: 'python',
        options: [
          "['a'] 然後 ['b']",
          "['a'] 然後 ['a', 'b']",
          "['a'] 然後 ['a']",
          '第二次呼叫拋出 TypeError',
        ],
        answer: 1,
        explain: '預設參數只在 `def` 執行時求值一次，之後每次呼叫沒傳 tags 都共用同一個 list 物件，所以第二次會累積成 `["a", "b"]`。正確寫法是 `tags=None`，在函式內 `if tags is None: tags = []`。這類「可變預設參數」是 Python 特有陷阱，dataclass / pydantic 的 `default_factory` 也是為了同一個問題而存在。',
      },
      {
        q: '你在 service 層寫 `get_order(order_id)`，訂單不存在時該怎麼處理最符合「例外是控制流的一部分、在單一位置轉成 HTTP 錯誤」？',
        options: [
          'raise 自訂的 `OrderNotFound` 例外，由應用最外層的 exception handler 統一對應成 404',
          '在 service 裡直接 `raise HTTPException(status_code=404)`，最直接',
          '回傳 None，讓每個呼叫端自己判斷要回什麼狀態碼',
          '在 service 裡 try/except 接住所有例外、記 log 後回傳空 dict，避免往上炸',
        ],
        answer: 0,
        explain: '自訂例外讓 service 層只描述「業務上發生什麼事」，HTTP 狀態碼的對應集中在一個 handler，之後改回應格式或新增錯誤碼只改一處。直接丟 HTTPException 把 HTTP 語意混進 service，讓它無法被背景工作或 CLI 重用；回傳 None 會讓每個呼叫端重複寫判斷且容易漏；吞掉例外回空 dict 是最糟的——錯誤被隱藏，之後 None 或空資料到處亂飛。',
      },
    ],
  },
  {
    skill: 'how-programs-run',
    questions: [
      {
        q: '同一個行程裡的兩個執行緒，下列哪一項是它們「各自擁有」而不是共用的？',
        options: [
          '堆積（heap）上的物件，例如全域的 dict 快取',
          '檔案描述子表，例如已經開著的資料庫連線 socket',
          '各自的 stack（函式呼叫的 frame 與區域變數）以及暫存器狀態',
          '行程的 PID 與環境變數',
        ],
        answer: 2,
        explain: '執行緒是 CPU 排程的單位，每個執行緒有自己的 stack 與暫存器，所以各自的呼叫鏈互不干擾。heap 上的物件、fd 表、PID、環境變數都屬於行程，同一行程內的執行緒共用——這也是為什麼兩個執行緒可以讀寫同一個 dict（要處理同時修改），也能共用同一條連線。',
      },
      {
        q: '服務跑了幾小時後開始大量出現這個錯誤，每次重啟就暫時恢復。最可能的原因與第一步調查是？',
        code: 'OSError: [Errno 24] Too many open files',
        lang: 'bash',
        options: [
          '磁碟空間不足；先用 df -h 清出空間',
          'fd 洩漏：連線或檔案沒有關閉；隔一段時間數 /proc/<pid>/fd 的項目，確認是否一路成長，再找沒用 with 或沒 close 的地方',
          'Python 的遞迴太深；把 sys.setrecursionlimit 調大',
          '記憶體不足被 OOM killer 砍掉；調高容器的記憶體上限',
        ],
        answer: 1,
        explain: 'Errno 24（EMFILE）是行程持有的檔案描述子到達上限，socket 也算在內。「跑久了才壞、重啟就好」是洩漏的典型特徵，例如每個請求新建 HTTP client 卻不關。數 /proc/<pid>/fd 能確認是否持續成長；直接調高 ulimit -n 只是延後爆發。磁碟滿是 ENOSPC、遞迴是 RecursionError、OOM 是行程被 SIGKILL（退出碼 137），訊息都不同。',
      },
      {
        q: '一個 Python 服務要對上傳的資料做大量純 Python 計算，在 4 核心機器上想縮短處理時間。在預設的 CPython（有 GIL）下，最合理的做法是？',
        options: [
          '用 ProcessPoolExecutor 把工作分給多個行程，每個行程有自己的直譯器與 GIL',
          '用 ThreadPoolExecutor 開 4 個執行緒，平均分攤到 4 顆核心',
          '改寫成 async def 並在迴圈裡 await asyncio.sleep(0)，讓 event loop 平行執行',
          '把 ulimit -n 調高，讓行程可以同時處理更多工作',
        ],
        answer: 0,
        explain: 'GIL 讓同一行程同一時間只有一個執行緒跑 Python bytecode，純計算開再多執行緒也只是輪流跑；多行程才能真的用到多核心，代價是記憶體各一份、資料要序列化傳遞。asyncio 是單執行緒，sleep(0) 只是讓出控制權，不會平行；ulimit -n 是 fd 上限，與 CPU 無關。',
      },
    ],
  },
  {
    skill: 'data-representation',
    questions: [
      {
        q: '後端（Python）回傳 `{"order_id": 9007199254740993}`，前端用 `JSON.parse` 後顯示成 9007199254740992。根本原因與正確修法是？',
        options: [
          'Python 的 json 模組對大整數有精度問題；改用 orjson 序列化',
          'HTTP 傳輸時壓縮造成數字被截斷；關掉 gzip',
          '資料庫的 bigint 欄位溢位；改成 numeric',
          'JavaScript 的 Number 是雙精度浮點數，只能精確表示到 2^53 − 1；這類 ID 改用字串傳，前端只比對與顯示',
        ],
        answer: 3,
        explain: 'Python 的 int 沒有上限，後端輸出的 JSON 文字本身是正確的；失準發生在前端把它解析成 Number 時——超過 Number.MAX_SAFE_INTEGER（9007199254740991）的整數會被捨入。換序列化函式庫、關壓縮、改資料庫型別都解決不了解析端的問題。64 位元 ID 對外一律當字串傳。',
      },
      {
        q: '這段程式最後一行印出什麼？',
        code: `from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
t = datetime(2026, 10, 19, 17, 30, tzinfo=timezone.utc)
print(t.astimezone(TAIPEI).isoformat())`,
        lang: 'python',
        options: [
          '2026-10-19T17:30:00+08:00',
          '2026-10-20T01:30:00+08:00',
          '2026-10-19T09:30:00+08:00',
          '2026-10-20T01:30:00Z',
        ],
        answer: 1,
        explain: 'astimezone 把同一個時間點換算到另一個時區：UTC 17:30 加 8 小時是隔天 01:30，偏移標成 +08:00。第一個選項只改了標籤沒換算時間（那是 replace(tzinfo=...) 的效果，代表另一個時間點）；第三個是減了 8 小時；第四個時間對了但標成 Z（UTC），意思就錯了。也注意日期從 19 號變 20 號——依日期分組的報表要先轉到業務時區再取日期。',
      },
      {
        q: '購物車要計算含稅金額並四捨五入到小數兩位，目前用 float 計算，對帳時偶爾差一分錢。最合適的改法是？',
        options: [
          '金額改用 Decimal 並從字串建立（例如 Decimal("19.90")），用 quantize 搭配明確的捨入規則；或改存整數的最小單位',
          '繼續用 float，最後用 round(x, 2) 四捨五入就不會有誤差',
          '改用 Decimal(19.9) 建立，再用 round 處理',
          '在資料庫用 double precision 欄位存，由資料庫負責精度',
        ],
        answer: 0,
        explain: 'float 是二進位浮點數，0.1 這類十進位小數本來就存不精確，round 也救不了：round(2.675, 2) 得到 2.67，而且 Python 的 round 是銀行家捨入。Decimal(19.9) 從 float 建立會把誤差一起帶進來，要從字串建立。double precision 和 float 是同一種表示法；資料庫應該用 numeric 或整數分。',
      },
    ],
  },
  {
    skill: 'uv-packaging',
    questions: [
      {
        q: 'uv 專案裡 pyproject.toml 與 uv.lock 的分工是什麼、哪些該進版控？',
        options: [
          'pyproject.toml 記所有依賴的精確版本；uv.lock 只是本機安裝快取，應加進 .gitignore',
          'uv.lock 給 CI 用、本機開發只需要 pyproject.toml，所以 lock 不必進版控',
          'pyproject.toml 記直接依賴與版本範圍（你要什麼）；uv.lock 記完整解析結果含間接依賴、精確版本與 hash（實際裝了什麼）；兩者都進版控',
          '兩者內容等價，uv.lock 只是 pyproject.toml 的機器可讀版本，擇一提交即可',
        ],
        answer: 2,
        explain: 'pyproject.toml 表達意圖（`fastapi>=0.110`），uv.lock 記錄某次解析的完整結果（連 fastapi 依賴的 starlette、anyio 精確到哪一版、hash 是多少）。lock 進版控才能讓同事、CI、Docker 裝出一模一樣的環境——這正是「在我電腦可以跑」的解法。不提交 lock 等於每個人各自解析，版本漂移就回來了。',
      },
      {
        q: 'Dockerfile 裡有這一行，它的行為是？',
        code: 'RUN uv sync --frozen --no-dev',
        lang: 'bash',
        options: [
          '完全以 uv.lock 為準安裝、不重新解析也不改寫 lock，並略過 dev 依賴群組；lock 檔不存在會直接失敗',
          '先依 pyproject.toml 重新解析並更新 uv.lock，再安裝正式依賴',
          '安裝 dev 以外的套件，並允許升級到版本範圍內的最新版',
          '只建立 .venv 不裝任何東西，等到 uv run 時才安裝',
        ],
        answer: 0,
        explain: '`--frozen` 把 uv.lock 當唯一真相：不解析、不更新、沒有 lock 就報錯，這是 CI / Docker 要的可重現性。`--no-dev` 略過 `[dependency-groups]` 的 dev 群組（pytest、ruff）。想「順便升級」要另外跑 `uv lock --upgrade`，sync 不會做這件事。補充：`--frozen` 不會檢查 lock 是否已過期，若要在 lock 與 pyproject 不一致時直接失敗，用 `--locked`。',
      },
      {
        q: '同事回報 requests 有安全性更新，你要把專案升到新版並讓全隊與 CI 一致。正確做法？',
        options: [
          '把 CI 的安裝指令改成會升級的模式，讓每次建置自動拿最新版',
          '本機跑 `uv lock --upgrade-package requests`（或 `uv lock --upgrade`），測試通過後把更新後的 uv.lock 連同程式碼一起 commit',
          '刪掉 uv.lock 並加進 .gitignore，讓每個人各自解析就會拿到最新版',
          '手動改 pyproject.toml 的版本號即可，uv.lock 不需要跟著變',
        ],
        answer: 1,
        explain: '升級是有意識的動作：在本機重新解析、跑測試、然後提交新的 lock，CI 與同事用 `uv sync --frozen` 就會拿到一樣的版本。讓 CI 自動升級會使每次建置結果不同，出問題無法重現；刪 lock 等於放棄可重現性；只改 pyproject 而不更新 lock，`--frozen` 會裝舊版（`--locked` 則直接報錯），兩邊不一致。',
      },
    ],
  },
  {
    skill: 'python-async',
    questions: [
      {
        q: 'CPython 的 GIL 對「用多執行緒加速」的實際影響是什麼？',
        options: [
          '只要執行緒數量等於 CPU 核心數，GIL 就會自動釋放，多執行緒即可平行運算',
          '多執行緒完全無法帶來任何好處，不論 I/O 或 CPU 密集都只能用多程序',
          'GIL 只影響 asyncio，threading 模組不受影響',
          '同一時間只有一個執行緒在執行 Python bytecode，但等 I/O 時會釋放 GIL；因此多執行緒對 I/O 密集有效、對 CPU 密集沒幫助',
        ],
        answer: 3,
        explain: 'GIL 讓 CPython 同一瞬間只跑一個執行緒的 bytecode，所以純 Python 的 CPU 運算開再多執行緒也不會更快（要用多程序）。但執行緒在等 socket、檔案、DB 回應時會釋放 GIL 讓別人跑，所以 I/O 密集的工作多執行緒仍有效。GIL 與核心數無關，也不是 asyncio 專屬的概念。',
      },
      {
        q: '這段 FastAPI handler 在高流量下會出什麼問題？',
        code: `@app.get("/report")
async def report():
    resp = requests.get(DATA_URL, timeout=5)
    return resp.json()`,
        lang: 'python',
        options: [
          '沒問題，async def 會自動把同步呼叫丟到 threadpool',
          '`requests.get` 是同步阻塞呼叫，在 async def 裡會卡住整個 event loop，期間所有其他請求都停擺；應改用 `httpx.AsyncClient` 並 await，或把 handler 改成 `def`',
          '只是少了 await，改成 `await requests.get(...)` 即可',
          '問題在 `.json()` 沒有 await，它會回傳 coroutine',
        ],
        answer: 1,
        explain: 'FastAPI 只會把 `def` handler 放到 threadpool；`async def` 是真的跑在 event loop 上，裡面任何同步阻塞呼叫（requests、psycopg2、time.sleep）都會讓整個 loop 停住，而不是只慢這一個請求。requests 不是 awaitable，加 await 只會拋 TypeError。解法是用非同步 client（httpx.AsyncClient、asyncpg），或把這個 handler 改成 `def` 讓它進 threadpool。',
      },
      {
        q: '有個 endpoint 要對上傳的圖片做約 2 秒的純 Python CPU 運算，目前寫成 async def，一被呼叫其他請求就變慢。最合理的處理？',
        options: [
          '把運算丟到程序池（ProcessPoolExecutor）或獨立的 worker / 任務佇列，讓 event loop 只負責 I/O',
          '改用 threading 在多個執行緒跑這段運算，即可利用多核心',
          '在運算中多插幾個 `await asyncio.sleep(0)`，讓 loop 有機會切換',
          '把 uvicorn 的 worker 數量開到跟核心數一樣就能完全解決，不用改程式',
        ],
        answer: 0,
        explain: 'CPU 密集工作在 CPython 要用多程序或外部 worker 才不會擋到別人：`run_in_executor` 配 ProcessPoolExecutor，或丟給 Celery / RQ 這類佇列非同步處理。threading 受 GIL 限制對 CPU 運算沒幫助；插 `sleep(0)` 只是把 2 秒切成很多段，總佔用時間不變，其他請求依然被拖慢；多開 uvicorn worker 能分攤但每個 worker 仍會被卡 2 秒，流量一上來就撐不住。',
      },
    ],
  },
  {
    skill: 'web-framework',
    questions: [
      {
        q: '一個 HTTP 請求進入 FastAPI 服務後，哪個順序最接近實際經過的層？',
        options: [
          'uvicorn → 路由比對 → middleware → 參數驗證 → handler → 序列化',
          'uvicorn → middleware → 路由比對 → 依賴注入與參數驗證 → handler → 回應序列化 → middleware 收尾',
          'uvicorn → 參數驗證 → 路由比對 → middleware → handler → 序列化',
          'uvicorn → middleware → handler → 依賴注入 → 參數驗證 → 序列化',
        ],
        answer: 1,
        explain: 'middleware 包在最外層，所以請求進來先過它（CORS、log、request id），回應出去也再經過它一次；接著才比對路由、執行 `Depends` 與 pydantic 驗證、進 handler、把回傳值序列化。參數驗證不可能在路由比對前發生——不知道打到哪個 endpoint 就不知道要用哪個 model；依賴注入與驗證也一定在 handler 之前，handler 拿到的已是驗過的物件。',
      },
      {
        q: '`Depends(get_db)` 在這段程式裡實際做了什麼？',
        code: `def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/orders/{order_id}")
def read_order(order_id: int, db: Session = Depends(get_db)):
    return db.get(Order, order_id)`,
        lang: 'python',
        options: [
          '在應用啟動時執行一次 get_db，之後所有請求共用同一個 session',
          '只是型別標註的替代寫法，handler 內還是要自己呼叫 get_db()',
          '每個請求進來時執行 get_db 到 yield，把 session 交給 handler；請求結束後繼續執行 finally 關閉它',
          '把 get_db 註冊成 middleware，對所有路由前後執行',
        ],
        answer: 2,
        explain: '依賴注入就是「框架替你呼叫這個函式，把結果塞進參數」，每個請求都會執行一次。帶 yield 的依賴等於有 setup / teardown：yield 前是準備、yield 後是清理，所以 session 一定會被關閉。它不是全域單例，也不是 middleware——middleware 對所有路由生效且看不到路徑參數，依賴只掛在宣告它的 handler 上，還能取用 order_id 這類參數。',
      },
      {
        q: '下列哪件事最不適合放在 middleware，而應該用 Depends 或放在 service 層？',
        options: [
          '為每個請求產生 request_id，寫進 log 與回應標頭',
          '記錄每個請求的路徑、狀態碼與耗時',
          '統一加上 CORS 相關標頭',
          '檢查目前使用者是否為這筆訂單的擁有者',
        ],
        answer: 3,
        explain: 'middleware 適合對所有請求一律執行、不需要知道商業物件的橫切事務：log、trace id、CORS、壓縮、逾時。擁有權檢查需要路徑參數（order_id）、目前使用者與查資料庫，而且只對特定 endpoint 有意義——這是 `Depends(get_order_or_403)` 或 service 層的工作。硬塞進 middleware 會變成自己解析 URL、猜路由的義大利麵。',
      },
    ],
  },
  {
    skill: 'project-layering',
    questions: [
      {
        q: '在 handler → service → repository 的分層裡，下列哪一種寫法違反了「領域邏輯不碰框架與資料庫」？',
        options: [
          'service 的建構子接收一個符合 OrderRepository Protocol 的物件',
          'repository 在查詢時接住資料庫的唯一鍵衝突，改丟領域例外 EmailTaken',
          'service 在找不到訂單時 raise HTTPException(status_code=404)',
          'handler 把 pydantic 的請求 model 拆成參數後呼叫 service',
        ],
        answer: 2,
        explain: 'HTTPException 是 Web 框架的概念，放進 service 之後，同一段規則被批次工作或 CLI 呼叫時就沒有意義，也讓測試必須理解 HTTP。service 應該丟自訂例外（OrderNotFound），在邊界轉成 404。其他三個選項正是建議的做法：依賴介面注入、在 repository 邊界翻譯基礎設施例外、在 handler 做資料轉換。',
      },
      {
        q: '要替這個 service 寫「過期的折扣碼要被拒絕」的單元測試，下列寫法最大的障礙是什麼？',
        code: `class CheckoutService:
    def __init__(self):
        self.repo = PostgresCouponRepository(connect(DATABASE_URL))

    def apply(self, code: str, amount: int) -> int:
        coupon = self.repo.get(code)
        if coupon.expires_on < date.today():
            raise CouponExpired(code)
        return amount * (100 - coupon.percent) // 100`,
        lang: 'python',
        options: [
          'apply 沒有加 async，測試框架無法呼叫',
          'service 自己建立 PostgreSQL repository、又直接呼叫 date.today()，測試無法換成記憶體版 repository，也無法固定「今天」',
          'coupon.percent 是整數，除法結果會有浮點誤差',
          'CouponExpired 應該繼承 HTTPException 才能被測試接住',
        ],
        answer: 1,
        explain: '依賴寫死在內部，測試只能真的連資料庫，或用 mock.patch 去改模組路徑；date.today() 寫死讓「到期日當天」這類邊界無法測。改成建構子注入：CheckoutService(repo, today) 或傳入 clock，測試直接傳 InMemoryCouponRepository 與固定日期。async 與否和可測性無關；// 是整數除法沒有浮點誤差；例外不該繼承 HTTP 類別。',
      },
      {
        q: 'FastAPI 專案裡，handler 透過 Depends 鏈取得 OrderService（get_conn → get_order_repo → get_order_service）。整合 API 測試時想讓 repository 改用記憶體版，最合適的做法是？',
        options: [
          '在測試裡 monkeypatch PostgresOrderRepository 類別的每個方法',
          '在 handler 裡加 if os.environ.get("TESTING") 判斷要建立哪一種 repository',
          '測試開始前把正式資料庫清空，跑完再還原',
          '設定 app.dependency_overrides[get_order_repo] = lambda: InMemoryOrderRepository(...)，handler 與 service 都不用改',
        ],
        answer: 3,
        explain: 'dependency_overrides 是 FastAPI 提供的測試機制：指定某個 provider 換成另一個函式，依賴鏈上游的 service 與 handler 完全不變。逐一 monkeypatch 方法很脆弱、容易漏；在正式程式碼裡判斷 TESTING 等於把測試邏輯混進產品；動正式資料庫則危險又無法平行。注意 repository 本身仍要另外對真的 PostgreSQL 做整合測試。',
      },
    ],
  },
  {
    skill: 'error-design',
    questions: [
      {
        q: '依 RFC 9457（Problem Details），前端要依「錯誤種類」決定顯示什麼訊息時，應該依據哪個欄位？',
        options: [
          '`type`（問題類型的 URI，是類型的主要識別），或與它一對一的穩定代碼擴充欄位',
          '`detail`，因為它最具體地描述了這次發生什麼事',
          '`title`，因為同一種問題的標題不會改變',
          '`instance`，因為它唯一識別了這個問題',
        ],
        answer: 0,
        explain: 'RFC 9457 規定 type 是問題類型的主要識別；很多團隊另外加一個與 type 一對一的 code 擴充欄位方便判斷。detail 是給人看的這一次說明，RFC 明確指出客戶端不應解析它；title 會因翻譯而不同；instance 識別的是「這一次事件」而不是種類，每次都不一樣。',
      },
      {
        q: '使用者註冊時 Email 重複，伺服器回了下面這個回應。最需要修正的問題是？',
        code: `HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"error": "psycopg.errors.UniqueViolation: duplicate key value violates unique constraint \\"users_email_key\\""}`,
        lang: 'http',
        options: [
          'Content-Type 應該是 text/plain，因為內容是錯誤訊息',
          '應該改回 200，並在 body 加上 "success": false',
          '這是預期內錯誤卻回 500，且把資料庫例外原文外洩；應在 repository 翻譯成 EmailTaken，邊界轉成 409 的 Problem Details，帶穩定代碼與給使用者的說明',
          '只要把錯誤訊息翻譯成中文即可，狀態碼不用改',
        ],
        answer: 2,
        explain: '重複 Email 是使用者能處理的預期內錯誤，應回 4xx（409 Conflict），否則監控會把正常操作當成伺服器故障；回應裡的約束名稱與驅動例外暴露了內部結構，前端也只能去比對字串。正確做法是翻譯成領域例外、用 application/problem+json 回應並附穩定代碼。200 加 success:false 會讓監控與 HTTP client 誤判成功；只翻譯文字仍然外洩資訊且狀態碼錯。',
      },
      {
        q: '使用者回報「按下結帳出現伺服器錯誤」，畫面上只有通用訊息。要讓維運能快速找到原因，同時不把內部細節給使用者，最合適的設計是？',
        options: [
          '在 500 回應的 detail 放完整 stack trace，讓使用者截圖回報',
          '每個請求產生 request id，寫進每一行 log、回應標頭與錯誤內容；使用者回報 id，維運在 log 系統搜尋完整的 stack trace',
          '在每個函式裡 try/except Exception，把錯誤寫進資料庫的 errors 表後回傳 None',
          '讓 500 回應附上伺服器主機名稱與時間，維運再去那台機器翻 log',
        ],
        answer: 1,
        explain: 'request id 把「使用者看到的回應」和「伺服器上的完整紀錄」串起來：回應只露出一個無意義的 id，log 裡才有 stack trace 與上下文。把 stack trace 回給使用者是資訊外洩；在每個函式吞掉例外再回 None 會讓 bug 變成靜悄悄的錯誤資料；主機名稱同樣是內部資訊，多台機器、容器重建後也很難找。',
      },
    ],
  },
  {
    skill: 'testing',
    questions: [
      {
        q: '寫整合測試時，哪個做法符合「mock 外部服務、不 mock 自己的資料庫」？',
        options: [
          '用 mock 取代 repository 層，測試就不需要資料庫，跑得最快',
          '第三方付款 API 用 fake / mock 取代；自己的資料層打一個 docker 起的測試用 PostgreSQL',
          '資料庫改用 SQLite in-memory 模擬 Postgres，外部 API 則直接打對方的 sandbox',
          '全部都打真的，包括第三方付款 API，才算真正的整合測試',
        ],
        answer: 1,
        explain: '外部服務慢、不穩、有副作用（真的扣款、寄信），所以用 fake；自己的資料層是 bug 最常藏的地方（SQL 寫錯、約束、交易邊界），mock 掉等於沒測。SQLite 假裝 Postgres 會漏掉方言差異、JSONB、鎖行為等真正的問題。CI 起一個 Postgres 容器的成本遠低於漏掉這些 bug。',
      },
      {
        q: '這個 pytest fixture 的設計目的是？',
        code: `@pytest.fixture
def db(engine):
    conn = engine.connect()
    tx = conn.begin()
    session = Session(bind=conn)
    yield session
    session.close()
    tx.rollback()
    conn.close()

def test_create_order(db):
    db.add(Order(total=100))
    db.flush()
    assert db.query(Order).count() == 1`,
        lang: 'python',
        options: [
          '確保測試資料會被寫進資料庫，方便事後人工檢查',
          '讓 fixture 在整個測試 session 只建立一次，所有測試共用同一個 session 物件',
          '讓 pytest 依名字自動建立 Order 對應的資料表',
          '每個測試在自己的 transaction 裡跑，結束時 rollback，測試之間不會互相留下資料',
        ],
        answer: 3,
        explain: 'fixture 預設 scope 是 function，每個測試都會重新執行：開連線、開交易、給 session，測試結束（yield 之後）rollback，所以 test_create_order 新增的訂單不會影響下一個測試。這就是「每個測試互不污染」的標準做法。它不會建表（那是 migration 或另一個 session 級 fixture 的事），資料也不會留下來。',
      },
      {
        q: '你要為 `POST /orders` 寫 API 測試。哪一組最能涵蓋「正常 / 驗證失敗 / 未授權」三種基本情境？',
        options: [
          '帶正確 body 與 token 期望 201；body 缺必填欄位期望 422；不帶 token 期望 401',
          '帶正確 body 期望 200；帶錯 body 期望 500；不帶 token 期望 404',
          '只測正確 body 期望 201，其餘兩種交給前端表單驗證擋掉',
          '三種情境都用 mock 取代 handler，只驗證路由有被呼叫到',
        ],
        answer: 0,
        explain: '這三種情境對應三個不同的層：handler 邏輯（201 且資料真的建立）、pydantic 驗證（422 並帶欄位錯誤）、認證依賴（401）。用 TestClient 打真的 endpoint 一個測試只要幾毫秒。500 代表伺服器有 bug，不該是預期結果；後端不能假設前端會驗證——API 會被任何客戶端打；mock 掉 handler 就什麼都沒測到。',
      },
    ],
  },
  {
    skill: 'code-quality',
    questions: [
      {
        q: '在 Python 專案導入 ruff，它可以直接取代下列哪一組工具？',
        options: [
          'flake8 + isort + mypy（lint、import 排序、型別檢查）',
          'black + mypy（格式化、型別檢查）',
          'flake8 + isort + black（lint、import 排序、格式化）',
          'pytest + coverage（測試與覆蓋率）',
        ],
        answer: 2,
        explain: 'ruff 一個工具包含 lint（相容 flake8 規則集，還有 pyupgrade、bugbear 等）、import 排序（取代 isort）與格式化（`ruff format`，black 相容），設定集中在 pyproject.toml 的 `[tool.ruff]`。它不做型別檢查——那是 pyright / mypy 的工作，兩者搭配才完整。',
      },
      {
        q: 'pyright 對這段程式回報 `"name" is not a known attribute of "None"`。正確的處理是？',
        code: `def find_user(user_id: int) -> User | None: ...

def greeting(user_id: int) -> str:
    user = find_user(user_id)
    return "Hi " + user.name`,
        lang: 'python',
        options: [
          '在該行加 `# type: ignore`，實務上 user 不會是 None',
          '把 find_user 的回傳型別改成 `User`，錯誤就消失',
          '把 greeting 的回傳型別改成 `str | None`',
          '在取 `user.name` 前處理 None：找不到就 raise NotFound 或回傳預設值',
        ],
        answer: 3,
        explain: '型別檢查器在提醒一個真的 bug：find_user 會回 None，`None.name` 在 runtime 就是 AttributeError。正確做法是明確處理這條路徑（`if user is None: raise NotFound`）。`# type: ignore` 是把警告關掉不是修 bug；把回傳型別改成 `User` 是對檢查器說謊；改 greeting 的回傳型別與問題無關——錯的是取屬性那一行。',
      },
      {
        q: '團隊常有人 commit 沒格式化的程式碼，到 CI 才被 ruff 擋下、來回浪費時間。最合理的改善？',
        options: [
          '把 CI 的 ruff 檢查移除，改由 code review 人工提醒',
          '加上 pre-commit hook，commit 時自動跑 ruff check --fix 與 ruff format；CI 保留同一組檢查當最後防線',
          '把 ruff 規則全部調成警告，讓 CI 不再失敗',
          '讓 CI 自動修好格式再 commit 回 PR 分支，開發者完全不用管',
        ],
        answer: 1,
        explain: '問題出在回饋太慢。pre-commit 把檢查搬到 commit 當下（幾秒內），且能自動修好大部分格式問題；CI 仍要跑一次，因為 hook 可以被跳過（`--no-verify`）或根本沒安裝。移除檢查或調成警告是放棄品質門檻；CI 自動 commit 回分支會產生機器 commit、與開發者本機分支衝突，且回饋依然要等 CI 跑完。',
      },
    ],
  },
  {
    skill: 'logging-config',
    questions: [
      {
        q: '使用者查詢一筆不存在的訂單，服務回 404。依「錯誤分三層」原則，這個事件的 log 該怎麼記？',
        options: [
          '記 error 等級並附 stack trace，方便追查',
          '屬於預期的商業錯誤：回 4xx、不記 error log（頂多 info / warning）、不觸發告警',
          '回 500 並送告警，資料找不到代表資料庫有問題',
          '回 422 並附欄位錯誤，因為這是輸入驗證問題',
        ],
        answer: 1,
        explain: '找不到是正常業務流程的一種結果，客戶端自己就能處理；如果記成 error 會把告警淹沒，半夜真正的 500 反而看不到。三層分法：預期的商業錯誤（4xx、不告警）、未預期例外（500、stack trace、告警）、驗證錯誤（422、附欄位）。422 是「請求格式或內容不合法」，「合法但找不到」用 404。',
      },
      {
        q: '相較於 `print(f"payment failed for user {user_id}")`，這種 log 在正式環境的主要好處是？',
        code: '{"ts":"2026-09-25T02:13:07Z","level":"error","msg":"payment failed","request_id":"c1f3a9","user_id":42,"path":"/orders","duration_ms":812}',
        lang: 'json',
        options: [
          '每個欄位能在 log 系統中獨立查詢與聚合：用 request_id 串起同一請求的所有 log、依 path 算 p95 duration、依 user_id 篩選',
          '檔案比較小，JSON 比純文字省空間',
          '在終端機比較好讀',
          'JSON 格式會自動隱藏 stack trace，避免洩漏內部資訊',
        ],
        answer: 0,
        explain: '正式環境的 log 是給機器讀的：Loki / Elasticsearch / CloudWatch 可以直接對欄位做篩選與統計，純文字要靠脆弱的 regex。JSON 其實比純文字長（key 重複），人眼也不好讀——所以人讀的格式只留給本機開發。它也不會自動處理 stack trace，那要靠 exception handler 決定記什麼、回什麼。',
      },
      {
        q: '服務要部署到 dev / staging / prod，DB 連線字串與第三方 API secret 各不相同。正確做法？',
        options: [
          '程式裡寫 `if ENV == "prod":` 分支，三組值都放在程式碼中',
          '每個環境一份 config.json 提交到 repo，部署時複製對應的檔案',
          '同一份 image，所有設定由環境變數注入（pydantic-settings 讀取），secret 只存在部署平台的 secret 管理，不進 repo',
          '在 Dockerfile 用 ENV 寫死 secret，為三個環境 build 三個 image',
        ],
        answer: 2,
        explain: '12-factor 的核心：程式與設定分離，同一個 image 靠環境變數跑在任何環境，換環境不用重 build。前兩個選項都把 secret 放進 repo，任何拿到程式碼的人都能看到；Dockerfile ENV 會把 secret 燒進 image layer，`docker history` 就能看到，而且三個 image 代表測過的東西不是上線的東西。',
      },
    ],
  },
]
