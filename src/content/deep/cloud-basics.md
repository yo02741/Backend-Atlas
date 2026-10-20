## 從一個具體問題開始：上雲第一個月

一個三人團隊把產品搬上公有雲：一個 API、一個 PostgreSQL、一個 SPA 前端。為了快，他們開了一台有公網 IP 的虛擬機，API、資料庫、nginx 全部裝在上面；防火牆規則開了 22（SSH）與 5432（方便從筆電連資料庫），來源都是 `0.0.0.0/0`；API 上傳檔案到物件儲存用的是一組具有完整管理權限的存取金鑰，寫在主機的 `.env` 裡。

一個月後：

- 資料庫的 log 裡每分鐘都有來自世界各地的登入失敗：`FATAL:  password authentication failed for user "postgres"`。5432 對整個網際網路開放，自動化掃描幾分鐘內就會找到它。
- 帳單比估算高了一截，明細裡有幾項沒預料到：建立網路時精靈順手建的 **NAT gateway**（按小時計費加上流量處理費）、開發與測試環境的虛擬機 24 小時開著、使用者直接從主機下載圖片產生的**對外流量**。
- 主機的磁碟壞了一次，從快照還原時發現最新的快照是三週前的。

這些都不是雲端特有的技術難題，而是沒有用到雲端提供的基本元件：私有網路與子網、安全群組、受管資料庫、IAM 角色、負載平衡器。這一課逐一講這些元件；放在地端、雲端還是混合的取捨，見 [地端、雲端還是混合雲](#/skill/hosting-models)。

## 服務模型與常見元件

| 模型 | 你給什麼 | 業者負責到哪 | 例子 |
|---|---|---|---|
| IaaS | 作業系統以上全部 | 實體機房、硬體、虛擬化 | 虛擬機、區塊儲存、虛擬網路 |
| PaaS | 程式碼或容器 image、設定 | 再加上作業系統、執行環境、擴縮 | 容器平台、受管資料庫、serverless 函式 |
| SaaS | 帳號與資料 | 整個應用程式 | 寄信服務、監控服務、身分驗證服務 |

同一個系統通常混用三種：API 跑在容器平台（PaaS）、資料庫用受管服務（PaaS）、寄信用外部服務（SaaS），少數需要特殊設定的東西才用虛擬機（IaaS）。各家的名字不同，概念大致對得起來：

| 元件 | AWS | Google Cloud | Azure |
|---|---|---|---|
| 虛擬機 | EC2 | Compute Engine | Virtual Machines |
| 容器平台 | ECS（含 Fargate） | Cloud Run | Container Apps |
| 受管 Kubernetes | EKS | GKE | AKS |
| serverless 函式 | Lambda | Cloud Run functions | Azure Functions |
| 受管 PostgreSQL | RDS for PostgreSQL、Aurora | Cloud SQL、AlloyDB | Azure Database for PostgreSQL |
| 物件儲存 | S3 | Cloud Storage | Blob Storage |
| 虛擬網路 | VPC | VPC | Virtual Network（VNet） |
| 網路存取規則 | Security group、Network ACL | VPC firewall rules | Network security group |
| 負載平衡 | Elastic Load Balancing（ALB、NLB） | Cloud Load Balancing | Load Balancer、Application Gateway |
| 身分與權限 | IAM | IAM | Microsoft Entra ID + Azure RBAC |
| 秘密管理 | Secrets Manager | Secret Manager | Key Vault |

後面的說明以 AWS 的用語為主，另外兩家的差異會特別註明。

## 區域與可用區

- **區域**（region）：一個地理區域，例如 Google Cloud 的 `asia-east1` 位於台灣。資料放在哪個區域，就實際存在那裡的機房。
- **可用區**（availability zone，AZ）：區域內彼此獨立的機房群，各自有電力、冷卻與網路，之間用低延遲的專線相連。一個 AZ 失效時，其他 AZ 應該不受影響。

選區域時看：離使用者近（延遲）、法規與資料落地的要求、需要的服務在那個區域有沒有提供（不是每個區域都有全部服務）、價格（同一個服務在不同區域價格不同）。

資源有不同的範圍：

| 範圍 | 例子 | 意思 |
|---|---|---|
| 可用區 | 虛擬機、區塊儲存磁碟、AWS 的子網 | 那個 AZ 掛了，它就跟著掛 |
| 區域 | 多 AZ 的受管資料庫、負載平衡器、物件儲存 bucket、Google Cloud 與 Azure 的子網 | 業者在區域內的多個 AZ 之間處理備援 |
| 全域 | IAM、多數 DNS 服務 | 不屬於特定區域 |

**高可用的基本做法是跨 AZ**：至少兩個 AZ 各有一份 API、資料庫有另一個 AZ 的備援、負載平衡器同時接到兩邊。跨區域（multi-region）的成本與複雜度高很多，多數服務用不到。另外要知道，跨 AZ 的流量在部分業者是要收費的。

## VPC 與子網

**VPC**（Virtual Private Cloud）是你在雲端上的一段私有網路，用一個 CIDR 位址範圍定義，例如 `10.20.0.0/16`。私有位址通常從這三段裡選（RFC 1918）：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`。

VPC 再切成**子網**（subnet）。子網的差別在於它的**路由表**：

| 子網類型 | 路由表裡 `0.0.0.0/0` 指向 | 放什麼 |
|---|---|---|
| 公開子網 | Internet gateway：可以直接進出網際網路 | 負載平衡器、NAT gateway、少數需要公網 IP 的東西 |
| 私有子網 | NAT gateway：只能**主動對外**連線（下載套件、呼叫外部 API），外面連不進來 | API 伺服器、背景工作 |
| 隔離子網 | 沒有對外路由 | 資料庫 |

在 AWS，一個子網屬於單一 AZ，所以每一種子網要在每個 AZ 各建一個。Google Cloud 的子網是區域範圍、跨所有可用區。

規劃位址時要注意：

- **不要和會互連的網路重疊**。之後要用 VPN 接公司網路、和另一個 VPC 對接（peering）時，位址範圍重疊就接不起來，事後改非常痛苦。
- **預留空間**。Kubernetes 這類平台可能讓每個 Pod 拿一個 VPC 位址，位址消耗很快。
- 每個子網會有幾個位址被業者保留（AWS 是每個子網 5 個），實際可用的比 CIDR 算出來的少。

下面用標準函式庫的 `ipaddress` 規劃子網並檢查重疊，可以直接執行：

```python run
import ipaddress

vpc = ipaddress.ip_network("10.20.0.0/16")
office = ipaddress.ip_network("10.20.128.0/20")      # 公司內網：之後要用 VPN 接進來

# 把 /16 切成 /20（每塊 4096 個位址），依序分配
blocks = vpc.subnets(new_prefix=20)
plan = {}
for name in ["public-a", "public-b", "app-a", "app-b", "db-a", "db-b"]:
    plan[name] = next(blocks)

for name, net in plan.items():
    usable = net.num_addresses - 5                     # AWS 每個子網保留 5 個位址
    print(f"{name:<9} {str(net):<15} 可用 {usable:>5} 個  範圍 {net[0]} – {net[-1]}")

print("\n和公司內網重疊？", vpc.overlaps(office), f"（{office} 在 VPC 範圍內，VPN 會接不起來）")
alt = ipaddress.ip_network("10.21.0.0/16")
print(f"改用 {alt}：重疊？", alt.overlaps(office))
print("10.20.33.7 在哪個子網？", [n for n, net in plan.items() if ipaddress.ip_address("10.20.33.7") in net])
```

### 私有子網怎麼對外

私有子網裡的 API 要拉 image、呼叫金流 API，需要 NAT gateway。NAT gateway 通常按**存在的時數**加上**經過的流量**計費，而且每個 AZ 各一個才有高可用。流量大的對象（例如同區域的物件儲存、image registry）可以改走 **VPC endpoint**，流量不經過 NAT，也不離開業者的網路；AWS 的 S3 gateway endpoint 本身不另外收費，其他類型的 endpoint 依業者計費。

## 安全群組：誰可以連誰

**安全群組**（security group）是掛在資源（虛擬機的網路介面、資料庫、負載平衡器）上的防火牆規則：

- **只有允許規則**：沒有被允許的就是拒絕。新建的安全群組預設沒有任何進入規則、允許所有對外連線。
- **有狀態**（stateful）：允許了進來的連線，回應會自動放行，不用另外寫出去的規則。
- **來源可以是另一個安全群組**：「允許來自 `app-sg` 的 5432」比「允許來自 10.20.32.0/20 的 5432」更精確，API 伺服器換 IP、擴縮都不用改規則。

另外還有掛在子網上的 **Network ACL**：無狀態（回程要另外允許）、有允許也有拒絕、依編號順序比對。多數情況下用安全群組就夠，NACL 保持預設。Google Cloud 的 VPC firewall rules 與 Azure 的 NSG 都支援允許與拒絕規則並有優先順序，概念介於兩者之間。

一個 API + 資料庫的典型規則：

| 安全群組 | 掛在 | 允許進入 | 來源 |
|---|---|---|---|
| `lb-sg` | 負載平衡器 | TCP 443、80（80 只用來轉址到 HTTPS） | `0.0.0.0/0` |
| `app-sg` | API 伺服器 | TCP 8000 | `lb-sg` |
| `db-sg` | 受管資料庫 | TCP 5432 | `app-sg` |

SSH 不在表上：需要進主機時，用業者提供的連線服務（AWS Systems Manager Session Manager、Google Cloud 的 IAP、Azure Bastion 這類）或跳板機，而不是對全世界開 22。開發者要查資料庫，也是經過這些通道，而不是把 5432 打開。

下面模擬安全群組的判斷：只有允許規則、來源可以是 CIDR 或另一個安全群組。可以直接執行：

```python run
import ipaddress

# 每台機器：IP 與它掛的安全群組
hosts = {
    "internet": {"ip": "203.0.113.9", "sgs": []},
    "lb":       {"ip": "10.20.0.12",  "sgs": ["lb-sg"]},
    "app-1":    {"ip": "10.20.32.5",  "sgs": ["app-sg"]},
    "db":       {"ip": "10.20.64.20", "sgs": ["db-sg"]},
}
# 進入規則：(安全群組, 埠, 來源)；來源是 CIDR 或另一個安全群組的名字
rules = [
    ("lb-sg",  443,  "0.0.0.0/0"),
    ("app-sg", 8000, "lb-sg"),
    ("db-sg",  5432, "app-sg"),
]

def allowed(src, dst, port):
    for sg in hosts[dst]["sgs"]:
        for rule_sg, rule_port, source in rules:
            if rule_sg != sg or rule_port != port:
                continue
            if source.endswith("-sg"):
                if source in hosts[src]["sgs"]:
                    return True, f"{sg} 允許來自 {source} 的 {port}"
            elif ipaddress.ip_address(hosts[src]["ip"]) in ipaddress.ip_network(source):
                return True, f"{sg} 允許來自 {source} 的 {port}"
    return False, "沒有任何允許規則：拒絕（對方看到的是連線逾時）"

for src, dst, port in [("internet", "lb", 443), ("lb", "app-1", 8000), ("app-1", "db", 5432),
                       ("internet", "db", 5432), ("lb", "db", 5432), ("internet", "app-1", 22)]:
    ok, why = allowed(src, dst, port)
    print(f"{src:>8} -> {dst:<5}:{port:<5} {'允許' if ok else '拒絕'}  {why}")
```

被安全群組擋掉的封包是**直接丟棄**，用戶端看到的是連線逾時，而不是 `Connection refused`。這個差別是排查的重要線索：refused 代表封包到了、但那個埠沒人在聽；逾時通常代表中間被擋了。完整的排查順序見 [網路通不通：從 DNS 到防火牆](#/skill/network-troubleshooting)。

## 負載平衡器

雲端的負載平衡器是受管服務：業者負責它本身的高可用與擴充，你設定規則。

- **L7（HTTP / HTTPS）**：AWS 的 ALB、Google Cloud 的 Application Load Balancer 這類。可以依網域與路徑分派、終結 TLS，而且通常能**掛受管憑證、自動續約**。
- **L4（TCP / UDP）**：AWS 的 NLB 這類，只轉送連線，延遲低、可以處理非 HTTP 的協定。

它放在公開子網、跨多個 AZ，後面的 API 放在私有子網。設定時要確認：

- **健康檢查**打哪個路徑、預期什麼狀態碼；後端的 `/ready` 該檢查什麼見 [應用伺服器與程序管理](#/skill/process-servers)。
- **閒置逾時**：負載平衡器對閒置連線的逾時，要和後端的 keep-alive 搭配（後端較長），否則會有零星的 502。
- **真實客戶端 IP**：後端看到的來源是負載平衡器，要從 `X-Forwarded-For` 取得，並只信任負載平衡器加的部分。

演算法、TLS 終結的位置與真實 IP 的信任邊界見 [負載平衡](#/skill/load-balancing)。

## 受管資料庫

把 PostgreSQL 裝在自己的虛擬機上，備份、修補、監控、故障切換都是自己的事。受管資料庫把這些變成設定：

| 功能 | 做什麼 | 要注意 |
|---|---|---|
| 自動備份 + PITR | 每日快照加上交易日誌，可以還原到保留期內的任一時間點 | 保留期要設；**定期實際演練還原**，備份沒還原過等於沒有 |
| 多 AZ 備援 | 另一個 AZ 有一台同步複寫的備用機，主機故障時自動切換 | 切換期間連線會斷，通常要一段時間（以業者文件為準）；應用程式要能重連；備用機通常也要計費 |
| 唯讀副本 | 非同步複寫的副本，分擔讀取 | 有複寫延遲，剛寫入的資料可能還讀不到 |
| 維護時段 | 業者在你指定的時段套用小版本修補 | 選離峰時段；大版本升級多半仍要自己決定時機與測試 |
| 參數設定 | `max_connections`、`statement_timeout`、log 設定 | 改某些參數需要重啟 |

仍然是你的責任：schema 與索引、慢查詢、連線數（見 [應用伺服器與程序管理](#/skill/process-servers) 的連線池計算）、資料的存取權限、規格選擇與成本。

網路上：資料庫放在隔離或私有子網、**關閉公開存取**、安全群組只允許 `app-sg`。連線用 TLS，帳密放在秘密管理服務，不寫在程式碼或 image 裡（見 [環境設定與 12-factor](#/skill/config-12factor)）。

## 物件儲存

使用者上傳的檔案、報表、備份、前端的靜態檔，放在物件儲存（S3、Cloud Storage、Blob Storage），而不是虛擬機的磁碟：容量不用預先規劃、多台 API 都讀得到、耐久性由業者負責。瀏覽器透過 presigned URL 直接上傳下載，檔案不經過 API；bucket 預設私有、開啟版本控制與生命週期規則。細節見 [物件儲存：檔案不要放在應用程式主機上](#/skill/object-storage)。前端靜態檔通常再加一層 CDN，減少從儲存直接對外的流量。

## IAM 與最小權限

IAM（Identity and Access Management）決定**誰**可以對**哪個資源**做**什麼動作**。

- **身分**：人（使用者，最好透過公司的單一登入）、工作負載（角色 / service account）。
- **政策**：一份允許或拒絕的規則，列出動作、資源與條件。
- **判斷規則**（以 AWS 為例）：預設全部拒絕；有允許才可以；**明確的拒絕永遠優先**於允許。

幾條基本原則：

1. **主帳號（root / 帳單擁有者）只用來做極少數的帳號層級操作**：開 MFA、不建立存取金鑰、日常不登入。
2. **工作負載用角色，不用長期金鑰**。虛擬機、容器、函式可以掛一個角色，平台自動提供會過期、會輪換的短效憑證（AWS 的 instance profile 與 task role、Google Cloud 的 attached service account、Kubernetes 上的 workload identity）。開頭那組寫在 `.env` 的管理員金鑰，主機被入侵就是整個帳號被接管。
3. **最小權限**：只給需要的動作、只給需要的資源。API 只需要讀寫某個 bucket 的 `uploads/` 底下：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::shop-prod-uploads/uploads/*"
    }
  ]
}
```

4. **權限不夠時，從錯誤訊息補上缺的那一個動作**，而不是直接換成 `*`。

下面模擬這套判斷規則（預設拒絕、允許、明確拒絕優先，萬用字元比對），可以直接執行：

```python run
from fnmatch import fnmatchcase

policies = [
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": ["arn:aws:s3:::shop-prod-uploads/uploads/*"]},
    {"Effect": "Allow", "Action": ["s3:*"],                          "Resource": ["arn:aws:s3:::shop-prod-uploads/*"]},   # 有人圖方便加的
    {"Effect": "Deny",  "Action": ["s3:DeleteObject"],               "Resource": ["*"]},                                  # 防護：一律不准刪
]

def evaluate(action, resource):
    matched_allow = False
    for p in policies:
        hit = any(fnmatchcase(action, a) for a in p["Action"]) and any(fnmatchcase(resource, r) for r in p["Resource"])
        if not hit:
            continue
        if p["Effect"] == "Deny":
            return "拒絕（明確拒絕優先）"
        matched_allow = True
    return "允許" if matched_allow else "拒絕（沒有任何允許：預設拒絕）"

checks = [
    ("s3:PutObject",    "arn:aws:s3:::shop-prod-uploads/uploads/u42/avatar.png"),
    ("s3:GetObject",    "arn:aws:s3:::shop-prod-uploads/reports/2026-10.csv"),
    ("s3:DeleteObject", "arn:aws:s3:::shop-prod-uploads/uploads/u42/avatar.png"),
    ("s3:GetObject",    "arn:aws:s3:::shop-prod-backups/db.dump"),
]
for action, resource in checks:
    print(f"{action:<16} {resource.split(':::')[1]:<45} {evaluate(action, resource)}")
```

第二條「圖方便加的」`s3:*` 讓 API 也能讀 `reports/` 底下的東西——權限就是這樣一點一點變寬的。把它刪掉再跑一次，看哪一列的結果改變。真實的 IAM 還有條件（來源 IP、是否用 MFA、標籤）、資源政策、權限邊界等層次，各家細節不同，以官方文件為準；授權模型的一般原則見 [RBAC 與 ABAC 授權模型](#/skill/rbac-abac)。

## 成本的主要來源

雲端帳單的結構大致是這幾類，各家計價細節不同，估算時以官方價格計算器為準：

| 類別 | 怎麼計費 | 常見的意外 |
|---|---|---|
| 運算 | 虛擬機、容器依規格 × 時數；函式依次數 × 執行時間 | 開發、測試環境 24 小時開著；規格開太大 |
| 受管資料庫 | 規格 × 時數 + 儲存 + 備份 + 部分服務的 I/O | 多 AZ 的備用機也算錢；保留太久的手動快照 |
| 區塊儲存 | **配置的**容量 × 時間（不是用了多少） | 刪掉虛擬機後留下的磁碟、越積越多的快照 |
| 物件儲存 | 容量 × 時間 + 請求次數 + 取出 | 大量小檔案的請求費；沒設生命週期，舊資料永遠留著 |
| 網路流量 | **流出**到網際網路通常要錢，流入通常免費；跨 AZ、跨區域也可能要錢 | 從主機直接提供圖片與下載；服務之間大量跨 AZ 呼叫 |
| NAT gateway | 時數 + 經過的流量 | 私有子網拉大量 image、資料走 NAT 而不是 VPC endpoint |
| 負載平衡器 | 時數 + 用量單位 | 每個小服務各開一個負載平衡器 |
| 公網 IPv4 位址 | 部分業者對公網 IPv4 位址按時數計費（AWS 自 2024 年起對所有公網 IPv4 收費） | 很多台機器各自有公網 IP |
| log 與監控 | 寫入量 + 保存時間 | debug 等級的 log 開在正式環境；保存期設成永久 |

控制成本的基本動作：

- **設定預算與告警**，帳單異常時第一天就知道，而不是月底。
- **所有資源打標籤**（環境、服務、負責人），才分得出錢花在哪裡。
- 非正式環境下班自動關機或縮到零；定期清掉沒在用的磁碟、快照、IP 位址。
- 用量穩定之後，再評估長期承諾的折扣方案（各家名稱不同）；一開始用量還在變，不要急著綁約。
- 容量怎麼估見 [硬體資源與容量規劃](#/skill/capacity-planning)。

## 調整後的架構

```text
                  Internet
                     │ 443 (80 → redirect)
          ┌──────────▼──────────┐
          │    Load balancer    │  public subnets, AZ-a + AZ-b, managed cert
          └──────────┬──────────┘
                     │ 8000, only from lb-sg
          ┌──────────▼──────────┐
          │  API containers x2  │  private subnets, AZ-a + AZ-b, IAM role
          └──────────┬──────────┘
                     │ 5432, only from app-sg
          ┌──────────▼──────────┐
          │ Managed PostgreSQL  │  db subnets, primary AZ-a + standby AZ-b
          └─────────────────────┘

  API ── VPC endpoint ──▶ object storage (browsers use presigned URLs)
  API ── NAT gateway ───▶ external APIs (payments, email)
  SPA static files: object storage + CDN
```

## 常見錯誤與錯誤訊息

| 現象 / 訊息 | 原因 | 怎麼查、怎麼修 |
|---|---|---|
| `connection to server at "…" (10.20.64.20), port 5432 failed: Connection timed out` | 封包被丟掉：安全群組沒允許、NACL 擋住、不在同一個 VPC 或沒有路由 | 檢查 `db-sg` 的來源是否包含連線端的安全群組；從**同一個子網**的機器測試 |
| 私有子網的機器 `docker pull` 或 `pip install` 卡住，最後 `dial tcp …:443: i/o timeout` | 私有子網沒有對外路由 | 加 NAT gateway 或對應的 VPC endpoint；確認路由表 |
| `An error occurred (AccessDenied) when calling the PutObject operation: Access Denied` | 這個身分沒有該動作或該資源的權限，或被明確拒絕、被 bucket 政策擋下 | 看錯誤中的動作與資源，補上最小的權限；確認程式實際用的是哪個身分 |
| 主控台、CLI 都找不到剛建的資源 | 看的是另一個區域，或另一個帳號 / 專案 | 確認 CLI 的預設區域與目前登入的帳號 |
| 建立資源時回報超過配額 | 帳號在該區域的配額（vCPU 數、IP 數…）到頂 | 申請提高配額；新帳號的預設配額通常偏低 |
| 多 AZ 資料庫切換後，API 一段時間全部錯誤 | 連線池裡還是連到舊主機的斷線連線 | 連線池開啟取用前檢查（例如 SQLAlchemy 的 `pool_pre_ping`），並設定重試 |
| 帳單出現陌生區域的大量運算費用 | 存取金鑰外洩，被拿去開機器 | 立刻停用金鑰、檢查稽核 log；改用角色、移除長期金鑰；業者偵測到外洩時也可能自動限制該金鑰 |
| 資料庫 log 滿是 `password authentication failed for user "postgres"` | 資料庫對網際網路開放 | 關閉公開存取、安全群組只允許應用程式 |

## 動手

1. 在 Playground 開啟子網規劃那段，把子網改成 `/24`，看每個子網可用幾個位址；再加一組 `cache-a`、`cache-b`。
2. 在安全群組那段加一條規則，讓公司 VPN 的網段 `10.99.0.0/16` 能連 `db:5432`，並加一台 `vpn-user`（IP `10.99.1.10`）驗證；想想這和「打開 5432 給 `0.0.0.0/0`」差在哪。
3. 在 IAM 那段刪掉 `s3:*` 那條政策，看哪些檢查的結果改變；再加一條只允許 `s3:GetObject` 到 `reports/*` 的政策。
4. 拿自己的一個專案，畫出和「調整後的架構」一樣的圖：每個元件放在哪種子網、安全群組允許什麼、用哪個身分存取什麼，再列出帳單上可能出現的每一個類別。
5. 決定要不要上雲、上哪一種，接著看 [地端、雲端還是混合雲](#/skill/hosting-models)；要上 Kubernetes 前看 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。
