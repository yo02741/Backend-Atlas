## 從一個具體問題開始：週一早上的憑證過期

週一早上七點半，一家醫院的對外預約網站開始出現瀏覽器警告「你的連線不是私人連線」，手機 App 直接顯示「無法連線」。原因是憑證在週日午夜到期。去年買憑證的同事已經調單位，續約提醒信寄到了他的信箱；新的憑證買好後，還要找到它被裝在哪幾個地方：nginx 一台、負載平衡器一台、還有一份被複製進某個 Java 程式的 keystore。

同一場檢討會上，接著有人問：「乾脆買 EV 憑證，比較安全？」「萬用字元憑證能不能一張全院通用？」「內部系統也要買嗎？」

這些問題都有明確的答案，但要先知道憑證是什麼、瀏覽器怎麼驗證它。這一課從機制講起，再回到「要買哪種、怎麼續、怎麼不再被到期日偷襲」。

## 憑證是什麼

一張 TLS 伺服器憑證（X.509 格式）是一份**被簽了名的聲明**，內容是：「這把公鑰屬於這些網域名稱，在這段期間內有效」。主要欄位：

| 欄位 | 內容 | 例子 |
|---|---|---|
| Subject | 憑證主體 | `CN=booking.example.org` |
| Subject Alternative Name（SAN） | 這張憑證涵蓋的所有名字 | `DNS:booking.example.org, DNS:www.example.org` |
| Public Key | 伺服器的公鑰 | ECDSA P-256 或 RSA 2048 |
| Validity | 有效期間 | `notBefore`、`notAfter` |
| Issuer | 誰簽發的 | 某個 CA 的中繼憑證 |
| Signature | 簽發者用自己的私鑰做的簽章 | |

**私鑰不在憑證裡**。私鑰在申請時由伺服器端產生、一直留在伺服器上；送給 CA 的是 CSR（憑證簽署請求，內含公鑰與要申請的名字）。CA 驗證你有資格使用這些名字之後，簽好憑證寄回來。所以「換憑證」時，憑證和對應的私鑰要一起換；裝了新憑證卻配舊私鑰，服務會起不來（nginx 會報 `key values mismatch`）。

瀏覽器現在只看 SAN 判斷名字是否相符；舊式的 CN 欄位已不被主流瀏覽器用於比對。

## 信任鏈：瀏覽器怎麼決定相信這張憑證

瀏覽器和作業系統內建一份**根憑證清單**（trust store）。CA 不會直接用根憑證簽網站憑證，而是用根憑證簽一張**中繼憑證**，再用中繼憑證簽網站憑證：

```text
根憑證（Root CA）               ← 內建在作業系統 / 瀏覽器的 trust store
  └─ 簽發 → 中繼憑證（Intermediate CA）  ← 伺服器要一併送出
               └─ 簽發 → 網站憑證（leaf）  booking.example.org
```

TLS 握手時，伺服器送出網站憑證**加上中繼憑證**（不需要送根憑證）。用戶端從網站憑證往上驗證每一層的簽章，直到接上一張它信任的根憑證。

最常見的設定錯誤是**沒送中繼憑證**。桌機瀏覽器有時會用快取或自動下載補上中繼憑證，所以「我用 Chrome 看沒問題」；但 `curl`、Java、Python、手機 App 通常不會補，直接報錯：

```text
curl: (60) SSL certificate problem: unable to get local issuer certificate
```

nginx 的修法是把網站憑證和中繼憑證**依序**串在同一個檔案裡（網站憑證在前），`ssl_certificate` 指向這個檔案。CA 寄來的檔案通常有一份叫 fullchain 或 bundle 的就是這種格式。

### trust store 不只一份

「信任哪些根憑證」不是全系統一份，而是每個執行環境各自有：

| 執行環境 | 用哪一份 trust store |
|---|---|
| Windows、macOS 上的瀏覽器 | 多半用作業系統的（Firefox 預設用自己的） |
| Linux 系統工具（curl 等） | 發行版的 CA bundle，例如 `/etc/ssl/certs/ca-certificates.crt` |
| Java | JDK 的 `cacerts` |
| Python `requests` | `certifi` 套件內附的 bundle，不是作業系統的 |
| 容器 | image 裡的 `ca-certificates` 套件；精簡 image 可能根本沒有 |

這在使用**內部 CA**時特別重要：根憑證裝進 Windows 網域電腦，不代表伺服器上的 Java 程式或容器裡的 Python 會相信它。

## DV、OV、EV：差在哪

三種憑證的**加密強度完全一樣**，差別在 CA 簽發前驗證了什麼：

| 類型 | CA 驗證的內容 | 簽發時間 | 憑證裡多了什麼 |
|---|---|---|---|
| DV（Domain Validation） | 申請者控制這個網域（放一個檔案、加一筆 DNS 記錄或收驗證信） | 幾分鐘 | 只有網域名稱 |
| OV（Organization Validation） | DV 加上組織確實存在（查登記資料、電話確認） | 數天 | Subject 裡有組織名稱 |
| EV（Extended Validation） | 比 OV 更嚴格的組織驗證程序 | 數天到數週 | Subject 裡有組織名稱與更多登記資訊 |

使用者在瀏覽器上幾乎看不出差別：主流瀏覽器在 2019 年前後陸續移除了網址列上顯示 EV 公司名稱的設計，現在三種憑證都只顯示一樣的鎖頭或網站資訊圖示，要點進憑證詳細資料才看得到組織名稱。

所以「買 EV 比較安全」不成立：EV 不會讓連線更難被破解，也不會讓使用者更容易辨識假網站。選 OV / EV 的理由通常是組織政策、合約要求或採購規範，而不是技術上的安全性。

## SAN 與萬用字元：一張憑證涵蓋哪些名字

憑證涵蓋的名字就是 SAN 裡列的那些。萬用字元 `*` 只能出現在**最左邊一段**，而且只代表**剛好一段**：

| 憑證的 SAN | `example.org` | `www.example.org` | `api.example.org` | `a.b.example.org` |
|---|---|---|---|---|
| `*.example.org` | ✗（apex 不涵蓋） | ✓ | ✓ | ✗（兩段） |
| `*.example.org`, `example.org` | ✓ | ✓ | ✓ | ✗ |
| `*.b.example.org` | ✗ | ✗ | ✗ | ✓ |

這條規則可以直接跑一次看看：

```python run
# 簡化版的主機名稱比對：萬用字元只能在最左邊一段、只代表一段
def matches(pattern: str, host: str) -> bool:
    p = pattern.lower().split(".")
    h = host.lower().split(".")
    if len(p) != len(h):          # 段數不同就不可能相符：*.example.org 不涵蓋 a.b.example.org
        return False
    if p[0] == "*":
        return p[1:] == h[1:]     # * 只取代最左邊那一段
    return p == h

def covered(san: list[str], host: str) -> bool:
    return any(matches(name, host) for name in san)

san = ["*.example.org"]
for host in ["example.org", "www.example.org", "a.b.example.org"]:
    print(f"{host:20} {'涵蓋' if covered(san, host) else '不涵蓋'}")

san = ["*.example.org", "example.org"]
print("加上 apex 之後：", covered(san, "example.org"))
```

（實際的比對規則還有細節，例如不允許 `*.org` 這種涵蓋整個頂級網域的寫法；這裡只示範段數與 apex。）

萬用字元憑證的取捨：

- **方便**：新增子網域不用重新申請。
- **風險集中**：同一把私鑰要複製到每一台用它的伺服器，任何一台外洩，所有子網域都受影響；換憑證時也要每一台都換。
- **無法同時給多層子網域**：`*.example.org` 不能用在 `his.dept.example.org`。

所以「一張萬用字元全院通用」在技術上做得到一部分，但私鑰散落在越多台機器，風險與換證工作量就越大。對外服務數量不多時，每個服務用自己的憑證、或用列了幾個名字的多網域（SAN）憑證，往往比較好管。

### 公開憑證會被公開記錄

公開 CA 簽發的每張憑證都必須記錄在 **Certificate Transparency（CT）** 日誌裡，任何人都能查詢。結果是：憑證 SAN 裡的每個名字都是公開資訊。如果把 `his-db-prod.example.org` 這種內部主機名稱放進公開憑證，等於公告了內部架構。內部系統的名字適合用內部 CA，或改用萬用字元憑證避免逐一列出。

## 公開 CA 與內部 CA

| | 公開 CA | 內部 CA |
|---|---|---|
| 誰信任 | 所有作業系統與瀏覽器預設信任 | 只有手動安裝了根憑證的裝置 |
| 能簽什麼名字 | 只能簽公開註冊的網域；不能簽 `.local`、`.internal` 這類內部名稱 | 任何名字，包括內部名稱與私有 IP |
| 適合 | 對外服務、使用者裝置無法統一管理的情境 | 只在內網使用的系統、伺服器之間的連線、內部 API |
| 維運負擔 | 依 CA 規定的效期與驗證程序 | 自己保管根憑證私鑰、自己管撤銷與效期 |

內部 CA 常見的實作有 Microsoft AD CS（Active Directory 憑證服務）、HashiCorp Vault 的 PKI、smallstep 的 step-ca 等。用內部 CA 的前提是**所有用戶端都裝了根憑證**：透過 AD 群組原則派送到 Windows 電腦很容易，但伺服器、容器、各種語言的執行環境（前一節那張表）都要各自處理。例如在 Debian 系的容器 image 裡：

```dockerfile
# 把內部根憑證加進系統的 CA bundle
COPY example-root-ca.crt /usr/local/share/ca-certificates/example-root-ca.crt
RUN update-ca-certificates
# Python requests 預設用 certifi，不讀系統 bundle；指定環境變數讓它改用系統的
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
```

根憑證的私鑰是內部 CA 最重要的資產：外洩就能簽出任何名字、被所有內部裝置相信的憑證。實務上根 CA 離線保存，日常簽發用中繼 CA。

## 免費的 Let's Encrypt 與購買的憑證

Let's Encrypt 是免費的公開 CA，只發 DV 憑證，透過 **ACME** 協定自動申請與續約。目前預設效期 90 天，官方也公布了把效期再往下調的計畫，細節以 Let's Encrypt 的公告為準。ACME 的驗證方式主要有兩種：

| 驗證方式 | 怎麼證明你控制網域 | 限制 |
|---|---|---|
| HTTP-01 | CA 從網際網路連到 `http://<網域>/.well-known/acme-challenge/<token>` | 該名字要能從外網用 80 port 連到；不能發萬用字元憑證 |
| DNS-01 | 在 `_acme-challenge.<網域>` 加一筆 TXT 記錄 | 要能用 API 自動修改公開 DNS；可以發萬用字元憑證 |

只在內網提供服務的系統，HTTP-01 行不通（CA 連不進來），但只要網域的公開 DNS 能自動更新，就能用 DNS-01 拿到公開憑證——前提是可以接受那個名字出現在 CT 日誌裡。

和購買的憑證比較：

| | Let's Encrypt | 購買的憑證 |
|---|---|---|
| 費用 | 免費 | 依類型與網域數計價 |
| 類型 | 只有 DV | DV、OV、EV |
| 申請與續約 | ACME 自動化 | 多數 CA 也支援 ACME，但不少單位仍是人工下載、上傳 |
| 支援 | 社群論壇 | 有客服、有合約 |

付費憑證**一樣受最長效期的限制**。買「三年方案」得到的是三年內可以重複簽發的權利，不是一張三年效期的憑證；每次到期仍要換一次。

## 效期越來越短

公開憑證的最長效期由 CA/Browser Forum（CA 與瀏覽器廠商組成的組織）的基本要求規範。2020 年 9 月起，公開憑證最長約 398 天（13 個月）。2025 年，CA/Browser Forum 通過了分階段縮短的時程：

| 簽發日期 | 最長效期 |
|---|---|
| 2026 年 3 月 15 日起 | 200 天 |
| 2027 年 3 月 15 日起 | 100 天 |
| 2029 年 3 月 15 日起 | 47 天 |

（確切時程與細節以 CA/Browser Forum 的公告為準。）這代表「一年換一次、到時候手動處理」的流程會變成一年換八次以上。到期事故的根本解法不是更好的提醒，而是**自動續約加上獨立的到期監控**。

## 續約：不靠人記得

自動續約要涵蓋三件事：拿到新憑證、放到所有用到它的地方、讓服務重新載入。

用 certbot 搭配 nginx 的典型做法：

```bash
# 申請（HTTP-01，certbot 會自動修改 nginx 設定來回應驗證）
sudo certbot --nginx -d booking.example.org

# 套件安裝時通常已經建立 systemd timer 或 cron，每天檢查兩次；手動模擬一次續約：
sudo certbot renew --dry-run

# 續約成功後重新載入 nginx（只在真的換了憑證時才執行）
sudo certbot renew --deploy-hook "systemctl reload nginx"
```

到期事故常見的原因不是「沒續約」，而是：

- **續約了但服務沒重新載入**：nginx 在記憶體裡還用舊憑證。
- **憑證有多份副本**：負載平衡器、另一台備援機、Java keystore、廠商設備，自動化只更新了其中一處。
- **驗證方式失效**：防火牆規則改了，80 port 從外網連不到，HTTP-01 驗證失敗；DNS API 的金鑰過期，DNS-01 失敗。
- **通知寄到沒人看的信箱**：而且不是每個 CA 都會寄到期提醒——Let's Encrypt 已停止寄送到期提醒信，必須自己監控。

所以要有一個**從外部、獨立於續約機制**的監控：直接連到服務，讀出它**實際送出**的憑證到期日。用 Prometheus 的 blackbox_exporter 可以拿到 `probe_ssl_earliest_cert_expiry` 這個指標，設定「剩不到 14 天就告警」。沒有監控系統的話，一個每天跑的腳本也可以：

```bash
# 實際連到服務，取出它送的憑證，檢查 30 天（2592000 秒）內會不會到期
echo | openssl s_client -connect booking.example.org:443 -servername booking.example.org 2>/dev/null \
  | openssl x509 -noout -checkend 2592000 \
  || echo "booking.example.org 的憑證 30 天內到期"
```

`-checkend` 在期限內會到期時，印出 `Certificate will expire` 並以非 0 結束。

## 用 openssl 看憑證

### 看一個服務實際送出什麼

```bash
$ openssl s_client -connect booking.example.org:443 -servername booking.example.org </dev/null
CONNECTED(00000003)
depth=2 C = TW, O = Example Org, CN = Example Root CA
verify return:1
depth=1 C = TW, O = Example Org, CN = Example Issuing CA
verify return:1
depth=0 CN = booking.example.org
verify return:1
---
Certificate chain
 0 s:CN = booking.example.org
   i:C = TW, O = Example Org, CN = Example Issuing CA
 1 s:C = TW, O = Example Org, CN = Example Issuing CA
   i:C = TW, O = Example Org, CN = Example Root CA
---
（中間省略）
    Verify return code: 0 (ok)
```

- `-servername` 送出 SNI（要連的名字）。同一個 IP 上有多個網站時，沒有它可能拿到預設站台的憑證。
- `Certificate chain` 底下，`0` 是網站憑證，`1` 是中繼憑證。`s:` 是主體、`i:` 是簽發者；每一層的 `i:` 應該等於下一層的 `s:`。
- 最後的 `Verify return code: 0 (ok)` 代表信任鏈驗證成功。（OpenSSL 3.x 的輸出還會多印金鑰演算法與效期等行，格式依版本略有不同。）

沒送中繼憑證時，鏈只剩一層，而且驗證失敗：

```text
depth=0 CN = booking.example.org
verify error:num=20:unable to get local issuer certificate
verify return:1
depth=0 CN = booking.example.org
verify error:num=21:unable to verify the first certificate
verify return:1
---
Certificate chain
 0 s:CN = booking.example.org
   i:C = TW, O = Example Org, CN = Example Issuing CA
---
    Verify return code: 21 (unable to verify the first certificate)
```

其他常見的 `Verify return code`：`10 (certificate has expired)`；`19 (self-signed certificate in certificate chain)`，通常是內部 CA 的根憑證沒裝，可以加 `-CAfile example-root-ca.crt` 指定根憑證再試一次。`s_client` 預設**不檢查名字**是否相符，要加 `-verify_hostname booking.example.org`，不符時會出現 `verify error:num=62:hostname mismatch`。

### 看憑證內容

```bash
$ openssl s_client -connect booking.example.org:443 -servername booking.example.org </dev/null 2>/dev/null \
    | openssl x509 -noout -dates -subject -ext subjectAltName
notBefore=Sep  1 00:00:00 2026 GMT
notAfter=Nov 30 23:59:59 2026 GMT
subject=CN = booking.example.org
X509v3 Subject Alternative Name: 
    DNS:booking.example.org, DNS:www.example.org
```

第一段把服務送的憑證取出來，第二段印出效期、主體與 SAN（`-ext` 需要 OpenSSL 1.1.1 以上）。也可以直接看檔案：`openssl x509 -in cert.pem -noout -dates -subject -ext subjectAltName`。`subject=` 那一行的空白與分隔格式依 OpenSSL 版本略有差異。

## Kubernetes 上的憑證：cert-manager

在 Kubernetes 上，憑證通常交給 **cert-manager** 管：它是一個在叢集裡持續運作的 controller，負責申請、存放與續約。

```yaml
# ClusterIssuer：整個叢集共用的簽發者設定（這裡用 Let's Encrypt 的 ACME）
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: infra@example.org
    privateKeySecretRef:
      name: letsencrypt-prod-account-key   # ACME 帳號金鑰存在這個 Secret
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
---
# Certificate：要一張涵蓋 booking.example.org 的憑證，結果放進 booking-tls 這個 Secret
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: booking
  namespace: booking
spec:
  secretName: booking-tls
  dnsNames:
    - booking.example.org
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

Ingress 的 `tls` 區段引用 `booking-tls`，Ingress controller 就會用這張憑證。cert-manager 會在憑證到期前自動續約（未設定 `renewBefore` 時，預設在效期剩約三分之一時），新的憑證寫回同一個 Secret，Ingress controller 讀到後換上。內部 CA 也能接：issuer 改用 `ca`（引用存著 CA 憑證與私鑰的 Secret）或接 Vault 等外部 CA。

cert-manager 解決了「拿到新憑證、放到正確位置」，但仍要監控：`kubectl get certificate -A` 的 `READY` 欄位為 `False` 時，用 `kubectl describe certificate <名稱>` 看事件，常見原因是 HTTP-01 驗證請求連不進來或 DNS 設定不對。

## 常見錯誤

| 現象 | 原因 | 處理 |
|---|---|---|
| 瀏覽器正常、`curl` / App 報 `unable to get local issuer certificate` | 沒送中繼憑證 | 改用 fullchain 檔案 |
| 只有某些用戶端報錯，而且是內部系統 | 那些用戶端沒裝內部根憑證 | 在該執行環境的 trust store 加入根憑證 |
| `no alternative certificate subject name matches` | SAN 沒有這個名字（常見是 apex 或多層子網域） | 重新申請，把需要的名字都列進 SAN |
| 已續約，但瀏覽器顯示的到期日還是舊的 | 服務沒重新載入，或請求打到另一台還沒更新的機器 | reload 服務；用 `s_client` 對每一台後端分別檢查 |
| nginx 啟動失敗：`key values mismatch` | 憑證與私鑰不是同一對 | 確認用的是同一次申請產生的私鑰 |
| 用 `curl -k` 或關閉驗證「暫時」解決 | 憑證驗證被關掉，連線可被冒充 | 修正憑證本身，不要關驗證 |

## 動手

1. 執行上面那段 SAN 比對的 Python，加幾個名字試試，例如 `*.dept.example.org` 對 `his.dept.example.org`。
2. 在能連外網的機器上，對任一 HTTPS 網站跑 `openssl s_client … | openssl x509 -noout -dates -subject -ext subjectAltName`，找出它的到期日與涵蓋的名字。
3. 對 `incomplete-chain.badssl.com` 跑 `openssl s_client -connect incomplete-chain.badssl.com:443 -servername incomplete-chain.badssl.com </dev/null`，看缺中繼憑證時的輸出。
4. 列出一個服務的憑證放在哪幾個地方、誰負責續約、哪裡監控到期日。三個問題任一個答不出來，就是下一次到期事故的來源。
5. 想回頭看 TLS 在連線中的位置，讀 [網路通不通](#/skill/network-troubleshooting) 的第 6 層。
