## 從一個具體問題開始：凌晨三點才發現少了一個設定

一個訂單服務在 staging 測過、上線，健康檢查全綠。凌晨三點第一筆需要退款的訂單進來，服務噴出：

```text
Traceback (most recent call last):
  ...
  File "/app/app/payments.py", line 14, in refund
    api_key = os.environ["PAYMENT_API_KEY"]
  ...
KeyError: 'PAYMENT_API_KEY'
```

正式環境的部署設定裡漏了這個變數。程式在**第一次用到**時才讀它，所以啟動、健康檢查、前面幾千筆一般訂單都沒事。

同一次檢查還發現另一件事：正式環境的錯誤頁顯示了完整的 stack trace 與設定值。設定是 `DEBUG=false`，程式碼是這樣讀的：

```python
DEBUG = bool(os.environ.get("DEBUG", False))
```

環境變數永遠是**字串**。`"false"` 是一個非空字串，`bool("false")` 是 `True`。

兩個問題的共同點：設定在程式各處零散地讀、沒有型別、沒有在啟動時檢查。這一課先整理 12-factor 中跟設定與部署有關的幾條原則，再寫一個在啟動時就驗證所有設定的載入器，最後談秘密怎麼不進 image。

## 12-factor 一覽

[The Twelve-Factor App](https://12factor.net/) 是一份描述「怎麼寫出容易部署、容易擴充的服務」的原則清單。十二條如下，後面詳細講其中幾條：

| # | 原則 | 一句話 |
|---|---|---|
| I | Codebase | 一個服務一個 repo（或 monorepo 中的一個單位），部署到多個環境 |
| II | Dependencies | 明確宣告並鎖定依賴，不依賴系統上碰巧裝了什麼 |
| III | Config | **設定放在環境裡**，不寫在程式碼中 |
| IV | Backing services | 資料庫、快取、佇列、外部 API 都是**用設定連接的附加資源** |
| V | Build, release, run | **建置、發布、執行**三個階段分開 |
| VI | Processes | 行程**無狀態**，狀態放在附加資源裡 |
| VII | Port binding | 服務自己聽一個埠提供 HTTP，不依賴外部容器注入 |
| VIII | Concurrency | 靠增加行程數擴充，不同工作用不同的行程類型 |
| IX | Disposability | 啟動快、收到 SIGTERM 能優雅結束，可以隨時被丟棄重建 |
| X | Dev/prod parity | 開發、staging、正式環境盡量一樣 |
| XI | Logs | **log 是事件流**，寫到 stdout，不自己管檔案 |
| XII | Admin processes | migration、資料修正這類一次性工作，用同一份程式碼與設定執行 |

這份清單在 2011 年前後提出，當時的背景是 Heroku 這類 PaaS。容器與 Kubernetes 普及之後，大部分原則被平台直接吸收（環境變數注入、stdout log 收集、以行程數擴充），所以讀起來有些像常識；但設定那幾條，仍然是事故最多的地方。

## III：設定放在環境裡

**設定**的定義是「在不同部署之間會不同的東西」：

| 是設定 | 不是設定 |
|---|---|
| 資料庫、Redis、外部 API 的位址與帳密 | URL 路由表 |
| 金鑰、token | 商業規則（「滿 1000 免運」除非營運要能隨時改） |
| log 等級、worker 數、功能開關 | 內部常數、預設的分頁大小 |
| 對外網址（用來產生 email 裡的連結） | 依賴套件的版本 |

一個簡單的檢驗：**把這份 repo 現在公開，會不會洩漏任何秘密？** 會的話，就有設定寫在程式碼裡了。

為什麼是環境變數：每個作業系統、每種語言、每個部署平台（systemd 的 `EnvironmentFile`、`docker run -e`、compose 的 `environment`、Kubernetes 的 `env` 與 Secret）都支援，而且不會被意外 commit。它也有缺點：只能是字串、沒有結構、同一台機器上權限夠的人看得到行程的環境（`/proc/<pid>/environ`）。結構複雜的設定可以用設定檔，但仍然由環境變數決定**讀哪一份**、並覆寫其中的秘密。

常見的優先順序（後面的蓋過前面的）：程式碼裡的預設值 → 設定檔 → 環境變數 → 命令列參數。不管用哪種組合，原則是一樣的：**同一份 image，不同環境只差注入的設定值**。

## IV：後端服務是附加資源

程式碼不區分「自己機房的 PostgreSQL」和「雲端的受管 PostgreSQL」，也不區分「本機的假 SMTP」和「正式的寄信服務」：它們都只是一個 URL 加上帳密。

```text
DATABASE_URL=postgresql://orders:***@db.internal:5432/orders
REDIS_URL=redis://cache.internal:6379/0
SMTP_URL=smtp://mailer.internal:587
OBJECT_STORAGE_ENDPOINT=https://storage.example.com
```

資料庫故障時切到備援、搬到另一個區域、本機改用 compose 起的容器，都只要改設定、重啟，不用改程式碼或重建 image。程式碼裡出現 `if ENV == "prod": host = "10.0.3.7"` 這種寫法，就違反了這一條。

## V：建置、發布、執行分開

```text
程式碼 (commit 8d1e7f40)
   │  建置 build：裝依賴、編譯、打包
   ▼
image  shop/api:8d1e7f40              ← 不含任何環境資訊，只建一次
   │  發布 release：image + 某個環境的設定
   ▼
release  prod-v57 = shop/api:8d1e7f40 + prod 設定
   │  執行 run：在主機或平台上啟動
   ▼
執行中的行程 ×N
```

- **同一個 image 依序推到 staging、prod**，中間不重建。staging 驗證過的就是正式環境跑的，位元組完全相同。每個環境各自重建，就無法保證這一點（依賴可能在兩次建置之間更新了）。
- **每個 release 有編號且不可變**。要改設定就產生新的 release；要退版就重新部署上一個 release，而不是在正式主機上改檔案。
- **執行階段不做建置的事**。容器啟動時才 `pip install`、在正式主機上 `git pull`，都讓「執行」依賴網路與外部狀態，啟動變慢、也可能裝到不同的版本。

Docker 的部分見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)；CI / CD 的流程見 [部署策略與資料庫遷移](#/skill/cd-strategies)。

## VI、VIII、IX：無狀態、可擴充、可拋棄

- **無狀態**：行程不在記憶體或本機磁碟裡留下「下一個請求需要的東西」。session 放 Redis 或用 token、上傳的檔案放物件儲存、快取當成「沒有也能運作」。這樣負載平衡器把請求送到任何一個行程都可以，行程也可以隨時被殺掉重建。
- **以行程擴充**：流量變大就多開幾個 web 行程；背景工作（寄信、產報表）是另一種行程類型，獨立擴充，不塞在 web 行程裡開執行緒。
- **可拋棄**：啟動要快（幾秒內能接流量）、收到 SIGTERM 要能把手上的工作做完再結束。部署、擴縮、主機維護都依賴這一點，細節見 [應用伺服器與程序管理](#/skill/process-servers)。

## XI：log 是事件流

應用程式把 log 一行一行寫到 **stdout**，不自己開檔案、不自己輪替。收集、輪替、轉送、搜尋交給執行環境：systemd 的 journald、`docker logs`、Kubernetes 的節點代理、雲端的 log 服務。

```python
import json, logging, sys

class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"level": record.levelname, "logger": record.name, "msg": record.getMessage()}, ensure_ascii=False)

handler = logging.StreamHandler(sys.stdout)   # 寫 stdout，不寫檔案
handler.setFormatter(JsonFormatter())
logging.basicConfig(level="INFO", handlers=[handler])
```

每行一個 JSON 物件，收集端就能依欄位搜尋。log 的格式、等級與不記個資的做法見 [日誌、錯誤處理與設定](#/skill/logging-config)。

## X、XII：環境一致，一次性工作用同一份程式

- **dev / prod 一致**：本機也用 PostgreSQL（不用 SQLite 代替）、也跑在容器裡，差異只在設定值。「本機測過」才有意義。compose 讓這件事很容易，見 [docker-compose 開發環境](#/skill/compose)。
- **一次性工作**：資料庫 migration、修資料的腳本，用**同一個 image、同一份設定**執行（`docker compose run --rm api alembic upgrade head`、Kubernetes 的 Job），不要另外在某人的筆電上連正式資料庫跑。

## 設定在啟動時驗證，失敗就不要啟動

回到開頭的兩個問題。解法是把所有設定集中在一個地方，在**行程啟動時**一次讀完、轉成正確的型別、檢查範圍與彼此的關係。任何一項有問題，就印出**全部**的錯誤並以非零退出碼結束。

這樣做的效果：

- 部署時新版本起不來 → 健康檢查不通過 → 滾動更新停住，舊版本繼續服務。錯誤在部署的那一刻、由部署的人看到，而不是凌晨三點由使用者觸發。
- 錯誤訊息直接指出「哪個變數、什麼問題」，而不是程式深處的 `KeyError` 或 `NoneType has no attribute`。
- 其他程式碼只用型別正確的 `settings.debug`、`settings.web_concurrency`，不會再出現 `bool("false")`。

先看字串轉型的陷阱，可以直接執行：

```python run
# 環境變數一律是字串：直接轉型會出錯
env = {"DEBUG": "false", "WEB_CONCURRENCY": "4", "TIMEOUT": "2.5"}

print("bool('false') =", bool(env["DEBUG"]))          # True：非空字串都是 True
print("'4' * 2       =", env["WEB_CONCURRENCY"] * 2)  # '44'：字串重複，不是 8
try:
    int(env["TIMEOUT"])
except ValueError as e:
    print("int('2.5')    ->", e)

def parse_bool(raw):
    v = raw.strip().lower()
    if v in {"1", "true", "yes", "on"}:
        return True
    if v in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"不是布林值：{raw!r}（可用 true/false、1/0、yes/no、on/off）")

for raw in ["false", "TRUE", " 1 ", "flase"]:
    try:
        print(f"parse_bool({raw!r}) = {parse_bool(raw)}")
    except ValueError as e:
        print(f"parse_bool({raw!r}) -> {e}")
```

接著是一個完整的載入器：宣告每個設定的名稱、型別、預設值（沒有預設值就是必填）、是否為秘密；載入時收集所有錯誤一次回報；成功時印出遮罩過的設定。標準函式庫就能做，可以直接執行：

```python run
from urllib.parse import urlsplit

REQUIRED = object()   # 標記「沒有預設值，必填」

def as_bool(raw):
    v = raw.strip().lower()
    if v in {"1", "true", "yes", "on"}: return True
    if v in {"0", "false", "no", "off"}: return False
    raise ValueError(f"不是布林值：{raw!r}")

def as_int(lo, hi):
    def parse(raw):
        n = int(raw)                                  # 不是整數會丟 ValueError
        if not lo <= n <= hi:
            raise ValueError(f"{n} 不在 {lo}–{hi} 之間")
        return n
    return parse

def as_choice(*options):
    def parse(raw):
        if raw not in options:
            raise ValueError(f"{raw!r} 不是 {'/'.join(options)} 之一")
        return raw
    return parse

def as_url(*schemes):
    def parse(raw):
        u = urlsplit(raw)
        if u.scheme not in schemes or not u.hostname:
            raise ValueError(f"需要 {'/'.join(schemes)} 開頭且有主機名稱的網址")
        return raw
    return parse

def as_secret(raw):
    if len(raw.strip()) < 16:
        raise ValueError("長度不足 16，看起來不像真的金鑰")
    return raw.strip()

# 名稱, 轉換函式, 預設值, 是否為秘密
SPEC = [
    ("APP_ENV",         as_choice("dev", "staging", "prod"), "dev",   False),
    ("DATABASE_URL",    as_url("postgresql"),                REQUIRED, True),
    ("DEBUG",           as_bool,                             "false", False),
    ("WEB_CONCURRENCY", as_int(1, 64),                       "2",     False),
    ("PAYMENT_API_KEY", as_secret,                           REQUIRED, True),
]

def load_settings(env):
    values, errors = {}, []
    for name, parse, default, _ in SPEC:
        raw = env.get(name)
        if raw is None:
            if default is REQUIRED:
                errors.append(f"{name}: 必填，但沒有設定")
                continue
            raw = default
        try:
            values[name] = parse(raw)
        except ValueError as e:
            errors.append(f"{name}: {e}")
    # 跨欄位的規則
    if values.get("APP_ENV") == "prod" and values.get("DEBUG"):
        errors.append("DEBUG: 正式環境不能開啟")
    if errors:
        raise SystemExit("設定錯誤，服務不啟動：\n  " + "\n  ".join(errors))
    return values

def masked(values):
    out = {}
    for name, _, _, secret in SPEC:
        v = values[name]
        if secret and "://" in str(v):
            u = urlsplit(v)                            # 網址只遮密碼，主機與資料庫名稱留著方便除錯
            v = v.replace(f":{u.password}@", ":***@") if u.password else v
        elif secret:
            v = v[:4] + "…（已遮罩）"
        out[name] = v
    return out

good = {"APP_ENV": "prod", "DATABASE_URL": "postgresql://orders:s3cr3t-pw@db.internal:5432/orders",
        "WEB_CONCURRENCY": "4", "PAYMENT_API_KEY": "pk_live_51Hxxxxxxxxxxxxxxxx"}
bad = {"APP_ENV": "prod", "DATABASE_URL": "localhost:5432/orders", "DEBUG": "true", "WEB_CONCURRENCY": "four"}

print("啟動時的設定：", masked(load_settings(good)))
try:
    load_settings(bad)
except SystemExit as e:
    print(e)
```

在真正的專案裡，用 pydantic-settings 做同一件事比較省事（需要安裝套件，不能在瀏覽器裡跑）：

```python
from typing import Literal
from pydantic import Field, PostgresDsn, SecretStr, model_validator
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # 欄位名稱對應環境變數（預設不分大小寫）：DATABASE_URL → database_url
    app_env: Literal["dev", "staging", "prod"] = "dev"
    database_url: PostgresDsn                         # 沒有預設值 = 必填，且必須是 PostgreSQL 網址
    debug: bool = False                               # "false"、"0"、"no" 都會轉成 False；"flase" 會報錯
    web_concurrency: int = Field(default=2, ge=1, le=64)
    payment_api_key: SecretStr                        # 印出時顯示 '**********'

    @model_validator(mode="after")
    def prod_rules(self):
        if self.app_env == "prod" and self.debug:
            raise ValueError("正式環境不能開啟 DEBUG")
        return self

settings = Settings()   # 在 import 時（行程啟動時）就驗證；有錯誤會丟 ValidationError，行程結束
```

缺值時的錯誤大致長這樣，每一個有問題的欄位都會列出來：

```text
pydantic_core._pydantic_core.ValidationError: 2 validation errors for Settings
database_url
  Field required [type=missing, input_value={...}, input_type=dict]
payment_api_key
  Field required [type=missing, input_value={...}, input_type=dict]
```

啟動時印一次遮罩過的設定（實際讀到的 `APP_ENV`、資料庫主機、worker 數），出問題時第一個要確認的就是「它到底讀到了什麼」。

## 秘密不放進 image

image 會被推到 registry、被很多台機器拉下來、被保留很久。放進 image 的秘密，等於給了所有能拉 image 的人。秘密進入 image 的常見途徑：

| 途徑 | 為什麼會留下 | 改法 |
|---|---|---|
| `COPY . .` 帶進 `.env` | 檔案就在某一層裡；之後再 `RUN rm .env` 也只是在上面加一層，原本那層還在 | `.dockerignore` 排除、明確列出要 COPY 的目錄 |
| `ENV DATABASE_URL=…` | 存在 image 的設定裡，`docker inspect` 直接看得到 | 執行時注入 |
| `ARG TOKEN` 用在 `RUN` 裡 | 用到 ARG 的 `RUN` 會連同值記錄在建置紀錄中，`docker history` 看得到 | BuildKit 的 `RUN --mount=type=secret` |
| 程式碼裡寫死 | 進 git 歷史，刪掉也還在 | 改成讀設定；**已經 commit 的秘密視為外洩，立即更換** |

執行時注入的方式，安全性大致由低到高：

1. **環境變數**：最普遍。缺點是會出現在 `docker inspect`、`/proc/<pid>/environ`，也可能被錯誤回報工具連同整個環境一起送出去。
2. **掛載成檔案**：Kubernetes Secret 掛成 volume、compose 的 `secrets:` 掛在 `/run/secrets/`。程式讀檔案；很多官方映像支援 `*_FILE` 慣例（例如 PostgreSQL 映像的 `POSTGRES_PASSWORD_FILE`）。讀檔時記得 `.strip()` 掉結尾的換行。
3. **執行時向秘密管理服務取得**：雲端的 Secret Manager、Vault 之類。可以做到短效憑證與稽核紀錄。

不管哪一種，秘密要能**更換**（rotation）：程式重新啟動就能讀到新值，舊的秘密在確認沒人用之後撤銷。秘密管理的完整討論見 [秘密管理](#/skill/secrets)。

## 常見錯誤與錯誤訊息

| 現象 / 訊息 | 原因 | 怎麼修 |
|---|---|---|
| `KeyError: 'PAYMENT_API_KEY'`（在某個請求裡） | 設定在用到時才讀，部署漏了沒被發現 | 集中在啟動時載入並驗證 |
| `DEBUG=false` 但 debug 模式開著 | `bool("false")` 是 `True` | 用明確的布林解析，或 pydantic 的 `bool` 欄位 |
| `pydantic_core._pydantic_core.ValidationError: … Field required` | 必填的環境變數沒有注入 | 對照錯誤列出的欄位，檢查部署設定 |
| 本機正常、容器裡讀不到變數 | compose 的 `.env` 只用於 compose 檔的替換，沒有傳進容器 | 用 `environment:` 或 `env_file:`；`docker compose exec api env` 確認 |
| 密碼明明對，連線卻失敗 | 值裡多了引號或結尾換行：不同工具處理 `.env` 引號的方式不同（例如 `docker run --env-file` 不會去掉引號），或秘密檔案結尾有 `\n` | 印出 `repr()` 的長度與頭尾字元（不要印整個秘密）；讀檔時 `strip()` |
| 改了設定，行為沒變 | 行程只在啟動時讀設定 | 重新啟動或重新部署；不要期待改環境變數會影響執行中的行程 |
| staging 正常、prod 出錯，但程式碼一樣 | 兩邊不是同一個 image（各自重建），或設定差太多 | 同一個 image 推到各環境；比對兩邊遮罩後的設定輸出 |
| 掃描工具在 image 裡找到金鑰 | 秘密在某一層裡 | 更換金鑰；修 `.dockerignore` 與 Dockerfile 後重建 |

## 動手

1. 在 Playground 開啟載入器那段，把 `bad` 改成只缺 `PAYMENT_API_KEY`，看錯誤訊息；再加一個 `REDIS_URL` 設定（`as_url("redis", "rediss")`，預設 `redis://localhost:6379/0`）。
2. 在 `load_settings` 加一條規則：`APP_ENV` 是 `prod` 時，`DATABASE_URL` 的主機不能是 `localhost`。
3. 檢查自己的專案：搜尋 `os.environ`、`os.getenv` 出現在哪些檔案。理想的結果是只出現在設定模組裡。
4. 對一個自己建的 image 執行 `docker history --no-trunc` 與 `docker inspect`，確認看不到任何秘密。
5. 接著看 [應用伺服器與程序管理](#/skill/process-servers)：設定好的服務怎麼啟動、開幾個 worker、怎麼優雅地關閉。
