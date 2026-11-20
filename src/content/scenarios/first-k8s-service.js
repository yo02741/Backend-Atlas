// 設計情境：第一批搬上 K8s 的服務（搬遷順序）
export default {
  id: 'first-k8s-service',
  order: 31,
  group: 'ops',
  title: '第一個搬上 K8s 的服務',
  en: 'Choosing the first service for Kubernetes',
  level: 2,
  week: 18,
  skills: ['k8s-readiness', 'k8s-config-probes', 'k8s-networking', 'k8s-storage', 'container-operations', 'k8s-operations', 'change-management'],
  lab: 'FirstK8sServiceScenarioLab',
  summary: '院方明年導入地端 K8s，四個要搬的服務各有包袱：無狀態的掛號前端與 API、寫本機磁碟的報表服務、不處理 SIGTERM 的付款長連線。第一批先搬風險低的、先搬最痛的、一次全搬，還是先只建平台？',
  situation: '青嶺醫院（虛構）明年導入地端 Kubernetes，資訊室 5 個人要挑第一批搬上去的服務，沒有人維運過叢集。候選有五個：門診掛號前端（nginx + Vue 靜態檔，無狀態，白天流量高，壞了有紙本掛號可以替代）；掛號 API（Flask + gunicorn，無狀態，即時查院內 Informix）；報表服務（夜間批次產生約 2,000 份 PDF，寫在本機磁碟，CPU 吃重）；付款 socket 服務（繳費機與刷卡機約 60 條長連線，程式不處理 SIGTERM，帳務不能錯）；院內 Informix 資料庫（有狀態，廠商支援條款不涵蓋容器環境，不搬）。以上數字皆為示意。',
  constraints: [
    '團隊沒有 Kubernetes 維運經驗；Ingress、registry、監控、儲存、備份都要從零建起',
    '叢集上線後一年內要通過院內資安稽核：權限控管、變更紀錄、映像來源、以非 root 執行、備份還原演練',
    '門診時段的掛號與繳費不能中斷；掛號有紙本流程可以暫代，繳費與帳務沒有',
    '掛號 API、報表、付款都要連 Informix，防火牆只放行現在的 VM；叢集節點要連得走變更申請，送件到生效約 4 週（示意）',
  ],
  options: [
    {
      id: 'stateless', name: '先搬無狀態的前端與 API',
      summary: '第一批只搬掛號前端，再搬掛號 API；防火牆申請在搬前端時送出。報表與付款等程式改好、團隊熟悉叢集之後再搬。',
      pros: [
        '前端不連舊系統，要處理的只有映像、探針與 Ingress，第一個服務很快能上線',
        '前端出事有紙本掛號可以暫代；舊 VM 保留期間，回退只要把入口指回 VM',
        'manifest 範本、部署流程、監控在前兩個服務上建立，後面的服務沿用',
        '防火牆申請在前端上線期間跑完，API 不必乾等',
      ],
      cons: [
        '報表服務的 CPU 與磁碟問題排在後面，收益來得慢',
        '前兩個服務都無狀態，儲存、長連線、優雅關機這些難題要到後面才碰到',
        '前端的流量在門診時段最高，出事時就是病人在排隊的時候',
      ],
    },
    {
      id: 'report', name: '先搬報表服務',
      summary: '從資源問題最明顯的報表服務下手：輸出改寫到 PVC、設 `requests` / `limits`、夜間批次改用 CronJob；儲存與 volume 備份先建好。',
      pros: [
        'CPU 爭用與磁碟塞滿是現在最痛的問題，搬好收益最大',
        '夜間批次不在門診時段，失敗了白天可以重跑',
        '報表晚到影響的是醫事室，不是正在看診的病人',
      ],
      cons: [
        '第一個服務就要碰儲存：CSI driver、StorageClass、`ReadWriteOnce` 的限制與 volume 備份',
        '寫本機磁碟要先改程式：輸出目錄、暫存檔、非 root 的寫入權限',
        '團隊第一次排錯就面對 PVC Pending、Multi-Attach 這類較難判讀的狀況',
        '一樣要等防火牆放行才能連 Informix；批次在夜間跑，出事時可能沒人在看',
      ],
    },
    {
      id: 'bigbang', name: '一次全部搬',
      summary: '平台建好後，四個服務同時改造，挑一個週末一起切到叢集；舊 VM 只保留到月底。',
      pros: [
        '總時程最短，新舊環境並存的時間最短',
        '只有一次停機公告與一次切換',
        '平台元件依四個服務的需求一次建好，不必邊搬邊補',
      ],
      cons: [
        '防火牆、SIGTERM、寫本機磁碟、長連線四個前置問題同時處理，最慢的那一個決定切換日',
        '團隊第一次在叢集上排錯，就是四個服務同時出狀況的時候',
        '付款的長連線與 SIGTERM 沒改完，第一次滾動更新就切斷進行中的交易',
        '回退牽連多個服務；舊 VM 停用後就回不去',
      ],
    },
    {
      id: 'platform', name: '先只建平台與內部工具',
      summary: '前三、四個月只建平台、放內部工具（wiki、監控儀表板），演練節點故障、drain 與備份還原；稽核項目到位後才搬病人流程的服務。',
      pros: [
        '出錯只影響內部工具，團隊在不碰病人流程的情況下練排錯',
        '權限、變更紀錄、Pod Security、備份還原演練一開始就做，稽核最好準備',
        '每個業務服務搬上來時，平台已經穩定運作了幾個月',
      ],
      cons: [
        '頭幾個月沒有任何業務服務上線，院方要能接受看不到成果',
        '內部工具碰不到防火牆、長連線與儲存，這些問題仍要到搬業務服務時才遇到',
        '總時程最長，付款服務到年底才上去',
      ],
    },
  ],
  tradeoffs: {
    axes: ['學習效果', '病人流程風險', '先解決的前置工作', '回退難度', '收益何時出現'],
    rows: [
      { option: 'stateless', cells: ['好：由簡到難，一次學一件事', '中：前端有紙本可暫代，但在門診時段', '好：前端幾乎沒有；API 要等防火牆', '好：入口指回 VM，幾分鐘', '中：前端本來問題就少，報表排在後面'] },
      { option: 'report', cells: ['中：第一個就是儲存，難度跳級', '好：夜間批次，不碰門診', '差：儲存、改寫檔、防火牆', '中：批次可改回舊主機跑，輸出要同步回去', '好：最痛的問題最先解決'] },
      { option: 'bigbang', cells: ['差：所有問題同時出現', '差：掛號與繳費同一天切換', '差：四個前置問題都要在切換日前做完', '差：牽連多個服務，舊 VM 停用後回不去', '中：一起上線，但事故處理吃掉前幾個月'] },
      { option: 'platform', cells: ['好：先練維運，再搬業務', '好：前幾個月不碰病人流程', '中：平台工作多，服務的前置延後', '好：業務服務還在 VM 上', '差：頭幾個月沒有業務收益'] },
    ],
  },
  decisions: [
    { id: 'firewall-slow', situation: '資安組一季才審一次防火牆變更，叢集節點連 Informix 的申請要三個月才會生效；院方希望半年內至少有一個門診用得到的服務跑在叢集上。',
      options: ['stateless', 'report', 'bigbang'], answer: 'stateless',
      explain: '掛號前端不連 Informix，不必等防火牆，第一、二個月就能上線，也是門診用得到的服務；API 的申請同時送出，三個月後接著搬。報表與付款都要連 Informix，先搬報表會卡在同一張申請單上；一次全部搬則讓整個切換日等最慢的那張申請單，連不需要防火牆的前端也一起等。' },
    { id: 'report-hw', situation: '報表主機的硬體保固明年 3 月到期，院方不續約，磁碟今年已經滿過兩次；報表晚一天交不影響看診，叢集的 CSI driver 與 StorageClass 由儲存廠商隨硬體一起建好。',
      options: ['stateless', 'report', 'platform'], answer: 'report',
      explain: '硬期限落在報表服務上。照由簡到難的順序，報表要排到半年後，會撞上保固到期。報表是夜間批次，出錯可以白天重跑，不碰門診流程；儲存元件已經由廠商建好，最難的前置工作少了一半。要先做的是把輸出改寫到 volume、規劃 volume 的備份，並在保固到期前完成一次還原演練。' },
    { id: 'audit-early', situation: '資安稽核提前到叢集上線後第 6 個月，範圍是叢集本身：誰有權限、每次變更有沒有紀錄、映像從哪裡來、容器是不是以非 root 執行、備份有沒有還原演練。院方同意上半年不要求業務服務上線。',
      options: ['stateless', 'bigbang', 'platform'], answer: 'platform',
      explain: '稽核查的是平台，不是哪個服務先上。先把 RBAC、變更紀錄（manifest 進 git、由流程套用）、映像倉庫與 Pod Security 建好，只放內部工具，並完成一次備份還原演練，第 6 個月時每一項都有紀錄可查。先搬前端與 API 會讓病人流程跑在稽核項目還沒到位的平台上；一次全搬時，事故處理期間的手動修改最容易讓變更紀錄出現缺口。' },
    { id: 'branch-small', situation: '分院要上同一套叢集平台：只有三個服務，全部無狀態、已處理 SIGTERM、不連舊系統；總院的叢集已穩定維運兩年，範本、監控與值班流程都現成，舊 VM 保留一個月可以隨時切回。',
      options: ['stateless', 'bigbang', 'platform'], answer: 'bigbang',
      explain: '一次全搬的風險來自同時出現多個沒處理過的問題，而團隊又沒有經驗。這裡前置問題都已解決，平台與團隊經驗也是現成的，逐一搬只是把同樣的步驟拉長三倍；先只建平台更沒有必要，平台已經在了。仍要先在測試環境演練整套切換，並寫好切回 VM 的步驟。' },
  ],
  switchIf: [
    { when: '資安稽核提前到第 6 個月，範圍是叢集本身，院方同意上半年不要求業務服務上線', then: '改用 `platform`：先把權限、變更紀錄、映像來源與備份還原做齊，稽核過了再搬病人流程。' },
    { when: '報表主機保固到期不續約、磁碟一直滿，報表晚一天不影響看診', then: '改用 `report`：痛點有期限，而且失敗時不會直接卡住病人。' },
    { when: '平台已穩定兩年，範本、監控與值班都現成，服務全部無狀態、處理過 SIGTERM', then: '改用 `bigbang`：風險已被前面的經驗吸收，一次切省下多次切換的成本。' },
  ],
  alternative: { option: 'platform', holdsWhen: '院方接受前幾個月沒有業務服務上叢集，而且稽核時程比業務收益更早到時。' },
  challenge: {
    task: '第一個服務出事時退不退得回去，要放進評分。為四個做法打分：學習效果、病人流程風險、回退難度、收益何時出現，各 1–5 分，再決定權重（回退難度至少占 25%）。打分前先在本頁模擬器把四個做法各「逐月播放」一次，記下「回退」與「病人流程受影響」的次數；「回退難度」那一欄寫出這個服務退回舊 VM 要做什麼、多久做得完。',
    deliver: '一張加權評分表（四個做法 × 四個面向）、權重的理由，以及每個做法退回舊 VM 的步驟',
    check: [
      '「回退難度」每格都寫了具體步驟（例如把 DNS 或負載平衡器指回舊 VM），不只給分數',
      '評分引用了模擬器記下的「回退」與「病人流程受影響」次數',
      '寫出權重怎麼改會讓第一名換人',
    ],
    twist: '打開「注入：防火牆申請延誤 3 個月」。先預測哪個做法掉分最多、第一名會不會換，再播放驗證。',
  },
  implementation: [
    { title: '第一個服務的上線檢查清單（附在變更單上）', lang: 'yaml', code: `service: registration-web          # 掛號前端（nginx + Vue 靜態檔）
owner: 資訊室 + 門診組
before:
  image:
    - CI 以 commit SHA 為 tag 推到院內 registry，不用 latest
    - 以非 root 執行：改用 nginx-unprivileged，listen 8080
  manifest:
    - replicas: 2，topologySpreadConstraints 讓兩個副本在不同節點
    - readinessProbe 打 /index.html；探針不打 /api（後端一停，前端會一起被移出 Service）
    - requests / limits 依 VM 上兩週的用量設定
    - PodDisruptionBudget minAvailable: 1（drain 節點時至少留一個）
  platform:
    - Ingress 的逾時、上傳大小與舊 nginx 的設定一致
    - 監控有錯誤率與回應時間，告警送到值班群組
    - 這份 manifest 放在 git，由流程套用，不在叢集上手動改
rollout:
  - 入口依比例分流：先導 10% 流量，觀察一週
  - 切換排在週六下午，門診時段不動
rollback:
  how: 入口指回舊 VM（約 5 分鐘）
  keep_vm_until: 全量後 30 天
  fallback: 櫃台紙本掛號流程，門診組事先演練過
done_when:
  - 全量後 14 天沒有因叢集造成的事故
  - 值班的每個人都操作過一次 kubectl rollout undo
  - 演練過一次 drain 這個服務所在的節點` },
    { title: '搬遷前檢查：非 root、寫本機檔案、SIGTERM（在現有 VM 上用 Docker 跑）', lang: 'bash', code: `#!/usr/bin/env bash
# 三項都過才排進搬遷清單；付款與報表服務各跑一次
set -u
IMG=registry.example.internal/billing/payment:4.12.0     # 示意
NAME=premove-check

# 唯讀根目錄、只給 /tmp 可寫：程式寫到別處會出現 Read-only file system
docker run -d --name "$NAME" --read-only --tmpfs /tmp "$IMG" >/dev/null
sleep 10

# 1. 以非 root 執行：User 的使用者部分不能是空字串、root 或 0
user=$(docker inspect --format '{{.Config.User}}' "$NAME")
case "\${user%%:*}" in
  ""|root|0) echo "FAIL 以 root 執行（User='$user'）" ;;
  *)         echo "ok   User=$user" ;;
esac

# 2. 不寫本機檔案（只涵蓋這 10 秒內跑到的程式路徑；報表要觸發一次產生 PDF）
if docker logs "$NAME" 2>&1 | grep -q 'Read-only file system'; then
  echo "FAIL 有寫到 /tmp 以外的地方：改寫到 volume，暫存檔放 /tmp"
else
  echo "ok   沒看到寫入錯誤"
fi

# 3. 處理 SIGTERM：給 30 秒，看多久結束、結束碼是多少
start=$(date +%s)
docker stop -t 30 "$NAME" >/dev/null
code=$(docker inspect --format '{{.State.ExitCode}}' "$NAME")
echo "stop 花了 $(( $(date +%s) - start )) 秒，結束碼 $code"
# 0    收到 SIGTERM 後自己收尾結束
# 137  等滿 30 秒被 SIGKILL：程式是 PID 1 又沒處理 SIGTERM，或 PID 1 是 shell
# 143  收到 SIGTERM 立刻以預設動作結束，手上的交易一樣被切斷

docker rm "$NAME" >/dev/null` },
    { title: '報表服務：輸出改寫到 PVC，夜間批次改用 CronJob', lang: 'yaml', code: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: clinic-report
  namespace: report
spec:
  schedule: "30 1 * * *"              # 每天 01:30
  timeZone: Asia/Taipei               # 不指定就依控制平面的時區解讀
  concurrencyPolicy: Forbid           # 前一次還沒跑完，這次就跳過
  startingDeadlineSeconds: 3600
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            fsGroup: 10001            # 掛上的 volume 讓 UID 10001 可以寫
          containers:
            - name: report
              image: registry.example.internal/report/batch:2.8.1
              args: ["--out", "/srv/reports"]
              resources:
                requests: { cpu: "2", memory: "2Gi" }
                limits: { memory: "3Gi" }   # CPU limit 只會節流；設太低，批次會拖到白天
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
              volumeMounts:
                - { name: out, mountPath: /srv/reports }
                - { name: tmp, mountPath: /tmp }    # 產生到一半的 PDF
          volumes:
            - name: out
              persistentVolumeClaim: { claimName: report-output }
            - name: tmp
              emptyDir: {}
# report-output 若是 ReadWriteOnce，同一時間只能掛在一個節點；
# 醫事室的下載網頁也要讀這些檔案時，改用 ReadWriteMany 的儲存或物件儲存` },
  ],
  exercise: 'k8s-readiness-1',
}
