// 程式題：DevOps：GitLab CI 等設定檔
// 測試碼前面共用的小工具：job(name) 取出某個頂層 job 的內容（去掉註解），沒有就回空字串
const JOB = String.raw`
const job = (name) => {
  const ls = source.split('\n').map((l) => l.replace(/\s+#.*$|^\s*#.*$/, ''))
  const i = ls.findIndex((l) => l.startsWith(name + ':'))
  if (i < 0) return ''
  const out = []
  for (const l of ls.slice(i + 1)) { if (/^\S/.test(l)) break; out.push(l) }
  return out.join('\n')
}
`

export default [
  {
    id: 'gitlab-cicd-1', skill: 'gitlab-cicd', kind: 'config', level: 2, file: '.gitlab-ci.yml',
    title: '測試 job 接上 PostgreSQL service',
    prompt: '`test` job 的測試需要一個真的 PostgreSQL，但現在 `DATABASE_URL` 指向 `localhost`，而 job 裡根本沒有資料庫，測試一連就失敗。\n\n修改 `test` job：\n\n- 用 `services:` 起一個 `postgres` 容器（例如 `postgres:16`，可以加 `alias`）\n- 用 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD` 設定資料庫名稱與帳密（這是 job 結束就銷毀的測試資料庫，帳密可以寫在檔案裡）\n- `DATABASE_URL` 的主機改成 service 的名稱（`postgres` 或你設的 alias），帳號、密碼、資料庫名稱要和上面三個變數一致\n- 仍然要執行 `pytest`',
    starter: `stages:
  - test

test:
  stage: test
  image: python:3.12-slim
  variables:
    DATABASE_URL: "postgresql://app:secret@localhost:5432/app"
  script:
    - pip install -r requirements.txt
    - pytest
`,
    solution: `stages:
  - test

test:
  stage: test
  image: python:3.12-slim
  services:
    - name: postgres:16
      alias: db
  variables:
    # job 結束就銷毀的測試資料庫，不是機密
    POSTGRES_DB: app_test
    POSTGRES_USER: app
    POSTGRES_PASSWORD: test-only
    DATABASE_URL: "postgresql://app:test-only@db:5432/app_test"
  script:
    - pip install -r requirements.txt
    - pytest
`,
    hints: [
      'docker executor 下，service 是另一個容器，不在 localhost；job 用 service 的名稱連它。`postgres:16` 的預設主機名稱是 `postgres`，加了 `alias: db` 就也能用 `db`。',
      'job 的 `variables` 也會傳給 service 容器，postgres image 會用 `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` 建立資料庫與帳號。',
    ],
    tests: [
      { name: 'test job 有 postgres service', code: JOB + String.raw`
const b = job('test')
assert(b, '找不到 test job')
assert(/^\s+services:/m.test(b), 'test job 沒有 services:')
assert(/^\s+-\s+(name:\s*)?["']?postgres(:[\w.-]+)?["']?\s*$/m.test(b), 'services 裡沒有 postgres image')
` },
      { name: '設定了 POSTGRES_DB、POSTGRES_USER、POSTGRES_PASSWORD', code: JOB + String.raw`
const b = job('test')
for (const k of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
  assert(new RegExp('^\\s+' + k + ':\\s*\\S+', 'm').test(b), '缺少 ' + k)
}
` },
      { name: 'DATABASE_URL 的主機是 service 名稱，不是 localhost', code: JOB + String.raw`
const b = job('test')
const m = b.match(/DATABASE_URL:\s*["']?postgres(?:ql)?:\/\/[^@\s"']*@([^:\/\s"']+)/)
assert(m, '找不到 DATABASE_URL（格式 postgresql://帳號:密碼@主機:5432/資料庫）')
const alias = (b.match(/^\s+alias:\s*["']?([\w.-]+)/m) || [])[1]
const ok = ['postgres', alias].filter(Boolean)
assert(m[1] !== 'localhost' && m[1] !== '127.0.0.1', 'DATABASE_URL 還是連 localhost')
assert(ok.includes(m[1]), 'DATABASE_URL 的主機是 ' + m[1] + '，應該是 ' + ok.join(' 或 '))
` },
      { name: 'DATABASE_URL 的帳號、密碼、資料庫名稱與 POSTGRES_* 一致', code: JOB + String.raw`
const b = job('test')
const v = (k) => ((b.match(new RegExp('^\\s+' + k + ':\\s*["\']?([^"\'\\s]+)', 'm')) || [])[1])
const m = b.match(/DATABASE_URL:\s*["']?postgres(?:ql)?:\/\/([^:@\s]+):([^@\s]+)@[^\/\s"']+\/([\w-]+)/)
assert(m, '找不到完整的 DATABASE_URL')
assertEqual(m[1], v('POSTGRES_USER'), '帳號')
assertEqual(m[2], v('POSTGRES_PASSWORD'), '密碼')
assertEqual(m[3], v('POSTGRES_DB'), '資料庫名稱')
` },
      { name: '仍然執行 pytest', code: JOB + String.raw`
assert(/^\s+-\s+.*\bpytest\b/m.test(job('test')), 'script 裡沒有 pytest')
` },
    ],
  },
  {
    id: 'gitlab-cicd-2', skill: 'gitlab-cicd', kind: 'config', level: 2, file: '.gitlab-ci.yml',
    title: '把 image 推到 GitLab Container Registry',
    prompt: '`build-image` 有三個問題：registry 的密碼寫死在檔案裡、image 一律用 `latest`（無法對回 commit）、而且每個分支都會 build 並覆蓋正式用的 image。\n\n修改 `build-image`：\n\n- 用 GitLab 預定義的 `$CI_REGISTRY_USER`、`$CI_REGISTRY_PASSWORD` 登入 `$CI_REGISTRY`，密碼經由 `--password-stdin` 傳入\n- 檔案裡不能出現寫死的密碼（也不要用 `docker login -p`）\n- build 與 push 的 image 都是 `$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA`\n- 用 `rules` 讓這個 job 只在預設分支（`$CI_DEFAULT_BRANCH`）執行\n\n`test` job 不用改。',
    starter: `stages:
  - test
  - build

test:
  stage: test
  image: python:3.12-slim
  script:
    - pip install -r requirements.txt
    - pytest

build-image:
  stage: build
  image: docker:27
  services:
    - docker:27-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  script:
    - docker login -u admin -p 'Registry-2024!' registry.example.org
    - docker build -t registry.example.org/booking/web:latest .
    - docker push registry.example.org/booking/web:latest
`,
    solution: `stages:
  - test
  - build

test:
  stage: test
  image: python:3.12-slim
  script:
    - pip install -r requirements.txt
    - pytest

build-image:
  stage: build
  image: docker:27
  services:
    - docker:27-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
`,
    hints: [
      '`echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"`：密碼從標準輸入讀，不會出現在指令列。',
      '`rules:` 底下寫 `- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`；所有規則都不成立時，job 不會加入 pipeline。',
    ],
    tests: [
      { name: '用 CI_REGISTRY_USER / CI_REGISTRY_PASSWORD 經 --password-stdin 登入', code: JOB + String.raw`
const b = job('build-image')
assert(b, '找不到 build-image job')
const login = b.split('\n').find((l) => /docker login/.test(l)) || ''
assert(login, '沒有 docker login')
assert(/--password-stdin/.test(login), 'docker login 沒有用 --password-stdin')
assert(/\$\{?CI_REGISTRY_PASSWORD\}?[^|]*\|/.test(login), '密碼要用 $CI_REGISTRY_PASSWORD 經由管線傳給 docker login')
assert(/\$\{?CI_REGISTRY_USER\}?/.test(login), '帳號要用 $CI_REGISTRY_USER')
assert(/\$\{?CI_REGISTRY\}?["']?\s*$/.test(login), '登入的 registry 要是 $CI_REGISTRY')
` },
      { name: '檔案裡沒有寫死的密碼', code: String.raw`
assert(!/docker login[^\n]*\s(-p|--password)(\s|=)/.test(source), 'docker login 還在用 -p / --password 傳密碼')
assert(!/Registry-2024!/.test(source), '原本寫死的密碼還在檔案裡')
` },
      { name: 'build 與 push 都用 $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA', code: JOB + String.raw`
const b = job('build-image')
const tag = '\\$\\{?CI_REGISTRY_IMAGE\\}?:\\$\\{?CI_COMMIT_SHORT_SHA\\}?'
assert(new RegExp('docker build[^\\n]*-t\\s+["\']?' + tag).test(b), 'docker build 的 -t 不是 $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA')
assert(new RegExp('docker push\\s+["\']?' + tag).test(b), 'docker push 的 image 不是 $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA')
` },
      { name: 'build-image 只在預設分支執行', code: JOB + String.raw`
const b = job('build-image')
assert(/^\s+rules:/m.test(b), 'build-image 沒有 rules:')
assert(/-\s*if:\s*["']?\$CI_COMMIT_BRANCH\s*==\s*(\$CI_DEFAULT_BRANCH|["']main["'])/.test(b), 'rules 要判斷 $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')
assert(!/^\s+(only|except):/m.test(b), 'rules 不能和 only / except 混用')
` },
    ],
  },
  {
    id: 'gitlab-cicd-3', skill: 'gitlab-cicd', kind: 'config', level: 2, file: '.gitlab-ci.yml',
    title: '正式環境部署：只在 main、手動、不寫死機密',
    prompt: '這份檔案的 `deploy-production` 有幾個問題：部署用的 `DEPLOY_TOKEN` 寫死在檔案裡（會永遠留在 git 歷史中）、任何分支 push 都會自動部署到正式環境、GitLab 沒有記錄部署到哪個環境。\n\n修改成：\n\n- 刪掉檔案裡 `DEPLOY_TOKEN` 的值（改在專案設定建立 protected、masked 變數，這部分不在檔案裡），`script` 照樣使用 `$DEPLOY_TOKEN`\n- `deploy-production` 只在預設分支出現，而且要**手動**觸發（`when: manual`）\n- 加上 `environment`，名稱是 `production`\n- 加上 `resource_group`，避免兩次部署同時執行',
    starter: `stages:
  - build
  - deploy

variables:
  DEPLOY_TOKEN: "dpl-9f3k2l1m0n8b7v6c"

build-image:
  stage: build
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - echo "build and push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"

deploy-production:
  stage: deploy
  image: alpine:3.20
  script:
    - ./deploy.sh "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" "$DEPLOY_TOKEN"
`,
    solution: `stages:
  - build
  - deploy

# DEPLOY_TOKEN 在 Settings → CI/CD → Variables 建立（protected + masked），不寫在這裡

build-image:
  stage: build
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - echo "build and push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"

deploy-production:
  stage: deploy
  image: alpine:3.20
  needs: [build-image]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
  environment:
    name: production
    url: https://booking.example.org
  resource_group: production
  script:
    - ./deploy.sh "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" "$DEPLOY_TOKEN"
`,
    hints: [
      '`when: manual` 可以寫在 `rules` 的那一條規則底下：`- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` 下一行縮排寫 `when: manual`。',
      '`environment:` 可以直接寫 `environment: production`，或用 `name:` / `url:` 兩個子欄位。',
    ],
    tests: [
      { name: '檔案裡沒有 DEPLOY_TOKEN 的值', code: String.raw`
assert(!/^\s*DEPLOY_TOKEN:\s*\S/m.test(source), 'DEPLOY_TOKEN 還寫在 variables 裡')
assert(!/dpl-9f3k2l1m0n8b7v6c/.test(source), '原本的 token 還在檔案裡')
` },
      { name: 'script 仍使用 $DEPLOY_TOKEN', code: JOB + String.raw`
const b = job('deploy-production')
assert(b, '找不到 deploy-production job')
assert(/^\s+-\s+.*\$\{?DEPLOY_TOKEN\}?/m.test(b), 'deploy-production 的 script 沒有使用 $DEPLOY_TOKEN')
` },
      { name: '只在預設分支出現', code: JOB + String.raw`
const b = job('deploy-production')
assert(/^\s+rules:/m.test(b), 'deploy-production 沒有 rules:')
assert(/-\s*if:\s*["']?\$CI_COMMIT_BRANCH\s*==\s*(\$CI_DEFAULT_BRANCH|["']main["'])/.test(b), 'rules 要判斷 $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')
assert(!/^\s+(only|except):/m.test(b), 'rules 不能和 only / except 混用')
` },
      { name: '要手動觸發（when: manual）', code: JOB + String.raw`
assert(/^\s+when:\s*manual\s*$/m.test(job('deploy-production')), 'deploy-production 沒有 when: manual')
` },
      { name: 'environment 是 production', code: JOB + String.raw`
const b = job('deploy-production')
assert(/^\s+environment:\s*["']?production["']?\s*$/m.test(b) || /^\s+environment:\s*\n\s+name:\s*["']?production["']?\s*$/m.test(b), 'environment 的名稱要是 production')
` },
      { name: '有 resource_group', code: JOB + String.raw`
assert(/^\s+resource_group:\s*\S+/m.test(job('deploy-production')), 'deploy-production 沒有 resource_group')
` },
    ],
  },
]
