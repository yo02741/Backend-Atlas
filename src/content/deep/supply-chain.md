## 從一個具體問題開始：沒有人改過程式碼，CI 卻送出了環境變數

週一早上的 CI 和上週五跑的是同一個 commit，沒有人改過任何一行程式碼。但這次的建置多了一個對外連線：某個間接依賴（依賴的依賴）在週末發布了新的 patch 版本，安裝腳本會讀取環境變數並送到外部伺服器。專案的依賴宣告寫的是 `^2.1.0`，沒有 lock 檔，CI 每次都重新解析版本，於是自動裝到了新版。CI 的環境變數裡有部署用的雲端金鑰。

這不是假設情境的極端版本。公開紀錄過的事件包括：

- **event-stream（2018）**：熱門 npm 套件的維護權被轉交給陌生人，新維護者加入一個惡意的依賴，目標是特定的加密貨幣錢包應用程式。
- **ua-parser-js（2021）**：維護者的 npm 帳號被盜，攻擊者發布了夾帶挖礦程式與竊密程式的版本。
- **xz-utils（2024，CVE-2024-3094）**：攻擊者花了很長時間成為共同維護者，在發布的原始碼壓縮檔裡植入後門，被一位工程師因為 SSH 登入變慢而發現。

專案自己寫的程式碼通常只佔最終執行內容的一小部分，其餘來自套件、base image、CI 的第三方 action、建置工具。它們都在你的信任範圍內執行，擁有和你的程式一樣的權限。

## 運作原理：風險從哪裡來

| 風險 | 怎麼發生 | 主要對策 |
|---|---|---|
| 已知漏洞 | 依賴的某個版本有公開的 CVE | 漏洞掃描、定期更新 |
| 惡意套件 | 一開始就是惡意的套件，靠假名稱或假描述吸引安裝 | 新增依賴前審查、內部鏡像或允許清單 |
| typosquatting | 名稱和熱門套件差一個字元（`reqeusts`、`python-dateutils`） | 審查新依賴的名稱與來源、lock 檔 |
| dependency confusion | 內部套件名稱在公開套件庫被搶註，安裝工具優先選了公開的高版本 | 內部套件用私有命名空間（npm scope）、安裝工具設定只從指定來源取特定名稱 |
| 維護者帳號被接管 | 合法套件被發布惡意的新版本 | lock 檔固定版本與雜湊、延遲採用新版本、來源證明 |
| 維護者本身變成攻擊者 | 長期潛伏後植入後門，或維護者破壞自己的套件 | 很難完全防；降低依賴數量、最小權限的執行環境、異常行為偵測 |
| 安裝時執行的程式 | npm 的 `postinstall`、Python 的 sdist 建置（`setup.py`） | 優先用 wheel；npm 可用 `--ignore-scripts` 再個別允許 |
| 建置過程被竄改 | CI 環境、建置工具被入侵，產物和原始碼不一致 | 可重現建置、來源證明（provenance）、簽章 |
| base image 與 CI action | image 裡的系統套件有漏洞；第三方 action 的 tag 被移到惡意 commit | image 掃描與定期重建；action 釘 commit SHA |

可以把它分成兩個問題：**我裝的是不是我以為的東西**（完整性、來源）與**我以為的東西本身有沒有問題**（漏洞、惡意）。lock 檔與簽章回答前者，掃描與審查回答後者。

### lock 檔與雜湊驗證

依賴宣告（`pyproject.toml`、`package.json`）寫的是**範圍**：`requests>=2.31`、`^2.1.0`。每次解析都可能得到不同的版本。lock 檔記錄的是解析結果：每個套件（包含間接依賴）的**確切版本**與**檔案雜湊**。

| 生態 | lock 檔 | CI 用的安裝方式 |
|---|---|---|
| uv | `uv.lock` | `uv sync --locked`：lock 檔和 `pyproject.toml` 不一致就失敗 |
| pip | `requirements.txt`（含 `--hash=sha256:…`，可用 `pip-compile --generate-hashes` 或 `uv pip compile --generate-hashes` 產生） | `pip install --require-hashes -r requirements.txt` |
| npm | `package-lock.json` | `npm ci`：照 lock 檔安裝，和 `package.json` 不一致就失敗 |
| pnpm | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |

雜湊驗證的意思：安裝工具下載檔案後算 SHA-256，和 lock 檔記錄的值比對，不符就拒絕安裝。套件庫上同一個版本的檔案若被替換，或下載過程被竄改，都會被擋下。lock 檔本身要進版控，它的變更要在 PR 裡被審查（工具產生的大量 diff 很容易被略過）。

lock 檔防的是「之後裝到不一樣的東西」，**不防第一次就鎖進惡意版本**。新增或升級依賴的那一刻才是審查點。

### 漏洞掃描

掃描工具拿 lock 檔裡的套件與版本，去比對漏洞資料庫：

- **OSV**（osv.dev）：開源漏洞資料庫，彙整 GitHub Advisory、PyPA、RustSec 等來源，格式統一、可用 API 查詢；`osv-scanner` 可以直接掃 lock 檔。
- **pip-audit**：掃 Python 環境或 requirements 檔，資料來源可選 PyPI 或 OSV。
- **npm audit**：查 npm 的漏洞資料庫，內建在 npm。
- **Trivy、Grype**：掃容器映像，包含系統套件與語言套件。

掃描結果要判斷，不是看到就全部升級：漏洞所在的函式有沒有被用到、是否只影響開發依賴、修正版本有沒有破壞性變更。CI 的做法通常是「高風險且有修正版本」時讓建置失敗，其他的產生報告定期處理。

### SBOM

**SBOM**（Software Bill of Materials，軟體物料清單）是一份機器可讀的清單：這個產物（image、執行檔）裡有哪些元件、什麼版本、從哪裡來、授權是什麼。兩種主要格式：

| 格式 | 維護者 | 特色 |
|---|---|---|
| SPDX | Linux Foundation | 起源於授權合規，已成為 ISO/IEC 標準 |
| CycloneDX | OWASP | 偏重安全用途，也能描述服務、漏洞可利用性（VEX） |

SBOM 的價值在於事後查詢：下一個重大漏洞公布時，不用逐一檢查每個服務，直接搜尋所有 SBOM 就知道哪些產物受影響。它應該在建置時由工具自動產生（例如 Syft、Trivy 都能輸出這兩種格式），和產物一起保存。

### 簽章與來源證明

lock 檔的雜湊證明「這個檔案和當初鎖定的一樣」，不能證明「這個檔案是從那份原始碼、用那個流程建出來的」。這是簽章與來源證明要回答的問題（以下是概念層次的說明）：

- **Sigstore**：一組開源的簽章基礎設施。`cosign` 對容器映像等產物簽章；可以用 CI 的 OIDC 身分做「keyless」簽章，不需要長期保管私鑰；簽章紀錄寫進公開的透明日誌（Rekor），事後可查。
- **來源證明（provenance）**：一份經過簽章的聲明，說明產物是由哪個 repo、哪個 commit、哪個建置系統產生的。npm 的 `--provenance` 發布、PyPI 的 trusted publishing 搭配數位證明（attestations），都是這類機制的應用。
- **SLSA**（Supply-chain Levels for Software Artifacts）：一個分級框架，描述建置流程要做到什麼程度（例如有來源證明、在受保護的建置平台上執行、建置過程難以被竄改），讓「供應鏈安全做到哪裡」有共同的語言。

部署端的對應動作是**驗證**：只部署有合法簽章、來源證明指向自己 repo 的 image。Kubernetes 可以用 admission controller 落實這條規則。

### 容器映像與 CI action

- `FROM python:3.12-slim` 的 tag 會被重新指向新的 image。需要可重現時釘 digest：`FROM python:3.12-slim@sha256:…`，並用 Dependabot 或 Renovate 自動提出更新 digest 的 PR。
- base image 越小，系統套件越少，漏洞也越少：slim、distroless。
- 定期重建 image，即使程式碼沒變：系統套件的修補要重建才會進來。
- GitHub Actions 的第三方 action 用完整的 commit SHA 釘住（`uses: owner/action@<40 字元 SHA>`），tag 可以被移動；workflow 設定最小的 `permissions:`。

### 更新策略

不更新會累積漏洞，更新太快會第一時間裝到被接管的惡意版本。常見的平衡：

- **自動化提出更新**：Dependabot、Renovate 定期開 PR，CI 跑完測試再合併。
- **延遲採用**：新版本發布後等幾天再採用，惡意版本通常在這段時間內被發現並下架。Renovate 有 `minimumReleaseAge` 設定；uv 有 `--exclude-newer` 可以排除某個時間點之後發布的版本。
- **安全更新例外**：有已知漏洞的修正版本走快速通道。
- **分組**：同一生態的小版本更新合併成一個 PR，減少審查疲勞。
- **減少依賴**：一個只用到一個函式的套件，考慮自己寫幾行取代。每個依賴都是一個信任關係。

### 新增依賴前的審查

- 名稱拼寫正確，是你要的那個專案（從官方文件連過去，不從搜尋結果複製）。
- 維護狀態：最近有沒有發布、issue 有沒有人回應、維護者是不是很少數。
- 下載量與使用者：極冷門的套件名稱和熱門套件很像時要特別小心。
- 安裝時會執行什麼：有沒有 `postinstall`、是否只有 sdist 沒有 wheel。
- 權限需求：一個字串處理套件為什麼需要網路與檔案系統？

## 實際程式：比對 lock 檔、漏洞與相似名稱

下面用標準函式庫模擬 CI 裡的三個檢查：雜湊驗證、已知漏洞比對、typosquatting 偵測。漏洞資料是虛構的，格式參考 OSV 的版本範圍概念（`introduced` 與 `fixed`）。

```python run
import hashlib

# 1) 雜湊驗證：下載的檔案與 lock 檔記錄的雜湊比對
artifact = b"pretend this is fastapi-0.115.0-py3-none-any.whl"
lock = {"fastapi": {"version": "0.115.0", "sha256": hashlib.sha256(artifact).hexdigest()}}

def verify_download(name, data):
    got = hashlib.sha256(data).hexdigest()
    want = lock[name]["sha256"]
    return "OK" if got == want else f"雜湊不符！預期 {want[:12]}…，實際 {got[:12]}…"

print("原檔：", verify_download("fastapi", artifact))
print("被替換：", verify_download("fastapi", artifact + b"\n# injected"))

# 2) 漏洞比對：lock 檔版本落在 [introduced, fixed) 就是受影響
def v(s):
    return tuple(int(x) for x in s.split("."))

locked = {"requests": "2.31.0", "jinja2": "3.1.2", "pyyaml": "6.0.1", "urllib3": "1.26.5"}
advisories = [   # 虛構的漏洞資料
    {"id": "DEMO-2026-0001", "package": "jinja2",  "introduced": "3.0.0", "fixed": "3.1.4", "severity": "medium"},
    {"id": "DEMO-2026-0002", "package": "urllib3", "introduced": "1.0.0", "fixed": "1.26.18", "severity": "high"},
    {"id": "DEMO-2026-0003", "package": "requests", "introduced": "2.0.0", "fixed": "2.20.0", "severity": "high"},
]
print("\n漏洞掃描：")
for adv in advisories:
    ver = locked.get(adv["package"])
    if ver and v(adv["introduced"]) <= v(ver) < v(adv["fixed"]):
        print(f"  {adv['severity']:6} {adv['package']} {ver} 受 {adv['id']} 影響 → 升級到 {adv['fixed']} 以上")

# 3) typosquatting：新依賴的名稱和熱門套件只差一兩個字元時警告
POPULAR = ["requests", "numpy", "pandas", "django", "flask", "fastapi", "pydantic", "urllib3", "python-dateutil"]

def distance(a, b):
    # Levenshtein 編輯距離：插入、刪除、替換各算 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

print("\n新依賴審查：")
for new in ["reqeusts", "pydantic", "python-dateutils", "fastapi-users", "nunpy"]:
    close = [p for p in POPULAR if p != new and distance(new, p) <= 2]
    if new in POPULAR:
        print(f"  {new:18} 熱門套件本身")
    elif close:
        print(f"  {new:18} 警告：和 {close} 很像，確認是不是打錯字")
    else:
        print(f"  {new:18} 沒有相似的熱門名稱（仍需看維護狀態與來源）")
```

`fastapi-users` 是一個真實存在的獨立套件，和 `fastapi` 的編輯距離很大，所以沒被標記；名稱相似度只是第一道篩子，最後仍要人看。

CI 裡的實際步驟大致是這樣（指令以各工具文件為準）：

```yaml
# GitHub Actions 片段：lock 檔安裝、漏洞掃描、image 掃描
permissions:
  contents: read
steps:
  - uses: actions/checkout@<commit-sha>
  - run: uv sync --locked                 # lock 檔與 pyproject 不一致就失敗
  - run: uvx pip-audit                    # 掃描已安裝的 Python 依賴
  - run: docker build -t app:${{ github.sha }} .
  # image 掃描（Trivy、Grype 等）與 SBOM 產生，有高風險漏洞時讓建置失敗
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修正 |
|---|---|---|
| `npm ci` 失敗，說 `package.json` 和 lock 檔不同步 | 有人改了依賴宣告但沒更新並提交 lock 檔 | 本機 `npm install` 更新 lock 檔後提交；CI 維持 `npm ci` |
| `uv sync --locked` 失敗，說 lock 檔需要更新 | `pyproject.toml` 改了但 `uv.lock` 沒跟著改 | 本機執行 `uv lock` 後提交 |
| pip 在 `--require-hashes` 模式下報 hash 不符 | 檔案被替換、下載到不同平台的 wheel，或 requirements 檔只記了部分平台的雜湊 | 先確認來源；重新產生含所有平台雜湊的檔案，不要直接拿掉 `--require-hashes` |
| 漏洞掃描每次都有幾十項，大家開始忽略 | 沒有分級、沒有處理流程 | 只讓「高風險且有修正版」擋建置；其他定期排程處理，確認不受影響的寫下理由並標記 |
| CI 有 lock 檔，Docker build 裡卻用 `pip install -r requirements.in` | image 裡裝的不是 lock 檔的版本 | Dockerfile 也用 lock 檔安裝（`uv sync --locked`、`npm ci`） |
| 依賴的 action 用 `@v3` | tag 可以被移到別的 commit | 釘 commit SHA，用 Dependabot 更新 |
| 開發依賴的漏洞被當成正式環境的風險 | 掃描範圍沒分開 | 分開掃描或標記；開發依賴仍會在開發機與 CI 上執行，不能完全忽略 |

## 動手

1. 在上面的程式把 `locked` 的 `jinja2` 改成 `3.1.4`、`urllib3` 改成 `1.26.18`，看哪些警告消失；再加一筆 `introduced` 比目前版本還新的漏洞，確認不會誤報。
2. 在 typosquatting 那段的 `POPULAR` 加上專案實際用到的套件名稱，試試 `djnago`、`flask-`、`pandas2`。
3. 對自己的專案確認三件事：lock 檔有進版控、CI 用 `--locked`／`npm ci` 這類嚴格模式安裝、Dockerfile 也照 lock 檔安裝。
4. 實際跑一次 `pip-audit` 或 `npm audit`，把結果分成「要立刻升級」「不受影響（寫下原因）」「排程處理」三類。
5. agent 的 MCP server、Skill、模型設定這類不在 SBOM 裡的依賴，見 [行為層的供應鏈管理](#/skill/agent-supply-chain)；套件管理工具本身見 [uv 與專案管理](#/skill/uv-packaging)。
