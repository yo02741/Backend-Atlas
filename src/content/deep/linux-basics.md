## 從一個具體問題開始：部署完，服務起不來

一台 Ubuntu 主機上跑著一個 Python API，由 systemd 管理，服務名稱 `orders-api`，聽 8000 埠。部署腳本拉了新版程式碼、執行 `sudo systemctl restart orders-api`，然後健康檢查一直失敗。ssh 進去看：

```bash
$ systemctl status orders-api
× orders-api.service - Orders API
     Loaded: loaded (/etc/systemd/system/orders-api.service; enabled; preset: enabled)
     Active: failed (Result: exit-code) since Tue 2026-10-20 09:12:41 CST; 8s ago
    Process: 48211 ExecStart=/srv/orders/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 (code=exited, status=1/FAILURE)
   Main PID: 48211 (code=exited, status=1/FAILURE)
```

`status` 只說它失敗了。原因在 log 裡：

```bash
$ journalctl -u orders-api -n 20 --no-pager
Oct 20 09:12:41 web-1 uvicorn[48211]: ERROR:    [Errno 98] error while attempting to bind on address ('0.0.0.0', 8000): address already in use
Oct 20 09:12:41 web-1 systemd[1]: orders-api.service: Main process exited, code=exited, status=1/FAILURE
```

8000 埠已經有人在用。是誰：

```bash
$ sudo ss -ltnp 'sport = :8000'
State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      2048         0.0.0.0:8000      0.0.0.0:*     users:(("uvicorn",pid=31877,fd=3))

$ ps -o pid,ppid,user,lstart,cmd -p 31877
    PID    PPID USER     STARTED                  CMD
  31877       1 deploy   Mon Oct 19 22:40:03 2026 /srv/orders/.venv/bin/uvicorn app.main:app --port 8000
```

前一天晚上有人用 `nohup uvicorn … &` 手動起了一份來測試，忘了關。它不歸 systemd 管，所以 `systemctl restart` 動不到它。處理方式是先請它優雅地結束，確認埠空出來，再啟動正式的服務：

```bash
$ kill -TERM 31877          # 先送 SIGTERM，讓它把手上的請求做完
$ sleep 5; kill -0 31877    # kill -0 不送訊號，只檢查行程還在不在
bash: kill: (31877) - No such process
$ sudo systemctl start orders-api
$ curl -s localhost:8000/health
{"status":"ok"}
```

這一段用到的東西——systemd、journal、`ss`、`ps`、訊號、行程的擁有者——就是這一課的內容。後面依序講檔案權限、行程與訊號、systemd 與 log、排查指令、環境變數，最後是 SSH 金鑰登入。

## 檔案權限：誰可以對這個檔案做什麼

`ls -l` 每一列的前十個字元是檔案類型加上三組權限：

```bash
$ ls -l /srv/orders
-rw-r-----  1 orders orders   612 Oct 20 09:10 .env
-rwxr-xr-x  1 deploy deploy   204 Oct 20 09:10 run.sh
drwxr-x---  2 orders orders  4096 Oct 20 09:10 uploads
lrwxrwxrwx  1 deploy deploy    22 Oct 20 09:10 current -> /srv/orders/releases/42
```

| 位置 | 意思 | 例子 `-rw-r-----` |
|---|---|---|
| 第 1 個字元 | 類型：`-` 一般檔案、`d` 目錄、`l` 符號連結 | `-`：一般檔案 |
| 2–4 | owner（擁有者）的權限 | `rw-`：可讀、可寫 |
| 5–7 | group（群組）的權限 | `r--`：只能讀 |
| 8–10 | others（其他所有人）的權限 | `---`：什麼都不行 |

`r`、`w`、`x` 對檔案和目錄的意思不一樣：

| 權限 | 對檔案 | 對目錄 |
|---|---|---|
| `r`（4） | 讀內容 | 列出目錄裡的檔名 |
| `w`（2） | 改內容 | 在目錄裡新增、刪除、改名檔案（**刪檔看的是目錄的 w，不是檔案本身**） |
| `x`（1） | 當成程式執行 | 進入目錄、存取裡面的檔案（沒有 `x` 就算知道檔名也打不開） |

數字表示法把每一組的 r、w、x 加起來：`rw-` = 4 + 2 = 6，`r--` = 4，`---` = 0，所以 `-rw-r-----` 就是 `640`。常見的組合：

| 數字 | 字串 | 用在 |
|---|---|---|
| `600` | `rw-------` | 私鑰、只給服務自己讀的秘密檔 |
| `640` | `rw-r-----` | 設定檔：擁有者可改，同群組的服務可讀 |
| `644` | `rw-r--r--` | 一般公開可讀的檔案 |
| `700` | `rwx------` | `~/.ssh` 目錄 |
| `755` | `rwxr-xr-x` | 程式、一般目錄 |

判斷一個行程能不能存取某個檔案時，核心依序檢查：行程的使用者是不是擁有者？是就只看 owner 那組；不是的話，行程是否屬於檔案的群組？是就只看 group 那組；都不是才看 others。root 不受這些限制（讀寫幾乎都可以；執行仍需要至少一組有 `x`）。

改權限與擁有者：

```bash
chmod 640 /srv/orders/.env              # 數字寫法
chmod u+x run.sh                        # 符號寫法：給 owner 加 x
chmod -R g+rX /srv/orders/static        # 大寫 X：只對目錄與已經有 x 的檔案加 x
sudo chown orders:orders /srv/orders/uploads    # 改擁有者與群組
sudo chown -R orders: /srv/orders/uploads       # 冒號後空白：群組改成該使用者的主要群組
id orders                               # 看使用者的 UID、GID 與所屬群組
```

新建立的檔案預設權限由 `umask` 決定：一般 shell 的 umask 是 `022`，新檔案就是 `644`、新目錄 `755`。

下面這段把權限字串轉成數字，並逐一判斷三種身分能做什麼，可以直接執行：

```python run
# 把 ls -l 的權限字串轉成數字，並說明 owner / group / others 各能做什麼
def parse_mode(s):
    kinds = {"-": "一般檔案", "d": "目錄", "l": "符號連結"}
    kind, bits = s[0], s[1:10]
    digits = ""
    rows = []
    for who, chunk in zip(["owner", "group", "others"], [bits[0:3], bits[3:6], bits[6:9]]):
        value = (4 if chunk[0] == "r" else 0) + (2 if chunk[1] == "w" else 0) + (1 if chunk[2] in "xst" else 0)   # 小寫 s / t 代表同時有 x
        digits += str(value)
        can = [name for flag, name in zip(chunk, ["讀", "寫", "執行/進入"]) if flag not in "-ST"]
        rows.append(f"  {who:<6} {chunk}  -> {'、'.join(can) or '不能存取'}")
    return kinds.get(kind, kind), digits, rows

for mode in ["-rw-r-----", "-rwxr-xr-x", "drwxr-x---", "-rw-------"]:
    kind, digits, rows = parse_mode(mode)
    print(f"{mode}  {digits}  {kind}")
    print("\n".join(rows))
```

### 服務用專屬帳號跑

服務不要用 root 跑，也不要用登入用的個人帳號跑。建一個沒有登入 shell 的系統帳號，程式碼屬於部署帳號（服務只能讀）、需要寫入的目錄（上傳、快取）才屬於服務帳號：

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin orders
sudo chown -R deploy:orders /srv/orders/releases     # 程式碼：deploy 可改，orders 群組可讀
sudo chmod -R g+rX,o-rwx /srv/orders/releases
sudo install -d -o orders -g orders -m 750 /srv/orders/uploads   # 建目錄並一次設好擁有者與權限
```

應用程式被攻破時，攻擊者拿到的就只是 `orders` 這個帳號能碰的東西。容器裡的使用者與掛載目錄的權限問題，本質上也是這裡的 UID 與權限位元，見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)。

## 行程與訊號

每個執行中的程式是一個**行程**（process），有 PID、父行程（PPID）、執行身分（USER）。`ps` 一次看全部：

```bash
$ ps aux --sort=-rss | head -5
USER       PID %CPU %MEM    VSZ   RSS TTY  STAT START   TIME COMMAND
orders   48302  3.1  4.2 412340 171204 ?   Ssl  09:13   0:21 /srv/orders/.venv/bin/python /srv/orders/.venv/bin/uvicorn app.main:app --workers 2
orders   48305  1.2  3.9 398112 160022 ?   Sl   09:13   0:08 /srv/orders/.venv/bin/python -c from multiprocessing.spawn import spawn_main; ...
postgres  1021  0.4  2.1 220180  86340 ?   Ss   Oct18   9:42 /usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main
root       812  0.0  0.3  44720  12104 ?   Ss   Oct18   0:03 /usr/lib/systemd/systemd-journald
```

`RSS` 是實際佔用的實體記憶體（KB），`STAT` 的 `S` 是睡眠中（等 I/O，閒置的服務大多是這個）、`R` 是在跑、`D` 是卡在磁碟或網路檔案系統、`Z` 是殭屍行程。各欄位的細節與執行緒、檔案描述子的關係見 [電腦怎麼跑你的程式：行程、執行緒、記憶體](#/skill/how-programs-run)。

### 訊號：請它停，或直接殺掉

**訊號**（signal）是核心送給行程的通知。`kill` 這個指令名稱有點誤導，它的工作是「送訊號」，送哪一個由參數決定：

| 訊號 | 編號 | 誰會送 | 預設行為 | 行程能不能攔截 |
|---|---|---|---|---|
| `SIGTERM` | 15 | `kill` 不加參數、`systemctl stop`、`docker stop`、Kubernetes 刪 Pod | 結束 | 可以：通常用來做清理再結束 |
| `SIGINT` | 2 | 終端機按 Ctrl+C | 結束 | 可以：Python 會變成 `KeyboardInterrupt` |
| `SIGHUP` | 1 | 終端機斷線；很多常駐程式拿它當「重新載入設定」 | 結束 | 可以：nginx 收到會重讀設定、gunicorn 會重啟 worker |
| `SIGKILL` | 9 | `kill -9`、OOM killer、逾時後的強制停止 | 立刻結束 | **不行**：沒有清理的機會 |

`SIGTERM` 和 `SIGKILL` 的差別是重點。`SIGTERM` 是「請你結束」，程式可以先停止接新請求、把進行中的請求做完、關掉資料庫連線、把緩衝寫進磁碟，然後才退出；`SIGKILL` 由核心直接回收行程，程式完全不知道發生了什麼：進行中的請求斷線、沒寫完的檔案留下半截。

所以停止服務的順序永遠是先 `SIGTERM`、等一段時間、還在才 `SIGKILL`。systemd、Docker、Kubernetes 都是這樣做的，只是等待時間不同（systemd 預設 90 秒、`docker stop` 預設 10 秒、Kubernetes 預設 30 秒）。程式要在這段時間內正確處理 `SIGTERM`，細節見 [應用伺服器與程序管理](#/skill/process-servers)。

```bash
kill -TERM 31877              # 等同 kill 31877
kill -0 31877 && echo 還在     # 只檢查存在與權限，不送訊號
pkill -TERM -f 'uvicorn app.main'   # 依完整指令列比對；-f 範圍很大，先用 pgrep -af 確認會比對到誰
pgrep -af uvicorn
kill -KILL 31877              # 最後手段
```

行程結束後，**退出碼**（exit code）告訴你它怎麼死的：0 是正常結束，1–125 通常是程式自己回報的錯誤，被訊號殺掉時 shell 與容器平台慣例顯示 `128 + 訊號編號`：`137` = 128 + 9（SIGKILL，常見於記憶體超限被 OOM killer 殺掉）、`143` = 128 + 15（SIGTERM）。

## systemd：開機自動起、掛了自動重啟

現在主流的 Linux 發行版用 systemd 管理常駐服務。一個服務由一個 unit 檔描述：

```ini
# /etc/systemd/system/orders-api.service
[Unit]
Description=Orders API
After=network-online.target          # 網路就緒之後才啟動
Wants=network-online.target

[Service]
User=orders                          # 用專屬帳號跑，不是 root
Group=orders
WorkingDirectory=/srv/orders/current
EnvironmentFile=/etc/orders/env      # 設定與秘密從這裡讀（權限 640、owner root、group orders）
ExecStart=/srv/orders/current/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=on-failure                   # 非正常結束才自動重啟
RestartSec=2
TimeoutStopSec=30                    # SIGTERM 之後等 30 秒，還在就 SIGKILL

[Install]
WantedBy=multi-user.target           # enable 之後，開機進入一般多使用者模式時啟動
```

常用操作：

```bash
sudo systemctl daemon-reload            # 改過 unit 檔之後一定要做，不然 systemd 用的還是舊內容
sudo systemctl enable --now orders-api  # 設定開機自動啟動，並立刻啟動
sudo systemctl restart orders-api       # 停（SIGTERM）再啟動
sudo systemctl reload nginx             # 不重啟、只重讀設定（服務要支援，nginx 支援）
systemctl status orders-api             # 狀態、Main PID、最近幾行 log
systemctl is-active orders-api          # 腳本裡判斷用：印 active / failed / inactive
systemctl list-units --type=service --state=failed   # 列出所有失敗的服務
systemctl cat orders-api                # 看 systemd 實際採用的 unit 內容（含覆寫檔）
sudo systemctl edit orders-api          # 建覆寫檔（drop-in），不直接改套件提供的原檔
```

`Restart=on-failure` 加上 `RestartSec` 讓服務當掉後自動回來。但如果短時間內一直失敗，systemd 會停止重試，狀態裡出現 `Start request repeated too quickly.`——這時是程式本身有問題（設定錯、埠被占用），要看 log，不是再按一次 restart。修好後先 `sudo systemctl reset-failed orders-api` 清掉計數。

## log 在哪：journalctl

systemd 管的服務，寫到 stdout / stderr 的東西都由 journald 收集：

```bash
journalctl -u orders-api -f                 # 即時追，像 tail -f
journalctl -u orders-api --since "10 min ago"
journalctl -u orders-api --since "2026-10-20 09:00" --until "2026-10-20 09:30"
journalctl -u orders-api -p err             # 只看 err 以上的等級（程式要用 syslog 等級或 systemd 能辨識的格式才有意義）
journalctl -b -1 -p warning                 # 上一次開機期間的警告（查「重開機前發生了什麼」）
journalctl -k | grep -i 'out of memory'     # 核心訊息：OOM killer 的紀錄在這裡
journalctl --disk-usage                     # journal 佔多少磁碟
```

其他常見位置：

- `/var/log/nginx/access.log`、`error.log`：nginx 自己寫檔案。
- `/var/log/syslog`（Debian / Ubuntu）或 `/var/log/messages`（RHEL 系）：有裝 rsyslog 時才有，是否預設安裝依發行版與版本而定；沒有就用 `journalctl`。
- 應用程式自己寫的檔案：在設定裡找路徑。服務的 log 建議一律寫 stdout，交給 journald 或容器平台收，見 [環境設定與 12-factor](#/skill/config-12factor)。

讀一般 log 檔：

```bash
tail -n 100 -f /var/log/nginx/error.log      # 最後 100 行並持續追加
grep -n ' 502 ' /var/log/nginx/access.log | tail -20
grep -i -C 3 'traceback' app.log             # 比對到的那一行前後各 3 行
zgrep 'timeout' /var/log/nginx/error.log.2.gz   # 已經被 logrotate 壓縮的舊檔
```

## 常用排查指令

連上一台出狀況的機器時，先花一分鐘看全貌：

```bash
uptime                  # 開機多久、load average（1、5、15 分鐘平均）
free -h                 # 記憶體：看 available，不是 free
df -h                   # 各檔案系統的使用率
df -i                   # inode 使用率：小檔案太多時，空間有剩也會寫不進去
top                     # 即時 CPU / 記憶體；按 M 依記憶體排序、按 P 依 CPU 排序、按 1 看每顆核心
sudo ss -ltnp           # 誰在聽哪個 TCP 埠（-l listen、-t TCP、-n 不解析名稱、-p 顯示行程，需 root 才看得到別人的）
ss -tn state established '( dport = :5432 )' | wc -l   # 目前連到資料庫的連線數
```

`free -h` 最容易誤讀：

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:           7.7Gi       5.1Gi       312Mi        64Mi       2.6Gi       2.4Gi
Swap:             0B          0B          0B
```

`free` 只剩 312 MiB 不代表快滿了。Linux 會把閒置的記憶體拿去當磁碟快取（`buff/cache`），需要時可以收回來。真正還能用的是 `available` 的 2.4 GiB。

磁碟滿了，找是誰：

```bash
sudo du -xh --max-depth=1 / 2>/dev/null | sort -h | tail    # -x 不跨檔案系統，由小到大排，看最後幾個
sudo du -sh /var/log/* | sort -h | tail
sudo lsof +L1                    # 已經被刪掉、但還被行程開著的檔案：空間要等行程關檔或重啟才會釋放
```

最後一個值得記住：刪掉一個正在被寫入的 10 GB log 檔，`df` 的使用率不會下降，因為寫入它的行程還握著那個檔案。正確做法是讓程式重新開檔（logrotate 的 `postrotate`、對 nginx 送 `USR1`），或用 `truncate -s 0` 清空內容而不是刪除。

依症狀找指令：

| 症狀 | 先看 | 再看 |
|---|---|---|
| 服務沒回應 | `systemctl status`、`journalctl -u` | `ss -ltnp` 確認有沒有在聽、聽的是 `127.0.0.1` 還是 `0.0.0.0` |
| 回應很慢 | `top` 的 CPU 與 `wa`（等 I/O） | `free -h`、`ss` 看連線數、資料庫的慢查詢 |
| 行程突然消失 | `journalctl -k` 找 OOM killer | `systemctl status` 的退出碼、`dmesg` |
| 寫檔失敗 | `df -h`、`df -i` | `ls -ld` 目錄的權限與擁有者 |
| 連不到別台 | `curl -v`、`dig` | 防火牆與路由，見 [網路通不通：從 DNS 到防火牆](#/skill/network-troubleshooting) |

下面這段模擬「拿到一份 `ps aux` 輸出，找出最吃記憶體的服務，依使用者加總」，可以直接執行：

```python run
# 解析 ps aux 的輸出：依 RSS 排序，並依 USER 加總記憶體
ps_output = """USER       PID %CPU %MEM    VSZ   RSS TTY  STAT START   TIME COMMAND
orders   48302  3.1  4.2 412340 171204 ?   Ssl  09:13   0:21 uvicorn app.main:app --workers 2
orders   48305  1.2  3.9 398112 160022 ?   Sl   09:13   0:08 python -c from multiprocessing.spawn import spawn_main
orders   48306  1.1  3.8 397000 158760 ?   Sl   09:13   0:07 python -c from multiprocessing.spawn import spawn_main
postgres  1021  0.4  2.1 220180  86340 ?   Ss   Oct18   9:42 postgres -D /var/lib/postgresql/16/main
www-data  1102  0.0  0.2  55320   9120 ?   S    Oct18   0:30 nginx: worker process
root       812  0.0  0.3  44720  12104 ?   Ss   Oct18   0:03 systemd-journald"""

lines = ps_output.splitlines()
rows = []
for line in lines[1:]:
    parts = line.split(None, 10)          # 前 10 欄用空白切開，第 11 欄 COMMAND 保留空白
    rows.append({"user": parts[0], "pid": int(parts[1]), "rss_kb": int(parts[5]), "cmd": parts[10]})

print("依 RSS 排序（MiB）：")
for r in sorted(rows, key=lambda r: r["rss_kb"], reverse=True)[:3]:
    print(f"  {r['pid']:>6} {r['user']:<9} {r['rss_kb'] / 1024:7.1f}  {r['cmd'][:40]}")

totals = {}
for r in rows:
    totals[r["user"]] = totals.get(r["user"], 0) + r["rss_kb"]
print("依使用者加總（MiB）：")
for user, kb in sorted(totals.items(), key=lambda kv: kv[1], reverse=True):
    print(f"  {user:<9} {kb / 1024:7.1f}")
```

## 環境變數與 PATH

每個行程都帶著一組**環境變數**，從父行程繼承。shell 裡：

```bash
export DATABASE_URL='postgresql://orders@db.internal:5432/orders'   # 設定，並讓之後啟動的子行程繼承
env | grep -i database        # 列出目前的環境變數
echo "$PATH"                  # 找指令時依序搜尋的目錄，用冒號分隔
command -v uvicorn            # 實際會執行的是哪一個檔案（找不到就沒有輸出）
LOG_LEVEL=debug ./run.sh      # 只對這一個指令設定，不影響目前的 shell
```

輸入 `uvicorn` 時，shell 依 `PATH` 的順序逐一找這個名字的可執行檔，找不到就是 `command not found`。虛擬環境的 `activate` 做的事主要就是把 `.venv/bin` 放到 `PATH` 最前面。

常見的意外是「在終端機能跑，交給別人跑就不行」，因為環境不一樣：

- **systemd 不讀 `~/.bashrc`、`~/.profile`**。服務的環境變數只來自 unit 檔的 `Environment=`、`EnvironmentFile=`，`PATH` 也是 systemd 給的預設值。`ExecStart=` 寫完整路徑（`/srv/orders/current/.venv/bin/uvicorn`）最保險。
- **`sudo` 預設會重設環境**，`PATH` 換成 `secure_path`，你 export 的變數不會帶過去。
- **cron 的環境非常精簡**，`PATH` 通常只有 `/usr/bin:/bin`。

要看一個執行中的服務實際拿到什麼環境，讀 `/proc/<pid>/environ`（需要權限）：

```bash
sudo cat /proc/48302/environ | tr '\0' '\n' | grep -v -i -E 'password|secret|token'
```

這也提醒了一件事：環境變數裡的秘密，同一台機器上權限夠的人都看得到。

shell 腳本開頭加上 `set -euo pipefail`：任一指令失敗就停（`-e`）、用到沒定義的變數就停（`-u`）、管線中任何一段失敗都算失敗（`pipefail`）。部署腳本沒有這一行時，`cd /srv/orders/releases/42` 失敗了，下一行 `rm -rf ./*` 照樣在錯誤的目錄執行。

## SSH 金鑰登入

用金鑰登入比密碼安全：私鑰只留在你的電腦上，伺服器只存公鑰。

```bash
# 在自己的電腦產生一組金鑰（ed25519 是現在常用的演算法）；設一個 passphrase 保護私鑰
ssh-keygen -t ed25519 -C "alice@laptop"
# 產生 ~/.ssh/id_ed25519（私鑰，絕不外流）與 ~/.ssh/id_ed25519.pub（公鑰）

# 把公鑰加到伺服器上該帳號的 ~/.ssh/authorized_keys
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@web-1.example.internal

# 登入；-v 會印出嘗試了哪些金鑰、為什麼失敗
ssh deploy@web-1.example.internal
ssh -v deploy@web-1.example.internal
```

常連的機器寫進 `~/.ssh/config`：

```text
Host web-1
    HostName web-1.example.internal
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    # 經由跳板機連線
    ProxyJump bastion.example.internal
```

之後 `ssh web-1` 就好。伺服器端確認金鑰登入可用之後，在 `/etc/ssh/sshd_config` 設 `PasswordAuthentication no` 並重新載入 sshd 以關掉密碼登入；改之前**保留一個已登入的連線**，用另一個終端測試新設定，設錯了才不會把自己鎖在外面。

權限是 SSH 最常見的失敗原因。sshd 預設（`StrictModes yes`）會拒絕權限太寬的 `authorized_keys`，客戶端也會拒絕權限太寬的私鑰：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

## 常見錯誤與錯誤訊息

| 訊息 | 意思 | 怎麼查、怎麼修 |
|---|---|---|
| `bash: ./run.sh: Permission denied` | 檔案沒有執行權限，或所在檔案系統以 `noexec` 掛載 | `ls -l` 看有沒有 `x`；`chmod u+x run.sh`，或用 `bash run.sh` 執行 |
| `PermissionError: [Errno 13] Permission denied: '/srv/orders/uploads/a.png'` | 服務帳號沒有寫入權限 | `ls -ld` 看目錄的擁有者與權限；`namei -l <路徑>` 會列出路徑上每一層，常常是上層目錄少了 `x` |
| `uvicorn: command not found` | `PATH` 裡找不到 | `command -v`；在 systemd、cron、sudo 底下寫完整路徑 |
| `[Errno 98] ... address already in use` | 埠已被其他行程占用 | `sudo ss -ltnp 'sport = :8000'` 找 PID，確認是誰再處理 |
| `OSError: [Errno 28] No space left on device` | 磁碟或 inode 用完 | `df -h`、`df -i`、`du`；刪了檔案空間沒回來就查 `lsof +L1` |
| 行程消失，`journalctl -k` 有 `Out of memory: Killed process 48302 (python)` | 記憶體不夠，被核心的 OOM killer 用 SIGKILL 砍掉 | 看 RSS 的變化；減少 worker 數、找記憶體洩漏或加記憶體 |
| `Start request repeated too quickly.` | systemd 在短時間內重啟太多次，停止重試 | 看 `journalctl -u` 找第一次失敗的原因；修好後 `systemctl reset-failed` |
| `Permission denied (publickey).` | 伺服器沒有接受任何一把金鑰 | `ssh -v` 看送了哪把；確認公鑰在正確帳號的 `authorized_keys`、`~/.ssh` 與檔案權限 |
| `WARNING: UNPROTECTED PRIVATE KEY FILE!` 後面接 `Permissions 0644 for '...' are too open.` | 私鑰權限太寬，客戶端拒絕使用 | `chmod 600` 私鑰 |
| `Host key verification failed.` | 伺服器的主機金鑰和 `known_hosts` 記的不同 | 機器重建過就是正常的，用 `ssh-keygen -R <主機>` 移除舊紀錄；**不明原因變動時先確認，不要直接忽略**，那正是防冒充的機制 |

## 動手

1. 在 Playground 開啟權限那段，加入 `-rwsr-xr-x`、`drwxrwxrwt` 這兩個字串看看輸出；它們多出來的 `s`、`t` 是 setuid 與 sticky bit，`/usr/bin/passwd` 和 `/tmp` 就是這樣設定的，查一下各自的用途。
2. 在 `ps aux` 那段的資料裡多加幾列 nginx worker，看依使用者加總的結果怎麼變；再改成依 `COMMAND` 的第一個字分組。
3. 在一台 Linux 機器（或 WSL、虛擬機）上，用 `python3 -m http.server 8000` 起一個服務，用 `ss -ltnp` 找到它，分別用 `kill -TERM` 與 `kill -KILL` 停掉，比較 shell 印出的結束訊息與 `echo $?` 的退出碼。
4. 為那個服務寫一個 systemd unit，`Restart=on-failure`，用 `kill -KILL` 殺掉主行程，看 `journalctl -u` 裡 systemd 怎麼記錄重啟。
5. 接著看 [Docker：image、container、layer](#/skill/docker-basics)：容器裡的 PID 1、訊號與使用者，都建立在這一課的內容上。
