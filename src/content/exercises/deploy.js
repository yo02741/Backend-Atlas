// 程式題：容器與部署
// 設定檔題（kind: 'config'）的測試碼是 JS：使用者內容是 `source`，`lines` 是去掉 # 註解與空行的各行。
// 測試碼用 String.raw 寫，regex 的反斜線照原樣保留；測試碼裡不要出現 `${`。
const R = String.raw

// YAML 用：在 from（預設整份檔案）的「最外層」找 name:，回傳它底下縮排更深的各行；找不到回傳 null
const YAML_BLOCK = R`
function block(name, from) {
  const ls = from || lines
  if (!ls.length) return null
  const indent = (l) => l.match(/^\s*/)[0].length
  const base = Math.min(...ls.map(indent))
  const re = new RegExp('^\\s*' + name + ':\\s*$')
  const i = ls.findIndex((l) => indent(l) === base && re.test(l))
  if (i < 0) return null
  const out = []
  for (const l of ls.slice(i + 1)) {
    if (indent(l) <= base) break
    out.push(l)
  }
  return out
}
`

// Dockerfile 用：依 FROM 切成各個 stage
const DOCKER_STAGES = R`
function stages() {
  const out = []
  for (const l of lines) {
    if (/^\s*FROM\s/i.test(l)) out.push([l])
    else if (out.length) out[out.length - 1].push(l)
  }
  return out
}
`

// nginx 用：取出所有 <head> { … } 區塊（依大括號配對）
const NGINX_BLOCKS = R`
function blocks(head, text) {
  const src = text === undefined ? lines.join('\n') : text
  const out = []
  const re = new RegExp(head + '\\s*\\{', 'g')
  let m
  while ((m = re.exec(src))) {
    let depth = 0
    for (let j = m.index + m[0].length - 1; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}' && --depth === 0) { out.push(src.slice(m.index, j + 1)); break }
    }
  }
  return out
}
`

export default [
  {
    id: 'docker-basics-1', skill: 'docker-basics', kind: 'config', level: 1,
    file: 'Dockerfile',
    title: '重排 Dockerfile，改程式碼不用重裝依賴',
    prompt: '這份 Dockerfile 每改一行程式碼，`uv sync` 就重跑一次：`COPY . .` 在前面，任何檔案變了，它之後的層全部失效。改寫成：\n\n- 先只 `COPY pyproject.toml uv.lock ./`，接著 `RUN uv sync`（依賴層：只有依賴變了才重做）\n- 之後才 `COPY . .` 複製程式碼\n- base image 固定版本（不要 `latest`，也不要省略 tag）\n\n提示：uv 官方的 Docker 指南建議第一次 sync 加 `--no-install-project`（只裝依賴、不裝專案本身），`COPY . .` 之後再 `uv sync` 一次。',
    starter: `FROM python:latest
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
COPY . .
RUN uv sync --frozen --no-dev
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
    solution: `FROM python:3.12-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

# 依賴層：只有 pyproject.toml / uv.lock 變了才會重做
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# 程式碼層：改程式碼只會讓這裡之後的層重做
COPY . .
RUN uv sync --frozen --no-dev

CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
    hints: [
      '快取是由上往下逐層比對，某一層失效，它之後的所有層都重做。',
      '把「很少變」的東西（依賴描述檔）放前面，「常常變」的東西（程式碼）放後面。',
      'FROM python:3.12-slim 這種寫法同時固定了版本、也用了較小的 slim 變體。',
    ],
    tests: [
      { name: '依賴描述檔先單獨 COPY', code: R`
const i = lines.findIndex((l) => /^\s*COPY\s/i.test(l) && /pyproject\.toml/.test(l) && /uv\.lock/.test(l))
assert(i >= 0, '要有一行 COPY pyproject.toml uv.lock ./')
const sync = lines.findIndex((l) => /^\s*RUN\s.*\buv\s+sync\b/i.test(l))
assert(sync > i, 'COPY pyproject.toml uv.lock 要在第一個 RUN uv sync 之前')` },
      { name: '第一次 uv sync 在 COPY . . 之前', code: R`
const sync = lines.findIndex((l) => /^\s*RUN\s.*\buv\s+sync\b/i.test(l))
const all = lines.findIndex((l) => /^\s*COPY\s+(--\S+\s+)*\.\s+\S+\s*$/i.test(l))
assert(sync >= 0, '找不到 RUN uv sync')
assert(all >= 0, '程式碼還是要用 COPY . . 複製進去')
assert(sync < all, '依賴安裝（RUN uv sync）要放在 COPY . . 之前，改程式碼才不會重裝依賴')` },
      { name: 'base image 固定版本', code: R`
const froms = lines.filter((l) => /^\s*FROM\s/i.test(l))
assert(froms.length, '找不到 FROM')
for (const f of froms) {
  const img = f.trim().split(/\s+/)[1]
  assert(/:/.test(img) && !/:latest$/i.test(img), 'FROM 要寫明確的版本 tag（例如 python:3.12-slim），不要用 latest 或省略 tag：' + f.trim())
}` },
    ],
  },
  {
    id: 'docker-basics-2', skill: 'docker-basics', kind: 'config', level: 1,
    file: '.dockerignore',
    title: '寫 .dockerignore：別把 .git、.venv、.env 送進 build',
    prompt: '`COPY . .` 會把 build context 裡的所有東西複製進 image。目前的 `.dockerignore` 幾乎沒有內容，於是 `.git`（整個版本歷史）、本機的 `.venv`、`__pycache__`，還有放著密碼的 `.env` 都進了 image。補上排除規則：\n\n- `.git`\n- `.venv`\n- `__pycache__`（任何層級的都要排除，寫 `**/__pycache__` 或 `__pycache__`）\n- `.env`（secret 不能進 image；可以用 `!.env.example` 把範例檔留下）\n- `node_modules`\n\n注意：不能把 `pyproject.toml`、`uv.lock` 這些 build 需要的檔案也排除掉。',
    starter: `# 目前只排除了 log
*.log
`,
    solution: `# 版本歷史與本機環境
.git
.venv
**/__pycache__
*.pyc
node_modules

# secret 不進 image；範例檔留著
.env
.env.*
!.env.example

*.log
`,
    hints: [
      '.dockerignore 每行一個樣式，語法類似 .gitignore；開頭加 ! 表示「這個例外不排除」。',
      '__pycache__ 會出現在每個套件目錄裡，用 **/__pycache__ 排除所有層級。',
    ],
    tests: [
      { name: '排除 .git 與 .venv', code: R`
assert(lines.some((l) => /^\/?\.git\/?$/.test(l.trim())), '要排除 .git')
assert(lines.some((l) => /^\/?\.venv\/?$/.test(l.trim())), '要排除 .venv')` },
      { name: '排除 __pycache__ 與 node_modules', code: R`
assert(lines.some((l) => /^(\*\*\/)?__pycache__\/?$/.test(l.trim())), '要排除 __pycache__（例如 **/__pycache__）')
assert(lines.some((l) => /^(\*\*\/)?node_modules\/?$/.test(l.trim())), '要排除 node_modules')` },
      { name: '排除 .env（secret）', code: R`
assert(lines.some((l) => /^(\*\*\/)?\.env(\*|\.\*)?$/.test(l.trim())), '要排除 .env')
assert(!lines.some((l) => /^!\s*\.env$/.test(l.trim())), '不能用 ! 把 .env 加回來')` },
      { name: 'build 需要的檔案沒被排除', code: R`
const bad = lines.map((l) => l.trim()).filter((l) => ['*', '**', '*.toml', '*.lock', 'pyproject.toml', 'uv.lock'].includes(l))
assert(!bad.length, '這些規則會把 build 需要的 pyproject.toml / uv.lock 一起排除：' + bad.join(', '))` },
    ],
  },
  {
    id: 'dockerfile-python-1', skill: 'dockerfile-python', kind: 'config', level: 2,
    file: 'Dockerfile',
    title: '正式環境的 Python Dockerfile',
    prompt: '把這份「能跑就好」的 Dockerfile 改成正式環境的基本盤：\n\n- **固定 base image 版本**（例如 `python:3.12-slim`），所有 `FROM` 都不能是 `latest` 或沒有 tag\n- **多階段建置**：builder 階段（`FROM … AS builder`）裝 uv 與依賴；最後的 runtime 階段用 `COPY --from=builder` 只拿 `.venv` 與程式碼\n- **非 root 執行**：runtime 階段建立使用者並用 `USER` 切換（不能是 root 或 0）\n- **HEALTHCHECK**：runtime 階段打 `/health`（slim image 沒有 curl，可以用 `python -c` 搭配 `urllib.request`）\n- **CMD 用 exec 形式**（JSON 陣列），讓 uvicorn 是 PID 1、收得到 SIGTERM',
    starter: `FROM python:latest
WORKDIR /app
RUN pip install uv
COPY . .
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD /app/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
`,
    solution: `# ---- builder：裝 uv 與依賴 ----
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

# ---- runtime：只有 .venv 與程式碼，沒有 uv 與建置工具 ----
FROM python:3.12-slim
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 app
COPY --from=builder --chown=app:app /app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
    hints: [
      '多階段：第一個 FROM 加上 AS builder，第二個 FROM 開始的是最終 image；COPY --from=builder 從前一個階段拿檔案。',
      '非 root：RUN useradd --create-home app，接著 USER app。COPY 時加 --chown=app:app 讓檔案屬於這個使用者。',
      'exec 形式：CMD ["uvicorn", "app.main:app", ...]；shell 形式（CMD uvicorn ...）的 PID 1 是 /bin/sh。',
    ],
    tests: [
      { name: '所有 FROM 都固定版本', code: R`
const froms = lines.filter((l) => /^\s*FROM\s/i.test(l))
assert(froms.length, '找不到 FROM')
for (const f of froms) {
  const img = f.trim().split(/\s+/)[1]
  assert(/:/.test(img) && !/:latest$/i.test(img), 'FROM 要有明確的版本 tag：' + f.trim())
}` },
      { name: '多階段：runtime 階段從 builder 複製', code: DOCKER_STAGES + R`
const st = stages()
assert(st.length >= 2, '要有至少兩個 FROM（builder 與 runtime）')
const names = st.map((s) => (s[0].match(/\sAS\s+(\S+)/i) || [])[1]).filter(Boolean)
assert(names.length, '前面的階段要命名，例如 FROM python:3.12-slim AS builder')
const last = st[st.length - 1]
assert(last.some((l) => names.some((n) => new RegExp('^\\s*COPY\\s+(--\\S+\\s+)*--from=' + n + '\\b', 'i').test(l))), '最後一個階段要用 COPY --from=<builder 階段名稱> 拿建好的 .venv')` },
      { name: 'runtime 階段以非 root 使用者執行', code: DOCKER_STAGES + R`
const last = stages().pop()
const users = last.filter((l) => /^\s*USER\s/i.test(l))
assert(users.length, '最後一個階段要有 USER 指令')
const u = users[users.length - 1].trim().split(/\s+/)[1]
assert(!/^(root|0)(:|$)/.test(u), 'USER 不能是 root 或 0')` },
      { name: 'runtime 階段有 HEALTHCHECK', code: DOCKER_STAGES + R`
const last = stages().pop()
assert(last.some((l) => /^\s*HEALTHCHECK\s+(--\S+\s+)*CMD\s/i.test(l)), '最後一個階段要有 HEALTHCHECK … CMD …')
assert(last.some((l) => /^\s*HEALTHCHECK\s/i.test(l) && /\/health/.test(l)), 'HEALTHCHECK 要打 /health')` },
      { name: 'CMD 是 exec 形式', code: R`
const cmds = lines.filter((l) => /^\s*CMD\s/i.test(l))
assert(cmds.length, '找不到 CMD')
assert(/^\s*CMD\s+\[/i.test(cmds[cmds.length - 1]), 'CMD 要用 JSON 陣列（exec 形式），例如 CMD ["uvicorn", "app.main:app"]')` },
    ],
  },
  {
    id: 'compose-1', skill: 'compose', kind: 'config', level: 2,
    file: 'compose.yaml',
    title: '讓 api 等資料庫就緒，密碼不寫死',
    prompt: '這份 `compose.yaml` 有兩個問題：`depends_on` 只保證 db 容器**先啟動**，PostgreSQL 還在初始化時 api 就開始連線而失敗；密碼直接寫在檔案裡，會跟著進版本控制。改寫成：\n\n- `db` 加上 `healthcheck`，用 `pg_isready` 檢查\n- `api` 的 `depends_on` 改成長格式：`db:` 底下 `condition: service_healthy`\n- 檔案裡不能出現密碼的明文：`POSTGRES_PASSWORD` 與 `DATABASE_URL` 裡的密碼改用變數插值（例如 `${POSTGRES_PASSWORD}`，值放在不進版控的 `.env`），或改用 `POSTGRES_PASSWORD_FILE` 搭配 `secrets`\n- db 不要用 `ports` 發布到主機（api 透過服務名 `db` 連線就好）',
    starter: `services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://app:supersecret@db:5432/app
    depends_on:
      - db

  db:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: supersecret
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`,
    solution: `services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      # 值從同目錄、不進版控的 .env 讀；沒設定就直接報錯，不會用空密碼啟動
      DATABASE_URL: postgresql://app:\${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}@db:5432/app
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`,
    hints: [
      'healthcheck 的 test 可以寫 ["CMD-SHELL", "pg_isready -U app -d app"]，再配 interval / timeout / retries。',
      'depends_on 的長格式：depends_on: 底下 db: 再底下 condition: service_healthy。',
      'compose 會自動讀同目錄的 .env 做變數插值；${VAR:?訊息} 在沒設定時直接報錯。',
    ],
    tests: [
      { name: 'db 有用 pg_isready 的 healthcheck', code: YAML_BLOCK + R`
const db = block('db', block('services'))
assert(db, '找不到 services.db')
const hc = block('healthcheck', db)
assert(hc, 'db 要有 healthcheck')
assert(hc.some((l) => /pg_isready/.test(l)), 'healthcheck 要用 pg_isready 檢查')` },
      { name: 'api 等 db healthy 才啟動', code: YAML_BLOCK + R`
const api = block('api', block('services'))
assert(api, '找不到 services.api')
const dep = block('depends_on', api)
assert(dep, 'api 的 depends_on 要用長格式（depends_on: 底下 db:）')
const d = block('db', dep)
assert(d && d.some((l) => /condition:\s*service_healthy\b/.test(l)), 'depends_on.db 要有 condition: service_healthy')` },
      { name: '密碼沒有寫死', code: YAML_BLOCK + R`
assert(!/supersecret/.test(source), '檔案裡還有密碼的明文')
const db = block('db', block('services')) || []
const pw = db.find((l) => /POSTGRES_PASSWORD\s*[:=]/.test(l))
assert(pw || db.some((l) => /POSTGRES_PASSWORD_FILE/.test(l)), 'db 要設定 POSTGRES_PASSWORD（用變數）或 POSTGRES_PASSWORD_FILE')
if (pw) assert(/\$\{?[A-Za-z_]/.test(pw.split(/[:=]/).slice(1).join(':')), 'POSTGRES_PASSWORD 的值要用變數插值，例如 $' + '{POSTGRES_PASSWORD}')
for (const l of lines) {
  const m = l.match(/:\/\/[^:\/\s]+:([^@\s]+)@/)
  if (m) assert(/^\$/.test(m[1]), '連線字串裡的密碼要用變數插值：' + l.trim())
}` },
      { name: 'db 沒有發布埠到主機', code: YAML_BLOCK + R`
const db = block('db', block('services')) || []
assert(!block('ports', db), 'db 不需要 ports：api 在 compose 網路內用 db:5432 就連得到')` },
    ],
  },
  {
    id: 'nginx-1', skill: 'nginx', kind: 'config', level: 2,
    file: 'nginx.conf',
    title: 'HTTPS 轉址與 /api 反向代理',
    prompt: '目前的設定只聽 80 埠，`/api/` 轉給後端時也沒帶任何轉發標頭，後端不知道原始網域、客戶端 IP，也不知道請求原本是不是 HTTPS。改寫成：\n\n- **80 埠的 server 只做一件事**：`return 301 https://$host$request_uri;`（不在這裡代理 /api）\n- **443 埠的 server**：`listen 443 ssl;`，設定 `ssl_certificate` 與 `ssl_certificate_key`\n- 443 server 裡的 `location /api/`：`proxy_pass http://api;`，並設定\n  - `proxy_set_header Host $host;`\n  - `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`\n  - `proxy_set_header X-Forwarded-Proto $scheme;`\n- 靜態檔的 `location /` 搬到 443 server',
    starter: `upstream api {
    server api:8000;
}

server {
    listen 80;
    server_name example.com;

    location / {
        root /usr/share/nginx/html;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://api;
    }
}
`,
    solution: `upstream api {
    server api:8000;
}

# 80：全部轉到 HTTPS
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        root /usr/share/nginx/html;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://api;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`,
    hints: [
      '兩個 server 區塊：一個 listen 80 只 return 301，一個 listen 443 ssl 處理真正的請求。',
      '$proxy_add_x_forwarded_for 會把 $remote_addr 接在客戶端送來的 X-Forwarded-For 後面。',
      '$scheme 在 443 server 裡是 https，後端靠 X-Forwarded-Proto 知道原始請求是 HTTPS。',
    ],
    tests: [
      { name: '80 埠只做 HTTPS 轉址', code: NGINX_BLOCKS + R`
const s80 = blocks('server').filter((b) => /listen\s+(\[::\]:)?80\b/.test(b))
assert(s80.length, '要有一個 listen 80 的 server')
for (const b of s80) {
  assert(/return\s+30[18]\s+https:\/\/\$(host|server_name)\$request_uri\s*;/.test(b), '80 埠的 server 要 return 301 https://$host$request_uri;')
  assert(!/proxy_pass/.test(b), '80 埠的 server 不要代理請求，只做轉址')
}` },
      { name: '443 埠啟用 TLS 並設定憑證', code: NGINX_BLOCKS + R`
const s = blocks('server').find((b) => /listen\s+(\[::\]:)?443\s+ssl\b/.test(b))
assert(s, '要有一個 listen 443 ssl 的 server')
assert(/ssl_certificate\s+\S+;/.test(s), '443 server 要設定 ssl_certificate')
assert(/ssl_certificate_key\s+\S+;/.test(s), '443 server 要設定 ssl_certificate_key')` },
      { name: '/api/ 反向代理到 upstream', code: NGINX_BLOCKS + R`
const s = blocks('server').find((b) => /listen\s+(\[::\]:)?443\s+ssl\b/.test(b)) || ''
const loc = blocks('location\\s+/api/', s)[0]
assert(loc, '443 server 裡要有 location /api/')
assert(/proxy_pass\s+http:\/\/api\/?;/.test(loc), 'location /api/ 要 proxy_pass http://api;')` },
      { name: '轉發 Host、X-Forwarded-For、X-Forwarded-Proto', code: NGINX_BLOCKS + R`
const s = blocks('server').find((b) => /listen\s+(\[::\]:)?443\s+ssl\b/.test(b)) || ''
const loc = blocks('location\\s+/api/', s)[0] || ''
assert(/proxy_set_header\s+Host\s+\$host\s*;/.test(loc), '要 proxy_set_header Host $host;')
assert(/proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for\s*;/.test(loc), '要 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
assert(/proxy_set_header\s+X-Forwarded-Proto\s+\$scheme\s*;/.test(loc), '要 proxy_set_header X-Forwarded-Proto $scheme;')` },
    ],
  },
  {
    id: 'config-12factor-1', skill: 'config-12factor', kind: 'python', level: 2,
    title: '從環境變數讀設定，啟動時就驗證',
    prompt: '實作 `load_settings(env: dict) -> Settings`，規則：\n\n- `DATABASE_URL`：**必填**，要以 `postgresql://` 或 `postgres://` 開頭\n- `PORT`：選填，1–65535 的整數，預設 `8000`\n- `DEBUG`：選填，接受 `true/false/1/0/yes/no/on/off`（不分大小寫），其他值算錯誤，預設 `False`。注意 `bool("false")` 是 `True`\n- `LOG_LEVEL`：選填，`DEBUG/INFO/WARNING/ERROR` 之一（不分大小寫，存成大寫），預設 `INFO`\n- 有任何錯誤就 `raise ValueError`，訊息要**一次列出所有**有問題的變數名稱（不要修好一個才看到下一個）\n\n另外實作 `describe(settings) -> str`：啟動時印出的設定摘要，`DATABASE_URL` 裡的密碼要換成 `***`。',
    starter: `from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int = 8000
    debug: bool = False
    log_level: str = "INFO"


def load_settings(env: dict) -> Settings:
    # TODO：驗證每個值，錯誤要一次全部列出
    return Settings(
        database_url=env.get("DATABASE_URL", "sqlite:///dev.db"),
        port=int(env.get("PORT", 8000)),
        debug=bool(env.get("DEBUG", False)),
        log_level=env.get("LOG_LEVEL", "INFO"),
    )


def describe(s: Settings) -> str:
    # TODO：遮罩密碼
    return f"database_url={s.database_url} port={s.port} debug={s.debug} log_level={s.log_level}"


s = load_settings({"DATABASE_URL": "postgresql://app:secret@db:5432/app", "DEBUG": "false"})
print(s)
print(describe(s))
`,
    solution: `from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit


@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int = 8000
    debug: bool = False
    log_level: str = "INFO"


TRUE = {"1", "true", "yes", "on"}
FALSE = {"0", "false", "no", "off"}
LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR"}


def load_settings(env: dict) -> Settings:
    errors = []

    url = env.get("DATABASE_URL", "")
    if not url:
        errors.append("DATABASE_URL 必填")
    elif not url.startswith(("postgresql://", "postgres://")):
        errors.append("DATABASE_URL 要以 postgresql:// 開頭")

    port = 8000
    if "PORT" in env:
        try:
            port = int(env["PORT"])
        except ValueError:
            port = 0
        if not 1 <= port <= 65535:
            errors.append(f"PORT 要是 1–65535 的整數（收到 {env['PORT']!r}）")

    debug = False
    if "DEBUG" in env:
        v = env["DEBUG"].strip().lower()
        if v in TRUE:
            debug = True
        elif v not in FALSE:
            errors.append(f"DEBUG 要是 true / false（收到 {env['DEBUG']!r}）")

    level = env.get("LOG_LEVEL", "INFO").strip().upper()
    if level not in LEVELS:
        errors.append(f"LOG_LEVEL 要是 {sorted(LEVELS)} 之一")

    if errors:
        raise ValueError("設定有誤：" + "；".join(errors))
    return Settings(url, port, debug, level)


def describe(s: Settings) -> str:
    parts = urlsplit(s.database_url)
    netloc = parts.netloc
    if parts.password:
        netloc = netloc.replace(":" + parts.password + "@", ":***@", 1)
    masked = urlunsplit(parts._replace(netloc=netloc))
    return f"database_url={masked} port={s.port} debug={s.debug} log_level={s.log_level}"


s = load_settings({"DATABASE_URL": "postgresql://app:secret@db:5432/app", "DEBUG": "false"})
print(s)
print(describe(s))
`,
    hints: [
      '先準備一個 errors = [] 清單，每個欄位檢查完把問題加進去，最後有內容才一次 raise。',
      '布林值不能用 bool(字串)：任何非空字串都是 True。比對小寫後的字串是否在允許的集合裡。',
      'urllib.parse.urlsplit 可以拿到 password，再用 _replace(netloc=...) 組回去。',
    ],
    tests: [
      { name: '正確讀取與型別轉換', code: `_s = load_settings({"DATABASE_URL": "postgresql://app:pw@db:5432/app", "PORT": "9000", "DEBUG": "false", "LOG_LEVEL": "warning"})
assert _s.port == 9000 and _s.debug is False and _s.log_level == "WARNING", _s
assert load_settings({"DATABASE_URL": "postgresql://a@b/c", "DEBUG": "TRUE"}).debug is True
assert load_settings({"DATABASE_URL": "postgresql://a@b/c", "DEBUG": "0"}).debug is False` },
      { name: '選填欄位的預設值', code: `_s = load_settings({"DATABASE_URL": "postgres://a@b/c"})
assert (_s.port, _s.debug, _s.log_level) == (8000, False, "INFO"), _s` },
      { name: '缺 DATABASE_URL 要失敗', code: `try:
    load_settings({})
    raise AssertionError("缺 DATABASE_URL 應該 raise ValueError")
except ValueError as e:
    assert "DATABASE_URL" in str(e), str(e)
try:
    load_settings({"DATABASE_URL": "sqlite:///dev.db"})
    raise AssertionError("不是 PostgreSQL 的連線字串應該 raise ValueError")
except ValueError:
    pass` },
      { name: '多個錯誤一次列出', code: `try:
    load_settings({"PORT": "abc", "DEBUG": "maybe", "LOG_LEVEL": "LOUD"})
    raise AssertionError("應該 raise ValueError")
except ValueError as e:
    for _name in ["DATABASE_URL", "PORT", "DEBUG", "LOG_LEVEL"]:
        assert _name in str(e), f"錯誤訊息要列出 {_name}：{e}"` },
      { name: 'PORT 超出範圍', code: `for _p in ["0", "70000", "-1"]:
    try:
        load_settings({"DATABASE_URL": "postgresql://a@b/c", "PORT": _p})
        raise AssertionError(f"PORT={_p} 應該 raise ValueError")
    except ValueError:
        pass` },
      { name: 'describe 遮罩密碼', code: `_d = describe(load_settings({"DATABASE_URL": "postgresql://app:s3cr3t@db:5432/app"}))
assert "s3cr3t" not in _d, _d
assert "app:***@db:5432/app" in _d, _d` },
    ],
  },
  {
    id: 'process-servers-1', skill: 'process-servers', kind: 'python', level: 2,
    title: 'worker 數與連線池：算出一個起點',
    prompt: 'gunicorn 文件建議以 `(2 × 核心數) + 1` 作為同步 worker 數的**起點**；I/O 密集的 async 服務（uvicorn worker）通常從「核心數個 worker」開始。這些都只是起點，最後要靠壓測調整。連線池則有硬限制：所有 worker 的連線加起來，不能超過資料庫的 `max_connections`。\n\n實作：\n\n- `suggest_workers(cpus, kind)`：`kind` 是 `"sync"` 回傳 `2 * cpus + 1`，`"async"` 回傳 `cpus`\n- `pool_per_worker(workers, max_connections, reserved, other_clients)`：扣掉保留連線（superuser、migration、監控）與其他服務用的連線後，平均分給每個 worker，**無條件捨去**；分不到 1 條就 `raise ValueError`\n- `plan(cpus, max_connections, kind, reserved=3, other_clients=0)`：回傳 `{"workers": …, "pool_per_worker": …}`',
    starter: `def suggest_workers(cpus: int, kind: str) -> int:
    # TODO
    return cpus * 4


def pool_per_worker(workers: int, max_connections: int, reserved: int, other_clients: int) -> int:
    # TODO
    return 10


def plan(cpus: int, max_connections: int, kind: str, reserved: int = 3, other_clients: int = 0) -> dict:
    workers = suggest_workers(cpus, kind)
    return {"workers": workers, "pool_per_worker": pool_per_worker(workers, max_connections, reserved, other_clients)}


print(plan(4, 100, "sync", other_clients=20))
print(plan(4, 100, "async", other_clients=20))
`,
    solution: `def suggest_workers(cpus: int, kind: str) -> int:
    if kind == "sync":
        return 2 * cpus + 1      # gunicorn 文件的起點建議
    if kind == "async":
        return cpus              # async I/O：每個 worker 本身就能同時處理很多請求
    raise ValueError(f"未知的 worker 類型：{kind}")


def pool_per_worker(workers: int, max_connections: int, reserved: int, other_clients: int) -> int:
    available = max_connections - reserved - other_clients
    per = available // workers
    if per < 1:
        raise ValueError(f"{workers} 個 worker 分 {available} 條連線，每個分不到 1 條：減少 worker 或加連線池代理（PgBouncer）")
    return per


def plan(cpus: int, max_connections: int, kind: str, reserved: int = 3, other_clients: int = 0) -> dict:
    workers = suggest_workers(cpus, kind)
    return {"workers": workers, "pool_per_worker": pool_per_worker(workers, max_connections, reserved, other_clients)}


print(plan(4, 100, "sync", other_clients=20))
print(plan(4, 100, "async", other_clients=20))
`,
    hints: [
      '可用連線 = max_connections - reserved - other_clients；每個 worker 分到 可用連線 // workers。',
      '每個 worker 是獨立程序、有自己的連線池，所以總連線數是 workers × pool_per_worker。',
    ],
    tests: [
      { name: 'worker 數的起點', code: `assert suggest_workers(4, "sync") == 9
assert suggest_workers(1, "sync") == 3
assert suggest_workers(4, "async") == 4` },
      { name: '連線池平均分配、無條件捨去', code: `assert plan(4, 100, "sync", other_clients=20) == {"workers": 9, "pool_per_worker": 8}
assert plan(4, 100, "async", other_clients=20) == {"workers": 4, "pool_per_worker": 19}` },
      { name: '總連線數不超過上限', code: `for _cpus in [1, 2, 4, 8]:
    for _kind in ["sync", "async"]:
        _p = plan(_cpus, 200, _kind, reserved=5, other_clients=30)
        assert _p["workers"] * _p["pool_per_worker"] + 5 + 30 <= 200, (_cpus, _kind, _p)` },
      { name: '分不到連線時要報錯', code: `try:
    plan(16, 20, "sync")
    raise AssertionError("33 個 worker 分 17 條連線，應該 raise ValueError")
except ValueError:
    pass` },
    ],
  },
  {
    id: 'linux-basics-1', skill: 'linux-basics', kind: 'python', level: 1,
    title: '解析 ls -l 的權限字串',
    prompt: '實作 `parse_mode(s) -> dict`，把 `ls -l` 第一欄（例如 `-rwxr-x---`）轉成：\n\n- `type`：第一個字元 `-` 是 `"file"`、`d` 是 `"dir"`、`l` 是 `"link"`，其他是 `"other"`\n- `octal`：權限的八進位字串，例如 `"750"`。有特殊位元時是四位數：setuid（owner 的 x 位置是 `s` 或 `S`）加 4000、setgid（group 的 x 位置是 `s` / `S`）加 2000、sticky（others 的 x 位置是 `t` / `T`）加 1000。小寫代表同時有 x、大寫代表沒有 x。例如 `drwxrwxrwt` → `"1777"`、`-rwSr--r--` → `"4644"`\n- `world_writable`：others 有沒有 w\n\n`ls -l` 在有 ACL 或 SELinux 標籤時會在後面多一個 `+` 或 `.`，要能接受；長度不對就 `raise ValueError`。',
    starter: `def parse_mode(s: str) -> dict:
    kinds = {"-": "file", "d": "dir", "l": "link"}
    digits = ""
    for i in range(1, 10, 3):
        part = s[i:i + 3]
        digits += str(("r" in part) * 4 + ("w" in part) * 2 + ("x" in part) * 1)
    # TODO：特殊位元（s / S / t / T）、結尾的 + 或 .、長度檢查
    return {"type": kinds.get(s[0], "other"), "octal": digits, "world_writable": s[8] == "w"}


print(parse_mode("-rw-r--r--"))
print(parse_mode("drwxrwxrwt"))
`,
    solution: `def parse_mode(s: str) -> dict:
    if len(s) == 11 and s[10] in "+.@":
        s = s[:10]                       # ACL / SELinux / 延伸屬性標記
    if len(s) != 10:
        raise ValueError(f"權限字串長度不對：{s!r}")
    kinds = {"-": "file", "d": "dir", "l": "link"}
    special = 0
    digits = ""
    # (起始位置, 特殊位元的字元, 特殊位元的值)
    for start, mark, bit in [(1, "s", 4), (4, "s", 2), (7, "t", 1)]:
        r, w, x = s[start:start + 3]
        value = (r == "r") * 4 + (w == "w") * 2
        if x == "x" or x == mark:        # 小寫：特殊位元 + x
            value += 1
        if x.lower() == mark:            # s / S 或 t / T
            special += bit
        digits += str(value)
    octal = (str(special) if special else "") + digits
    return {"type": kinds.get(s[0], "other"), "octal": octal, "world_writable": s[8] == "w"}


print(parse_mode("-rw-r--r--"))
print(parse_mode("drwxrwxrwt"))
`,
    hints: [
      '每三個字元一組，r=4、w=2、x=1；x 的位置如果是 s 或 t（小寫），代表 x 也有。',
      '特殊位元疊成第一位數：setuid 4、setgid 2、sticky 1；沒有特殊位元時維持三位數。',
    ],
    tests: [
      { name: '一般檔案與目錄', code: `assert parse_mode("-rw-r--r--") == {"type": "file", "octal": "644", "world_writable": False}
assert parse_mode("drwxr-x---") == {"type": "dir", "octal": "750", "world_writable": False}
assert parse_mode("lrwxrwxrwx")["type"] == "link"
assert parse_mode("-rw-rw-rw-")["world_writable"] is True` },
      { name: 'sticky 與 setuid / setgid', code: `assert parse_mode("drwxrwxrwt")["octal"] == "1777", parse_mode("drwxrwxrwt")
assert parse_mode("-rwsr-xr-x")["octal"] == "4755"
assert parse_mode("-rwSr--r--")["octal"] == "4644"
assert parse_mode("drwxr-sr-x")["octal"] == "2755"
assert parse_mode("drwxrwx--T")["octal"] == "1770"` },
      { name: '接受結尾的 + 或 .，拒絕長度不對的字串', code: `assert parse_mode("-rw-r--r--.")["octal"] == "644"
assert parse_mode("drwxr-xr-x+")["type"] == "dir"
for _bad in ["rwxr-xr-x", "-rw-r--r--xx", ""]:
    try:
        parse_mode(_bad)
        raise AssertionError(f"{_bad!r} 應該 raise ValueError")
    except ValueError:
        pass` },
    ],
  },
  {
    id: 'cloud-basics-1', skill: 'cloud-basics', kind: 'python', level: 2,
    title: '找出對整個網際網路開放的危險規則',
    prompt: '雲端的防火牆（security group 之類）規則以 `{"name", "from_port", "to_port", "cidr"}` 表示，代表「允許來自 `cidr` 的流量進入 `from_port` 到 `to_port`（含）」。網路邊界的原則是：對外只開 80 與 443，資料庫、Redis、SSH 只開給私有網段。\n\n實作 `find_exposed(rules) -> list[str]`：回傳（依原本順序）**來源是整個網際網路**（IPv4 的 `0.0.0.0/0` 或 IPv6 的 `::/0`，也就是前綴長度為 0 的網段）、而且開放的埠範圍包含 80、443 **以外**任何一個埠的規則名稱。可以用標準函式庫的 `ipaddress`。',
    starter: `def find_exposed(rules: list[dict]) -> list[str]:
    # TODO：目前只抓 IPv4 的 SSH
    return [r["name"] for r in rules if r["cidr"] == "0.0.0.0/0" and r["from_port"] == 22]


RULES = [
    {"name": "web-https", "from_port": 443, "to_port": 443, "cidr": "0.0.0.0/0"},
    {"name": "ssh-anywhere", "from_port": 22, "to_port": 22, "cidr": "0.0.0.0/0"},
    {"name": "db-private", "from_port": 5432, "to_port": 5432, "cidr": "10.0.0.0/16"},
    {"name": "redis-v6", "from_port": 6379, "to_port": 6379, "cidr": "::/0"},
]
print(find_exposed(RULES))   # 預期 ['ssh-anywhere', 'redis-v6']
`,
    solution: `import ipaddress

PUBLIC_OK = {80, 443}


def find_exposed(rules: list[dict]) -> list[str]:
    out = []
    for r in rules:
        net = ipaddress.ip_network(r["cidr"], strict=False)
        if net.prefixlen != 0:                       # 不是整個網際網路
            continue
        ports = range(r["from_port"], r["to_port"] + 1)
        allowed = sum(1 for p in PUBLIC_OK if p in ports)
        if len(ports) > allowed:                     # 範圍裡有 80 / 443 以外的埠
            out.append(r["name"])
    return out


RULES = [
    {"name": "web-https", "from_port": 443, "to_port": 443, "cidr": "0.0.0.0/0"},
    {"name": "ssh-anywhere", "from_port": 22, "to_port": 22, "cidr": "0.0.0.0/0"},
    {"name": "db-private", "from_port": 5432, "to_port": 5432, "cidr": "10.0.0.0/16"},
    {"name": "redis-v6", "from_port": 6379, "to_port": 6379, "cidr": "::/0"},
]
print(find_exposed(RULES))
`,
    hints: [
      'ipaddress.ip_network("::/0").prefixlen 是 0；0.0.0.0/0 也是。',
      '埠範圍 80–443 也包含了 81 到 442，一樣算多開。',
    ],
    tests: [
      { name: '範例規則', code: `assert find_exposed(RULES) == ["ssh-anywhere", "redis-v6"], find_exposed(RULES)` },
      { name: 'IPv6 與私有網段', code: `_r = [
    {"name": "pg-v6", "from_port": 5432, "to_port": 5432, "cidr": "::/0"},
    {"name": "pg-vpc", "from_port": 5432, "to_port": 5432, "cidr": "172.16.0.0/12"},
    {"name": "http-v6", "from_port": 80, "to_port": 80, "cidr": "::/0"},
]
assert find_exposed(_r) == ["pg-v6"], find_exposed(_r)` },
      { name: '埠範圍', code: `_r = [
    {"name": "all-ports", "from_port": 0, "to_port": 65535, "cidr": "0.0.0.0/0"},
    {"name": "80-to-443", "from_port": 80, "to_port": 443, "cidr": "0.0.0.0/0"},
    {"name": "only-443", "from_port": 443, "to_port": 443, "cidr": "0.0.0.0/0"},
    {"name": "admin-range", "from_port": 8000, "to_port": 8100, "cidr": "0.0.0.0/0"},
]
assert find_exposed(_r) == ["all-ports", "80-to-443", "admin-range"], find_exposed(_r)` },
    ],
  },
  {
    id: 'object-storage-1', skill: 'object-storage', kind: 'python', level: 2,
    title: '簡化版 presigned URL：簽章與到期',
    prompt: '真實的 S3 簽章（Signature Version 4）由 SDK 處理，這題用簡化版練習核心概念。`sign` 與 `presign` 已經寫好：簽章是 HMAC-SHA256，涵蓋 HTTP 方法、key 與到期時間。完成：\n\n- `presign`：`ttl` 要在 1 到 3600 秒之間（網址就是授權，不能發長效的），否則 `raise ValueError`\n- `verify(secret, method, url, now) -> bool`：\n  - 從網址取出 key（路徑去掉開頭的 `/`）、`expires`、`sig`；缺參數或格式不對回 `False`（不要丟例外）\n  - `now` 超過 `expires` 回 `False`（剛好等於還算有效）\n  - 用同一把 secret 重算簽章，與網址裡的 `sig` 比對，不同就回 `False`。比對用 `hmac.compare_digest`',
    starter: R`import hmac
import hashlib
from urllib.parse import urlencode, urlparse, parse_qs


def sign(secret: bytes, method: str, key: str, expires: int) -> str:
    msg = f"{method}\n{key}\n{expires}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def presign(secret: bytes, method: str, key: str, now: int, ttl: int) -> str:
    # TODO：限制 ttl
    expires = now + ttl
    return f"/{key}?" + urlencode({"expires": expires, "sig": sign(secret, method, key, expires)})


def verify(secret: bytes, method: str, url: str, now: int) -> bool:
    # TODO：檢查到期與簽章
    return "sig=" in url


SECRET = b"demo-secret"
url = presign(SECRET, "GET", "reports/2026-10.pdf", now=1000, ttl=300)
print(url)
print(verify(SECRET, "GET", url, now=1100))   # True
print(verify(SECRET, "GET", url, now=1400))   # 預期 False：過期
`,
    solution: R`import hmac
import hashlib
from urllib.parse import urlencode, urlparse, parse_qs


def sign(secret: bytes, method: str, key: str, expires: int) -> str:
    msg = f"{method}\n{key}\n{expires}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def presign(secret: bytes, method: str, key: str, now: int, ttl: int) -> str:
    if not 1 <= ttl <= 3600:
        raise ValueError("ttl 要在 1 到 3600 秒之間")
    expires = now + ttl
    return f"/{key}?" + urlencode({"expires": expires, "sig": sign(secret, method, key, expires)})


def verify(secret: bytes, method: str, url: str, now: int) -> bool:
    u = urlparse(url)
    q = parse_qs(u.query)
    key = u.path.lstrip("/")
    try:
        expires = int(q["expires"][0])
        sig = q["sig"][0]
    except (KeyError, IndexError, ValueError):
        return False
    if not key or now > expires:
        return False
    return hmac.compare_digest(sign(secret, method, key, expires), sig)


SECRET = b"demo-secret"
url = presign(SECRET, "GET", "reports/2026-10.pdf", now=1000, ttl=300)
print(url)
print(verify(SECRET, "GET", url, now=1100))
print(verify(SECRET, "GET", url, now=1400))
`,
    hints: [
      'urlparse(url).path 是 /key，parse_qs(urlparse(url).query) 回傳 {"expires": ["1300"], "sig": ["..."]}。',
      '改掉 expires 也會讓簽章對不上，因為 expires 是簽進去的內容之一。',
      'hmac.compare_digest 的比對時間不因「前面幾個字元相同」而改變，避免 timing attack。',
    ],
    tests: [
      { name: '時間內、同方法同 key 通過', code: `_u = presign(b"k", "PUT", "uploads/1/a.png", now=0, ttl=60)
assert verify(b"k", "PUT", _u, now=30) is True
assert verify(b"k", "PUT", _u, now=60) is True, "剛好到期那一秒還算有效"` },
      { name: '過期拒絕', code: `_u = presign(b"k", "GET", "f.txt", now=0, ttl=60)
assert verify(b"k", "GET", _u, now=61) is False` },
      { name: '換方法、改 key、改到期時間、換密鑰都拒絕', code: `_u = presign(b"k", "GET", "users/42/id.png", now=0, ttl=60)
assert verify(b"k", "PUT", _u, now=1) is False, "GET 的網址不能拿來 PUT"
assert verify(b"k", "GET", _u.replace("/42/", "/43/"), now=1) is False, "改 key 要失敗"
assert verify(b"k", "GET", _u.replace("expires=60", "expires=99999"), now=1) is False, "延長到期時間要失敗"
assert verify(b"other", "GET", _u, now=1) is False, "別的密鑰簽的不算"` },
      { name: '缺參數或格式錯誤回 False', code: `assert verify(b"k", "GET", "/f.txt", now=0) is False
assert verify(b"k", "GET", "/f.txt?expires=abc&sig=00", now=0) is False
assert verify(b"k", "GET", "/f.txt?expires=100", now=0) is False` },
      { name: 'ttl 限制', code: `for _ttl in [0, 3601, 7 * 86400]:
    try:
        presign(b"k", "GET", "f", now=0, ttl=_ttl)
        raise AssertionError(f"ttl={_ttl} 應該 raise ValueError")
    except ValueError:
        pass` },
    ],
  },
  {
    id: 'load-balancing-1', skill: 'load-balancing', kind: 'python', level: 2,
    title: '一致性雜湊：加一台只搬一小部分',
    prompt: '起始碼用 `hash % N` 決定 key 送到哪台：分布平均，但從 3 台變 4 台時大約四分之三的 key 會換主人（對快取來說等於大部分同時失效）。改寫 `HashRing` 成一致性雜湊：\n\n- 每台節點在環上放 `vnodes` 個點，點的位置是 `h(f"{node}#{i}")`（`i` 從 0 到 `vnodes - 1`）\n- `node_for(key)`：從 `h(key)` 順時針找第一個點（比它大的第一個；超過最大值就繞回第一個點），回傳那個點的節點\n- `add(node)`、`remove(node)`：加入或移除節點的所有點\n\n用 `bisect` 在排序好的點上找位置。',
    starter: `import hashlib
import bisect


def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest()[:16], 16)


class HashRing:
    def __init__(self, nodes: list[str], vnodes: int = 100):
        self.vnodes = vnodes
        self.nodes = list(nodes)

    def add(self, node: str):
        self.nodes.append(node)

    def remove(self, node: str):
        self.nodes.remove(node)

    def node_for(self, key: str) -> str:
        # TODO：改成一致性雜湊
        return self.nodes[h(key) % len(self.nodes)]


ring = HashRing(["a", "b", "c"])
keys = [f"user:{i}" for i in range(10000)]
before = {k: ring.node_for(k) for k in keys}
ring.add("d")
moved = sum(before[k] != ring.node_for(k) for k in keys)
print(f"加一台後搬動了 {moved / len(keys):.0%} 的 key")
`,
    solution: `import hashlib
import bisect


def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest()[:16], 16)


class HashRing:
    def __init__(self, nodes: list[str], vnodes: int = 100):
        self.vnodes = vnodes
        self.points: list[int] = []        # 排序好的點
        self.owner: dict[int, str] = {}    # 點 → 節點
        for n in nodes:
            self.add(n)

    def add(self, node: str):
        for i in range(self.vnodes):
            p = h(f"{node}#{i}")
            self.owner[p] = node
            bisect.insort(self.points, p)

    def remove(self, node: str):
        self.points = [p for p in self.points if self.owner[p] != node]
        self.owner = {p: n for p, n in self.owner.items() if n != node}

    def node_for(self, key: str) -> str:
        i = bisect.bisect(self.points, h(key)) % len(self.points)   # 順時針第一個點，超過就繞回 0
        return self.owner[self.points[i]]


ring = HashRing(["a", "b", "c"])
keys = [f"user:{i}" for i in range(10000)]
before = {k: ring.node_for(k) for k in keys}
ring.add("d")
moved = sum(before[k] != ring.node_for(k) for k in keys)
print(f"加一台後搬動了 {moved / len(keys):.0%} 的 key")
`,
    hints: [
      'bisect.bisect(points, x) 回傳第一個大於 x 的位置；等於 len(points) 時要繞回 0（取餘數）。',
      '用一個 dict 記住每個點屬於哪個節點，bisect.insort 維持 points 排序。',
      '虛擬節點越多，各節點分到的比例越接近平均。',
    ],
    tests: [
      { name: '同一個 key 永遠同一台', code: `_r = HashRing(["a", "b", "c"])
assert all(_r.node_for("order:7") == _r.node_for("order:7") for _ in range(5))
assert {_r.node_for(f"k{i}") for i in range(1000)} == {"a", "b", "c"}` },
      { name: '分布大致平均', code: `_r = HashRing(["a", "b", "c"])
_c = {"a": 0, "b": 0, "c": 0}
for _i in range(10000):
    _c[_r.node_for(f"user:{_i}")] += 1
assert all(2500 < v < 4200 for v in _c.values()), _c` },
      { name: '加一台：只搬一小部分，而且都搬到新節點', code: `_r = HashRing(["a", "b", "c"])
_keys = [f"user:{i}" for i in range(10000)]
_before = {k: _r.node_for(k) for k in _keys}
_r.add("d")
_moved = [k for k in _keys if _r.node_for(k) != _before[k]]
assert len(_moved) / len(_keys) < 0.35, f"搬動了 {len(_moved) / len(_keys):.0%}，hash % N 的做法大約是 75%"
assert all(_r.node_for(k) == "d" for k in _moved), "被搬動的 key 應該都是搬到新節點 d"` },
      { name: '移除一台：只有原本在那台的 key 會移動', code: `_r = HashRing(["a", "b", "c", "d"])
_keys = [f"user:{i}" for i in range(10000)]
_before = {k: _r.node_for(k) for k in _keys}
_r.remove("b")
for _k in _keys:
    if _before[_k] != "b":
        assert _r.node_for(_k) == _before[_k], f"{_k} 原本在 {_before[_k]}，不該移動"
    else:
        assert _r.node_for(_k) != "b"` },
    ],
  },
]
