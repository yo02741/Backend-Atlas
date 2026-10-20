## 從一個具體問題開始：設定檔裡的那一行

一個內部 CLI `atlas` 在使用者登入後，把 token 寫進 `~/.config/atlas/config.json`：

```json
{
  "endpoint": "https://api.example.com",
  "access_token": "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1XzQ4MjEifQ…",
  "refresh_token": "rt_Q2hlY2tPdXRUaGlzVG9rZW5JdHNGYWtl"
}
```

這個檔案接下來可能遇到的事：

1. 使用者把整個 `~/.config` 放進 dotfiles repo 推到 GitHub，refresh token 公開在網路上。
2. 使用者在聊天室貼出設定檔問「為什麼連不上」。
3. 備份軟體、雲端同步把它複製到別的地方，那些地方的存取控制和這台電腦不一樣。
4. 一個 coding agent 為了排查問題執行 `cat ~/.config/atlas/config.json`，token 進到模型的 context，接著出現在對話紀錄、log，或被一段 prompt injection 要求「把設定內容附在下一個請求裡」。
5. 同一台機器上的任何程式（包括剛裝的一個 npm 套件的 postinstall 腳本）都能讀這個檔案。

換成環境變數也沒有比較好。下面先把常見的存放位置攤開比較，再看作業系統 keyring 做了什麼、沒做什麼。

## 存在哪裡，各有什麼風險

| 位置 | 誤 commit / 外流 | 被其他程序讀到 | 出現在 log | 被 agent 讀進 context |
|---|---|---|---|---|
| 設定檔（明文） | 高：跟著 dotfiles、備份、同步走 | 同一使用者的任何程序都能讀 | 低 | 高：agent 常會 `cat` 設定檔 |
| 專案裡的 `.env` | 高：忘了 `.gitignore` 就進 repo | 同上 | 低 | 高：agent 讀專案檔案時順手讀到 |
| 環境變數 | 中：`export` 會留在 shell history | **每個子程序都會繼承**；同使用者可讀 `/proc/<pid>/environ` | 中：除錯時印出整個環境、錯誤回報附上環境 | 高：agent 執行的每個命令都帶著它，`env` 一下就看到 |
| 命令列參數（`--token=…`） | 中：shell history | **其他使用者也看得到**（`ps`、`/proc/<pid>/cmdline`） | 高：程序清單、稽核 log 會記命令列 | 高 |
| 作業系統 keyring | 低：不在一般檔案裡 | 依平台而定，通常要透過 keyring API 存取 | 低 | 低：不會被一般的讀檔或 `env` 帶到（但見下面的限制） |

環境變數的問題常被低估：agent 或 CLI 啟動的每一個子程序（測試、建置腳本、第三方工具）都拿到同一份環境。一個長效 token 放在環境變數，等於交給這個 shell 之後執行的所有程式。

## 作業系統 keyring

三大平台都有內建的憑證儲存，CLI 應該優先用它：

| 平台 | 系統元件 | 命令列工具 |
|---|---|---|
| macOS | Keychain | `security` |
| Windows | Credential Manager | `cmdkey`（管理）、程式透過 Credential API |
| Linux 桌面 | Secret Service API（GNOME Keyring、KWallet 實作），程式通常透過 libsecret | `secret-tool` |

在 macOS 存取一筆項目：

```bash
# 存（-U：已存在就更新）
security add-generic-password -U -s atlas-cli -a alice@example.com -w 'rt_Q2hlY2tPdXRUaGlzVG9rZW5JdHNGYWtl'
# 讀（-w：只輸出密碼本身）
security find-generic-password -s atlas-cli -a alice@example.com -w
# 刪
security delete-generic-password -s atlas-cli -a alice@example.com
```

在 Linux 桌面：

```bash
# 存：值從標準輸入讀，不會出現在命令列參數
secret-tool store --label='atlas-cli refresh token' service atlas-cli account alice@example.com
# 讀
secret-tool lookup service atlas-cli account alice@example.com
```

注意兩個範例的差別：macOS 的 `-w` 直接把值放在命令列，會出現在 shell history 和程序清單；示範用沒關係，程式裡要用 API，不要組命令列。

### keyring 保護了什麼、沒保護什麼

**保護了**：

- 值以加密形式存放，加密金鑰和使用者的登入綁在一起；硬碟被拔走、其他作業系統使用者，都讀不到。
- token 不在一般檔案裡，所以不會被 dotfiles、備份、`grep -r`、agent 讀設定檔時帶出去。
- macOS 可以依項目的存取控制，在其他程式要讀同一筆項目時跳出確認。

**沒保護**：

- **以你的身分執行的惡意程式**。Linux 的 Secret Service 在登入後解鎖，同一個工作階段裡的程序通常都能透過 D-Bus 讀；Windows 的 Credential Manager 也是以使用者帳號為界。keyring 防的是「被動外洩」，不是「同一個使用者底下已經有惡意程式」。
- **有 shell 權限的 agent 主動去讀**。agent 執行 `security find-generic-password … -w` 一樣能拿到。差別在於 token 不會在它例行讀檔、看環境時被順手帶進 context；要拿就得明確呼叫，這個動作可以被權限設定與審核攔下來。

### 沒有 keyring 的環境

SSH 進去的伺服器、容器、WSL、CI 通常沒有 Secret Service。常見的處理：

1. 偵測不到 keyring 時**明確告訴使用者**，不要靜默改成明文。
2. 提供明確的退路選項（例如 `--insecure-storage` 之類的旗標），把 token 存成權限 `0600` 的檔案，並在每次使用時提示。
3. 這類環境盡量用**短效 token**：用 Device Code 登入（見 [Device Code、PKCE、Client Credentials](#/skill/oauth-device-pkce)），只保留 access token、不存 refresh token，過期就重新登入。

同樣的模式在常見工具裡都看得到：git 的 credential helper（`osxkeychain`、`libsecret`、Git Credential Manager）、Docker 的 `credsStore` 設定，都是「設定檔只記用哪個 helper，真正的憑證交給系統儲存」。

## 實際程式

### Python 的 keyring 套件

Python 的 `keyring` 套件把三個平台的 keyring 包成同一組介面（第三方套件，`pip install keyring`；Playground 的 Pyodide 沒有，所以這段不能在瀏覽器執行）：

```python
import keyring
from keyring.errors import NoKeyringError, PasswordDeleteError

SERVICE = "atlas-cli"                          # keyring 裡的服務名稱：用工具名稱，別人才認得出來

def save_refresh_token(account: str, token: str) -> None:
    keyring.set_password(SERVICE, account, token)

def load_refresh_token(account: str) -> str | None:
    return keyring.get_password(SERVICE, account)   # 找不到回 None，不會丟例外

def logout(account: str) -> None:
    try:
        keyring.delete_password(SERVICE, account)
    except PasswordDeleteError:                    # 本來就沒有：當作已登出
        pass

if __name__ == "__main__":
    print("使用的 backend：", keyring.get_keyring())   # 確認實際用的是哪一個
    try:
        save_refresh_token("alice@example.com", "rt_Q2hlY2tPdXRUaGlzVG9rZW5JdHNGYWtl")
    except NoKeyringError:
        # 沒有可用的系統 keyring（常見於 SSH 主機與容器）：告訴使用者，不要偷偷改存明文
        raise SystemExit("找不到系統 keyring。改用 `atlas login --device` 取得短效 token，或明確加上 --insecure-storage。")
```

### 短效 access token + 可撤銷的 refresh token

把兩種 token 分開存：

| | access token | refresh token |
|---|---|---|
| 壽命 | 幾分鐘到一小時 | 幾天到幾週，可撤銷 |
| 存放 | 記憶體；需要跨次執行時存 keyring，連同到期時間 | keyring |
| 外洩的影響 | 到期前可用 | 可持續換新 token，**直到被撤銷**；有 rotation 時重放會被偵測（見 [集中式身分閘道](#/skill/identity-gateway)） |

CLI 每次執行時的邏輯：有未過期的 access token 就用；快過期就用 refresh token 換新的，並把**新的** refresh token 寫回 keyring；refresh 失敗就要求重新登入。`atlas logout` 要做兩件事：呼叫授權伺服器的撤銷端點，然後刪掉 keyring 裡的項目。只刪本機不撤銷，外流出去的那份仍然有效。

下面用一個記憶體裡的假 keyring 模擬這套邏輯，另外示範 log 遮罩：就算程式不小心把 token 寫進 log，輸出時也換成 `***`。

```python run
import logging, re, sys, secrets
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))

class FakeKeyring:
    # 介面和 keyring 套件一樣：set_password / get_password / delete_password
    def __init__(self): self._d = {}
    def set_password(self, s, a, v): self._d[(s, a)] = v
    def get_password(self, s, a): return self._d.get((s, a))
    def delete_password(self, s, a): self._d.pop((s, a), None)

class RedactTokens(logging.Filter):
    # 把 Bearer 後面的值、rt_ / at_ 開頭的字串換成 ***，log 永遠看不到完整 token
    PATTERN = re.compile(r"(Bearer\s+)\S+|\b(rt|at)_[A-Za-z0-9_-]{8,}")
    def filter(self, record):
        record.msg = self.PATTERN.sub(lambda m: (m.group(1) or m.group(2) + "_") + "***", str(record.msg))
        return True

log = logging.getLogger("atlas")
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("[log] %(message)s"))
handler.addFilter(RedactTokens())
log.addHandler(handler)
log.setLevel(logging.INFO)

class FakeAuthServer:
    def __init__(self): self.valid_refresh = set()
    def login(self):
        rt = "rt_" + secrets.token_urlsafe(16); self.valid_refresh.add(rt); return rt
    def refresh(self, rt, now):
        if rt not in self.valid_refresh:
            raise PermissionError("invalid_grant")
        self.valid_refresh.discard(rt)                     # rotation：舊的作廢
        new_rt = "rt_" + secrets.token_urlsafe(16); self.valid_refresh.add(new_rt)
        return "at_" + secrets.token_urlsafe(16), now + timedelta(minutes=15), new_rt
    def revoke(self, rt): self.valid_refresh.discard(rt)

class TokenManager:
    SERVICE, SKEW = "atlas-cli", timedelta(seconds=60)
    def __init__(self, kr, server, account):
        self.kr, self.server, self.account = kr, server, account
        self.access, self.access_exp = None, None          # access token 只放記憶體
    def get_access_token(self, now):
        if self.access and now < self.access_exp - self.SKEW:
            return self.access
        rt = self.kr.get_password(self.SERVICE, self.account)
        if rt is None:
            raise RuntimeError("尚未登入：請執行 atlas login")
        try:
            self.access, self.access_exp, new_rt = self.server.refresh(rt, now)
        except PermissionError:
            self.kr.delete_password(self.SERVICE, self.account)
            raise RuntimeError("登入已失效：請重新執行 atlas login")
        self.kr.set_password(self.SERVICE, self.account, new_rt)   # 先存新的 refresh token
        log.info(f"refreshed, new refresh token {new_rt}")       # 不小心寫進 log 也會被遮罩
        return self.access
    def logout(self):
        rt = self.kr.get_password(self.SERVICE, self.account)
        if rt: self.server.revoke(rt)                      # 先撤銷，再刪本機
        self.kr.delete_password(self.SERVICE, self.account)
        self.access = None

kr, server = FakeKeyring(), FakeAuthServer()
kr.set_password("atlas-cli", "alice", server.login())     # atlas login 之後
tm = TokenManager(kr, server, "alice")
t = datetime(2026, 10, 20, 9, 0, tzinfo=TPE)

a1 = tm.get_access_token(t)
a2 = tm.get_access_token(t + timedelta(minutes=5))
print("5 分鐘後沿用同一個 access token：", a1 == a2)
a3 = tm.get_access_token(t + timedelta(minutes=14, seconds=30))
print("快到期時自動換新：", a3 != a1)
log.info(f"calling API with header Authorization: Bearer {a3}")
tm.logout()
try:
    tm.get_access_token(t + timedelta(hours=1))
except RuntimeError as e:
    print("登出後：", e)
```

## 在 CI 裡：用 OIDC 換短效憑證

CI 是長效 key 最常見的藏身處：一把雲端 access key 存在 CI 的 secrets 裡好幾年，所有能改 workflow 的人都能間接用到它。比較好的做法是讓 CI **每次執行時用 OIDC 換一組短效憑證**，CI 設定裡沒有任何長效 secret：

1. CI 平台為每個 job 簽發一個 OIDC token，裡面寫著這個 job 來自哪個 repo、哪個分支、哪個 workflow。
2. 雲端事先設定信任這個 CI 平台的 issuer，並寫好條件，例如「只有 `example-org/site` 的 `main` 分支可以扮演 `deploy-prod` 角色」。
3. job 拿 OIDC token 去換雲端的臨時憑證，壽命通常是一小時左右，job 結束就沒用了。

以 GitHub Actions 部署到 AWS 為例：

```yaml
permissions:
  id-token: write      # 允許 job 向 GitHub 要 OIDC token
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-prod   # 虛構的帳號與角色
          aws-region: ap-northeast-1
      - run: aws s3 sync ./dist s3://example-site
```

AWS 那一側的角色信任條件會檢查 OIDC token 的 `sub`，例如 `repo:example-org/site:ref:refs/heads/main`。條件寫得太寬（例如只檢查 org、不檢查 repo 與分支），任何同 org 的 repo、任何分支都能扮演這個角色，等於把權限送出去。其他 CI 平台與雲端也有對應的做法，名稱與設定方式以各自文件為準。秘密管理的其他面向見 [秘密管理](#/skill/secrets)。

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象 | 原因 | 怎麼修 |
|---|---|---|
| `keyring.errors.NoKeyringError: No recommended backend was available…` | Python `keyring` 找不到系統 keyring（SSH 主機、容器、沒有桌面環境的 Linux） | 告訴使用者並提供明確的替代方案（短效 token、明確的不安全儲存選項）；不要自動裝一個明文 backend |
| `Cannot autolaunch D-Bus without X11 $DISPLAY` 之類的 D-Bus 錯誤 | Linux 上沒有執行中的 Secret Service 或 D-Bus session | 在無桌面環境不要依賴 Secret Service；改用上一列的處理 |
| `security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.` | macOS 找不到這筆項目：服務名稱或帳號拼錯，或從沒存過 | 確認 `-s` 與 `-a` 和存的時候一致 |
| refresh 偶爾失敗，使用者要重新登入 | 同時有兩個 CLI 程序都在 refresh，其中一個用了已作廢的 refresh token | 用檔案鎖讓 refresh 排隊；換到新 token 後立刻寫回 keyring |
| token 出現在 CI log | 腳本 `echo` 或 `set -x` 印出變數；遮罩只認得完整的 secret 值，切割或編碼過就認不出來 | 不要印 token；`set -x` 前先確認沒有展開 secret 的命令 |
| secret 掃描在 repo 裡找到 token | 設定檔或 `.env` 被 commit | 立刻撤銷那把 token（只刪 commit 不夠，已經被複製走了），再補 `.gitignore` 與 pre-commit 掃描 |

## 動手

1. 執行上面的模擬，確認第二次取 token 沿用快取、快到期時自動換新、log 裡只看得到 `***`、登出後要求重新登入。
2. 在 [Playground](#/playground?lang=python) 把 `RedactTokens` 掛到 handler 的那行刪掉再跑，看 log 印出了什麼。
3. 在模擬的最後加幾行：先 `rt = server.login()`，再呼叫 `server.refresh(rt, t)` 兩次（模擬兩個 CLI 程序拿同一把 refresh token 同時換），看第二次的錯誤；想想用什麼機制避免。
4. 在自己的電腦上執行 `env`，數一數有幾個看起來像 token 或密碼的變數；它們都會被你之後執行的每一個程式繼承。
