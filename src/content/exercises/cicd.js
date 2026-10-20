// 程式題：CI/CD 與交付
// GitHub Actions workflow 題共用的小工具（測試碼前面接上）：
//   job(name)：取出 jobs 底下某個 job 的內容（去掉註解）；沒有就回空字串
//   needsOf(body)：取出 job 層級的 needs 清單（支援 `needs: x`、`needs: [a, b]` 與多行清單）
const GH = String.raw`
const clean = source.split('\n').map((l) => l.replace(/\s+#.*$|^\s*#.*$/, '').replace(/\s+$/, ''))
const job = (name) => {
  const i = clean.findIndex((l) => l === '  ' + name + ':')
  if (i < 0) return ''
  const out = []
  for (const l of clean.slice(i + 1)) { if (l.trim() && !/^   /.test(l)) break; out.push(l) }
  return out.join('\n')
}
const needsOf = (b) => {
  const ls = b.split('\n')
  const i = ls.findIndex((l) => /^    needs:/.test(l))
  if (i < 0) return []
  const v = ls[i].replace(/^    needs:\s*/, '')
  if (v) return v.replace(/[\[\]"']/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  const out = []
  for (const l of ls.slice(i + 1)) { const m = l.match(/^\s+-\s+["']?([\w-]+)/); if (!m) break; out.push(m[1]) }
  return out
}
`

export default [
  {
    id: 'git-workflow-1', skill: 'git-workflow', kind: 'python', level: 1,
    title: '從 Conventional Commits 決定下一個版本號',
    prompt: '實作兩個函式：\n\n- `bump_level(messages)`：輸入這次發版包含的 commit 訊息（每則可能有多行），回傳 `"major"`、`"minor"`、`"patch"` 或 `None`\n- `next_version(current, messages)`：輸入目前版本（例如 `"1.4.2"`）與 commit 訊息，回傳下一個版本號字串\n\n規則：\n\n- 第一行（header）的格式是 `type(scope)!: description`，`(scope)` 與 `!` 都可以省略；冒號後面要有一個空格。不符合格式的訊息（例如 `Merge branch ...`、`update readme`）忽略\n- 破壞性變更 → `major`：type 後面有 `!`，或 header 之後有一行以 `BREAKING CHANGE: ` 或 `BREAKING-CHANGE: ` 開頭（任何 type 都可以帶這個 footer）\n- 否則 `feat` → `minor`、`fix` → `patch`，其他 type（`docs`、`chore`、`refactor`…）不升版\n- 多則訊息取**最大**的那一級；都不升版回傳 `None`\n- 升 major 時 minor、patch 歸零；升 minor 時 patch 歸零；不升版時回傳原本的版本',
    starter: `def bump_level(messages):
    level = None
    for msg in messages:
        if "BREAKING" in msg:
            return "major"
        if "feat" in msg:
            level = "minor"
        elif "fix" in msg and level is None:
            level = "patch"
    return level


def next_version(current, messages):
    major, minor, patch = (int(x) for x in current.split("."))
    level = bump_level(messages)
    if level == "major":
        major += 1
    elif level == "minor":
        minor += 1
    elif level == "patch":
        patch += 1
    return f"{major}.{minor}.{patch}"


print(bump_level(["fix: handle feature flag edge case"]))   # 預期 patch
print(next_version("1.4.2", ["feat(coupon): add percentage coupons"]))   # 預期 1.5.0
`,
    solution: `import re

# type、可省略的 (scope)、可省略的 !，接著是冒號、一個空格與描述
HEADER = re.compile(r"^(?P<type>[A-Za-z]+)(?:\\((?P<scope>[^()\\r\\n]*)\\))?(?P<bang>!)?: \\S")
RANK = {None: 0, "patch": 1, "minor": 2, "major": 3}


def commit_level(message):
    lines = message.strip().splitlines()
    if not lines:
        return None
    m = HEADER.match(lines[0])
    if not m:
        return None                     # 不符合格式：忽略
    footer_breaking = any(l.startswith(("BREAKING CHANGE: ", "BREAKING-CHANGE: ")) for l in lines[1:])
    if m.group("bang") or footer_breaking:
        return "major"
    kind = m.group("type").lower()
    if kind == "feat":
        return "minor"
    if kind == "fix":
        return "patch"
    return None


def bump_level(messages):
    best = None
    for msg in messages:
        level = commit_level(msg)
        if RANK[level] > RANK[best]:
            best = level
    return best


def next_version(current, messages):
    major, minor, patch = (int(x) for x in current.split("."))
    level = bump_level(messages)
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    if level == "patch":
        return f"{major}.{minor}.{patch + 1}"
    return current


print(bump_level(["fix: handle feature flag edge case"]))
print(next_version("1.4.2", ["feat(coupon): add percentage coupons"]))
`,
    hints: [
      '用 `in` 找子字串會誤判：`fix: handle feature flag` 裡有 `feat`。先用正規表示式解析第一行，拿到真正的 type。',
      '`!` 要緊接在 type 或 `(scope)` 後面、冒號前面；`BREAKING CHANGE:` 只有出現在 header 之後、而且是一行的開頭才算。',
      '取最大值可以給每一級一個數字（None=0、patch=1、minor=2、major=3）再比較。',
    ],
    tests: [
      { name: 'fix → patch、feat → minor（不能用子字串判斷）', code: `assert bump_level(["fix: handle feature flag edge case"]) == "patch", bump_level(["fix: handle feature flag edge case"])
assert bump_level(["feat(coupon): add percentage coupons"]) == "minor"
assert bump_level(["fix(auth): reject expired refresh tokens"]) == "patch"` },
      { name: 'type 後面的 ! 代表 major', code: `assert bump_level(["feat(api)!: remove legacy total field"]) == "major"
assert bump_level(["fix!: change default currency"]) == "major"` },
      { name: 'BREAKING CHANGE footer 代表 major；只在 header 裡提到不算', code: `assert bump_level(["refactor(api): drop v1 routes\\n\\nBREAKING CHANGE: /v1 endpoints are removed"]) == "major"
assert bump_level(["feat: new login\\n\\nBREAKING-CHANGE: sessions are invalidated"]) == "major"
assert bump_level(["docs: explain BREAKING CHANGE policy"]) is None, bump_level(["docs: explain BREAKING CHANGE policy"])` },
      { name: '多則訊息取最大的一級', code: `assert bump_level(["fix: a", "feat: b", "chore: c"]) == "minor"
assert bump_level(["docs: a", "fix: b"]) == "patch"
assert bump_level(["feat: a", "perf!: b", "fix: c"]) == "major"` },
      { name: '不符合格式的訊息忽略', code: `_r = bump_level(["Merge branch 'main' into feature/coupon", "update readme", "fixed typo", "feature: add coupon", "chore(deps): bump httpx"])
assert _r is None, _r
assert bump_level([]) is None` },
      { name: 'next_version 歸零規則', code: `assert next_version("1.4.2", ["feat: x"]) == "1.5.0", next_version("1.4.2", ["feat: x"])
assert next_version("1.4.2", ["fix: x"]) == "1.4.3"
assert next_version("1.4.2", ["feat!: x"]) == "2.0.0", next_version("1.4.2", ["feat!: x"])
assert next_version("1.4.2", ["docs: x"]) == "1.4.2"
assert next_version("2.9.9", ["fix: a", "feat: b"]) == "2.10.0"` },
    ],
  },
  {
    id: 'ci-pipeline-1', skill: 'ci-pipeline', kind: 'config', level: 2, file: '.github/workflows/ci.yml',
    title: 'GitHub Actions：快取、lint 先行、PostgreSQL service、只在 main 推 image',
    prompt: '這份 workflow 能跑，但有四個問題：每次都重新下載依賴、lint 和測試同時開跑（lint 幾秒就能擋的錯也要等測試跑完）、測試要連的 PostgreSQL 根本不存在、每個分支和 PR 都會 build 並推 image。\n\n修改成：\n\n- **快取依賴**：每個執行 `uv sync` 的 job 都要快取 uv 的下載目錄（`~/.cache/uv`）。用 `actions/cache`，key 要包含 `hashFiles(\'uv.lock\')`；或用 `astral-sh/setup-uv` 並設定 `enable-cache: true`\n- **lint 在 test 之前**：`test` job 要等 `lint` 通過才開始\n- **測試接 postgres service**：`test` job 用 `services:` 起一個 `postgres` image，用 `ports` 把 `5432:5432` 對應出來，加上 `pg_isready` 的 health check；`DATABASE_URL` 的帳號、密碼、資料庫名稱要和 service 的 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 一致（job 直接跑在 runner 上，主機用 `localhost`）\n- **只在 main 推 image**：`build` 要在 `test` 通過之後，而且用 `if:` 限制只在 main 分支執行\n\n仍然要執行 `ruff check` 與 `pytest`。',
    starter: `name: ci

on:
  push:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install uv
      - run: uv sync --locked
      - run: uv run ruff check .

  test:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://app:test-only@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install uv
      - run: uv sync --locked
      - run: uv run pytest

  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/example-org/shop-api:\${{ github.sha }}
`,
    solution: `name: ci

on:
  push:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/cache@v4
        with:
          path: ~/.cache/uv
          key: uv-\${{ runner.os }}-\${{ hashFiles('uv.lock') }}
          restore-keys: uv-\${{ runner.os }}-
      - run: pip install uv
      - run: uv sync --locked
      - run: uv run ruff check .

  test:
    needs: lint
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: test-only
          POSTGRES_DB: app_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://app:test-only@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/cache@v4
        with:
          path: ~/.cache/uv
          key: uv-\${{ runner.os }}-\${{ hashFiles('uv.lock') }}
          restore-keys: uv-\${{ runner.os }}-
      - run: pip install uv
      - run: uv sync --locked
      - run: uv run pytest

  build:
    needs: [lint, test]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/example-org/shop-api:\${{ github.sha }}
`,
    hints: [
      '`actions/cache@v4` 放在 `uv sync` 之前：`path: ~/.cache/uv`、`key: uv-${{ runner.os }}-${{ hashFiles(\'uv.lock\') }}`。lock 檔沒變，key 就一樣，直接命中。',
      'job 層級寫 `needs: lint`，test 就會等 lint 成功才開始；lint 失敗時 test 會被跳過。',
      'service 的設定寫在 `services: postgres:` 底下：`image`、`env`、`ports: - 5432:5432`，以及 `options: --health-cmd pg_isready ...`。',
      '`build` 加 `needs: [lint, test]` 與 `if: github.ref == \'refs/heads/main\'`（可以再加上 `github.event_name == \'push\'`）。',
    ],
    tests: [
      { name: '每個執行 uv sync 的 job 都有依賴快取', code: GH + String.raw`
for (const n of ['lint', 'test']) {
  const b = job(n)
  assert(b, '找不到 ' + n + ' job')
  if (!/uv\s+sync/.test(b)) continue
  const viaCache = /uses:\s*actions\/cache@/.test(b) && /key:.*hashFiles\(\s*['"][^'"]*uv\.lock['"]/.test(b) && /path:[^\n]*(uv|\.venv)/.test(b)
  const viaSetupUv = /uses:\s*astral-sh\/setup-uv@/.test(b) && /enable-cache:\s*true/.test(b)
  assert(viaCache || viaSetupUv, n + ' job 沒有快取 uv 的依賴（actions/cache 的 key 要用 hashFiles(\'uv.lock\')，或用 setup-uv 的 enable-cache: true）')
}
` },
      { name: 'test 要等 lint 通過', code: GH + String.raw`
const b = job('test')
assert(b, '找不到 test job')
assert(needsOf(b).includes('lint'), 'test job 沒有 needs: lint（目前 needs：' + (needsOf(b).join(', ') || '無') + '）')
` },
      { name: 'test 有 postgres service、對應 5432 埠並有 health check', code: GH + String.raw`
const b = job('test')
assert(/^    services:/m.test(b), 'test job 沒有 services:')
assert(/^\s+image:\s*["']?postgres(:[\w.-]+)?["']?\s*$/m.test(b), 'services 裡沒有 postgres image')
assert(/["']?5432:5432["']?/.test(b), 'service 沒有用 ports 對應 5432:5432（job 跑在 runner 上，要對應埠才能用 localhost 連）')
assert(/--health-cmd[\s"']+pg_isready/.test(b), '沒有 pg_isready 的 health check：資料庫還沒就緒，測試就可能先開跑')
` },
      { name: 'DATABASE_URL 連 localhost，帳密與資料庫名稱和 service 一致', code: GH + String.raw`
const b = job('test')
const v = (k) => ((b.match(new RegExp('^\\s+' + k + ':\\s*["\']?([^"\'\\s]+)', 'm')) || [])[1])
const m = b.match(/DATABASE_URL:\s*["']?postgres(?:ql)?:\/\/([^:@\s]+):([^@\s]+)@([^:\/\s"']+)(?::\d+)?\/([\w-]+)/)
assert(m, '找不到 DATABASE_URL（格式 postgresql://帳號:密碼@主機:5432/資料庫）')
assert(['localhost', '127.0.0.1'].includes(m[3]), 'job 直接跑在 runner 上時，DATABASE_URL 的主機要用 localhost（目前是 ' + m[3] + '）')
assert(v('POSTGRES_PASSWORD'), 'service 沒有設定 POSTGRES_PASSWORD（postgres image 沒有密碼不會啟動）')
const user = v('POSTGRES_USER') || 'postgres'
assertEqual(m[1], user, '帳號')
assertEqual(m[2], v('POSTGRES_PASSWORD'), '密碼')
assertEqual(m[4], v('POSTGRES_DB') || user, '資料庫名稱')
` },
      { name: 'build 在 test 之後，而且只在 main 執行', code: GH + String.raw`
const b = job('build')
assert(b, '找不到 build job')
assert(needsOf(b).includes('test'), 'build 沒有 needs test：測試沒過也會推 image')
const cond = (b.match(/^    if:\s*(.+)$/m) || [])[1] || ''
assert(cond, 'build job 沒有 job 層級的 if:')
assert(/github\.ref\s*==\s*['"]refs\/heads\/main['"]/.test(cond) || /github\.ref_name\s*==\s*['"]main['"]/.test(cond), 'build 的 if 要限制在 main（github.ref == \'refs/heads/main\'）')
assert(!/\|\|/.test(cond), 'if 條件裡不要用 ||，否則其他分支也可能通過')
` },
      { name: '仍然執行 ruff check 與 pytest', code: GH + String.raw`
assert(/run:.*ruff\s+check/.test(job('lint')), 'lint job 沒有 ruff check')
assert(/run:.*pytest/.test(job('test')), 'test job 沒有 pytest')
` },
    ],
  },
  {
    id: 'environments-secrets-1', skill: 'environments-secrets', kind: 'config', level: 2, file: '.github/workflows/deploy.yml',
    title: '同一個 image 從 staging 晉升到 production',
    prompt: '這份部署 workflow 有三個問題：staging 和 production 各自 `docker build` 一次（production 跑的不是 staging 驗過的那個 image）、production 的資料庫連線字串連同密碼寫死在檔案裡、`deploy-production` 沒有綁定 environment——所以在 Settings → Environments 為 `production` 設定的 required reviewers（人工核准）完全不會生效，job 也拿不到 production 環境的 secrets。\n\n修改成：\n\n- 新增一個 `build` job：build 並推送 image，用 job 的 `outputs` 輸出 image 的位置（建議用 `docker/build-push-action` 的 `digest` 輸出組成 `image@sha256:...`）\n- `deploy-staging` 與 `deploy-production` **都不能再 build 或 push**，部署時都用 `needs.build.outputs` 裡**同一個** output\n- `deploy-production` 要在 `deploy-staging` 成功之後才執行（注意：要讀 `needs.build.outputs`，`build` 也必須列在這個 job 的 `needs` 裡）\n- `deploy-staging` 綁定 `environment: staging`，`deploy-production` 綁定 `environment: production`（核准規則在平台設定，YAML 只要綁定）\n- 檔案裡不能有寫死的密碼；兩個 deploy job 的 `DATABASE_URL` 都用 `${{ secrets.DATABASE_URL }}`（綁了哪個 environment，就拿到那個環境的值）',
    starter: `name: deploy

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ghcr.io/example-org/shop-api:\${{ github.sha }} .
      - run: docker push ghcr.io/example-org/shop-api:\${{ github.sha }}
      - run: ./scripts/deploy.sh "ghcr.io/example-org/shop-api:\${{ github.sha }}"
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}

  deploy-production:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ghcr.io/example-org/shop-api:\${{ github.sha }}-prod .
      - run: docker push ghcr.io/example-org/shop-api:\${{ github.sha }}-prod
      - run: ./scripts/deploy.sh "ghcr.io/example-org/shop-api:\${{ github.sha }}-prod"
        env:
          DATABASE_URL: "postgresql://shop:Pr0d-Db-2026@db-prod.internal:5432/shop"
`,
    solution: `name: deploy

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      # digest 是內容的雜湊：staging 與 production 拿到的是位元組完全相同的 image
      image: ghcr.io/example-org/shop-api@\${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - id: push
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/example-org/shop-api:\${{ github.sha }}

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh "\${{ needs.build.outputs.image }}"
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}

  deploy-production:
    needs: [build, deploy-staging]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://shop.example.org
    concurrency: production
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/deploy.sh "\${{ needs.build.outputs.image }}"
        env:
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
`,
    hints: [
      'build job 的 step 加上 `id: push`，job 層級寫 `outputs:`，底下 `image: ghcr.io/example-org/shop-api@${{ steps.push.outputs.digest }}`。',
      '`needs` context 只包含**直接**列在 `needs` 裡的 job：`deploy-production` 要寫 `needs: [build, deploy-staging]` 才讀得到 `needs.build.outputs.image`。',
      '`environment: production` 或 `environment:` 底下寫 `name: production` 都可以。兩個 deploy job 的 `DATABASE_URL` 寫法一樣，值由各自綁定的 environment 決定。',
    ],
    tests: [
      { name: 'build job 會 build 並用 outputs 輸出 image', code: GH + String.raw`
const b = job('build')
assert(b, '找不到 build job')
assert(/docker\s+build|docker\s+buildx\s+build|build-push-action/.test(b), 'build job 沒有 build image')
assert(/^    outputs:\s*\n\s{6,}[\w-]+:\s*\S/m.test(b), 'build job 沒有 outputs（後面的 job 要靠它拿到 image 位置）')
` },
      { name: '兩個 deploy job 都不再 build', code: GH + String.raw`
for (const n of ['deploy-staging', 'deploy-production']) {
  const b = job(n)
  assert(b, '找不到 ' + n + ' job')
  assert(!/docker\s+build|docker\s+buildx\s+build|build-push-action|docker\s+push/.test(b), n + ' 還在 build 或 push image：每個環境重 build，production 跑的就不是驗過的那個')
}
` },
      { name: 'staging 與 production 部署同一個 build output', code: GH + String.raw`
const keys = (n) => [...job(n).matchAll(/needs\.build\.outputs\.([\w-]+)/g)].map((m) => m[1])
const s = keys('deploy-staging'), p = keys('deploy-production')
assert(s.length, 'deploy-staging 沒有使用 needs.build.outputs')
assert(p.length, 'deploy-production 沒有使用 needs.build.outputs')
assertEqual([...new Set(p)], [...new Set(s)], 'production 用的 output')
const outs = (job('build').match(/^    outputs:\s*\n((?:\s{6,}.*\n?)+)/m) || [])[1] || ''
assert(new RegExp('^\\s{6,}' + s[0] + ':', 'm').test(outs), 'build 的 outputs 裡沒有 ' + s[0])
` },
      { name: 'production 在 staging 之後，而且 needs 裡有 build', code: GH + String.raw`
const n = needsOf(job('deploy-production'))
assert(n.includes('deploy-staging'), 'deploy-production 要 needs deploy-staging（目前：' + (n.join(', ') || '無') + '）')
assert(n.includes('build'), 'deploy-production 的 needs 也要列出 build，否則讀不到 needs.build.outputs')
assert(needsOf(job('deploy-staging')).includes('build'), 'deploy-staging 要 needs build')
` },
      { name: '兩個 deploy job 分別綁定 staging 與 production 環境', code: GH + String.raw`
const env = (b) => ((b.match(/^    environment:\s*["']?([\w-]+)["']?\s*$/m) || b.match(/^    environment:\s*\n\s+name:\s*["']?([\w-]+)["']?/m) || [])[1])
assertEqual(env(job('deploy-staging')), 'staging', 'deploy-staging 的 environment')
assertEqual(env(job('deploy-production')), 'production', 'deploy-production 的 environment')
` },
      { name: '沒有寫死的密碼，DATABASE_URL 來自 secrets', code: GH + String.raw`
assert(!/postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"'$]+@/.test(source), '檔案裡有帶密碼的連線字串')
assert(!/Pr0d-Db-2026/.test(source), '原本的密碼還在檔案裡')
for (const n of ['deploy-staging', 'deploy-production']) {
  const m = job(n).match(/DATABASE_URL:\s*(.+)$/m)
  assert(m, n + ' 沒有設定 DATABASE_URL')
  assert(/^["']?\$\{\{\s*secrets\.\w+\s*\}\}["']?$/.test(m[1].trim()), n + ' 的 DATABASE_URL 要用 secrets（目前是 ' + m[1].trim() + '）')
}
` },
    ],
  },
  {
    id: 'cd-strategies-1', skill: 'cd-strategies', kind: 'python', level: 2,
    title: 'canary 判斷：繼續放量、暫停或回滾',
    prompt: '實作 `canary_decision(baseline, canary)`，回傳 `"promote"`（繼續放量）、`"hold"`（維持目前比例、繼續觀察）或 `"rollback"`。兩個參數都是同一段時間的統計：`{"requests": int, "errors": int, "p95_ms": float}`，`baseline` 是舊版、`canary` 是新版。\n\n規則（依序判斷）：\n\n1. 錯誤率 = `errors / requests`；`requests` 為 0 時錯誤率當作 0（不能丟 `ZeroDivisionError`）\n2. **樣本不足**：canary 的請求數少於 500，或 baseline 的請求數是 0。這時如果 canary 錯誤率已經 ≥ 20% → `"rollback"`（明顯壞掉），否則 `"hold"`\n3. canary 錯誤率比 baseline **高超過 0.01**（1 個百分點），或 canary 的 p95 **超過** baseline p95 的 1.5 倍 → `"rollback"`\n4. canary 錯誤率比 baseline 高超過 0.002，或 canary 的 p95 超過 baseline p95 的 1.2 倍 → `"hold"`\n5. 其他 → `"promote"`\n\n注意比較的是**比例**，不是錯誤次數：canary 只拿到一小部分流量，次數本來就少。',
    starter: `def canary_decision(baseline, canary):
    # 比較錯誤次數與延遲
    if canary["errors"] > baseline["errors"]:
        return "rollback"
    if canary["p95_ms"] > baseline["p95_ms"]:
        return "hold"
    return "promote"


baseline = {"requests": 20000, "errors": 40, "p95_ms": 180}
print(canary_decision(baseline, {"requests": 1000, "errors": 30, "p95_ms": 190}))   # 錯誤率 3%，預期 rollback
`,
    solution: `def rate(stats):
    return stats["errors"] / stats["requests"] if stats["requests"] else 0.0


def canary_decision(baseline, canary):
    err_b, err_c = rate(baseline), rate(canary)

    # 樣本不足：除非已經明顯壞掉，否則不下結論
    if canary["requests"] < 500 or baseline["requests"] == 0:
        return "rollback" if err_c >= 0.20 else "hold"

    diff = err_c - err_b
    if diff > 0.01 or canary["p95_ms"] > baseline["p95_ms"] * 1.5:
        return "rollback"
    if diff > 0.002 or canary["p95_ms"] > baseline["p95_ms"] * 1.2:
        return "hold"
    return "promote"


baseline = {"requests": 20000, "errors": 40, "p95_ms": 180}
print(canary_decision(baseline, {"requests": 1000, "errors": 30, "p95_ms": 190}))
`,
    hints: [
      '先寫一個 `rate(stats)`：`requests` 是 0 就回 0.0，否則回 `errors / requests`。',
      '判斷順序很重要：樣本不足要最先檢查，否則 30 個請求裡的 1 個錯誤（3.3%）就會觸發回滾。',
      '錯誤率的差距是「相減」：`rate(canary) - rate(baseline) > 0.01`；延遲是「倍數」：`canary["p95_ms"] > baseline["p95_ms"] * 1.5`。',
    ],
    tests: [
      { name: '新舊版一樣健康 → promote', code: `_b = {"requests": 20000, "errors": 40, "p95_ms": 180}
_r = canary_decision(_b, {"requests": 1000, "errors": 2, "p95_ms": 185})
assert _r == "promote", _r` },
      { name: '比較錯誤率而不是錯誤次數 → rollback', code: `_b = {"requests": 20000, "errors": 40, "p95_ms": 180}
_r = canary_decision(_b, {"requests": 1000, "errors": 30, "p95_ms": 190})
assert _r == "rollback", f"canary 錯誤率 3%、baseline 0.2%，得到 {_r}"` },
      { name: 'p95 超過 1.5 倍 → rollback', code: `_b = {"requests": 20000, "errors": 40, "p95_ms": 180}
_r = canary_decision(_b, {"requests": 1000, "errors": 2, "p95_ms": 300})
assert _r == "rollback", _r` },
      { name: '輕微變差 → hold', code: `_b = {"requests": 20000, "errors": 40, "p95_ms": 180}
_r1 = canary_decision(_b, {"requests": 1000, "errors": 6, "p95_ms": 190})
assert _r1 == "hold", f"錯誤率 0.6% 對 0.2%，得到 {_r1}"
_r2 = canary_decision(_b, {"requests": 1000, "errors": 2, "p95_ms": 230})
assert _r2 == "hold", f"p95 230 對 180（1.28 倍），得到 {_r2}"` },
      { name: '樣本不足 → hold；明顯壞掉 → rollback', code: `_b = {"requests": 20000, "errors": 40, "p95_ms": 180}
_r1 = canary_decision(_b, {"requests": 120, "errors": 1, "p95_ms": 400})
assert _r1 == "hold", f"只有 120 個請求，得到 {_r1}"
_r2 = canary_decision(_b, {"requests": 120, "errors": 40, "p95_ms": 200})
assert _r2 == "rollback", f"120 個請求裡 40 個錯誤（33%），得到 {_r2}"` },
      { name: '請求數為 0 不會除以零', code: `_r = canary_decision({"requests": 0, "errors": 0, "p95_ms": 0}, {"requests": 1000, "errors": 1, "p95_ms": 150})
assert _r == "hold", _r
_r2 = canary_decision({"requests": 20000, "errors": 40, "p95_ms": 180}, {"requests": 0, "errors": 0, "p95_ms": 0})
assert _r2 == "hold", _r2` },
    ],
  },
  {
    id: 'observability-1', skill: 'observability', kind: 'python', level: 2,
    title: '延遲百分位數、錯誤率與結構化 log',
    prompt: '實作三個函式：\n\n- `percentile(values, p)`：用 **nearest-rank** 方法——排序後取第 `ceil(p / 100 * n)` 個（從 1 開始數）。`values` 是空的就 `raise ValueError`。不能改動傳進來的 list\n- `summarize(samples)`：`samples` 是 `(延遲毫秒, HTTP 狀態碼)` 的 list，回傳 `{"count", "p50", "p95", "p99", "error_rate"}` 這五個 key 的 dict。只有 **5xx** 算錯誤（4xx 是客戶端的問題，不算服務的錯誤）\n- `log_line(level, msg, **fields)`：回傳**一行** JSON 字串，包含 `level`、`msg` 與所有 `fields`。`msg` 裡有換行也要維持一行；欄位值是 `datetime` 這類 `json` 不認得的型別時，轉成字串，不能丟例外',
    starter: `import json
from datetime import datetime, timezone


def percentile(values, p):
    return values[int(len(values) * p / 100) - 1]


def summarize(samples):
    latencies = [ms for ms, _ in samples]
    errors = sum(1 for _, status in samples if status >= 400)
    return {
        "count": len(samples),
        "p50": percentile(latencies, 50),
        "p95": percentile(latencies, 95),
        "p99": percentile(latencies, 99),
        "error_rate": errors / len(samples),
    }


def log_line(level, msg, **fields):
    return f"{level} {msg} {fields}"


samples = [(120, 200), (95, 200), (3100, 503), (140, 404), (110, 200)]
print(summarize(samples))
print(log_line("INFO", "checkout finished", order_id=88123, duration_ms=8143))
`,
    solution: `import json
import math
from datetime import datetime, timezone


def percentile(values, p):
    if not values:
        raise ValueError("values is empty")
    s = sorted(values)                       # sorted() 產生新的 list，不動原本的
    k = max(1, math.ceil(p / 100 * len(s)))  # nearest-rank：第 k 個（從 1 開始）
    return s[k - 1]


def summarize(samples):
    latencies = [ms for ms, _ in samples]
    errors = sum(1 for _, status in samples if status >= 500)   # 只有 5xx 算服務的錯誤
    return {
        "count": len(samples),
        "p50": percentile(latencies, 50),
        "p95": percentile(latencies, 95),
        "p99": percentile(latencies, 99),
        "error_rate": errors / len(samples),
    }


def log_line(level, msg, **fields):
    entry = {"level": level, "msg": msg, **fields}
    # json.dumps 會把換行跳脫成 \\n，輸出一定是一行；default=str 處理 datetime 等型別
    return json.dumps(entry, ensure_ascii=False, default=str)


samples = [(120, 200), (95, 200), (3100, 503), (140, 404), (110, 200)]
print(summarize(samples))
print(log_line("INFO", "checkout finished", order_id=88123, duration_ms=8143))
`,
    hints: [
      '`math.ceil(p / 100 * n)` 算出名次 k（從 1 開始），所以要取 `sorted(values)[k - 1]`。',
      '錯誤只算 `status >= 500`。',
      '`json.dumps(..., default=str)`：遇到不認得的型別就呼叫 `str()`；字串裡的換行會被跳脫成 `\\n`，不會真的換行。',
    ],
    tests: [
      { name: 'nearest-rank 百分位數（要先排序）', code: `assert percentile([5, 1, 4, 2, 3], 50) == 3, percentile([5, 1, 4, 2, 3], 50)
_v = list(range(100, 0, -1))
assert percentile(_v, 95) == 95, percentile(_v, 95)
assert percentile(_v, 99) == 99
assert percentile([42], 99) == 42` },
      { name: '不改動傳入的 list；空的要 raise ValueError', code: `_v = [3, 1, 2]
percentile(_v, 50)
assert _v == [3, 1, 2], "percentile 改動了傳入的 list"
try:
    percentile([], 50)
    raise AssertionError("空的 list 沒有 raise ValueError")
except ValueError:
    pass` },
      { name: 'summarize 算出 p50／p95／p99', code: `_s = [(100 + i, 200) for i in range(97)] + [(7000, 404), (5000, 500), (6000, 503)]
_r = summarize(_s)
assert _r["count"] == 100, _r
assert (_r["p50"], _r["p95"], _r["p99"]) == (149, 194, 6000), _r` },
      { name: '只有 5xx 算錯誤', code: `_s = [(100 + i, 200) for i in range(97)] + [(7000, 404), (5000, 500), (6000, 503)]
assert abs(summarize(_s)["error_rate"] - 0.02) < 1e-9, summarize(_s)["error_rate"]
assert summarize([(10, 404), (12, 401)])["error_rate"] == 0` },
      { name: 'log_line 是可以解析的 JSON', code: `import json as _json
_d = _json.loads(log_line("INFO", "checkout finished", order_id=88123, duration_ms=12.5))
assert _d == {"level": "INFO", "msg": "checkout finished", "order_id": 88123, "duration_ms": 12.5}, _d` },
      { name: 'log_line 永遠是一行，datetime 也不會出錯', code: `import json as _json
from datetime import datetime as _dt, timezone as _tz
_l = log_line("ERROR", "charge failed\\nTraceback: TimeoutError", at=_dt(2026, 10, 20, 6, 0, tzinfo=_tz.utc))
assert "\\n" not in _l, "log_line 輸出了多行"
_d = _json.loads(_l)
assert _d["msg"] == "charge failed\\nTraceback: TimeoutError"
assert "2026-10-20" in _d["at"], _d` },
    ],
  },
  {
    id: 'reliability-1', skill: 'reliability', kind: 'python', level: 2,
    title: 'liveness 與 readiness：依賴掛掉時誰該失敗',
    prompt: '實作兩個健康檢查函式，都回傳 `(HTTP 狀態碼, body dict)`：\n\n- `liveness(state, now)`：只回答「這個程序有沒有卡死」。事件迴圈的心跳（`state.loop_heartbeat`）距離 `now` 不超過 `HEARTBEAT_LIMIT` 秒 → `200`，否則 `503`。**不檢查任何外部依賴**——資料庫掛了，重啟程序也救不了\n- `readiness(state, now)`：回答「現在能不能接流量」\n  - 還沒啟動完成（`started` 為 False）、正在關閉（`draining`）、程序卡死、或必要依賴資料庫掛掉（`db_ok` 為 False）→ `503`\n  - 只有可降級的快取掛掉（`cache_ok` 為 False）→ 仍然 `200`，body 是 `{"status": "degraded", "degraded": ["cache"]}`\n  - 都正常 → `200`，body 的 `status` 是 `"ok"`\n\n失敗時 body 的內容不限，但要是 dict。',
    starter: `from dataclasses import dataclass

HEARTBEAT_LIMIT = 10.0


@dataclass
class AppState:
    started: bool = True          # 啟動流程（載入設定、建立連線池）完成了沒
    draining: bool = False        # 收到 SIGTERM，正在優雅關閉
    loop_heartbeat: float = 0.0   # 事件迴圈最後一次跳動的時間（秒）
    db_ok: bool = True            # 主資料庫連得上（必要依賴）
    cache_ok: bool = True         # 快取連得上（可以降級的依賴）


def liveness(state, now):
    if not state.db_ok:
        return 503, {"status": "db down"}
    return 200, {"status": "ok"}


def readiness(state, now):
    if not state.db_ok or not state.cache_ok:
        return 503, {"status": "dependency down"}
    return 200, {"status": "ok"}


s = AppState(loop_heartbeat=100.0, db_ok=False)
print("liveness:", liveness(s, now=101.0))    # 資料庫掛了，程序本身沒事：預期 200
print("readiness:", readiness(s, now=101.0))  # 預期 503
`,
    solution: `from dataclasses import dataclass

HEARTBEAT_LIMIT = 10.0


@dataclass
class AppState:
    started: bool = True
    draining: bool = False
    loop_heartbeat: float = 0.0
    db_ok: bool = True
    cache_ok: bool = True


def _alive(state, now):
    return now - state.loop_heartbeat <= HEARTBEAT_LIMIT


def liveness(state, now):
    # 只看程序自己：事件迴圈還在跳就是活著。不碰資料庫、快取或任何外部服務
    if _alive(state, now):
        return 200, {"status": "ok"}
    return 503, {"status": "stuck", "since": state.loop_heartbeat}


def readiness(state, now):
    reasons = []
    if not state.started:
        reasons.append("starting")
    if state.draining:
        reasons.append("draining")
    if not _alive(state, now):
        reasons.append("stuck")
    if not state.db_ok:
        reasons.append("database")          # 必要依賴：沒有它就不能服務
    if reasons:
        return 503, {"status": "unavailable", "reasons": reasons}
    if not state.cache_ok:
        # 可降級的依賴：快取掛了就直接查資料庫，慢一點但能服務
        return 200, {"status": "degraded", "degraded": ["cache"]}
    return 200, {"status": "ok"}


s = AppState(loop_heartbeat=100.0, db_ok=False)
print("liveness:", liveness(s, now=101.0))
print("readiness:", readiness(s, now=101.0))
`,
    hints: [
      'liveness 只需要一個條件：`now - state.loop_heartbeat <= HEARTBEAT_LIMIT`。',
      'readiness 先檢查會讓它回 503 的條件（啟動、關閉、卡死、資料庫），最後才看快取：快取掛掉只是降級。',
    ],
    tests: [
      { name: '一切正常：兩個都 200', code: `_s = AppState(loop_heartbeat=100.0)
assert liveness(_s, 101.0)[0] == 200
_c, _b = readiness(_s, 101.0)
assert _c == 200 and _b.get("status") == "ok", (_c, _b)` },
      { name: '資料庫掛了：readiness 503、liveness 仍然 200', code: `_s = AppState(loop_heartbeat=100.0, db_ok=False)
assert readiness(_s, 101.0)[0] == 503, readiness(_s, 101.0)
assert liveness(_s, 101.0)[0] == 200, "資料庫掛掉時 liveness 失敗，所有實例會被一起重啟"` },
      { name: '快取掛了：仍然能服務（degraded）', code: `_s = AppState(loop_heartbeat=100.0, cache_ok=False)
_c, _b = readiness(_s, 101.0)
assert _c == 200, f"快取是可降級的依賴，readiness 應該是 200，得到 {_c}"
assert _b.get("status") == "degraded" and "cache" in _b.get("degraded", []), _b
assert liveness(_s, 101.0)[0] == 200` },
      { name: '正在關閉或還沒啟動完成：不接流量，但不要被重啟', code: `_d = AppState(loop_heartbeat=100.0, draining=True)
assert readiness(_d, 101.0)[0] == 503 and liveness(_d, 101.0)[0] == 200
_n = AppState(loop_heartbeat=100.0, started=False)
assert readiness(_n, 101.0)[0] == 503 and liveness(_n, 101.0)[0] == 200` },
      { name: '事件迴圈卡住：liveness 503', code: `_s = AppState(loop_heartbeat=100.0)
assert liveness(_s, 130.0)[0] == 503, "心跳停了 30 秒，應該要重啟"
assert readiness(_s, 130.0)[0] == 503
assert liveness(_s, 110.0)[0] == 200, "剛好 10 秒還在容許範圍內"` },
      { name: '回傳 (狀態碼, dict)', code: `_s = AppState(loop_heartbeat=100.0, db_ok=False)
for _f in (liveness, readiness):
    _r = _f(_s, 101.0)
    assert isinstance(_r, tuple) and len(_r) == 2 and isinstance(_r[1], dict), _r` },
    ],
  },
]
