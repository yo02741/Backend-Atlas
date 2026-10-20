## 從一個具體問題開始：staging 驗過了，production 還是壞了

一個團隊的部署流程是這樣：合進 main 後，`deploy-staging` job 執行 `docker build` 再部署到 staging；QA 驗過之後，有人按下 `deploy-production`，它**再執行一次** `docker build`，部署到 production。

| 時間 | 發生什麼 |
|---|---|
| 週二 10:00 | staging 的 image 建好：基底 `python:3.12-slim` 當時的版本、`pip install` 解析出 `httpx 0.27.x` |
| 週二到週四 | QA 在 staging 測了三天，一切正常 |
| 週四 14:00 | 按下部署 production：重新 build。基底 image 已經更新，`requirements.txt` 沒有釘版本，裝到了較新的依賴 |
| 週四 14:10 | production 出現 staging 從沒見過的錯誤 |
| 週四 14:30 | 要回滾到「上一版」：上一版的 image 也是當時臨時 build 的，沒有保存 |

同一份程式碼、同一個 commit，build 了兩次就是兩個不同的東西。staging 的三天驗證，驗的是一個從來沒有上過 production 的 image。

同一個 workflow 裡還有另一個問題：production 資料庫密碼存在 repo 層級的 secret，任何分支的任何 job 都讀得到——包括某位同事為了除錯，在自己分支的 workflow 裡加的 `env | sort`。

這一課的兩個主題：**同一個 artifact 走過所有環境**，以及**設定與秘密由平台在需要的地方注入**。

## 環境與晉升

| 環境 | 用途 | 誰能部署 | 資料 |
|---|---|---|---|
| 本機／dev | 開發、除錯 | 開發者自己 | 假資料、測試資料 |
| 預覽環境（選配） | 每個 PR 一個臨時環境，給審查者實際操作 | CI 自動建立、PR 關閉時銷毀 | 種子資料 |
| staging | 正式部署前的最後驗證：遷移、設定、整合 | CI 在合進 main 後自動部署 | 去識別化或合成資料，**不是** production 的複本 |
| production | 服務真實使用者 | 經過核准的部署流程 | 真實資料 |

staging 的價值取決於它跟 production **有多像**：同樣的 image、同樣的部署方式、同樣大版本的資料庫、同樣的設定結構（值不同）。差異越多，「staging 沒問題」能代表的就越少。

**晉升（promotion）**的意思是：build 一次，把同一個 artifact 依序部署到各環境，每個環境只換設定。

```text
commit 8d1e7f4
   │
   ▼
 build ──► ghcr.io/example-org/shop-api@sha256:4b1c…（只 build 這一次）
   │
   ├──► staging     同一個 digest ＋ staging 的設定與秘密
   │       │ 驗證通過
   │       ▼
   └──► production  同一個 digest ＋ production 的設定與秘密（需要核准）
```

### tag 會變、digest 不會

`shop-api:8d1e7f4` 這種 tag 是一個**可以移動的名字**：任何有寫入權限的人都可以把它指到另一個 image。image 的 **digest**（`sha256:…`）是內容的雜湊，內容不同 digest 就不同。

- build 時用 commit SHA 當 tag，方便人看。
- 部署時用 digest（`image@sha256:…`）指定，確保 staging 和 production 跑的是位元組完全相同的東西。
- 回滾就是把上一個 digest 再部署一次。registry 的清理政策要保留最近幾個部署過的版本。

### job 之間怎麼傳

CI 的每個 job 通常在全新的機器或容器裡執行，**不共享檔案系統**。build job 產生的東西要靠以下方式傳給後面的 job：

- **registry**：image 本身推到 registry，後面的 job 用 digest 拉取。
- **job outputs**：短字串（例如 digest）用 GitHub Actions 的 `outputs` 傳；GitLab 可以把值寫進檔案，用 `artifacts: reports: dotenv:` 傳給後面的 job。
- **artifact**：測試報告、覆蓋率、建置出來的靜態檔。cache 不能拿來傳，它不保證存在。

## 完整範例：GitHub Actions 晉升流程

```yaml
# .github/workflows/deploy.yml
name: deploy
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
      image: ghcr.io/example-org/shop-api@${{ steps.push.outputs.digest }}   # 用 digest 傳給後面的 job
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: push
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/example-org/shop-api:${{ github.sha }}

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging                       # 綁定環境：拿得到 staging 的 secrets、留下部署紀錄
    steps:
      - run: ./scripts/deploy.sh "${{ needs.build.outputs.image }}"
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}   # staging 環境的 secret
      - run: ./scripts/smoke-test.sh https://staging.example.org

  deploy-production:
    needs: [build, deploy-staging]             # staging 成功才輪到 production
    runs-on: ubuntu-latest
    environment:
      name: production                         # 在 Settings → Environments 設定 required reviewers
      url: https://shop.example.org
    concurrency: production                    # 同一時間只有一個 production 部署
    steps:
      - run: ./scripts/deploy.sh "${{ needs.build.outputs.image }}"   # 和 staging 同一個 digest
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}   # 同名，但取的是 production 環境的值
```

兩個 deploy job 都沒有 `docker build`，image 都來自 `needs.build.outputs.image`。`DATABASE_URL` 在兩個 job 裡寫法一樣，值不同：job 綁了哪個 environment，就拿到那個環境的 secret。

### environment 的保護規則

GitHub 的 environment 在 Settings → Environments 設定，可以加上：

| 規則 | 效果 |
|---|---|
| Required reviewers | job 執行前停下來，等指定的人核准 |
| Wait timer | 延遲一段時間才執行 |
| Deployment branches and tags | 只有指定的分支或 tag 能部署到這個環境 |
| Environment secrets 與 variables | 只有綁定這個環境的 job 拿得到 |

這些規則寫在平台設定裡，YAML 只負責宣告 `environment: production`。**沒寫 `environment:` 的 job 不受這些規則約束**，也拿不到環境層級的 secret。私有 repo 能不能用 required reviewers 依方案而定，以官方文件為準。

GitLab 的對應做法：job 加 `environment: name: production`、`when: manual` 讓部署需要有人按下；變數可以設定 environment scope，只注入特定環境的 job；protected 變數只給受保護分支。見 [GitLab CI/CD](#/skill/gitlab-cicd)。

## 設定與秘密：注入，不寫死

同一個 image 能跑在不同環境，前提是**環境之間不同的東西都不在 image 裡**。這是 [環境設定與 12-factor](#/skill/config-12factor)。分三層：

| 層 | 例子 | 放在哪裡 |
|---|---|---|
| 程式內預設值 | 分頁大小、逾時的預設值 | 程式碼（不是機密、各環境都一樣時） |
| 環境設定 | 對外網址、log 等級、feature flag | CI 的 variables、部署平台的設定 |
| 秘密 | 資料庫密碼、第三方 API key、簽章金鑰 | CI 的 secrets、秘密管理服務（Vault、雲端的 Secrets Manager） |

應用程式啟動時讀取設定，**缺少必要的值就立刻失敗**，不要帶著空字串跑起來，等第一個請求才出錯：

```python run
import os

REQUIRED = ["DATABASE_URL", "SESSION_SECRET"]
SECRET_KEYS = {"DATABASE_URL", "SESSION_SECRET", "PAYMENT_API_KEY"}

def load_settings(env: dict) -> dict:
    missing = [k for k in REQUIRED if not env.get(k)]
    if missing:
        # 啟動就失敗：部署的 readiness 不會通過，舊版本繼續服務
        raise RuntimeError(f"缺少必要設定：{', '.join(missing)}")
    return {
        "database_url": env["DATABASE_URL"],
        "session_secret": env["SESSION_SECRET"],
        "log_level": env.get("LOG_LEVEL", "INFO"),
        "public_url": env.get("PUBLIC_URL", "http://localhost:8000"),
    }

def describe(env: dict) -> dict:
    # 印設定除錯時，秘密只顯示「有沒有設」，不顯示值
    return {k: ("<已設定>" if k in SECRET_KEYS else v) for k, v in env.items()}

staging = {"DATABASE_URL": "postgresql://app:xxx@db-staging/app", "SESSION_SECRET": "s3", "LOG_LEVEL": "DEBUG"}
production = {"DATABASE_URL": "postgresql://app:yyy@db-prod/app", "LOG_LEVEL": "INFO"}

print("staging:", describe(staging))
print("staging 設定載入：", load_settings(staging)["log_level"])
try:
    load_settings(production)
except RuntimeError as e:
    print("production：", e)

# 真正的程式從 os.environ 讀；這裡用 dict 方便示範
print("目前程序有沒有 DATABASE_URL：", "DATABASE_URL" in os.environ)
```

### CI 裡的秘密

- **只注入需要的 job、需要的 step**：上面的範例把 `DATABASE_URL` 寫在 step 的 `env`，而不是整個 workflow 的 `env`。
- **遮蔽不是防線**：平台會把已知的 secret 值在 log 裡換成 `***`，但經過編碼（base64）或切片後的值不會被遮蔽。GitHub 文件也建議不要把 JSON 這類結構化資料存成單一 secret，因為遮蔽可能失效。
- **fork 來的 PR 拿不到 secret**：GitHub 對 fork 觸發的 `pull_request` 不提供 secrets（`GITHUB_TOKEN` 也是唯讀）。為了繞過這點改用 `pull_request_target` 並 checkout PR 的程式碼，等於讓陌生人的程式碼在有秘密的環境裡執行，是已知的高風險寫法。
- **protected 是真正的防線**：GitLab 的 protected 變數、GitHub 的 environment secrets 加上分支限制，確保只有審查過、合進受保護分支的程式碼拿得到 production 的秘密。
- 秘密的輪替、撤銷與存放方式見 [秘密管理](#/skill/secrets)。

## OIDC：不存長期金鑰

部署到雲端時，傳統做法是建一組雲端帳號的長期 access key，存進 CI 的 secret。這組金鑰不會過期，外洩了要等到有人發現才會撤銷。

**OIDC（OpenID Connect）**的做法是不存金鑰：

1. job 執行時，向 CI 平台要一個 **ID token**（JWT），裡面的 claims 描述這個 job：哪個 repo、哪個分支、哪個環境。
2. job 把 ID token 交給雲端的 STS（安全權杖服務）。
3. 雲端事先設定好「信任這個發行者（issuer），而且 claims 符合條件才給」，驗證簽章與 claims 後，發一組**幾十分鐘到一小時就過期**的臨時憑證。
4. job 用臨時憑證部署。job 結束後，憑證很快自己失效。

GitHub Actions 的 ID token，`sub` claim 依情境有不同的格式：

| 情境 | `sub` 的樣子 |
|---|---|
| job 綁了 environment | `repo:example-org/shop-api:environment:production` |
| 分支上的 push | `repo:example-org/shop-api:ref:refs/heads/main` |
| pull request | `repo:example-org/shop-api:pull_request` |

雲端這一側的信任條件（AWS IAM role 的 trust policy 片段）：

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:example-org/shop-api:environment:production"
    }
  }
}
```

workflow 這一側：

```yaml
deploy-production:
  environment: production
  permissions:
    id-token: write          # 允許這個 job 向 GitHub 要 ID token
    contents: read
  steps:
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: arn:aws:iam::111122223333:role/shop-api-deploy-prod
        aws-region: ap-northeast-1
    - run: ./scripts/deploy.sh "${{ needs.build.outputs.image }}"
```

GitLab 用 `id_tokens:` 關鍵字取得 ID token（可以指定 `aud`），`sub` 的格式是 `project_path:<群組>/<專案>:ref_type:branch:ref:main` 這類。

OIDC 最容易出錯的地方在**信任條件太寬**。下面模擬雲端那一側的判斷：

```python run
import fnmatch

def allowed(claims: dict, cond: dict) -> bool:
    # 每個條件都要成立；值裡的 * 當成萬用字元（類似 StringLike）
    return all(fnmatch.fnmatchcase(claims.get(k, ""), pattern) for k, pattern in cond.items())

strict = {"aud": "sts.amazonaws.com", "sub": "repo:example-org/shop-api:environment:production"}
loose  = {"aud": "sts.amazonaws.com", "sub": "repo:example-org/*"}

tokens = {
    "production 部署 job": {"aud": "sts.amazonaws.com", "sub": "repo:example-org/shop-api:environment:production"},
    "某個功能分支的 job":  {"aud": "sts.amazonaws.com", "sub": "repo:example-org/shop-api:ref:refs/heads/try-something"},
    "組織裡另一個 repo":   {"aud": "sts.amazonaws.com", "sub": "repo:example-org/intern-sandbox:ref:refs/heads/main"},
}
for name, claims in tokens.items():
    print(f"{name:<14} 嚴格條件：{allowed(claims, strict)!s:<5}  寬鬆條件：{allowed(claims, loose)}")
```

寬鬆條件下，組織裡任何 repo 的任何分支都能拿到 production 的權限。條件要釘到 repo 與 environment（或受保護的分支），而 environment 本身再加上核准與分支限制。

## 環境的資料與存取控管

- **staging 不放 production 的真實資料**：複製正式資料到測試環境，等於把個資的存取範圍擴大到所有能進 staging 的人。需要接近真實的資料量與分佈時，用去識別化或合成資料。見 [資料治理](#/skill/data-governance)。
- **環境之間網路隔離、帳號分開**：staging 的憑證連不到 production 的資料庫。常見做法是不同環境用不同的雲端帳號或專案。
- **人對 production 的存取最小化**：日常部署走 CI；人直接連 production 是例外，要有申請、時限與稽核紀錄。
- **部署要能追溯**：每次部署記錄 commit、digest、誰核准、什麼時候、部署到哪。GitHub 與 GitLab 的 environment 頁面會保留這份歷史。出事時第一個問題通常是「上一次改了什麼」。

## 常見錯誤與錯誤訊息

| 現象／訊息 | 原因 | 怎麼處理 |
|---|---|---|
| secret 在 job 裡是空字串 | job 沒有 `environment:`，拿不到環境層級的 secret；或是 fork 的 PR | 在 job 綁定 environment；fork PR 本來就不該拿到 |
| `Could not assume role with OIDC` 之類的錯誤，或 STS 回 `Not authorized to perform sts:AssumeRoleWithWebIdentity` | trust policy 的 `sub`／`aud` 跟實際 token 不符，例如 job 綁了 environment，`sub` 就變成 environment 格式 | 對照實際的 `sub` 格式調整條件，不要用萬用字元放寬 |
| 要求 ID token 時失敗，提示缺少 `ACTIONS_ID_TOKEN_REQUEST_URL` 之類的環境變數 | job 沒有 `permissions: id-token: write` | 在需要的 job 加上 |
| `manifest unknown` | 部署用的 tag 或 digest 在 registry 裡不存在（被清理政策刪掉、或打錯） | 清理政策保留最近部署過的版本；部署用 build job 輸出的 digest |
| production 的行為和 staging 不同 | 每個環境各自 build；或設定不只是值不同，而是結構不同（某個 flag 只在 production 有設） | 只 build 一次；各環境的設定項目一致，只有值不同 |

## 動手

1. 執行設定載入那段，把 production 補上 `SESSION_SECRET`，再加一個 `PAYMENT_API_KEY` 看 `describe` 怎麼顯示它。
2. 執行 OIDC 那段，把寬鬆條件改成 `repo:example-org/shop-api:*`，看看哪些 token 還會通過，想想功能分支能不能拿到 production 權限。
3. 到本課的程式題：把一份「每個環境重新 build、密碼寫死、production 沒綁環境」的 workflow 改成同一個 image 一路晉升。
4. 到 [CI/CD 管線實驗室](#/lab/PipelineLab) 看 staging 與 production 兩個部署階段的條件與核准。
