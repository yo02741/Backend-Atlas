// 題庫：資安（OWASP Top 10、注入、密碼儲存、XSS/CSRF、輸入驗證、秘密管理、供應鏈）
export default [
  {
    skill: 'owasp-top10',
    questions: [
      {
        q: '登入後 GET /api/orders/1234 看到自己的訂單；把網址改成 /api/orders/1235 卻看到別人的訂單。這屬於哪一類、怎麼修？',
        options: [
          'A03 注入——訂單 id 沒有參數化就直接拼進 SQL 查詢字串',
          'A01 存取控制失效（IDOR）——查詢時要一併驗證擁有權，例如 WHERE id = ? AND user_id = 目前登入者',
          'A02 加密機制失效——訂單 id 應該加密後再放進 URL，避免被讀懂',
          'A05 安全設定錯誤——把自增 id 換成 UUID 讓人猜不到就能解決',
        ],
        answer: 1,
        explain: '這是 Top 10 第一名的典型樣貌：伺服器只確認「你有登入」，沒確認「這個資源是你的」。修法是每個資源操作都驗擁有權與角色，最乾淨的是把目前使用者當成查詢條件的一部分，或取出後檢查 owner 再回傳。把 id 改成 UUID 或加密只是讓人比較難猜，屬於 security by obscurity——一旦 id 在其他地方洩漏（分享連結、log）漏洞依舊存在。這裡也沒有拼接 SQL 的問題，跟注入無關。',
      },
      {
        q: '這個「網址預覽」endpoint 會抓使用者給的 URL 並解析 og 標籤。主要風險是什麼？',
        code: `@app.post("/preview")
def preview(url: str):
    html = requests.get(url, timeout=5).text
    return extract_og_tags(html)`,
        lang: 'python',
        options: [
          'A03 注入——url 字串會被拼進 SQL 查詢，攻擊者可以藉此讀取資料庫',
          '只要加上登入檢查、確認是會員才能呼叫這個 endpoint，就沒有問題',
          'A10 SSRF——伺服器替攻擊者去請求內網或雲端 metadata 位址；要白名單目標網域、拒絕私有網段、不跟隨轉址',
          '有設 timeout 就安全了，SSRF 只在沒有逾時限制、能長時間佔用連線時才成立',
        ],
        answer: 2,
        explain: '使用者提供的 URL 由伺服器去 fetch，伺服器就成了攻擊者在內網的代理：打內部 admin 介面、掃 port、讀雲端 metadata 服務（169.254.169.254）拿到機器的憑證。防護要在「目標」上做：網域白名單（最好）、或解析 DNS 後拒絕 127.0.0.0/8、10.0.0.0/8、169.254.0.0/16 等私有／保留網段，並關閉自動轉址（requests 預設會跟隨 redirect，攻擊者可以用公開網址轉到內網）。timeout 只防慢，登入檢查只限縮了誰能打，兩者都不是解法。這段程式碼沒有碰 SQL。',
      },
      {
        q: '上線前檢查發現：FastAPI 以 debug=True 跑在正式環境、CORS 設 allow_origins=["*"]、requirements 兩年沒更新。這些對應 Top 10 的哪些類別？',
        options: [
          'A05 安全設定錯誤（debug、CORS）與 A06 過時元件（依賴）——用設定 checklist 與依賴掃描處理',
          'A01 存取控制失效——CORS 本質上就是伺服器端的存取控制機制',
          'A03 注入——debug 模式會把 SQL 錯誤訊息暴露給攻擊者，等於開了注入的門',
          '只有依賴過期算資安問題，debug 與 CORS 是開發便利性的取捨，不在 Top 10',
        ],
        answer: 0,
        explain: 'debug 模式會把 traceback、環境變數、原始碼片段直接回給使用者；CORS 全開讓任何網站都能用使用者的身分打你的 API；兩者都是「設定沒調成正式環境該有的樣子」，歸在 A05。兩年沒更新的依賴幾乎必然含已公開的 CVE，這是 A06。CORS 是瀏覽器層的同源放寬機制，不是伺服器端的授權檢查，別把它跟 A01 混為一談；debug 訊息洩漏 SQL 不等於注入。A05 與 A06 的好處是修法便宜：一份設定 checklist、一個 CI 裡的掃描。',
      },
    ],
  },
  {
    skill: 'injection',
    questions: [
      {
        q: '這段用 SQLAlchemy 的程式有 SQL 注入。哪個修法正確？',
        code: `name = request.args["name"]
rows = session.execute(
    text(f"SELECT * FROM users WHERE name = '{name}'")
)`,
        lang: 'python',
        options: [
          '把 name 裡的單引號替換成兩個單引號後再拼接，資料庫會把它當成字面值',
          '在前端表單限制 name 只能輸入英文字母與數字，後端維持原樣不需要改',
          '改用 ORM 的 session.query 呼叫 text()，ORM 會自動跳脫 f-string 裡的值',
          'text("… WHERE name = :name") 搭配 session.execute(stmt, {"name": name})，讓值以參數送出、與 SQL 分開',
        ],
        answer: 3,
        explain: '注入的根源是「使用者輸入變成 SQL 的一部分」。參數化查詢把 SQL 骨架與值分兩路送到資料庫，值永遠被當成值，不管裡面有引號、分號還是 -- 都無法改變語句結構。自己跳脫引號是黑名單思維，字元集、編碼、跳脫規則的差異都可能漏；前端驗證攔不住直接打 API 的人；text() 裡用 f-string 的字串在 ORM 眼中就是一段完整 SQL，沒有任何魔法會幫你跳脫——ORM 只有在你用它的參數綁定時才安全。',
      },
      {
        q: 'API 讓使用者用 ?sort=created_at 指定排序欄位。你把它參數化成 ORDER BY :sort，結果排序完全沒作用。該怎麼處理？',
        options: [
          '改回 f-string 直接拼進 SQL——欄位名不是值，攻擊者拼不出有效的注入',
          '用白名單 dict 把允許的 sort 值對應到寫死的欄位名（查不到就回 400）再拼進 SQL；識別字無法參數化',
          '把 sort 的值前後加上雙引號再參數化，資料庫就會把它當成欄位名而非字串',
          '改用 ORM 的 order_by(text(sort))，ORM 會驗證欄位是否存在於 model',
        ],
        answer: 1,
        explain: '參數只能代表「值」，ORDER BY :sort 被綁定後等於 ORDER BY \'created_at\'——排序一個常數，當然沒效果。表名、欄名、ASC/DESC 這類識別字沒有參數化機制，唯一安全的做法是白名單：使用者傳的是「選項名」，程式查表換成你寫死的欄位名，不在表裡就拒絕。直接拼接就是注入（ORDER BY (CASE WHEN ... ) 可以做盲注）；加引號變成字串常數同樣沒排序；order_by(text(...)) 只是把字串原樣送出去，沒有任何驗證。',
      },
      {
        q: '縮圖服務對上傳的檔案這樣處理。問題與正確修法是？',
        code: `filename = upload.filename
os.system(f"convert {filename} -resize 200x200 thumb.png")`,
        lang: 'python',
        options: [
          '檔名由使用者控制，取成 a.png; rm -rf / 就能執行任意命令；改用 subprocess.run([…]) 陣列形式、不經 shell',
          '沒有問題——檔名來自上傳的檔案物件，不是使用者在表單裡輸入的字串',
          '把檔名用雙引號包起來 convert "{filename}" 就安全了，shell 不會解析引號內的內容',
          '改成 subprocess.run(f"convert {filename} …", shell=True)，subprocess 比 os.system 安全',
        ],
        answer: 0,
        explain: 'os.system 把整個字串交給 shell 解讀，分號、管線、$( ) 與反引號都是 shell 的語法，檔名（完全由客戶端決定）裡放這些就等於在你的伺服器執行命令。雙引號擋不住 $( ) 與反引號，檔名裡再放一個雙引號就直接跳出；shell=True 的 subprocess 跟 os.system 是同一件事。subprocess.run(["convert", filename, "-resize", "200x200", "thumb.png"]) 讓每個元素直接成為程式的 argv，不經 shell 解析，字元就只是字元。再把上傳檔重新命名成隨機檔名，順便解掉以 - 開頭被當成參數的問題。',
      },
    ],
  },
  {
    skill: 'password-storage',
    questions: [
      {
        q: 'Base64、SHA-256、bcrypt 各是什麼？哪個適合存密碼？',
        options: [
          '三者都是雜湊演算法，差別只在輸出長度與運算速度，安全性相當',
          'Base64 是可逆的編碼、SHA-256 是快速雜湊（單向但每秒可試數十億次）、bcrypt 是加鹽慢雜湊——只有後者適合存密碼',
          'Base64 搭配每人一個隨機 salt 之後效果等同雜湊，可以用來存密碼',
          'SHA-256 加上隨機 salt 已經足夠安全，bcrypt 只是比較舊、比較慢的做法',
        ],
        answer: 1,
        explain: '編碼是換一種表示法，Base64 解回去不需要任何秘密，存密碼等於存明文。雜湊是單向的，但 SHA-256 的設計目標是「快」，GPU 一秒能試幾十億個候選，外洩後的字典攻擊幾小時就掃完常見密碼——加 salt 只擋預先算好的彩虹表，擋不住針對單一使用者的暴力嘗試。bcrypt / scrypt / argon2 故意慢（可調 work factor）且內建 per-user salt，攻擊者每秒只能試幾千次。argon2id 是目前建議的首選，bcrypt 仍然可靠，不是「舊做法」。',
      },
      {
        q: '這是某系統的密碼雜湊函式。它有哪兩個問題？',
        code: `import hashlib

SALT = "app-static-salt-2026"

def hash_pw(pw: str) -> str:
    return hashlib.sha256((SALT + pw).encode()).hexdigest()`,
        lang: 'python',
        options: [
          'salt 是全站固定值而非每人隨機——相同密碼雜湊相同、一張表就能破全庫；而且 SHA-256 太快沒有 work factor',
          '沒有問題——有 salt、有 SHA-256，已經符合密碼儲存的基本要求',
          '只需要把 SHA-256 換成 SHA-512，輸出更長、計算更久就更難破解',
          '問題只在 salt 放在密碼前面容易被推算，改成放在密碼後面就安全了',
        ],
        answer: 0,
        explain: 'salt 的意義是「每個使用者不同」，讓相同密碼在資料庫裡長得不一樣、也讓攻擊者無法一次算完全部帳號。全站共用一個 salt（其實是 pepper）只是把彩虹表的成本從「通用」變成「針對你這站一次」，兩千萬筆帳號還是一起破。第二個問題是速度：SHA 家族不管 256 還是 512 都是為了快而設計，沒有 work factor 可以調高。正確做法是呼叫 argon2-cffi 或 bcrypt 的 hash / verify，它們自動處理隨機 salt、參數編碼與常數時間比對；salt 放前放後不是重點。',
      },
      {
        q: '客服希望能查出使用者的原密碼告訴忘記密碼的人，工程師提議把密碼改成 AES 加密儲存以便解回來。你該怎麼回應？',
        options: [
          '可以，只要 AES 金鑰放在環境變數而不是程式碼裡，就不會跟資料庫一起外洩',
          '折衷：只對一般使用者加密存，管理員與 VIP 帳號維持雜湊',
          '拒絕：驗證密碼不需要還原它，而金鑰就在伺服器上、外洩時等於明文；正解是寄一次性短效的重設連結',
          '可以，但改用 RSA 非對稱加密，私鑰交給客服主管保管、離線使用',
        ],
        answer: 2,
        explain: '密碼只需要「比對」，不需要「還原」，所以雜湊就夠；一旦系統能解回明文，攻擊者拿到資料庫與伺服器（金鑰必然在伺服器能讀到的地方）也能解，而且客服看得到密碼本身就是內部風險與合規問題（使用者常在多個網站重複使用密碼）。RSA 私鑰給人保管只是把風險搬到一個人身上，一般使用者「比較不重要」更是錯誤前提。忘記密碼的正解是重設流程：一次性 token、短效期、用過即廢，並通知使用者。',
      },
    ],
  },
  {
    skill: 'xss-csrf',
    questions: [
      {
        q: 'cookie session 與 Bearer token（放在 Authorization 標頭）這兩種驗證方式，各要防 CSRF 還是 XSS？',
        options: [
          '兩者都要防 CSRF，因為請求都是從瀏覽器發出、都帶著使用者的憑證',
          'cookie session 要防 CSRF（瀏覽器自動帶 cookie）；Bearer token 免疫 CSRF 但會被 XSS 偷走——兩者都要防 XSS',
          'Bearer token 要防 CSRF，cookie 加上 HttpOnly 旗標之後對兩種攻擊都免疫',
          '只要狀態改變的操作都用 POST 不用 GET，兩種方式都不會有 CSRF 問題',
        ],
        answer: 1,
        explain: 'CSRF 的本質是「瀏覽器自動附帶憑證」：惡意網站的表單送出時，瀏覽器會把你網站的 cookie 一起帶去，伺服器分不出是不是使用者本人的意思。Bearer token 必須由 JS 主動放進 Authorization 標頭，惡意網站的程式碼拿不到它，所以沒有 CSRF——但也因此 token 通常放在 localStorage，任何 XSS 都能讀走整個身分。HttpOnly 只讓 JS 讀不到 cookie，擋的是 XSS 偷 cookie，跟 CSRF 無關；惡意網站的 <form method="POST"> 照樣能帶 cookie 送出。',
      },
      {
        q: '一個純 JSON API 的回應長這樣。從安全角度哪裡有問題？',
        code: `HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

{"name": "<script>alert(document.cookie)</script>"}`,
        lang: 'http',
        options: [
          '回應內容應該把 < 與 > 轉成 HTML 實體再輸出，Content-Type 本身沒有問題',
          '缺少 Content-Length 標頭，瀏覽器會自行嗅探並猜測內容型別',
          '沒有問題——JSON 字串裡的 script 標籤只是資料，瀏覽器不會執行它',
          'Content-Type 宣告 text/html 但內容是 JSON，直接用瀏覽器開這個 URL 會執行 script；改 application/json 並加 nosniff',
        ],
        answer: 3,
        explain: '瀏覽器怎麼處理回應完全看 Content-Type：宣告 text/html，就算內容是 JSON，裡面出現的 <script> 就會被執行——攻擊者只要讓 name 欄位含惡意腳本、再誘使受害者開那個 API 網址，就是一個 reflected XSS。正確宣告 application/json 瀏覽器只會顯示純文字；X-Content-Type-Options: nosniff 再禁止瀏覽器自作聰明去猜型別。對 JSON 做 HTML 實體轉換會破壞資料（前端拿到的名字變成 &lt;…&gt;），Content-Length 跟型別判斷無關。',
      },
      {
        q: '一個用 cookie session 的網站有 GET /account/delete 會刪除帳號。使用者逛了某個惡意網站後帳號被刪了。最根本的修法是？',
        options: [
          '改變狀態的操作改成 POST / DELETE（GET 必須無副作用），cookie 加 SameSite=Lax，表單頁再加 CSRF token',
          '把 GET 改成 POST 就完全解決了——瀏覽器不會替其他網站自動送 POST',
          '在伺服器檢查 User-Agent 與 Referer 是不是來自瀏覽器與自己的網域',
          '把 session id 從 cookie 改放到 URL 參數，瀏覽器就不會自動帶給其他網站',
        ],
        answer: 0,
        explain: '惡意頁面只要放一個 <img src="…/account/delete"> 或用連結導過去，瀏覽器就帶著 cookie 發出 GET，帳號就沒了。第一刀是語意：GET 不該有副作用。但只改 POST 不夠——惡意網站一樣能自動送出跨站表單 POST；SameSite=Lax 讓跨站的 POST 不帶 cookie（注意 Lax 仍允許最上層的跨站 GET 導覽帶 cookie，所以兩件事要一起做），表單型網站再加 CSRF token 當第二道。User-Agent 與 Referer 都是客戶端可以隨意填或省略的；session id 放 URL 會被 Referer、log、分享連結洩漏，比 cookie 更糟。',
      },
    ],
  },
  {
    skill: 'input-validation',
    questions: [
      {
        q: '建立訂單 API 的 pydantic model 如下。從安全角度看，最大的問題是什麼？',
        code: `class OrderItem(BaseModel):
    product_id: int
    qty: int
    unit_price: Decimal

class CreateOrder(BaseModel):
    items: list[OrderItem]
    total: Decimal`,
        lang: 'python',
        options: [
          'qty 應該用 float 才能支援非整數的數量，用 int 會讓部分商品無法下單',
          'unit_price 與 total 由客戶端傳入——價格與總額必須由伺服器查商品表計算，否則使用者可以自己開價',
          'product_id 應該用 str 以避免整數溢位，攻擊者可以送超大數字讓服務崩潰',
          '沒有問題——pydantic 已經確保每個欄位的型別正確，其餘由資料庫約束負責',
        ],
        answer: 1,
        explain: '型別對只是第一步。客戶端送來的價格與總金額只能當「參考」，伺服器一定要用 product_id 去查目前價格、自己算 total，否則改一下 request body 就能以 1 元買下所有東西——這是邏輯層的信任邊界問題，pydantic 驗型別擋不住。同時每個數值都要有範圍（qty 至少 1、有上限），每個陣列都要有長度上限（items 一萬筆會拖垮訂單處理）。float 用在數量與金額都是錯的，Python 的 int 不會溢位，pydantic 也會擋掉非整數。',
      },
      {
        q: '頭像上傳功能目前的做法：擋掉 .php / .exe / .sh 副檔名，其他都接受，用原始檔名存到 /var/www/uploads。哪個改法正確？',
        options: [
          '黑名單再補上 .phtml / .jsp / .aspx / .htaccess 等危險副檔名就夠了',
          '把上傳目錄權限設成 644 並拿掉執行權限，這樣上傳的檔案就無法被執行',
          '改白名單只收 png / jpg / webp、檢查 magic bytes、隨機重新命名、存到 web root 之外、圖片重新編碼一次',
          '前端 <input type="file" accept="image/*"> 已經只讓使用者選圖片，後端不需重複檢查',
        ],
        answer: 2,
        explain: '黑名單永遠補不完（大小寫變化、雙副檔名 a.php.jpg、伺服器新支援的副檔名），白名單「列出允許的、其餘全拒」才可靠。副檔名與 Content-Type 都是客戶端說的，要看檔頭 magic bytes；原始檔名可能含路徑穿越（../../）或跟其他人撞名，一律換成隨機檔名；存在 web root 裡等於給攻擊者一個可直接存取的位置，放到 web root 外或 S3 之類的物件儲存；重新編碼圖片能去掉藏在檔案裡的惡意內容與 EXIF。目錄權限擋不住被 web server 直接當 HTML / SVG 送出的檔案，前端 accept 擋不住直接打 API 的人。',
      },
      {
        q: 'GET /posts?limit=1000000 讓服務直接記憶體不足重啟。該怎麼防？',
        options: [
          '對 limit 設上限（如 le=100）在 model 層驗證，並讓 body 大小、陣列長度、字串長度都有上限',
          '加大伺服器記憶體並開更多 worker，讓大查詢有足夠資源跑完',
          '在資料庫端為排序欄位加索引，讓大範圍查詢跑得更快就不會逾時',
          '把大結果快取到 Redis，下一次相同查詢就不用重算也不會佔用記憶體',
        ],
        answer: 0,
        explain: '所有來自外部的數量、長度、大小都要有上限，而且要在邊界（request model）一次驗完，超過就回 4xx。limit 是最常見的例子，同類的還有分頁 offset、批次操作的 id 陣列、搜尋字串長度、上傳大小（nginx client_max_body_size）。沒上限的輸入就是 DoS 入口。加記憶體只是把炸點往後推一點；索引讓資料庫快但一百萬筆還是要序列化成 JSON 送出去；快取一百萬筆的結果反而把 Redis 也拖下水。',
      },
    ],
  },
  {
    skill: 'secrets',
    questions: [
      {
        q: '這個 Dockerfile 哪裡有問題？',
        code: `FROM python:3.12-slim
WORKDIR /app
COPY .env /app/.env
ARG DB_PASSWORD
ENV DB_PASSWORD=$DB_PASSWORD
COPY . .
CMD ["uvicorn", "app.main:app"]`,
        lang: 'bash',
        options: [
          '只有 COPY .env 有問題，ARG 傳進來的 DB_PASSWORD 在 build 結束後就消失了',
          '沒有問題——image 推到私有 registry、只有團隊能拉，就不會外流',
          '.env 被 COPY 進 image 層、ARG 轉 ENV 也留在 image 設定裡，docker history / inspect 就看得到；secret 應在 runtime 注入',
          '只要在最後加一行 RUN rm /app/.env 就能把秘密從 image 移除，ENV 則無害',
        ],
        answer: 2,
        explain: 'image 是一層層疊起來的，COPY 進去的檔案就算後面 RUN rm 也還在前一層裡，docker save 解開就看得到；ARG 的值會出現在用到它的指令的 history 中，轉成 ENV 更是直接寫進 image 的 config。私有 registry 只是縮小了「誰拿得到 image」，CI 快取、開發者本機、被入侵的節點都拿得到。原則是 image 只放程式碼，secret 在 container 啟動時由環境變數、secret mount 或 Secret Manager 注入；build 時真的要用 token（例如拉私有套件）就用 BuildKit 的 --mount=type=secret，它不會留在層裡。',
      },
      {
        q: '同事不小心把含 AWS access key 的 .env commit 並 push 到公開 repo，五分鐘後發現。第一步該做什麼？',
        options: [
          '立刻 git push --force 把那個 commit 從歷史抹掉，沒人再看得到 key 就安全了',
          '先把 .env 加進 .gitignore 避免再犯；key 先保留，因為換 key 要重新部署很麻煩',
          '把 repo 改成私有，外人就看不到了，之後再慢慢處理 key 的問題',
          '立刻撤銷該 key 並發新 key、更新使用處，接著查 CloudTrail 確認有沒有被用；清 git 歷史放最後',
        ],
        answer: 3,
        explain: '推上公開 repo 的 secret 要當成「已經外洩」：掃描 GitHub 找 key 的機器人以秒計，你發現的五分鐘內它可能已經被拿去開機器挖礦。所以順序是撤銷 → 輪替 → 查 log 看損害 → 最後才清歷史（改私有、force push 都只是事後整理，且 fork 與快取仍然存在）。「換 key 麻煩」正是要在平時就把輪替設計成可以做的原因。之後再補 pre-commit 的 gitleaks 掃描，讓下次 commit 前就被擋下。',
      },
      {
        q: '同一份程式碼的 DB 密碼與 API key，在本機開發、CI、正式環境各應該放在哪裡？',
        options: [
          '三處都放在 repo 裡的 config.py，方便統一管理、有版本控制可以追蹤變更',
          '本機用 .env（gitignore，repo 只放 .env.example）、CI 用平台的 secrets、正式環境由環境變數或 Secret Manager 注入',
          '本機與 CI 用 .env 檔，正式環境直接寫在 Dockerfile 的 ENV 指令裡跟著 image 走',
          '全部包進 Docker image，因為 image 放在私有 registry 只有團隊拉得到',
        ],
        answer: 1,
        explain: '原則只有一條：secret 不進版本控制、不進 image，且每個環境用不同的值。本機用 .env 是為了開發方便，但 repo 裡只能有 .env.example 告訴大家需要哪些 key；CI 平台的 secrets 功能會在 log 裡自動遮罩、只有指定的 branch / job 拿得到；正式環境由部署平台（k8s secret、雲端 Secret Manager、環境變數）注入，這樣輪替時不用重新 build。放進 repo 或 image 的秘密等於發給所有能讀 repo / 拉 image 的人與系統，而且 git 歷史刪不乾淨。',
      },
    ],
  },
  {
    skill: 'supply-chain',
    questions: [
      {
        q: '為什麼 CI 應該用 lock 檔安裝（例如 uv sync --frozen、npm ci）而不是直接照 pyproject / package.json 解析？',
        options: [
          '純粹為了安裝速度——lock 檔省掉版本解析的時間，跟安全無關',
          'lock 檔釘住每個依賴（含間接依賴）的精確版本與 hash，CI 裝到的跟本機一致，被掉包時 hash 不符會失敗',
          'lock 檔會讓套件管理器在安裝時自動套用已知漏洞的修補版本',
          '有 lock 檔就代表依賴版本已經審核過，之後不需要再做漏洞掃描',
        ],
        answer: 1,
        explain: 'pyproject 裡的 >=2.0 是「範圍」，每次解析可能解到不同版本，更別說幾百個間接依賴。lock 檔把整棵樹釘死並記錄 hash，重現性（本機、CI、正式一致）與完整性（下載的檔案就是當初審過的那個）都靠它。但它只保證「一樣」不保證「安全」：釘住的版本一樣可能有 CVE，所以 pip-audit / Dependabot 這類掃描仍然要跑，而且要能透過更新 lock 檔來升級。速度快是副產品。',
      },
      {
        q: '這段 GitHub Actions 設定有什麼供應鏈風險？',
        code: `permissions: write-all

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: some-org/cool-action@main
      - run: ./build.sh`,
        lang: 'yaml',
        options: [
          '沒有問題——@main 才能自動拿到 action 的最新修補，釘死版本反而會用到有漏洞的舊版',
          '只要把 actions/checkout 也改成 @main 保持一致，就不會有版本衝突的風險',
          '第三方 action 釘在可變的 @main（tag 也能被移動），作者被入侵就等於在你的 CI 跑任意程式碼還握著 write-all token',
          'permissions: write-all 是 GitHub 的預設值，官方 action 也需要它才能運作，不需要改',
        ],
        answer: 2,
        explain: 'CI 裡的 action 就是依賴，而且是能拿到你 repo token 的依賴。@main 或 @v1 都指向可以被作者（或入侵作者帳號的人）隨時改掉的目標，2025 年的 tj-actions 事件就是被改 tag 後把 secrets 印進 log。釘 40 字元的 commit SHA 才是不可變的，配合 Dependabot 自動更新。permissions 用最小權限：預設給 contents: read 就好，需要寫的 job 再單獨開；write-all 讓被入侵的 action 能推 commit、改 release。actions/checkout 這種官方 action 也建議釘 SHA，但它不是這裡的主要問題。',
      },
      {
        q: 'Trivy 掃你的 image 出現 40 個 HIGH，大多在 base image 的系統套件，你的 Python 依賴只佔 2 個。怎麼處理？',
        options: [
          '換 slim / distroless base 減少攻擊面、定期重新 build 拉最新 base、升級那 2 個 Python 依賴，掃描放進 CI 設門檻',
          '全部忽略——系統套件的漏洞跟 Python 程式沒有關係，程式碼沒呼叫到就打不到',
          '把 base image 改成 latest 標籤，每次 build 都自動拿到最新版就不會有舊漏洞',
          '在 Dockerfile 加一行 apt-get upgrade，一次把系統套件更新到最新，永久有效',
        ],
        answer: 0,
        explain: '容器裡的系統套件就算你的程式沒直接呼叫，也還是攻擊者取得 shell 後可以利用的東西；而且很多 HIGH 來自你根本用不到的套件——換 slim / distroless 直接讓它們不存在。base image 的修補靠「重新 build」才會拉到，所以要有排程定期 rebuild，即使程式碼沒改。latest 標籤讓 build 不可重現、出問題無法回溯；apt-get upgrade 只在 build 當下有效，下週又有新 CVE，「永久」不存在。最後把 Trivy 放進 CI 設門檻，才不會修一次後慢慢又長回來。',
      },
    ],
  },
]
