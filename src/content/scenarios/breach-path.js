// 設計情境：縱深防禦的架構取捨（依公開事件報告改寫）
export default {
  id: 'breach-path',
  order: 25,
  group: 'agent',
  title: '從一個容器到正式資料庫',
  en: 'Defense in depth: breach path',
  level: 2,
  week: 21,
  skills: ['key-scope-lifetime', 'agent-credential-isolation', 'agent-supply-chain', 'owasp-mcp-top10'],
  lab: 'BreachPathScenarioLab',
  summary: '共享叢集上一個租戶的應用有漏洞，最後丟掉的是雲端最高權限與正式資料庫。防線要蓋在哪一層、先蓋哪一道？',
  situation: '一個部署平台（PaaS）把所有租戶的容器跑在共享的 Kubernetes 叢集上。某位租戶部署的開源 AI 聊天應用版本有已公開的漏洞：MCP 功能的授權檢查不足，攻擊者利用它在該容器內取得執行權。接著從叢集內網讀到平台路由快取裡的舊式 API 金鑰（沒有權限範圍、沒有期限，其中一把是團隊管理員金鑰），之後取得雲端 root 金鑰、連進正式資料庫，並讀走環境變數裡的第三方 API 金鑰、資料庫密碼與其他服務憑證。本情境依 Zeabur 2026 年 8 月的官方事件報告改寫，事件細節以報告為準；各道防線「可能在哪一步截斷」是推論，模擬器為示意。',
  constraints: [
    '租戶的程式碼與相依套件由租戶自己選版本、自己部署，平台無法保證每個應用都即時修補',
    '路由等平台元件必須拿得到某些憑證才能運作，不能完全不存放',
    '既有客戶的整合還在用舊式金鑰，不能一夕全部停用',
    '任何一道防線都可能失效：應用有 0-day、網路政策漏設一條、token 外洩',
    '雲端帳號的最高權限一旦外洩，損害不限於單一租戶',
  ],
  options: [
    {
      id: 'patch', name: '只修補應用漏洞',
      summary: '追蹤 CVE、掃描映像檔、通知或強制租戶升級有漏洞的版本；平台架構不變。',
      pros: ['直接處理入口，已知漏洞的攻擊面變小', '不用改平台架構，導入成本最低'],
      cons: ['0-day 或租戶不升級時完全沒有作用', '入口一旦被打穿，後面每一步都沒有邊界：共享內網、長效金鑰、雲端最高權限都還在'],
    },
    {
      id: 'network', name: '網路隔離',
      summary: '每個租戶 namespace 預設拒絕的 `NetworkPolicy`：租戶工作負載只能連自己的服務與外網，連不到平台內部的快取、控制面與其他租戶。',
      pros: ['不管入口是哪個漏洞都有效', '依教材的推論，是最可能在「從內網讀到路由快取」這一步截斷的位置'],
      cons: ['政策要持續維護，例外一多就有洞；漏設一條就失效', '擋不住被打穿的容器讀自己環境變數裡的機密'],
    },
    {
      id: 'scoped', name: '金鑰有範圍與期限',
      summary: '停用無範圍、無期限的舊式金鑰，改發有 scope、到期日、來源限制與稽核紀錄的短效 token；機密由秘密管理服務在需要時注入，不長期放在環境變數。',
      pros: ['金鑰被讀到之後，損害有上限、可用時間有上限', '稽核紀錄讓「金鑰從沒出現過的來源被使用」變成可告警的訊號'],
      cons: ['舊金鑰遷移要時間，過渡期仍有風險', 'token 換發、秘密管理服務、稽核管線都是要維運的新元件'],
    },
    {
      id: 'depth', name: '縱深防禦（全部都做）',
      summary: '修補與隔離應用、網路隔離、金鑰有範圍與期限，再加上雲端最高權限不用於日常：不為 root 建立 access key，日常操作用權限受限角色的臨時憑證。',
      pros: ['任何一道失效，下一道仍在', '每一層都在縮小攻擊者下一步能拿到的東西'],
      cons: ['導入成本與維運負擔最高', '每一層都要有人負責、有測試，否則只是紙上的防線'],
    },
  ],
  tradeoffs: {
    axes: ['0-day 入口', '金鑰被讀到之後', '導入成本', '維運負擔'],
    rows: [
      { option: 'patch', cells: ['差：來不及修就沒有任何防線', '差：無範圍、無期限，偷到就是全部', '低', '中：持續追 CVE 與租戶版本'] },
      { option: 'network', cells: ['中：入口仍破，但擴散被限在該容器', '差：若仍被讀到，金鑰照樣可用', '中', '中：政策與例外要管'] },
      { option: 'scoped', cells: ['中：內網可達，但拿到的憑證權限有限、會過期', '好：有上限、有時效、有紀錄', '高：舊金鑰遷移', '中：換發與稽核管線'] },
      { option: 'depth', cells: ['好：入口破了還有好幾道邊界', '好：同上，且不存在可拿的最高權限金鑰', '最高', '最高：每一層都要有人顧'] },
    ],
  },
  decisions: [
    { id: 'zeroday', situation: '熱門開源應用的漏洞公開當天就被利用，修補版還沒釋出，平台上有大量租戶跑著這個版本；這一季的人力只夠先做一項。', options: ['patch', 'network', 'scoped'], answer: 'network',
      explain: '修補要等上游發版、等租戶升級，0-day 期間等於沒有防線。網路預設拒絕不管入口是哪個漏洞都有效，依兩課的推論也是最可能截斷「從內網讀到平台快取」的位置。金鑰改造牽涉舊金鑰遷移，一季內通常做不完，適合當下一項。' },
    { id: 'legacy', situation: '網路隔離已經上線，但平台必須讓舊式金鑰再保留半年給既有客戶的整合使用。', options: ['network', 'scoped', 'patch'], answer: 'scoped',
      explain: '保留不代表維持原樣：替舊金鑰補上範圍（只能做整合需要的操作）、來源限制與到期日，記錄每次使用與最後使用時間；新整合一律發短效 token。網路政策只要有一條例外設錯，無範圍、無期限的金鑰被讀到就是全部，所以不能只靠前一道。' },
    { id: 'dedicated', situation: '每個租戶跑在專屬的 VM 與 VPC，平台元件不在租戶網路內，也沒有任何平台級金鑰放在租戶碰得到的地方。某租戶的應用有已知 CVE，修補版已經釋出。', options: ['patch', 'network', 'depth'], answer: 'patch',
      explain: '隔離與憑證邊界在架構上已經存在，剩下的缺口就是這個已知漏洞，最直接的動作是修補並確認租戶升級。這時再加一層網路政策的邊際效益很小；縱深防禦的其他層已經在了，不需要重做。' },
    { id: 'contract', situation: '平台要承接金融業客戶，合約要求「任一控制失效時，單一租戶的事故不得擴大到其他租戶或雲端帳號」。', options: ['network', 'scoped', 'depth'], answer: 'depth',
      explain: '「任一控制失效時仍有邊界」就是縱深防禦的定義：只靠網路隔離，政策漏一條就直通內部；只靠金鑰範圍，內網仍可達，雲端最高權限若存在仍可能被拿到。每一層各自限制下一步能拿到的東西，才能對「任一失效」做出保證。' },
  ],
  implementation: [
    { title: '租戶 namespace 預設拒絕（Kubernetes NetworkPolicy）', lang: 'yaml', code: `# 需要會執行 NetworkPolicy 的 CNI；每個租戶 namespace 各套一份
# 1) 預設拒絕：沒有被明確允許的進出流量一律不通
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: tenant-a
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# 2) 只開需要的：同 namespace 互連、平台 ingress 進來、DNS、外網
#    外網規則排除私有網段與 link-local（叢集內網、平台內部服務都在這些網段）
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-minimal
  namespace: tenant-a
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector: {}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16]` },
    { title: '有範圍、有期限、有稽核的 token（Python 虛擬碼）', lang: 'python', code: `import hashlib, secrets
from datetime import datetime, timedelta, timezone

MAX_TTL = {"integration": timedelta(days=90), "admin": timedelta(hours=4), "internal": timedelta(minutes=15)}

def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()

def issue_token(principal, scopes: list[str], resource: str, ttl: timedelta, sources: list[str], reason: str) -> str:
    if ttl > MAX_TTL[principal.kind]:
        raise ValueError("ttl 超過這類身分的上限")       # 管理權限只發短效
    raw = "atl_live_" + secrets.token_urlsafe(32)
    db.insert("tokens", {
        "hash": sha256(raw),                             # 只存雜湊，原文只顯示一次
        "principal": principal.id, "scopes": scopes, "resource": resource,
        "allowed_sources": sources,                      # 例：只允許管理介面所在網段
        "expires_at": datetime.now(timezone.utc) + ttl,
        "created_by": principal.created_by, "reason": reason,
    })
    return raw

def authorize(raw: str, action: str, resource: str, source: str):
    t = db.get("tokens", hash=sha256(raw))
    now = datetime.now(timezone.utc)
    if t is None or t.revoked or t.expires_at <= now:
        return deny("invalid_or_expired")
    if action not in t.scopes or not resource.startswith(t.resource):
        return deny("out_of_scope")
    if t.allowed_sources and not ip_in_any(source, t.allowed_sources):
        audit.alert("token_from_unexpected_source", token=t.id, source=source)
        return deny("source_not_allowed")
    audit.log(token=t.id, action=action, resource=resource, source=source)
    db.update("tokens", t.id, last_used_at=now, last_used_from=source)
    return allow()` },
  ],
  exercise: null,
  refs: [],
}
