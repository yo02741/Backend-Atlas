## 從一個具體問題開始：刪掉了，但還在

開發者為了測試，把雲端存取金鑰寫進 `settings.py`，推上了 GitHub 的公開 repo。十分鐘後發現，馬上再推一個 commit 把那兩行刪掉。

這時金鑰仍然在：

- **git 歷史**：`git log -p` 看得到那個 commit 的 diff，任何 clone 過的人都有完整歷史。
- **託管平台**：fork、pull request 的頁面、平台的快取都可能保留那個 commit。
- **已經被別人拿走**：公開 repo 會被自動化工具持續掃描，金鑰推上去之後可能在很短時間內就被抓到並開始使用。

刪掉那兩行不會讓金鑰失效。唯一有效的處理是**到發行金鑰的地方撤銷它**，換一把新的。改寫 git 歷史（`git filter-repo` 之類）只是避免之後的人再看到，不能讓已經流出去的那份消失。

同一個專案還有其他沒那麼明顯的外洩點：`Dockerfile` 裡 `COPY . .` 把本機的 `.env` 打包進 image；CI 的除錯步驟 `env` 把所有環境變數印進 log；前端用 `VITE_API_SECRET` 傳金鑰，結果被打包進公開的 JavaScript。

## 運作原理

### 秘密的種類

| 種類 | 例子 | 外洩的後果 | 輪替難度 |
|---|---|---|---|
| 資料庫帳密 | 連線字串裡的密碼 | 直接讀寫資料 | 中：要協調所有連線的服務 |
| 第三方 API key | 金流、寄信、地圖、LLM 服務 | 盜用額度、冒名操作 | 低到中：多數服務允許同時有兩把 |
| 雲端憑證 | access key、service account 金鑰檔 | 依權限而定，可能是整個雲端帳號 | 中 |
| 簽章金鑰 | JWT 簽章金鑰、session secret、webhook secret | 偽造任何人的身分或事件 | 高：換掉時所有既有 token 失效，要設計過渡期 |
| 加密金鑰 | 欄位加密用的資料金鑰、主金鑰 | 已加密的資料全部可解 | 高：要重新加密或重新包裝 |
| 私鑰與憑證 | TLS 私鑰、SSH key、程式碼簽章金鑰 | 冒充伺服器、登入主機、簽出惡意版本 | 中到高 |
| OAuth client secret | 第三方登入的應用程式密鑰 | 冒充你的應用程式 | 中 |

### 外洩的途徑

| 途徑 | 怎麼發生 | 防法 |
|---|---|---|
| git | 寫死在程式碼、`.env` 沒進 `.gitignore`、測試資料夾裡的真實設定 | `.gitignore`、pre-commit 掃描、平台的 push protection |
| 容器映像 | `COPY .env`、`ARG`／`ENV` 傳秘密（會留在層的中繼資料或 `docker history` 裡） | `.dockerignore`；build 時需要的秘密用 BuildKit 的 secret mount（見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)） |
| 日誌 | 印出設定物件、例外訊息含連線字串、CI 步驟印出環境變數 | 日誌欄位白名單與遮罩（見 [日誌與稽核紀錄裡的個資](#/skill/logs-pii)） |
| 前端打包 | Vite 的 `VITE_` 前綴、Next.js 的 `NEXT_PUBLIC_` 前綴變數會被打包進給瀏覽器的程式碼 | 前端只放公開的值；需要秘密的呼叫一律經過後端 |
| 錯誤頁 | 正式環境開著 debug 模式，錯誤頁列出設定與環境變數 | 正式環境關閉 debug |
| 共享管道 | 在聊天軟體、工單、文件裡貼秘密 | 用秘密管理服務的分享功能或一次性連結 |

### 環境變數的侷限

12-factor 建議用環境變數傳設定（見 [環境設定與 12-factor](#/skill/config-12factor)），它比寫死在程式碼好很多，但不是秘密管理：

- 同一個行程啟動的子行程會繼承全部環境變數，包括不需要它的工具。
- 有權限的人可以從 `/proc/<pid>/environ`、`docker inspect`、Kubernetes 的 Pod 定義讀到。
- 錯誤回報工具、除錯頁面常常會收集環境變數。
- 沒有稽核（誰讀過）、沒有版本、沒有到期，也沒辦法不重啟就換值。

所以環境變數適合當**最後一哩**：由部署平台或秘密管理服務在啟動時注入，而秘密的正本存在別處。

### 秘密管理服務

| 選項 | 特性 |
|---|---|
| HashiCorp Vault（或 OpenBao） | 自架；支援動態秘密（每次申請產生一組有期限的資料庫帳密）、租約、細緻的政策與稽核 |
| 雲端 Secret Manager（AWS Secrets Manager、GCP Secret Manager、Azure Key Vault） | 託管；用雲端 IAM 控制誰能讀；有版本與存取紀錄，部分支援自動輪替 |
| 雲端 KMS | 管的是加密金鑰本身，金鑰不離開服務，只提供加密、解密、簽章的 API |
| SOPS 加密檔 | 秘密加密後放進 git，解密金鑰在 KMS 或 age 金鑰；適合 GitOps |
| Kubernetes Secret | **預設只是 base64 編碼**，不是加密。要另外設定 etcd 的靜態加密、用 RBAC 限制誰能讀 Secret，或用 External Secrets Operator 從外部服務同步 |

Kubernetes Secret 的 base64 只是為了能存二進位資料。`kubectl get secret db -o yaml` 拿到的值，`base64 -d` 就是明文；能讀 Secret 的人、能在該 namespace 建 Pod 的人（把 Secret 掛進去再印出來），都能拿到秘密。

### 輪替

任何秘密都假設有一天會外洩。能輪替代表：

1. **知道誰在用**：每把秘密有負責人與使用者清單；秘密管理服務的存取紀錄可以回答「誰讀過」。
2. **能不停機替換**：新舊兩把同時有效一段時間。資料庫可以準備兩個帳號輪流換密碼；JWT 用 `kid` 標頭標示金鑰版本，驗證端同時接受新舊兩把，簽發端換成新的，等舊 token 過期再移除舊金鑰。
3. **定期演練**：從沒換過的秘密，真的外洩時通常換不動。設定到期日，讓輪替成為例行工作。

### 最小權限

秘密的危害等於它的權限。API 服務用的資料庫帳號不需要 `DROP`；只讀取 bucket 的服務不需要寫入權限；每個服務各自一組憑證，不共用一把萬用金鑰。這樣一把秘密外洩時，損害有範圍，也能從存取紀錄看出是哪個服務出事。

### CI 的秘密與 OIDC

CI 平台都有秘密功能（GitHub Actions 的 secrets、GitLab 的 CI/CD variables 搭配 masked 與 protected）。幾個重點：

- log 的遮罩只對完整字串有效；秘密經過 base64、URL encoding 或被切成片段印出時，遮罩就失效。不要印出來。
- GitHub Actions 中，來自 fork 的 `pull_request` 事件預設拿不到 repo 的 secrets；`pull_request_target` 在基底 repo 的權限下執行，若同時 checkout 並執行 PR 的程式碼，等於把 secrets 交給 PR 作者。
- **OIDC 取代長期金鑰**：CI 工作向平台申請一個短效的 OIDC token，裡面帶著 repo、分支、環境等聲明；雲端服務設定信任規則（例如只信任某個 repo 的 `main` 分支），用它換到幾分鐘到一小時有效的雲端憑證。CI 裡不再存任何長期的雲端金鑰。

```yaml
# GitHub Actions：用 OIDC 換雲端短效憑證（雲端端的信任設定另外做）
permissions:
  id-token: write      # 允許這個 job 申請 OIDC token
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production     # 搭配環境保護規則：需要核准才能拿到這個環境的權限
    steps:
      - uses: actions/checkout@<commit-sha>
      # 雲端供應商提供的登入 action 用 OIDC token 換短效憑證；不需要 secrets.CLOUD_KEY
```

CI 的秘密與環境分層見 [環境、secrets 與 artifact](#/skill/environments-secrets)。

### 外洩了怎麼辦

順序很重要：

1. **撤銷並輪替**：先讓那把秘密失效，換上新的。這一步優先於一切。
2. **查使用紀錄**：從秘密管理服務、雲端稽核日誌、第三方服務的後台，看外洩期間有沒有異常使用。
3. **評估影響範圍**：那把秘密能做什麼、碰得到哪些資料；若涉及個資，依法規與公司流程通報。
4. **清理來源**：從 git 歷史移除、重 build 有問題的 image、刪除含秘密的 log。
5. **補上防線**：加掃描、改用 OIDC、縮小權限，讓同樣的事不再發生。

## 實際程式：簡單的秘密掃描

正式專案用 gitleaks、trufflehog 這類工具，或平台內建的秘密掃描。它們的核心是兩種技巧：**已知格式的正規表示式**（很多服務的金鑰有固定前綴）與**熵**（隨機字串的字元分布很平均）。下面用標準函式庫寫一個簡化版。範例裡的假金鑰在執行時才組出來，避免這個檔案本身被掃描工具標記。

```python run
import re, math
from collections import Counter

# 測試用的「檔案內容」：假值在執行時組合
fake_aws = "AKIA" + "IOSFODNN7EXAMPLE"                       # AWS 文件裡的範例格式
fake_gh = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
files = {
    "settings.py": f'DEBUG = False\nAWS_ACCESS_KEY_ID = "{fake_aws}"\nTIMEOUT = 30\n',
    "deploy.sh": f'curl -H "Authorization: token {fake_gh}" https://api.github.com/user\n',
    "config.yaml": 'db:\n  password: "Zq8#vT2mLp9!xR4w"\n  host: db.internal\n',
    "README.md": 'Set API_KEY=your-key-here before running.\nVersion: 1.2.3\n',
    "app.js": 'const id = "550e8400-e29b-41d4-a716-446655440000"\n',
}

RULES = [
    ("aws-access-key-id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github-token",      re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("private-key",       re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]
# 通用規則：key 名稱像秘密、值夠長
ASSIGN = re.compile(r"""(?i)\b([a-z_]*(?:secret|password|passwd|token|api_?key)[a-z_]*)\s*[:=]\s*["']?([^\s"']{8,})""")
PLACEHOLDER = re.compile(r"(?i)your|example|changeme|xxx|<.*>|\$\{")

def entropy(s: str) -> float:
    # Shannon 熵：每個字元平均攜帶幾 bits 的資訊；隨機字串高、英文單字低
    n = len(s)
    return abs(-sum(c / n * math.log2(c / n) for c in Counter(s).values()))   # abs：避免印出 -0.00

findings = []
for path, text in files.items():
    for lineno, line in enumerate(text.splitlines(), 1):
        for name, rx in RULES:
            for m in rx.finditer(line):
                findings.append((path, lineno, name, m.group(0)))
        for m in ASSIGN.finditer(line):
            key, value = m.group(1), m.group(2)
            if PLACEHOLDER.search(value):
                continue                       # 明顯是佔位字，略過
            h = entropy(value)
            if h >= 3.0:
                findings.append((path, lineno, f"generic:{key} (熵 {h:.2f})", value))

def mask(v):
    return v[:4] + "…" + v[-2:] if len(v) > 8 else "****"

for path, lineno, rule, value in findings:
    print(f"{path}:{lineno:<3} {rule:32} {mask(value)}")

print("\n熵的直覺：")
for s in ["password", "aaaaaaaaaaaa", "Zq8#vT2mLp9!xR4w", "550e8400-e29b-41d4-a716-446655440000"]:
    print(f"  {s:40} {entropy(s):.2f} bits/字元")
```

觀察結果：UUID 的熵也不低，但它不在「看起來像秘密」的 key 後面，所以沒被通用規則抓到；`API_KEY=your-key-here` 被佔位字規則排除。真實的掃描器有數百條服務專屬規則、允許清單與基準檔（baseline），誤報與漏報之間的取捨是調整的重點。

本機與 CI 的掃描（概念示意，實際指令與參數以各工具文件為準）：

```bash
# 找出歷史中曾經出現某個字串的 commit
git log -p -S 'AKIA' --all

# pre-commit：提交前掃描暫存區的變更；CI：每次 push 掃描新增的 commit
# 平台功能：GitHub 的 secret scanning 與 push protection 會在推送時擋下已知格式的金鑰
```

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| 發現金鑰進了 git，只改歷史不輪替 | 已經被複製的那份仍然有效 | 先撤銷輪替，再清歷史 |
| `.env.example` 放了真實值當「範例」 | 範例檔一定會進 git | 範例檔只放 key 與明顯的假值 |
| `ENV DB_PASSWORD=…` 或 `ARG` 傳秘密給 `docker build` | `docker history`、image 中繼資料看得到 | BuildKit secret mount；runtime 由平台注入 |
| 以為 Kubernetes Secret 是加密的 | 能讀 Secret 或能建 Pod 的人都拿得到明文 | 設定 etcd 加密與 RBAC；用外部秘密管理同步 |
| 所有服務共用一把高權限 API key | 任何一個服務出事都是全面外洩；不知道是誰在用 | 每個服務一把、權限最小、可以個別撤銷 |
| CI 裡存長期雲端金鑰 | 金鑰被印出、被惡意 PR 取得時長期有效 | OIDC 換短效憑證，信任規則限定 repo 與分支 |
| 簽章金鑰沒有版本 | 換金鑰時所有使用者被登出 | `kid` 標頭，新舊金鑰並存一段時間 |
| 從不輪替 | 真的需要換時沒人知道怎麼換、誰在用 | 設定到期日，把輪替做成例行程序 |

## 動手

1. 執行掃描程式，在 `files` 加一個 `id_rsa` 檔，內容第一行是 `-----BEGIN OPENSSH PRIVATE KEY-----`，確認被 `private-key` 規則抓到。
2. 把熵的門檻從 3.0 改成 4.0，看哪些結果消失；再加一個 `"token = 'aaaaaaaaaaaa'"` 的行，觀察低熵值為什麼不會被報出來。
3. 為自己的專案列一張表：每把秘密是什麼、存在哪、誰在用、權限多大、上次輪替是什麼時候、怎麼換。
4. 檢查專案的前端建置設定，確認沒有任何以 `VITE_`、`NEXT_PUBLIC_` 開頭的變數裝著秘密。
5. agent 與 CLI 工具的 token 存放見 [CLI 與 Agent 的 token 存哪裡](#/skill/cli-token-storage)；權限範圍與有效期限的設計見 [金鑰的範圍與壽命](#/skill/key-scope-lifetime)。
