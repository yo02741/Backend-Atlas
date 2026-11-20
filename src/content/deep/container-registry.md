## 從一個具體問題開始：同一個早上的三件事

週一早上，`clinic-api` 的 pipeline 一直失敗。資訊室的 Dockerfile 從院內 Harbor 的 `base` 專案 `FROM` 一個含 Informix 用戶端的 Python 3.12 slim 基底映像，再從 ghcr.io 複製 uv 的執行檔（`COPY --from=ghcr.io/astral-sh/uv:0.11.32`）。兩個 job 的錯誤節錄如下（確切文字依版本而異）：

```text
# build-base：每月重建基底映像，FROM python:3.12-slim
failed to resolve source metadata for docker.io/library/python:3.12-slim: ... 429 Too Many Requests
toomanyrequests: You have reached your unauthenticated pull rate limit. ...

# build-image：clinic-api 本身
failed to resolve source metadata for ghcr.io/astral-sh/uv:0.11.32: ... dial tcp ...:443: i/o timeout
```

第一個 job 拉 Docker Hub：全院經由同一個對外 IP 出去，未登入的拉取次數依來源 IP 計算，早上幾十條 pipeline 就用完了。第二個拉 ghcr.io，網路組上週收緊對外規則，它不在白名單裡。兩個 job 的 `image: docker:27` 與 `services: docker:27-dind` 也來自 Docker Hub，只是 Runner 上剛好有快取。

有人想把 `python:3.12-slim` 手動推進 Harbor 救急，登入後又看到兩件事：

- 儲存空間用了 92%。`clinic/api` 有一萬一千多個 tag，三年來每次合併推一個，從沒刪過。
- `clinic` 專案的成員裡有一位去年離職的同事，角色是 Developer，可以推送；CI 變數 `HARBOR_PASSWORD` 也是他的密碼。Harbor 用內建的資料庫帳號、沒接 AD，停用他的 AD 帳號影響不到這裡。

| 現象 | 原因 | 本課的段落 |
|---|---|---|
| 建置拉不到外部映像 | `FROM`、`COPY --from`、CI 的 `image:` 直接指向外部 registry | 外部映像 |
| 磁碟快滿 | 沒有保留規則；刪掉 tag 也不會馬上釋放空間 | 清理 |
| 離職同事還能推送，CI 用他的密碼 | 本機帳號不隨 AD 停用；CI 用個人帳號 | Harbor 的模型、CI 推送 |

明後年的 Kubernetes 叢集若是斷網或受限網路，三件事都會放大：節點拉不到外部映像，拉取用的憑證失效時，節點故障後重排的 Pod 起不來。

image、tag、digest 與多架構映像在 [Docker：image、container、layer](#/skill/docker-basics)；映像掃描在 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)；SBOM 與簽章在 [依賴與供應鏈安全](#/skill/supply-chain)；弱點的優先序在 [資安維運](#/skill/security-operations)。這一課講 registry 本身怎麼設、怎麼管。

## registry 存的是什麼

```text
clinic/api:c2f81b6a ────┐
clinic/api:release-1.4.0 ┴─→ manifest sha256:c2f8…
                                 ├─→ config sha256:7d1a…（啟動指令、環境變數）
                                 ├─→ layer  sha256:a1b2…（python:3.12-slim）    ← 其他版本也指向它
                                 ├─→ layer  sha256:c3d4…（Informix 用戶端）     ← 其他版本也指向它
                                 ├─→ layer  sha256:e5f6…（.venv）
                                 └─→ layer  sha256:0a9b…（程式碼）
```

- registry 存的是 **manifest**（一份 JSON，列出設定檔與每一層的 digest）、config 與 layer。config 與 layer 統稱 blob，以內容的 SHA-256 為名存放。多架構映像多一層索引（image index，舊稱 manifest list），再指向每個架構的 manifest。
- tag 是指向某個 manifest 或索引的名字，好幾個 tag 可以指向同一個 digest。
- 拉取時，client 先向 `/v2/<repository>/manifests/<tag>` 要 manifest，再下載本機沒有的 blob。
- 同一個 blob 在儲存空間裡只放一份，不管多少映像用到它。

由此推得三件事：

1. 刪掉 tag 只拿掉名字。沒有 tag 的 manifest 成為 untagged artifact，blob 照樣在磁碟上，要等垃圾回收（garbage collection，GC）把沒有任何 manifest 參照的 blob 刪掉。
2. 共用的 layer 不會因為刪掉一個映像而釋放。`clinic/api` 每個版本都帶著 130 MB 左右的基底層，磁碟上只有一份；刪掉一百個舊版本，釋放的多半只有程式碼層與換過版本的依賴層。
3. 介面上把每個映像的大小加起來，會遠大於實際占用的空間。

院內有自己的 registry，外部故障、限流或防火牆改規則時，已經在院內的映像照樣拉得到；拉取走院內網路；誰推了什麼、誰拉過都有紀錄；斷網的叢集也只能靠它。

## Harbor 的模型：專案、成員與機器人帳號

Harbor 是 CNCF 的開源 registry，在儲存映像之外加上權限、弱點掃描、保留規則、複製與代理快取。下面講設定的意義，以 Harbor 2.x 為準；選單位置與欄位名稱隨版本調整，以官方文件為準。

### 專案與角色

映像一定放在某個專案（project）底下：`harbor.example.org/<專案>/<repository>:<tag>`。成員、配額、掃描、保留與不可變規則、機器人帳號都設在專案上。公開專案任何人不用登入就能拉，私有專案只有成員能拉。Harbor 安裝後有一個預設的公開專案 `library`。

成員的內建角色由低到高是 Limited Guest、Guest、Developer、Maintainer、Project Admin（較新的版本也能自訂角色）：Guest 起能拉取，Developer 起就能推送，Maintainer 起能刪除與掃描映像，Project Admin 管成員與專案設定。人員通常只需要 Guest，推送交給 CI 的機器人帳號。院內可以這樣切專案：

| 專案 | 公開或私有 | 放什麼 | 誰能推送 |
|---|---|---|---|
| `base` | 私有 | 資訊室維護的基底映像（含 Informix 用戶端的 Python 3.12 slim） | 基底映像的 CI |
| `clinic` | 私有 | 門診系統的應用程式映像 | `clinic-api` 的 CI |
| `dockerhub-proxy`、`ghcr-proxy`、`quay-proxy` | 依院內規定 | 外部映像的代理快取 | 沒有人（代理快取專案不能推送） |
| `k8s` | 私有 | 斷網叢集要用的 Kubernetes 元件、附加元件與 Helm chart | 同步 job |

### 帳號從哪裡來：資料庫、LDAP 或 OIDC

Harbor 的驗證方式有三種：自己的資料庫、LDAP 或 AD、OIDC。官方文件要求部署時就選定，資料庫裡一旦有 admin 以外的本機帳號，就不能再切換到 LDAP；開頭那位同事的就是這種帳號。

- 接 LDAP 時，可以把 AD 群組加進專案並給角色（AD 端要有 `memberof` 屬性），人員異動跟著群組走，見 [企業身分：LDAP、AD、SAML 與 SCIM](#/skill/enterprise-identity)。
- 接 OIDC 時，`docker login` 不能走網頁登入，Harbor 給每位使用者一組 CLI secret 當密碼。離職流程要確認它也不能再用。
- 安裝設定檔裡的預設 admin 密碼，第一次登入後就換掉；admin 不給 CI 用。

### 機器人帳號

機器人帳號（robot account）給程式用，不能登入網頁介面，只能用 `docker`、`skopeo` 這類工具或 API。專案層級的只能操作所在的專案，名稱是 `robot$<專案>+<名稱>`；Harbor 2.2 起另有 system 層級的，由系統管理者建立，可以涵蓋多個專案、每個專案給不同權限（勾選「Cover all projects」時連之後新建的專案也包含）。建立時選權限（推送必須搭配拉取）與到期日；secret 只在建立時顯示一次，遺失或外洩就 refresh 產生新的，舊的立即失效。

| 用途 | 機器人帳號 | 權限 | 憑證放哪裡 |
|---|---|---|---|
| `clinic-api` 的 CI | system 層級 `robot$clinic-ci`，只勾 `clinic` 與 `base` | `clinic` 推送與拉取；`base` 只拉取（`FROM` 基底映像） | GitLab 的受保護變數，secret 另外勾遮蔽 |
| 叢集拉應用程式映像 | 專案層級 `robot$clinic+k8s-pull` | `clinic` 只拉取 | `clinic` namespace 的 pull secret |
| 基底映像的 CI | 專案層級 `robot$base+gitlab-ci` | `base` 推送與拉取 | 基底映像 repo 的受保護變數 |
| 斷網同步 | 專案層級 `robot$k8s+sync` | `k8s` 推送與拉取 | 跳板機上的憑證檔，只有同步帳號讀得到 |

到期那天什麼都不會壞，執行中的 Pod 不用再拉。壞在下一次需要拉取時：滾動更新、節點故障後 Pod 重排、新節點加入。到期日寫進維運日曆，到期前輪替（refresh secret、更新 GitLab 變數與 pull secret），見 [金鑰的範圍與壽命](#/skill/key-scope-lifetime)。機器人帳號不隨人員離職失效，每季列一次用途、權限與到期日，從專案的操作紀錄看是否還在用。

開頭那位同事的處理順序：先建好上表的機器人帳號，換掉 CI 變數與叢集的 pull secret，確認 pipeline 與 Pod 都正常，再移除他的成員資格、刪除帳號。順序反過來，pipeline 會立刻失敗。

## 推送之後：掃描、阻擋與不可變 tag

### 自動掃描

Harbor 內建 Trivy 當預設的弱點掃描器（Clair 在 v2.2 從預設移除，要用可以當外部掃描器接上）。Trivy 要在安裝時啟用：安裝程式加 `--with-trivy`，用 Helm chart 則看 chart 的設定。接著打開專案的「推送時自動掃描」與系統層級的排程全部重掃：推進來那天沒有已知弱點，三個月後可能就有，見 [資安維運](#/skill/security-operations)。

### 有高風險弱點就不准拉

專案設定的「Prevent vulnerable images from running」搭配一個嚴重度：映像有這個等級或更高的弱點時，Harbor 拒絕拉取。打開之前先知道它的效果：

- 擋的是拉取，節點與 CI 一樣被擋。新公告的弱點會讓昨天拉得到的映像今天拉不到；執行中的 Pod 不受影響，節點故障重排時才起不來。
- 沒掃過、掃描失敗或還在掃的映像也拉不到。
- 確認不受影響的弱點加進 CVE allowlist（系統或專案層級），每一筆寫下理由與複查日期。

先開自動掃描、只看報告一段時間，排好處理流程與 allowlist 的審核人，再對正式環境拉取的專案打開阻擋，等級從 Critical 開始。

斷網時，Harbor 的 Trivy 預設從 ghcr.io 下載弱點資料庫的那一步會失敗。`harbor.yml` 的 `trivy` 區段可以設 `skip_update`（資料庫檔自己搬進去）與 `offline_scan`，或用 `db_repository` 指向院內同步好的資料庫。資料庫停止更新時，掃描會一直回報沒有新弱點。

### 不可變 tag

Harbor 預設允許同一個 tag 重複推送，tag 移到新的 artifact，舊的變成 untagged，和 [Docker：image、container、layer](#/skill/docker-basics) 開頭兩台主機的 `latest` 是同一件事。不可變規則（tag immutability）設在專案上，用 repository 與 tag 的樣式比對；符合的 tag 推過一次之後，不能被覆蓋、重新標記或被複製覆寫，它指向的 artifact 也不能刪。再推一次同名的 tag：

```text
Failed to process request due to 'clinic/api:release-1.4.0' configured as immutable.
```

`release-*` 適合設成不可變。每個 commit 的 SHA tag 不要設：不可變的 artifact 刪不掉，保留規則也清不掉，磁碟會一直長。

:::stop 讀到這裡可以先停：知道 registry 存的是 manifest 與 layer，會用 Harbor 的專案、角色與機器人帳號分權限，設好推送後掃描。後面的清理、外部映像、CI 推送、叢集拉取與斷網搬運，在磁碟快滿、Docker Hub 限流或要準備斷網叢集時再回來讀。

## 清理：保留規則、垃圾回收與配額

### 保留規則

保留規則（tag retention）設在專案上，指定套用的 repository（`**` 是全部），每條規則選一種保留條件，再用 tag 樣式限定範圍：

| 保留條件 | 意思 |
|---|---|
| 最近推送的 N 個、最近拉取的 N 個 | 依推送或最後拉取的時間，數量上限 N |
| N 天內推送的、N 天內拉取的 | 依時間，沒有數量上限 |
| 一律保留 | 通常搭配 `release-*` 這類樣式 |

官方文件描述的幾個行為，第一次設定時常讓人意外：

- 規則只寫要保留什麼，沒被任何一條保留的就刪。規則之間是 OR。
- 「最近 N 個」在每個 repository 各自計算。
- 比對看 tag，刪除以 artifact 為單位：同一個 digest 只要有一個 tag 被保留，其他 tag 一起留下。
- 沒有 tag 的 artifact 預設不在規則範圍內（除非勾選包含 untagged），執行時會被刪。
- 一個專案最多 15 條規則，共用一個排程。執行後無法復原，先 dry run。

Harbor 只知道推送時間、拉取時間與 tag 名稱，不知道哪個映像正在叢集裡跑。節點用 `imagePullPolicy: IfNotPresent` 時，映像拉過一次就用快取，一個跑了兩個月的版本，在 Harbor 看來就是兩個月沒人拉。下面的模擬從 `clinic/api` 挑 12 個代表性的 artifact，套用三條規則，再加一道「部署中的不刪」的安全網，最後算能釋放多少空間：

```python run
from datetime import date
from fnmatch import fnmatch

TODAY = date(2026, 11, 16)
# Harbor 上設定的三條保留規則
KEEP_LATEST = 5            # 最近推送的 N 個
PULLED_WITHIN = 30         # N 天內拉取過的
PATTERNS = ("release-*",)  # 符合這些樣式的 tag 一律保留

# 每一層的大小（MB）。py-* 是 python:3.12-slim 的層，ifx-* 是 Informix 用戶端，
# venv-* 是裝好的依賴，app-* 是程式碼。基底每月重建，這裡只畫 2024 與 2026 兩版
LAYERS = {
    "py-2024": 48, "ifx-2024": 85, "py-2026": 50, "ifx-2026": 88,
    "venv-a": 61, "venv-b": 64, "venv-c": 66,
}

def size(layer):
    return LAYERS.get(layer, 0.4)   # 沒列出的是程式碼層，每層約 0.4 MB

BASE_2024 = ["py-2024", "ifx-2024"]
BASE_2026 = ["py-2026", "ifx-2026"]

# clinic/api 這個 repository 裡的 artifact（一個 digest 可以有好幾個 tag）
artifacts = [
    {"digest": "sha256:a01", "tags": ["9c41e2d0"], "pushed": "2024-01-15", "last_pulled": "2024-01-20",
     "deployed": False, "layers": BASE_2024 + ["venv-a", "app-a01"]},
    {"digest": "sha256:a02", "tags": ["5b7a10fe", "release-1.0.0"], "pushed": "2024-03-02", "last_pulled": "2024-06-30",
     "deployed": False, "layers": BASE_2024 + ["venv-a", "app-a02"]},
    {"digest": "sha256:a03", "tags": ["e18c3b77"], "pushed": "2025-02-10", "last_pulled": "2025-02-11",
     "deployed": False, "layers": BASE_2024 + ["venv-b", "app-a03"]},
    {"digest": "sha256:a04", "tags": ["77d0a9c4", "release-1.3.0"], "pushed": "2025-09-01", "last_pulled": "2025-10-01",
     "deployed": False, "layers": BASE_2024 + ["venv-b", "app-a04"]},
    {"digest": "sha256:a05", "tags": ["c2f81b6a", "release-1.4.0"], "pushed": "2026-08-03", "last_pulled": "2026-08-04",
     "deployed": True, "layers": BASE_2026 + ["venv-c", "app-a05"]},
    # 九月的緊急修正：直接用 commit SHA 部署到正式環境，沒有打 release tag
    {"digest": "sha256:a06", "tags": ["3a9d5e01"], "pushed": "2026-09-10", "last_pulled": "2026-09-11",
     "deployed": True, "layers": BASE_2026 + ["venv-c", "app-a06"]},
]
# 十月、十一月的日常合併：每個 commit 一個 tag，測試環境拉過
for i, (sha, pushed, pulled) in enumerate([
    ("41be0c77", "2026-10-05", "2026-10-05"), ("8f02d9e3", "2026-10-19", "2026-10-20"),
    ("d7a3c510", "2026-10-28", "2026-10-28"), ("0b6e4f21", "2026-11-04", "2026-11-05"),
    ("f93c2a8d", "2026-11-11", "2026-11-12"), ("6e15b0aa", "2026-11-14", None),
]):
    artifacts.append({"digest": f"sha256:b{i:02d}", "tags": [sha], "pushed": pushed, "last_pulled": pulled,
                      "deployed": False, "layers": BASE_2026 + ["venv-c", f"app-b{i:02d}"]})

# base/python-informix 這個 repository 本身也持有基底映像的層
REFERENCED_ELSEWHERE = set(BASE_2024 + BASE_2026)

def days_since(d):
    return (TODAY - date.fromisoformat(d)).days if d else None

def harbor_rules(arts, keep_latest, pulled_within, patterns):
    """回傳 {digest: 保留的理由}。規則之間是 OR；一個 tag 符合，整個 artifact 保留"""
    reasons = {}
    newest = sorted(arts, key=lambda a: a["pushed"], reverse=True)[:keep_latest]
    for a in newest:
        reasons.setdefault(a["digest"], []).append(f"最近推送的 {keep_latest} 個")
    for a in arts:
        age = days_since(a["last_pulled"])
        if age is not None and age <= pulled_within:
            reasons.setdefault(a["digest"], []).append(f"{age} 天前被拉過")
        hit = [t for t in a["tags"] if any(fnmatch(t, p) for p in patterns)]
        if hit:
            reasons.setdefault(a["digest"], []).append(f"tag {hit[0]} 符合")
    return reasons

def plan(arts, keep_latest, pulled_within, patterns):
    reasons = harbor_rules(arts, keep_latest, pulled_within, patterns)
    keep, delete, at_risk = [], [], []
    for a in arts:
        if a["digest"] in reasons:
            keep.append(a)
        elif a["deployed"]:
            keep.append(a)
            at_risk.append(a)      # Harbor 的規則會刪掉它，但它正在跑
        else:
            delete.append(a)
    kept_layers = {l for a in keep for l in a["layers"]} | REFERENCED_ELSEWHERE
    freed = {l for a in delete for l in a["layers"]} - kept_layers
    return reasons, keep, delete, at_risk, freed

reasons, keep, delete, at_risk, freed = plan(artifacts, KEEP_LATEST, PULLED_WITHIN, PATTERNS)

print(f"{'tag':<28} {'推送':<11} {'最後拉取':<11} 結果")
for a in artifacts:
    tags = ",".join(a["tags"])
    if a in at_risk:
        verdict = "保留（安全網：正在部署中，Harbor 的規則會刪）"
    elif a in keep:
        verdict = "保留：" + "、".join(reasons[a["digest"]])
    else:
        verdict = "刪除"
    print(f"{tags:<28} {a['pushed']:<11} {a['last_pulled'] or '從未':<11} {verdict}")

total = sum(size(l) for l in {l for a in artifacts for l in a["layers"]} - REFERENCED_ELSEWHERE)
tag_size = sum(size(l) for a in delete for l in a["layers"])
print(f"\n刪除 {len(delete)} 個 artifact、{sum(len(a['tags']) for a in delete)} 個 tag")
print(f"把每個被刪映像的大小直接相加：{tag_size:.0f} MB（介面上的映像大小加總，會重複計算共用的層）")
print(f"刪 tag 當下釋放：0 MB（layer 還在儲存空間裡，要等垃圾回收）")
print(f"垃圾回收後釋放：{sum(size(l) for l in freed):.1f} MB，來自 {sorted(freed)}")
print(f"這個 repository 自己的層總共 {total:.1f} MB（不含 base 專案共用的基底層）")
```

輸出有三點要看：

- `3a9d5e01` 是九月直接用 commit SHA 部署的緊急修正，三條規則都保不住它。真的刪下去，正式環境照常運作，直到某台節點故障、Pod 重排到沒有快取的節點，才出現 `ImagePullBackOff`。
- `5b7a10fe` 自己不符合任何規則，因為同一個 digest 有 `release-1.0.0` 而一起保留。
- 刪掉 3 個映像，介面上的大小加總是 596 MB，垃圾回收後只釋放 1.2 MB：依賴層還被保留的 release 版本用著，基底層由 `base` 專案持有。

`clinic` 專案可以用這一組：`release-*` 一律保留（同時設成不可變）、最近推送的 20 個、30 天內拉取過的。部署端再訂一條規矩：正式環境只部署 release tag，緊急修正事後補打。定期把叢集裡實際在跑的映像（`kubectl get pods -A -o jsonpath='{..image}'`）和 Harbor 比對。

### 垃圾回收

依 Harbor 的文件：垃圾回收刪掉不再被任何 manifest 參照的 blob，可以勾選先刪除 untagged artifact；dry run 列出可刪的 blob 並估算能釋放的空間；最近 2 小時內上傳的 blob 不會被刪，避免刪到正在推送的映像；執行期間照樣可以推送與拉取（很舊的版本要先切唯讀）。開頭那一萬一千個 tag，第一次清理依序做保留規則 dry run、執行、垃圾回收 dry run、執行；之後排成每週固定時段，保留規則先、垃圾回收後。

### 配額

專案可以設儲存空間上限，預設沒有上限；系統層級的預設配額只套用到之後新建的專案。超過時推送失敗，CI 的錯誤類似：

```text
adding 85.3 MiB of storage resource, which when updated to current usage of 49.9 GiB will exceed the configured upper limit of 50.0 GiB.
```

配額依專案計算，同一個 blob 被兩個專案用到時各算一次，加總可能大於實際磁碟用量。整座 Harbor 的磁碟用量與成長速度仍要另外監控，見 [硬體資源與容量規劃](#/skill/capacity-planning)。

## 外部映像：拉取次數、代理快取與同步

### Docker Hub 與其他公開 registry

Docker Hub 對未登入的使用者與免費帳號有拉取次數上限，付費方案沒有次數上限（另有合理使用規範）。數字與計算的時間窗 Docker 調整過好幾次，以官方文件的 Docker Hub usage and limits 頁面為準。對院內影響最大的是計算方式：

- 未登入的次數依來源 IP 計算（IPv6 以 /64 網段計）。全院經由同一個出口 IP 時，大家共用一份額度。
- 計算的是取得 manifest 的請求。只問 manifest 有沒有變的 HEAD 請求不算，Harbor 2.1.1 起的代理快取用 HEAD 檢查上游。

ghcr.io、quay.io、registry.k8s.io（Kubernetes 元件的官方來源）各有自己的使用規範。

### 三種把外部映像帶進院內的做法

| | 代理快取專案 | 複製（replication） | 同步 job（skopeo、crane） |
|---|---|---|---|
| 運作方式 | 第一次有人拉時向上游取並快取；再拉時先用 HEAD 檢查上游有沒有更新 | Harbor 依規則從外部 registry 拉進來，或推到另一座 Harbor；手動、排程或推送事件觸發 | 自己維護清單，排程複製 |
| 院內有哪些映像 | 有人拉過的 | 符合篩選條件的 | 清單上列的 |
| 上游斷線時 | 快取過的照樣能拉，沒快取過的拉不到 | 複製過的都在 | 同步過的都在 |
| 適合 | 受限網路：Harbor 能連外，節點與 Runner 不能 | 兩座 Harbor 之間，例如正式與災備 | 斷網環境；映像要先審核再放行 |

代理快取專案（proxy cache）在 Harbor 2.1 加入，官方建議用 2.1.1 以上以免被 Docker Hub 限流。系統管理者先建一個指向上游的 registry endpoint，建專案時打開 Proxy Cache 選它。上游可以是 Docker Hub、GitHub Container Registry、Quay、另一座 Harbor 等（清單依版本而定）。

- 代理快取專案不能推送。新建時 Harbor 預設帶一條 7 天的保留規則。
- endpoint 的上游帳號拉得到的，有這個代理專案權限的人都拉得到，上游帳號只給需要的權限；用 Docker Hub 帳號設定，額度也比匿名高。
- Docker Hub 的官方映像要寫出 `library/`：`python:3.12-slim` 的完整名稱是 `docker.io/library/python:3.12-slim`，院內位址是 `harbor.example.org/dockerhub-proxy/library/python:3.12-slim`。

複製要注意：官方文件寫明不同版本的 Harbor 之間的複製不支援，兩座要一起升級；手動與排程觸發不會複製刪除。

### 改寫 `FROM`、`COPY --from` 與 CI 的映像

```dockerfile
# base/python-informix/Dockerfile：資訊室的基底映像，每月重建
FROM harbor.example.org/dockerhub-proxy/library/python:3.12-slim
# ……安裝 Informix 用戶端（略）
```

```dockerfile
# clinic-api/Dockerfile
FROM harbor.example.org/base/python-informix:3.12-slim-2026.11 AS build
COPY --from=harbor.example.org/ghcr-proxy/astral-sh/uv:0.11.32 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

FROM harbor.example.org/base/python-informix:3.12-slim-2026.11
# build 是上面的階段名稱，不是映像，不用改
COPY --from=build /app/.venv /app/.venv
```

- 需要可重現時，基底映像再釘上 digest（`…:3.12-slim-2026.11@sha256:…`），由 Renovate 這類工具提出更新，見 [依賴與供應鏈安全](#/skill/supply-chain)。
- CI 的 `image:` 與 `services:` 一樣改成院內位址（下一節的範例）。GitLab Runner 自己的 helper 映像預設也從外部下載，斷網時要在 Runner 設定裡指向院內。

## CI 推送：機器人帳號、受保護變數與 digest

```yaml
build-image:
  stage: build
  image: harbor.example.org/dockerhub-proxy/library/docker:27
  services:
    - name: harbor.example.org/dockerhub-proxy/library/docker:27-dind
      alias: docker                  # 預設的主機名稱由映像名稱產生，改了位址就不叫 docker
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
    IMAGE: harbor.example.org/clinic/api
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH   # 受保護分支才拿得到受保護變數
  script:
    # HARBOR_ROBOT_USER 與 HARBOR_ROBOT_SECRET 設在專案的 CI/CD 變數：都勾 Protected，secret 另外勾 Masked
    - echo "$HARBOR_ROBOT_SECRET" | docker login -u "$HARBOR_ROBOT_USER" --password-stdin harbor.example.org
    - docker build --pull -t "$IMAGE:$CI_COMMIT_SHORT_SHA" .
    - docker push "$IMAGE:$CI_COMMIT_SHORT_SHA"
    # 推送後 RepoDigests 才有值；把 digest 交給後面的部署 job
    - echo "IMAGE_REF=$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE:$CI_COMMIT_SHORT_SHA")" > build.env
  artifacts:
    reports:
      dotenv: build.env              # 後面的 job 會拿到 $IMAGE_REF
```

- 用機器人帳號，不用任何人的個人帳號；`--password-stdin` 讓密碼不出現在指令列。受保護變數只注入受保護分支上的 pipeline，所以 job 用 `rules` 限定在預設分支，見 [GitLab CI/CD 實戰](#/skill/gitlab-cicd)。
- 機器人帳號的名稱有 `$`（`robot$clinic-ci`）。GitLab 預設會把變數值裡的 `$clinic` 當成另一個變數展開，帳號變成 `robot-ci`，登入失敗。`HARBOR_ROBOT_USER` 要取消勾選「Expand variable reference」，或在值裡寫成 `$$`；在 shell 裡用單引號。
- tag 用 commit SHA，不推 `latest`。發版時另外加 `release-<版本>` 的 tag（例如 `crane tag harbor.example.org/clinic/api:3f9c2a1b release-1.5.0`），由不可變規則保護。部署 job 用 `$IMAGE_REF`（`…/clinic/api@sha256:…`），叢集跑的是這次建出來的那一份。
- 參考專案 `companion/clinic-api` 用的是 GitLab Container Registry 的位址（`registry.gitlab.example/clinic/api`），換成 Harbor 只改 `image` 與登入步驟。

GitLab 內建的 Container Registry 每個專案一個，和 GitLab 的權限與 `CI_REGISTRY_PASSWORD` 這類預定義變數整合，推送不用另外管帳號，也有清理政策（自架版刪 tag 後同樣要跑垃圾回收）；GitLab 的 Dependency Proxy 也能代理 Docker Hub。Harbor 多的是多種上游的代理快取、與其他 registry 之間的複製、registry 端的掃描與阻擋拉取，以及專案層級的保留、不可變規則與配額。基底映像已經在 Harbor，應用程式映像也放 Harbor 的話，叢集只要信任一個 registry、管一組 pull secret。

## 叢集怎麼拉院內的映像

### pull secret 掛在 ServiceAccount 上

私有專案的映像要帶登入資訊才拉得到。Kubernetes 官方建議用 Pod 的 `imagePullSecrets`：Secret 的型別是 `kubernetes.io/dockerconfigjson`，而且要和 Pod 在同一個 namespace。

```bash
# 機器人帳號的名稱有 $，用單引號；正式環境的 Secret 由秘密管理流程建立
kubectl create secret docker-registry harbor-pull -n clinic \
  --docker-server=harbor.example.org \
  --docker-username='robot$clinic+k8s-pull' \
  --docker-password="$(cat robot-clinic-k8s-pull.secret)"
```

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: clinic-api
  namespace: clinic
automountServiceAccountToken: false
imagePullSecrets:
  - name: harbor-pull          # 之後用這個 ServiceAccount 建立的 Pod 會自動帶上
---
# Deployment 的 Pod 範本（節錄）
spec:
  template:
    spec:
      serviceAccountName: clinic-api
      containers:
        - name: api
          image: harbor.example.org/clinic/api@sha256:c2f8…   # CI 交出來的 IMAGE_REF
```

- 寫在 ServiceAccount 上，之後建立的 Pod 會自動帶上，已經存在的 Pod 不會。
- 讀得到這個 Secret 的人就有拉取權限，誰讀得到見 [Kubernetes 權限與多租戶](#/skill/k8s-rbac-tenancy)。機器人帳號只給拉取，外洩時的影響就只有拉 `clinic` 的映像。
- 另外兩種做法：在每台節點的容器執行環境設定登入資訊（所有 Pod 都能用），或用 kubelet 的 credential provider 外掛動態取得。

節點上的快取也牽涉權限：`imagePullPolicy: IfNotPresent` 時，節點上已有的映像以前不會再驗證，同一台節點上沒帶 pull secret 的 Pod 也能用，多租戶叢集要靠 AlwaysPullImages admission plugin 擋。Kubernetes 1.33 加入 `KubeletEnsureSecretPulledImages`（alpha），1.35 起為 beta 且預設開啟：kubelet 會確認 Pod 帶的憑證拉過這個映像；不是 kubelet 拉的映像（例如事先匯入節點的）預設不檢查，由 kubelet 設定的 `imagePullCredentialsVerificationPolicy` 決定。

### 節點要信任院內 CA

拉映像的是節點上的 containerd。Harbor 用院內 CA 簽的憑證時，每台節點都要信任院內 CA：裝進作業系統的信任清單，或在 containerd 的 registry 設定指定 `ca`，並寫進節點的建置流程；CI 的 dind 與開發機的 Docker 也一樣。憑證見 [HTTPS 憑證：要買哪種、怎麼續](#/skill/https-certificates)。

```toml
# /etc/containerd/certs.d/harbor.example.org/hosts.toml
# containerd 1.5 起的寫法；config.toml 要把 registry 的 config_path 設成 /etc/containerd/certs.d
# （containerd 2.x 的設定區段是 plugins."io.containerd.cri.v1.images".registry）
server = "https://harbor.example.org"

[host."https://harbor.example.org"]
  capabilities = ["pull", "resolve"]
  ca = "/etc/containerd/certs.d/harbor.example.org/hospital-root-ca.crt"
```

### 鏡像設定：只講概念

containerd 可以替某個 registry 設定鏡像（mirror）：manifest 寫 `docker.io/library/postgres:16`，containerd 實際向院內位址拿。設定放在 `certs.d/docker.io/hosts.toml`，`server` 設成院內位址時就只用院內、不回上游。Harbor 代理快取的路徑多一段專案名稱，拿它當 mirror 要讓 containerd 用帶專案名稱的路徑（`override_path`），細節以 containerd 與 Harbor 的文件為準。

鏡像不用改 manifest，代價是看不出 manifest 依賴外部來源，換一台沒設鏡像的節點就壞，斷網清單也容易漏列。自己維護的 manifest 明寫院內位址，鏡像當成第三方 chart 漏改時的備援。拉不到映像時的排查順序見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

## 斷網環境：列清單、複製、搬運

### 列出需要的映像

斷網叢集只拉得到院內有的映像。清單要從每一個會拉映像的地方列：

| 類別 | 從哪裡列 | 容易漏的 |
|---|---|---|
| 應用程式 | 自己的 manifest、Kustomize overlay 的 `images` | CronJob、Job、initContainers |
| 基底與建置 | Dockerfile 的 `FROM` 與 `COPY --from` | 多階段建置裡的工具映像 |
| CI | `.gitlab-ci.yml` 的 `image:` 與 `services:` | Runner 的 helper 映像 |
| Kubernetes 本身 | `kubeadm config images list --kubernetes-version <版本>` | 下一個要升級的版本 |
| 附加元件 | CNI、CSI、Ingress 或 Gateway controller、cert-manager、監控、Velero 的安裝檔 | 元件執行時才建立的 Pod 所用的映像，寫在啟動參數或設定裡 |
| Helm chart | `helm template` 的輸出；chart 本身也要進院內（Harbor 能存 OCI 格式的 chart） | 依 values 才啟用的子元件 |

下面的程式從幾份 manifest 與 `kubeadm config images list` 的輸出找出所有映像，補上省略的 registry 與 tag 後去重，標出還在用 `latest`、還指向外部，以及只出現在啟動參數裡的：

```python run
import re

INTERNAL = "harbor.example.org"

# 幾份要帶進斷網環境的 manifest（版本為示意）
manifests = {
    "clinic/base/deployment.yaml": """
spec:
  template:
    spec:
      containers:
        - name: api
          image: harbor.example.org/clinic/api:3f9c2a1b
""",
    "clinic/overlays/kind/postgres.yaml": """
      containers:
        - name: postgres
          image: postgres:16
""",
    "clinic/report-cronjob.yaml": """
          initContainers:
            - name: wait-db
              image: "busybox"
          containers:
            - name: report
              image: harbor.example.org/clinic/report:latest
""",
    # helm template cert-manager … 的輸出（節錄）
    "helm/cert-manager.yaml": """
      containers:
        - name: cert-manager-controller
          image: "quay.io/jetstack/cert-manager-controller:v1.19.1"
          args:
            - --acme-http01-solver-image=quay.io/jetstack/cert-manager-acmesolver:v1.19.1
""",
    "helm/monitoring.yaml": """
      containers:
        - name: grafana
          image: docker.io/grafana/grafana:12.2.1
        - name: sidecar
          image: quay.io/kiwigrid/k8s-sidecar@sha256:4f6c0d9a1b2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a
""",
}
# kubeadm config images list 的輸出（節錄）：控制平面的元件也是映像
kubeadm_images = """
registry.k8s.io/kube-apiserver:v1.35.2
registry.k8s.io/pause:3.10.1
registry.k8s.io/coredns/coredns:v1.12.1
"""

IMAGE_FIELD = re.compile(r"^\s*(?:-\s*)?image:\s*['\"]?([^'\"\s]+)")
IMAGE_ARG = re.compile(r"-image=([^\s'\"]+)")   # 寫在啟動參數裡的映像

def parse(ref):
    """把映像名稱拆成 (registry, repository, tag, digest)，補上省略的部分"""
    name, _, digest = ref.partition("@")
    first, _, rest = name.partition("/")
    if rest and ("." in first or ":" in first or first == "localhost"):
        registry, repo = first, rest
    else:
        registry, repo = "docker.io", name
        if "/" not in repo:
            repo = "library/" + repo          # 官方映像在 library 底下
    tag = None
    if ":" in repo.rsplit("/", 1)[-1]:
        repo, tag = repo.rsplit(":", 1)
    if tag is None and not digest:
        tag = "latest"                         # 什麼都沒寫，就是 latest
    return registry, repo, tag, digest or None

found = {}   # 完整名稱 → 出現在哪些檔案、是不是從參數裡找到的
sources = dict(manifests, **{"kubeadm config images list": kubeadm_images})
for path, text in sources.items():
    for line in text.splitlines():
        m = IMAGE_FIELD.match(line)
        refs = [(m.group(1), False)] if m else []
        if not m and path.startswith("kubeadm") and line.strip():
            refs = [(line.strip(), False)]
        refs += [(r, True) for r in IMAGE_ARG.findall(line)]
        for ref, from_arg in refs:
            reg, repo, tag, digest = parse(ref)
            full = f"{reg}/{repo}" + (f":{tag}" if tag else "") + (f"@{digest[:19]}…" if digest else "")
            entry = found.setdefault(full, {"files": set(), "arg": from_arg, "reg": reg, "tag": tag, "digest": digest})
            entry["files"].add(path)

print(f"共 {len(found)} 個不重複的映像\n")
for full, e in sorted(found.items()):
    flags = []
    if e["tag"] == "latest":
        flags.append("latest")
    if e["reg"] != INTERNAL:
        flags.append("外部，要同步")
    if e["arg"]:
        flags.append("在參數裡")
    print(f"{full}")
    print(f"    {'、'.join(flags) or '院內、固定版本'}　← {', '.join(sorted(e['files']))}")

to_sync = sorted(f for f, e in found.items() if e["reg"] != INTERNAL)
print(f"\n要同步進院內的外部映像：{len(to_sync)} 個；用 latest 的：{sum(e['tag'] == 'latest' for e in found.values())} 個")
```

- `busybox` 沒寫 registry 也沒寫 tag，完整名稱是 `docker.io/library/busybox:latest`。今天同步進來的 `latest`，和下次同步的不會是同一個。
- `clinic/report:latest` 在院內，但 tag 會移動，回退時沒有版本可以指。
- `cert-manager-acmesolver` 不在任何 `image:` 欄位，是 controller 執行時才拿來建 Pod 的。程式靠比對 `-image=` 參數找到它，換一種寫法就會漏。

從 manifest 推出來的清單總會漏幾個，最後要在一座同樣斷網的測試叢集裡完整安裝一次，看 `kubectl get events -A` 有沒有拉取失敗。

### 複製：保留 digest 與多架構

skopeo 與 crane 都不需要 Docker daemon，直接在 registry 之間搬 manifest 與 blob。指令只示意，旗標以各工具的文件為準：

```bash
# 在能連外、也能連院內 Harbor 的跳板機上執行
# skopeo：--all 複製每個架構與多架構索引；--preserve-digests 在 digest 保不住時直接失敗
skopeo copy --all --preserve-digests \
  docker://quay.io/jetstack/cert-manager-controller:v1.19.1 \
  docker://harbor.example.org/k8s/jetstack/cert-manager-controller:v1.19.1

# crane：預設複製所有架構，並保留 digest
crane copy registry.k8s.io/pause:3.10.1 harbor.example.org/k8s/pause:3.10.1

# 兩邊的 digest 要一樣
crane digest registry.k8s.io/pause:3.10.1
crane digest harbor.example.org/k8s/pause:3.10.1
```

- 用 `docker pull`、`docker tag`、`docker push` 搬，或 skopeo 沒加 `--all`，只會拿到執行機器那個架構的一份，多架構索引沒有過來。manifest 照上游用索引的 digest 釘版本時，院內會回 `manifest unknown`；跳板機是 arm64 筆電時，搬到的還是 arm64 那一份。
- 院內路徑照上游的路徑放在專案底下（`harbor.example.org/k8s/<上游路徑>`），改寫規則才單純。kubeadm 的 `imageRepository` 改成院內位址後，各元件的完整路徑以 `kubeadm config images list --image-repository harbor.example.org/k8s` 的輸出為準。

### 跨網段搬運

完全隔離的網段沒有一台機器同時連得到兩邊，映像要先存成檔案，經核可的管道搬進去：

```text
可連外的區域                     受控管道                       斷網區域
依清單存成目錄             →   雜湊清單、掃描、核可        →   核對雜湊、推進 Harbor
（skopeo sync --dest dir）      經核可的媒體或單向傳輸           → Harbor 掃描 → 測試叢集安裝驗證
```

```bash
# 1. 可連外的跳板機：依清單把映像存成目錄（清單格式與目錄命名見 skopeo-sync 的文件）
skopeo sync --all --src yaml --dest dir sync.yaml /transfer/images
# 2. 產生每個檔案的雜湊，跟著媒體一起送審
cd /transfer && find images -type f -exec sha256sum {} + > images.sha256
# 3. 斷網區域：核對雜湊後推進院內 Harbor
cd /transfer && sha256sum -c images.sha256 && \
  skopeo sync --all --src dir --dest docker images harbor.example.org/k8s
```

crane 也能做（`crane pull --format=oci`、`crane push`）。哪些映像能進來、誰核可、多久搬一次，寫成流程，見 [受監管環境的變更管理](#/skill/change-management)。Trivy 的弱點資料庫也走同一條路。

### 升級前先同步

Kubernetes 升級前，新版本的控制平面映像、相容版本的 CNI、CSI、controller 與 Helm chart 一次搬進來，先在斷網的測試叢集升一次，升級的順序見 [Kubernetes 叢集維運](#/skill/k8s-operations)。套件庫等其他下載來源見 [地端、雲端還是混合雲](#/skill/hosting-models) 的斷網一節。

## 常見錯誤與錯誤訊息

訊息的確切文字依版本與工具而異，下面是類似的樣子：

| 訊息或現象 | 原因 | 怎麼修 |
|---|---|---|
| `toomanyrequests: You have reached your … pull rate limit` | Docker Hub 的拉取次數用完 | 改走代理快取，endpoint 用 Docker Hub 帳號 |
| `unauthorized to access repository: clinic/api, action: push` | 沒有推送權限、機器人帳號過期或停用 | 看機器人帳號的權限與到期日 |
| CI 的 `docker login` 失敗，同一組帳密在自己電腦上登得進去 | GitLab 把 `robot$clinic-ci` 裡的 `$clinic` 當成變數展開 | 取消勾選「Expand variable reference」，或寫成 `$$` |
| `… configured as immutable.` | 不可變的 tag 不能重推 | 用新的版本號 |
| `… cannot be pulled due to configured policy in 'Prevent images with vulnerability severity of "High" or higher from running.'` | 有該等級以上的弱點；或還沒掃、掃描失敗 | 重建以拉到修補過的基底；不受影響的加進 allowlist |
| 用 digest 釘版本的映像拉取時 `manifest unknown` | 複製時沒有帶多架構索引 | `skopeo copy --all --preserve-digests` 或 `crane copy` 重新複製，比對 digest |
| `x509: certificate signed by unknown authority` | 那個 containerd 或 Docker（含 CI 的 dind）不信任院內 CA | 每台節點與 dind 都放院內 CA |
| CI 改用院內位址的 dind 後 `Cannot connect to the Docker daemon` | 服務的主機名稱由映像名稱產生，不再叫 `docker` | `services:` 加 `alias: docker` |
| 節點故障後重排的 Pod 停在 `ImagePullBackOff`，其他 Pod 正常 | pull secret 的機器人帳號過期、映像被保留規則刪了、或新弱點觸發阻擋 | `describe pod` 的 Events，見 [Kubernetes 排錯](#/skill/k8s-troubleshooting) |

## 動手

1. 執行保留規則的模擬。把 `PATTERNS` 改成 `("release-1.[34]*",)`，看垃圾回收多釋放哪一層；再把 `REFERENCED_ELSEWHERE` 改成空集合（假設 `base` 專案也清掉了 2024 年的基底），先預測再執行。
2. 執行映像清單的程式，把 `busybox` 改成 `busybox:1.37`、把報表的 tag 改成 commit SHA，看標記怎麼變；再貼一份 `helm template` 的輸出進去。
3. 做本課的程式題：實作保留規則；把 Dockerfile 的外部映像改寫成代理快取的位址。
4. 依 [本機叢集指南](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md) 建好 kind 叢集，照 kind 文件的 local registry 做法起一個 `registry:2`。用 `crane copy` 把 `postgres:16` 複製到 `mirror-a/postgres:16`、用不加 `--all` 的 `skopeo copy` 複製到 `mirror-b/postgres:16`，三邊各跑 `crane digest`。再把 overlay 的 `postgres:16` 改成本機 registry 加上游的 digest，分別指向兩邊，看哪一個拉得起來。
5. 有測試用的 Harbor 時：建一個只能拉取的機器人帳號，在 kind 的節點（`docker exec` 進節點容器）放院內 CA 與 `hosts.toml`，建 pull secret 掛到 `clinic` 的 ServiceAccount 並部署。把 Secret 的密碼改錯、刪掉 Pod，看 Events 的訊息。
6. 替院內 Harbor 寫一張盤點表：每個專案的成員與角色、機器人帳號（用途、權限、到期日、憑證放哪）、保留規則、垃圾回收排程與配額。
