import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Callout, Status, Stats, Stat, Caption, useWidth } from './ui.jsx'

/* ============================================================
   Kubernetes 排錯：從 Pod 狀態查到原因
   - 六種故障情境；左邊「終端機」按指令才看得到那個指令的輸出，右邊筆記累積線索
   - 收集線索後從四個選項選原因：答對顯示要改 manifest 的哪一行，答錯提示還缺什麼線索
   - 關係圖：Deployment → ReplicaSet → Pod ← Service ← Ingress，看到關鍵線索後故障的那一段標紅
   kubectl 輸出是示意格式（刪節過），欄位與訊息依版本不同；名稱、位址全部虛構
   ============================================================ */

const tbl = (w, rows) => rows.map((r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join('')).join('\n')
const pods = (rows) => tbl([23, 8, 19, 15], [['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], ...rows])
const events = (rows) => tbl([11, 9, 18, 27], [['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], ...rows])
const devents = (rows) => 'Events:\n' + tbl([2, 9, 18, 19], [['', 'Type', 'Reason', 'From', 'Message'], ...rows.map((r) => ['', ...r])])
const endpoints = (v) => tbl([10, Math.max(v.length, 9) + 3], [['NAME', 'ENDPOINTS', 'AGE'], ['api-svc', v, '9d']])
const noPrev = (p) => `Error from server (BadRequest): previous terminated container "api"\n  in pod "${p}" not found`
const K = 'kubelet', NONE = '<none>'

const CMDS = [
  { k: 'get', label: 'kubectl get pods', full: () => 'kubectl get pods' },
  { k: 'desc', label: 'describe pod', full: (p) => `kubectl describe pod ${p}` },
  { k: 'logs', label: 'logs', full: (p) => `kubectl logs ${p}` },
  { k: 'prev', label: 'logs --previous', full: (p) => `kubectl logs ${p} --previous` },
  { k: 'ev', label: 'get events', full: () => 'kubectl get events --sort-by=.lastTimestamp' },
  { k: 'ep', label: 'get endpoints', full: () => 'kubectl get endpoints api-svc' },
]
const CMD = Object.fromEntries(CMDS.map((c) => [c.k, c]))
const PARTS = [
  { k: 'dep', label: 'Deployment', sub: 'api' }, { k: 'rs', label: 'ReplicaSet', sub: '維持 Pod 數量' }, { k: 'pod', label: 'Pod', sub: '容器 api :8080' },
  { k: 'svc', label: 'Service', sub: 'api-svc' }, { k: 'ing', label: 'Ingress', sub: '/api' },
]
const EDGES = [{ t: '建立' }, { t: '建立' }, { t: 'selector 選取', rev: true }, { t: '轉送', rev: true }]   // rev：箭頭指向左邊的節點

/* 每個指令：o 輸出、hl 重點行（0 起算）、seen 看到什麼、so 能判斷什麼、clear 可以排除的段落 */
const SCN = {
  pending: {
    label: 'Pending', pod: 'api-6c9d7b5f4-x2kqp', fault: 'pod', faultText: '排不上任何節點', keys: ['desc', 'ev'], order: ['get', 'desc'],
    intro: '新版部署後，api 的兩個 Pod 一直沒有起來。',
    orderWhy: 'Pending 代表還沒排上節點，容器沒跑過，logs 不會有東西；直接看 describe 最下面的 Events。',
    get: { o: pods([['api-6c9d7b5f4-x2kqp', '0/1', 'Pending', '0', '4m12s'], ['api-6c9d7b5f4-m8zvw', '0/1', 'Pending', '0', '4m12s']]), hl: [1, 2], clear: ['dep', 'rs'],
      seen: 'STATUS 是 Pending、RESTARTS 0：Pod 物件建出來了，但容器從來沒啟動過。', so: 'Deployment 與 ReplicaSet 有照常建出 Pod，可以排除；問題在「排上節點」到「容器啟動」之間。' },
    desc: { o: `Name:    api-6c9d7b5f4-x2kqp\nStatus:  Pending\nNode:    ${NONE}\nContainers:\n  api:\n    Image:  reg.local/shop/api:1.4.2\n    Requests:\n      cpu:     4\n      memory:  1Gi\n` + devents([['Warning', 'FailedScheduling', 'default-scheduler', '0/3 nodes are available:'], ['', '', '', '3 Insufficient cpu.']]), hl: [2, 7, 11, 12],
      seen: 'Node 是 <none>；Events 有 FailedScheduling：三台節點都 Insufficient cpu；requests 寫 cpu: 4。', so: 'scheduler 比的是 requests 和節點剩下的可分配量，不是實際用量。還沒排上節點，所以也輪不到 image 或程式出問題。' },
    logs: { o: 'Error from server (BadRequest): pod api-6c9d7b5f4-x2kqp\n  does not have a host assigned', hl: [0, 1], seen: '沒有 log 可看：Pod 還沒被指派到節點，容器不存在。', so: 'Pending 時 logs 幫不上忙，線索在 describe 的 Events。' },
    prev: { o: 'Error from server (BadRequest): pod api-6c9d7b5f4-x2kqp\n  does not have a host assigned', hl: [], seen: '一樣沒有：沒有任何容器跑過。', so: '--previous 要容器重啟過才有內容。' },
    ev: { o: events([['4m', 'Normal', 'SuccessfulCreate', 'replicaset/api-6c9d7b5f4', 'Created pod: api-6c9d7b5f4-x2kqp'], ['12s', 'Warning', 'FailedScheduling', 'pod/api-6c9d7b5f4-x2kqp', '0/3 nodes are available: 3 Insufficient cpu.']]), hl: [2],
      seen: '同一則 FailedScheduling，12 秒前還在發生。', so: 'events 是整個 namespace 的時間軸，和 describe 最下面那段是同一份資料。' },
    ep: { o: endpoints(NONE), hl: [1], seen: 'endpoints 是空的。', so: '這是結果不是原因：沒有 Ready 的 Pod，Service 自然沒有後端。往回查 Pod。' },
    opts: [
      { t: 'image tag 打錯，拉不到映像', why: '拉 image 是排上節點之後的事。這裡 Node 還是 <none>，還沒走到那一步；拉不到會是 ErrImagePull / ImagePullBackOff。' },
      { t: 'Pod 的 CPU requests 太大，沒有節點放得下', ok: true },
      { t: '程式啟動後立刻當掉', why: '當掉會看到 RESTARTS 增加、STATUS 是 CrashLoopBackOff。這裡容器從沒啟動過。' },
      { t: 'Service 的 selector 沒選到 Pod', why: 'selector 只影響流量送不送得到，不會讓 Pod 停在 Pending。' },
    ],
    fix: [' resources:', '   requests:', '-    cpu: "4"', '+    cpu: "500m"', '     memory: "1Gi"'],
    fixNote: 'requests 依實測用量訂；真的需要 4 核，就要加節點或換大規格。套用後 Deployment 會建立新的 Pod。',
    why: ['scheduler 只看 requests：節點的「可分配量 − 已被其他 Pod 的 requests 佔走的量」要放得下這個 Pod。這裡要 4 核，三台節點剩下的都不夠，所以一直 Pending。', '節點實際上可能很閒——requests 是預留量，不是用量。'],
  },
  image: {
    label: 'ImagePullBackOff', pod: 'api-5b8c6d7f9-qz4tn', fault: 'pod', faultText: 'image 拉不下來', keys: ['desc', 'ev'], order: ['get', 'desc'],
    intro: '發了新版，滾動更新停在一半：新的 Pod 起不來。',
    orderWhy: 'ImagePullBackOff 的原因寫在 describe 的 Events：看 Failed to pull image 後面那句是 not found、unauthorized，還是連不到 registry。',
    get: { o: pods([['api-5b8c6d7f9-qz4tn', '0/1', 'ImagePullBackOff', '0', '3m40s'], ['api-6c9d7b5f4-h7k2c', '1/1', 'Running', '0', '2d'], ['api-6c9d7b5f4-r5n8d', '1/1', 'Running', '0', '2d']]), hl: [1], clear: ['dep', 'rs'],
      seen: '新的 Pod 是 ImagePullBackOff，兩個舊 Pod 還在 Running。', so: '已經排上節點才會開始拉 image，排程可以排除；舊版還在服務，滾動更新只是卡住。' },
    desc: { o: `Name:  api-5b8c6d7f9-qz4tn\nNode:  node-2/10.0.3.12\nContainers:\n  api:\n    Image:     reg.local/shop/api:1.43\n    State:     Waiting\n      Reason:  ImagePullBackOff\n` + devents([['Normal', 'Pulling', K, 'Pulling image "reg.local/shop/api:1.43"'], ['Warning', 'Failed', K, 'Failed to pull image "reg.local/shop/api:1.43":'], ['', '', '', 'reg.local/shop/api:1.43: not found'], ['Normal', 'BackOff', K, 'Back-off pulling image "reg.local/shop/api:1.43"']]), hl: [4, 10, 11],
      seen: 'Events：Failed to pull image "…/api:1.43"，原因是 not found。', so: '是 not found 而不是 unauthorized：registry 連得到、也有權限，只是沒有這個 tag。發版紀錄上的版本是 1.4.3。' },
    logs: { o: 'Error from server (BadRequest): container "api" in pod\n  "api-5b8c6d7f9-qz4tn" is waiting to start:\n  trying and failing to pull image', hl: [2], seen: '沒有 log：容器還沒建立，kubectl 直接回報「正在拉 image 而且失敗」。', so: '程式沒跑過，可以排除程式本身的問題。' },
    prev: { o: noPrev('api-5b8c6d7f9-qz4tn'), hl: [], seen: '沒有上一個容器。', so: '沒有重啟過，--previous 沒東西可看。' },
    ev: { o: events([['3m', 'Normal', 'Pulling', 'pod/api-5b8c6d7f9-qz4tn', 'Pulling image "reg.local/shop/api:1.43"'], ['3m', 'Warning', 'Failed', 'pod/api-5b8c6d7f9-qz4tn', 'Failed to pull image "reg.local/shop/api:1.43": … not found'], ['25s', 'Normal', 'BackOff', 'pod/api-5b8c6d7f9-qz4tn', 'Back-off pulling image "reg.local/shop/api:1.43"']]), hl: [2],
      seen: 'Failed to pull image … not found，之後進入 BackOff。', so: 'kubelet 拉失敗後拉長間隔再試，所以 STATUS 會在 ErrImagePull 與 ImagePullBackOff 之間切換。' },
    ep: { o: endpoints('10.244.1.17:8080,10.244.2.9:8080'), hl: [1], clear: ['svc'], seen: 'endpoints 還有兩個位址，是舊版的 Pod。', so: 'Service 與 selector 正常，使用者目前還連得到舊版。' },
    opts: [
      { t: '私有 registry 需要認證，但沒設 imagePullSecrets', why: '少了認證，訊息會是 unauthorized 或 pull access denied。這裡是 not found，而且同一個 registry 的舊版 image 拉得到。' },
      { t: '節點 CPU 不夠，Pod 排不上去', why: '排不上去時 Node 是 <none>、Events 是 FailedScheduling。這個 Pod 已經在 node-2 上了。' },
      { t: 'manifest 的 image tag 打錯，registry 沒有這個 tag', ok: true },
      { t: 'readiness probe 沒過', why: '探針要等容器跑起來才會開始打。這裡連 image 都還沒拉下來。' },
    ],
    fix: [' containers:', '   - name: api', '-    image: reg.local/shop/api:1.43', '+    image: reg.local/shop/api:1.4.3'],
    fixNote: 'tag 交給 CI 用變數帶入，不要手打。套用後新的 Pod 拉得到 image，滾動更新就會繼續。',
    why: ['manifest 寫的 tag 是 1.43，registry 裡只有 1.4.3。kubelet 拉不到就不會建立容器，Pod 停在 ImagePullBackOff。', '新 Pod 沒有 Ready，Deployment 就不會再關舊 Pod，所以服務沒有中斷——這是滾動更新的保護。'],
  },
  crash: {
    label: 'CrashLoopBackOff', pod: 'api-7f6d8c9b5-tk3wd', fault: 'pod', faultText: '容器一啟動就退出', keys: ['logs', 'prev'], order: ['get', 'logs', 'desc'],
    intro: '新版部署後，兩個 Pod 都在不斷重啟。',
    orderWhy: 'CrashLoopBackOff 代表容器跑起來過，程式通常會在 log 留下最後一句話，先看 logs；describe 的 Exit Code 用來分辨是自己退出（1）還是被殺掉（137）。',
    get: { o: pods([['api-7f6d8c9b5-tk3wd', '0/1', 'CrashLoopBackOff', '5 (48s ago)', '4m30s'], ['api-7f6d8c9b5-b9m2x', '0/1', 'CrashLoopBackOff', '5 (37s ago)', '4m30s']]), hl: [1, 2], clear: ['dep', 'rs'],
      seen: 'CrashLoopBackOff、RESTARTS 5：容器有啟動，但一啟動就結束，kubelet 拉長間隔重試。', so: '排程和 image 都沒問題（容器跑得起來）；要找的是「程式為什麼退出」。' },
    desc: { o: `Name:  api-7f6d8c9b5-tk3wd\nContainers:\n  api:\n    State:          Waiting\n      Reason:       CrashLoopBackOff\n    Last State:     Terminated\n      Reason:       Error\n      Exit Code:    1\n    Restart Count:  5\n` + devents([['Normal', 'Pulled', K, 'Container image already present on machine'], ['Normal', 'Started', K, 'Started container api'], ['Warning', 'BackOff', K, 'Back-off restarting failed container api']]), hl: [6, 7],
      seen: 'Last State：Terminated、Reason Error、Exit Code 1。', so: 'Exit Code 1 是程式自己結束的，不是 137（被殺掉），可以排除 OOM；Events 沒有探針失敗，也排除 liveness。但還不知道程式為什麼退出。' },
    logs: { o: '09:14:07 INFO  starting api 1.4.3\n09:14:07 ERROR config: required environment variable\n               DATABASE_URL is not set\n09:14:07 FATAL exiting with code 1', hl: [1, 2],
      seen: '程式自己說了：required environment variable DATABASE_URL is not set。', so: '原因在設定：這個版本多了一個必要的環境變數，manifest 沒給。' },
    prev: { o: '09:12:41 INFO  starting api 1.4.3\n09:12:41 ERROR config: required environment variable\n               DATABASE_URL is not set\n09:12:41 FATAL exiting with code 1', hl: [1, 2],
      seen: '上一個容器死在同一行：DATABASE_URL is not set。', so: '每次重啟都一樣，不是偶發。容器剛重啟、logs 還是空的時候，要靠 --previous 才看得到上一次的遺言。' },
    ev: { o: events([['4m', 'Normal', 'Started', 'pod/api-7f6d8c9b5-tk3wd', 'Started container api'], ['40s', 'Warning', 'BackOff', 'pod/api-7f6d8c9b5-tk3wd', 'Back-off restarting failed container api']]), hl: [2],
      seen: '只有 Started 和 BackOff，沒有排程、拉 image、探針的警告。', so: 'events 只說「一直重啟」，不會說程式為什麼退出——那要看 logs。' },
    ep: { o: endpoints(NONE), hl: [1], seen: 'endpoints 是空的。', so: '兩個 Pod 都沒 Ready，Service 沒有後端；是結果不是原因。' },
    opts: [
      { t: '少了必要的環境變數，程式讀設定時就退出', ok: true },
      { t: 'memory limits 太小，容器被 OOMKilled', why: 'OOM 的話 describe 的 Last State 會是 OOMKilled、Exit Code 137。這裡是 Error、Exit Code 1。' },
      { t: 'liveness probe 太嚴格，容器一直被重啟', why: '被 liveness 重啟時 Events 會有 Liveness probe failed。這裡沒有，而且容器是自己退出的。' },
      { t: 'image 拉不下來', why: 'Events 寫 image 已經在節點上、容器也 Started 了；拉不下來會是 ImagePullBackOff。' },
    ],
    fix: [' containers:', '   - name: api', '     image: reg.local/shop/api:1.4.3', '+    env:', '+      - name: DATABASE_URL', '+        valueFrom:', '+          secretKeyRef:', '+            name: api-db', '+            key: url'],
    fixNote: '連線字串放 Secret，不直接寫在 manifest。Secret 不存在時 Pod 會停在 CreateContainerConfigError，是另一種狀態。',
    why: ['CrashLoopBackOff 不是一種錯誤，而是「容器一直結束，kubelet 用越來越長的間隔重啟它」的狀態；真正的原因要從容器最後印出來的 log 找。', '這個版本新增了必要的設定 DATABASE_URL，Deployment 沒有跟著補上，所以每次啟動都在讀設定時退出。'],
  },
  oom: {
    label: 'OOMKilled', pod: 'api-66d5f7c8b9-p4x7n', fault: 'pod', faultText: '超過 memory limits 被殺', keys: ['desc'], order: ['get', 'desc', 'prev'],
    intro: '服務時好時壞；Pod 沒有被換掉，但 RESTARTS 一直增加。',
    orderWhy: 'RESTARTS 一直增加時，先用 describe 看 Last State 的 Reason 與 Exit Code，分辨是自己退出還是被殺；再用 logs --previous 看死前在做什麼。',
    get: { o: pods([['api-66d5f7c8b9-p4x7n', '1/1', 'Running', '6 (40s ago)', '38m'], ['api-66d5f7c8b9-w9c2j', '0/1', 'OOMKilled', '5 (9s ago)', '38m']]), hl: [1, 2], clear: ['dep', 'rs'],
      seen: '一個 Running 但 RESTARTS 6，另一個 STATUS 是 OOMKilled。', so: '容器能跑一陣子才掛，不是一啟動就死；排程與 image 可以排除。' },
    desc: { o: `Name:  api-66d5f7c8b9-p4x7n\nContainers:\n  api:\n    State:          Running\n    Last State:     Terminated\n      Reason:       OOMKilled\n      Exit Code:    137\n    Restart Count:  6\n    Limits:\n      memory:  128Mi\n` + devents([['Normal', 'Started', K, 'Started container api'], ['Warning', 'BackOff', K, 'Back-off restarting failed container api']]), hl: [5, 6, 9],
      seen: 'Last State：OOMKilled、Exit Code 137；Limits 的 memory 是 128Mi。', so: '137 = 128 + 9，被 SIGKILL 殺掉；Reason 寫明 OOMKilled：容器用的記憶體超過自己的 limits。不是節點記憶體不足——那會是 Evicted。' },
    logs: { o: '10:02:11 INFO  starting api 1.4.2\n10:02:12 INFO  listening on :8080\n10:02:15 INFO  GET /orders 200 18ms', hl: [],
      seen: '目前這個容器的 log 一切正常。', so: '剛重啟的容器還沒出事；要看「上一個」容器死前發生什麼，得加 --previous。' },
    prev: { o: '10:01:02 INFO  GET /orders 200 21ms\n10:01:19 INFO  GET /reports/export?range=365d started\n10:01:27 INFO  export: loaded 480000 rows\n# log 到這裡就斷了，沒有任何錯誤訊息', hl: [1, 2],
      seen: '上一個容器的 log 停在匯出一整年的報表，沒有錯誤訊息就斷了。', so: '被 SIGKILL 的程式來不及寫 log，所以 log 裡找不到 OOM；但看得出死前在做很吃記憶體的事。' },
    ev: { o: events([['45s', 'Normal', 'Started', 'pod/api-66d5f7c8b9-p4x7n', 'Started container api'], ['12s', 'Warning', 'BackOff', 'pod/api-66d5f7c8b9-w9c2j', 'Back-off restarting failed container api']]), hl: [2],
      seen: '只看到 Started 和 BackOff。', so: '這裡的 events 沒有寫出 OOM；被殺的原因要看 describe 的 Last State。' },
    ep: { o: endpoints('10.244.1.23:8080'), hl: [1], clear: ['svc'], seen: 'endpoints 只剩一個位址。', so: 'Service 正常，只是 Ready 的 Pod 時多時少，所以連線時好時壞。' },
    opts: [
      { t: '程式少了環境變數，啟動就退出', why: '那樣會是 Exit Code 1，log 也會有錯誤訊息。這裡容器跑了一陣子才掛，Exit Code 是 137。' },
      { t: '節點記憶體不足，Pod 被驅逐', why: '被驅逐的 Pod STATUS 是 Evicted，而且會換一個新的 Pod，不是原地重啟。這裡是同一個 Pod 的 RESTARTS 增加。' },
      { t: 'liveness probe 失敗，被 kubelet 重啟', why: 'liveness 失敗會在 Events 留下 Liveness probe failed，Last State 的 Reason 也不會是 OOMKilled。' },
      { t: 'memory limits 太小，用量一超過就被殺', ok: true },
    ],
    fix: [' resources:', '   requests:', '-    memory: "128Mi"', '+    memory: "512Mi"', '   limits:', '-    memory: "128Mi"', '+    memory: "512Mi"'],
    fixNote: '數字依實際用量訂（kubectl top pod 或監控）。用量只漲不跌是記憶體洩漏，加大 limits 只是延後；一次載入大量資料的匯出，改成分批處理才是根本。',
    why: ['容器的記憶體用量超過 limits.memory 時，kernel 直接殺掉程序（SIGKILL，Exit Code 137），kubelet 再把容器重啟。程式沒有機會處理，也不會留下錯誤 log。', 'CPU 超過 limits 只會被節流變慢，記憶體超過則是直接被殺，兩者後果不同。'],
  },
  selector: {
    label: 'Running 但連不到', pod: 'api-6c9d7b5f4-h7k2c', fault: 'svc', faultText: 'selector 選不到 Pod', keys: ['ep'], order: ['get', 'ep', 'desc'],
    intro: 'Pod 全部正常在跑，但從 Ingress 進來的請求一律 503。',
    orderWhy: 'Pod 都是 1/1 Running 卻連不到，就不用再翻 Pod 內部，直接看 Service 有沒有後端（endpoints）；空的就比對 selector 和 Pod 的 label。',
    get: { o: pods([['api-6c9d7b5f4-h7k2c', '1/1', 'Running', '0', '12m'], ['api-6c9d7b5f4-r5n8d', '1/1', 'Running', '0', '12m']]), hl: [1, 2], clear: ['dep', 'rs', 'pod'],
      seen: '兩個 Pod 都是 1/1 Running、RESTARTS 0。', so: 'Pod 本身健康：排程、image、程式啟動、readiness 都過了，問題不在 Pod 內部。' },
    desc: { o: `Name:    api-6c9d7b5f4-h7k2c\nLabels:  app=api-server\n         pod-template-hash=6c9d7b5f4\nStatus:  Running\nIP:      10.244.1.17\nContainers:\n  api:\n    Port:   8080/TCP\n    Ready:  True\n` + devents([['Normal', 'Started', K, 'Started container api']]), hl: [1],
      seen: 'Ready: True，Events 沒有警告；Pod 的 label 是 app=api-server。', so: 'Pod 沒事。把 label 記下來——Service 是靠 label 找 Pod 的。' },
    logs: { o: '08:40:02 INFO  starting api 1.4.2\n08:40:03 INFO  listening on :8080', hl: [], seen: '程式正常啟動，之後沒有任何請求的紀錄。', so: '程式沒壞，是請求根本沒送到 Pod；往 Service 那一段查。' },
    prev: { o: noPrev('api-6c9d7b5f4-h7k2c'), hl: [], seen: '沒有上一個容器。', so: '沒重啟過，排除程式當掉。' },
    ev: { o: events([['12m', 'Normal', 'Started', 'pod/api-6c9d7b5f4-h7k2c', 'Started container api'], ['12m', 'Normal', 'Started', 'pod/api-6c9d7b5f4-r5n8d', 'Started container api']]), hl: [],
      seen: '全部是 Normal。', so: '叢集這邊沒有任何東西失敗；設定對不上不會產生事件。' },
    ep: { o: endpoints(NONE), hl: [1], seen: 'Pod 明明 Ready，Service 的 endpoints 卻是 <none>。', so: 'Ready 的 Pod 沒被列進去，只剩一種可能：selector 沒選到它們。下一步用 kubectl get svc api-svc -o wide 看 SELECTOR，和 Pod 的 label 比對。' },
    opts: [
      { t: 'readiness probe 沒過，Pod 被移出 endpoints', why: 'readiness 沒過的話 READY 會是 0/1。這裡是 1/1。' },
      { t: 'Service 的 selector 和 Pod 的 label 對不上', ok: true },
      { t: '程式聽錯 port', why: 'port 不對時 endpoints 還是會列出 Pod 的位址，只是連過去被拒絕。這裡 endpoints 完全是空的。' },
      { t: 'Ingress 的路徑規則寫錯', why: 'Ingress 寫錯不會讓 Service 的 endpoints 變空。Service 找不到 Pod 這件事要先修。' },
    ],
    fix: [' kind: Service', ' metadata:', '   name: api-svc', ' spec:', '   selector:', '-    app: api', '+    app: api-server'],
    fixNote: '也可以反過來改 Pod template 的 label，重點是兩邊一致。selector 對不上不會有任何錯誤訊息，只能從 endpoints 發現。',
    why: ['Service 不認 Pod 的名字，只認 label：被 selector 選到、而且 Ready 的 Pod 才會進 endpoints。Pod template 的 label 改成了 app=api-server，Service 還在找 app=api，一個都選不到。', 'Ingress 把請求轉給一個沒有後端的 Service，所以回 503。'],
  },
  ready: {
    label: 'Running 但 0/1', pod: 'api-58c7d9f6b-j6v3s', fault: 'pod', faultText: 'readiness 一直沒過', keys: ['desc', 'ev', 'logs'], order: ['get', 'desc', 'logs'],
    intro: 'Pod 看起來都在跑，但服務一樣連不到。',
    orderWhy: 'Running 但 0/1 就是 readiness 沒過：describe 的 Events 會寫探針失敗的原因（404、connection refused、timeout 各代表不同問題），再用 logs 從程式那一側確認。',
    get: { o: pods([['api-58c7d9f6b-j6v3s', '0/1', 'Running', '0', '6m'], ['api-58c7d9f6b-n2q8f', '0/1', 'Running', '0', '6m']]), hl: [1, 2], clear: ['dep', 'rs'],
      seen: 'STATUS 是 Running，但 READY 0/1、RESTARTS 0。', so: '容器活著、沒重啟（排除當掉與 OOM），只是沒被判定為「可以接流量」——這是 readiness 管的事。' },
    desc: { o: `Name:  api-58c7d9f6b-j6v3s\nContainers:\n  api:\n    State:          Running\n    Ready:          False\n    Restart Count:  0\n    Readiness:      http-get http://:8080/healthz period=5s\n` + devents([['Normal', 'Started', K, 'Started container api'], ['Warning', 'Unhealthy', K, 'Readiness probe failed: HTTP probe'], ['', '', '', 'failed with statuscode: 404']]), hl: [6, 10, 11],
      seen: 'Events：Readiness probe failed … statuscode: 404；探針打的是 :8080/healthz。', so: '404 代表連得到程式、port 也對，只是沒有這個路徑。port 錯會是 connection refused，程式太慢會是 timeout。' },
    logs: { o: '11:20:04 INFO  routes: /orders /reports /ready\n11:20:04 INFO  listening on :8080\n11:20:10 INFO  GET /healthz 404 0ms\n11:20:15 INFO  GET /healthz 404 0ms', hl: [0, 2, 3],
      seen: '程式每 5 秒收到一次 GET /healthz，都回 404；它提供的路徑是 /ready。', so: '從程式這一側證實：探針有打到，只是路徑不對。' },
    prev: { o: noPrev('api-58c7d9f6b-j6v3s'), hl: [], seen: '沒有上一個容器。', so: 'RESTARTS 是 0，沒有當掉過。' },
    ev: { o: events([['6m', 'Normal', 'Started', 'pod/api-58c7d9f6b-j6v3s', 'Started container api'], ['3s', 'Warning', 'Unhealthy', 'pod/api-58c7d9f6b-j6v3s', 'Readiness probe failed: HTTP probe failed with statuscode: 404']]), hl: [2],
      seen: 'Unhealthy：Readiness probe failed，statuscode 404，3 秒前還在發生。', so: '探針持續失敗，而且失敗的方式是 404——路徑的問題。' },
    ep: { o: endpoints(NONE), hl: [1], seen: 'endpoints 是空的。', so: '和 selector 對不上的症狀一樣；差別在 get pods 的 READY：這次是 0/1，是 Pod 自己沒就緒。' },
    opts: [
      { t: 'Service 的 selector 對不上', why: 'selector 對不上時 Pod 會是 1/1。這裡 READY 是 0/1，是 Pod 自己沒通過就緒檢查。' },
      { t: '程式啟動失敗、不斷重啟', why: 'RESTARTS 是 0，容器一直活著。' },
      { t: 'readiness probe 的路徑寫錯，探針一直拿到 404', ok: true },
      { t: '節點資源不足', why: '資源不足會停在 Pending。這裡容器已經在跑了。' },
    ],
    fix: [' readinessProbe:', '   httpGet:', '-    path: /healthz', '+    path: /ready', '     port: 8080'],
    fixNote: 'readiness 沒過只會把 Pod 移出 endpoints，不會重啟容器；同樣的錯路徑如果寫在 livenessProbe，容器會被不斷重啟。',
    why: ['readiness probe 決定 Pod 能不能接流量：持續失敗就不會進 Service 的 endpoints，但容器不會被重啟，所以 STATUS 還是 Running。', '探針設定的路徑是 /healthz，程式提供的是 /ready，每次都拿到 404，於是永遠不 Ready。'],
  },
}
const KEYS = Object.keys(SCN)

export default function K8sDebugLab() {
  const [key, setKey] = useState('pending')
  const [ran, setRan] = useState([])        // 跑過的指令（依序）
  const [cur, setCur] = useState(null)      // 終端機正在顯示哪個指令
  const [pick, setPick] = useState(null)
  const [tries, setTries] = useState(0)
  const [showOrder, setShowOrder] = useState(false)
  const sc = SCN[key]
  const choose = (k) => { setKey(k); setRan([]); setCur(null); setPick(null); setTries(0); setShowOrder(false) }
  const run = (k) => { setCur(k); setRan((r) => (r.includes(k) ? r : [...r, k])) }
  const answer = (i) => { setPick(i); setTries((t) => t + 1) }

  const hitKey = ran.some((k) => sc.keys.includes(k))
  const solved = pick !== null && !!sc.opts[pick].ok
  const cleared = new Set(ran.flatMap((k) => sc[k].clear || []))
  if (solved) PARTS.forEach((p) => { if (p.k !== sc.fault) cleared.add(p.k) })
  const showFault = hitKey || solved || showOrder
  const keyNames = sc.keys.map((k) => CMD[k].label.replace('kubectl ', '')).join(' 或 ')
  const out = cur ? sc[cur] : null

  return (
    <Lab accent="violet" className="kd" kicker="K8S DEBUG LAB" title="從 Pod 狀態查到原因：該下哪個指令、看哪一行"
         blurb="選一種故障，按指令看它在這個情境下會印出什麼，線索記在右邊的筆記；蒐集夠了就選原因——答對會看到要改 manifest 的哪一行。">
      <LabControls>
        <Seg label="情境" tinted value={key} onChange={choose} options={KEYS.map((k) => ({ value: k, label: SCN[k].label }))} />
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => choose(KEYS[(KEYS.indexOf(key) + 1) % KEYS.length])}>換一個情境</button>
        <button type="button" className="btn ghost small" onClick={() => setShowOrder((v) => !v)}>{showOrder ? '收起排查順序' : '顯示建議的排查順序'}</button>
      </LabControls>

      <LabStage label="物件關係" caption={`${sc.intro}　綠色 = 目前的線索可以排除；紅色 = 故障所在（看到關鍵線索後才標出來）。`}>
        <Chain sc={sc} cleared={cleared} showFault={showFault} />
      </LabStage>
      {showOrder && (
        <div className="kd-order">
          <b>建議順序</b>
          {sc.order.map((k, i) => <span key={k} className="tag">{i + 1}. {CMD[k].label}</span>)}
          <span>{sc.orderWhy}</span>
          <span className="g">通則：get pods 看 STATUS / READY / RESTARTS 三欄分類 → describe 看 Events → 容器跑起來過才看 logs（重啟過加 --previous）→ Pod 都正常再看 Service 的 endpoints。</span>
        </div>
      )}

      <LabGrid variant="wide">
        <div className="lab-stack kd-col">
          <div className="kd-term kd-o1">
            <div className="kd-term-head"><span>終端機</span><span>示意輸出</span></div>
            <div className="kd-cmds" role="group" aria-label="指令">
              {CMDS.map((c) => (
                <button key={c.k} type="button" className={`kd-cmd${cur === c.k ? ' on' : ''}${ran.includes(c.k) ? ' ran' : ''}`} onClick={() => run(c.k)}>{c.label}</button>
              ))}
            </div>
            <pre className="kd-out" aria-live="polite">
              {out ? (
                <>
                  <span className="p">$ {CMD[cur].full(sc.pod)}</span>
                  {out.o.split('\n').map((l, i) => <span key={`${key}${cur}${i}`} className={`l${out.hl.includes(i) ? ' hl' : ''}`}>{l || ' '}</span>)}
                </>
              ) : <span className="p">$ <i className="kd-caret" /><em>　按上面的指令開始，建議先 get pods</em></span>}
            </pre>
          </div>
          <Stats min={130} className="kd-o2">
            <Stat label="用了幾個指令" value={`${ran.length} / ${CMDS.length}`} note={ran.map((k) => CMD[k].label.replace('kubectl ', '')).join(' → ') || '還沒開始'} />
            <Stat label="關鍵指令" value={hitKey ? '已走到' : '還沒'} tone={hitKey ? 'ok' : 'warn'} note={hitKey || solved || showOrder ? keyNames : '能直接指出原因的那個'} />
            <Stat label="作答" value={`${tries} 次`} note={solved ? '已找出原因' : tries ? '還沒答對' : '蒐集線索後再選'} tone={solved ? 'ok' : ''} />
          </Stats>
          <div className="kd-o5"><LabExplain title={solved ? '發生了什麼' : `症狀：${sc.label}`}>
            {solved ? sc.why.map((t, i) => <p key={i}>{t}</p>) : <><p>{sc.intro}</p><p>先用 get pods 看 STATUS、READY、RESTARTS 三欄，判斷容器是「沒排上節點」「沒啟動」「啟動後又掛」還是「活著但沒接到流量」，再決定下一個指令。每個指令都按按看：沒有輸出、或印出錯誤，本身也是線索。</p></>}
          </LabExplain></div>
        </div>

        <div className="lab-stack kd-col">
          <div className="kd-notes kd-o3" aria-label="排查筆記">
            <h4>排查筆記</h4>
            {ran.length === 0 && <p className="e">還沒有線索。</p>}
            {ran.map((k) => (
              <div key={k} className={`n${sc.keys.includes(k) ? ' key' : ''}`}>
                <span className="tag">{CMD[k].label.replace('kubectl ', '')}</span>{sc.keys.includes(k) && <span className="kd-key">關鍵</span>}
                <p><b>看到</b>{sc[k].seen}</p>
                <p><b>判斷</b>{sc[k].so}</p>
              </div>
            ))}
            {cleared.size > 0 && <p className="x">目前可以排除：{PARTS.filter((p) => cleared.has(p.k)).map((p) => p.label).join('、')}</p>}
          </div>
          <div className="kd-quiz kd-o4">
            <h4>原因是哪一個？</h4>
            {sc.opts.map((o, i) => (
              <button key={i} type="button" className={`kd-opt${pick === i ? (o.ok ? ' ok' : ' no') : ''}`} aria-pressed={pick === i} onClick={() => answer(i)}>{o.t}</button>
            ))}
            {pick !== null && !solved && (
              <div className="kd-fb"><Status>不是這個</Status>
                <p>{hitKey ? sc.opts[pick].why : `還缺關鍵線索：先跑 ${keyNames}，看它印出什麼再判斷。`}</p></div>
            )}
            {solved && (
              <div className="kd-fb"><Status ok>答對</Status>
                {!hitKey && <p>答案對了，但還沒看到證據：動手改之前先跑 {keyNames} 確認。</p>}
                <pre className="kd-diff" aria-label="manifest 修改（示意）">{sc.fix.map((l, i) => <span key={i} className={l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : ''}>{l}</span>)}</pre>
                <p>{sc.fixNote}</p></div>
            )}
          </div>
          <div className="kd-o6"><Callout title="實際用在哪裡">
            部署後 Pod 起不來、服務時好時壞、Pod 都在跑卻連不到，都從 get pods 的三欄開始分類，再決定看 describe、logs 還是 endpoints。回報問題時附上 STATUS、READY、RESTARTS 與 Events 的那一行，比「服務掛了」有用得多。
          </Callout></div>
        </div>
      </LabGrid>
      <Caption>kubectl 輸出為示意格式、經過刪節，實際欄位與訊息依版本而異；較新的 Kubernetes 建議改看 EndpointSlice（kubectl get endpointslices），判讀方式相同。名稱與位址皆為虛構。</Caption>

      <style>{`
        .kd .seg-group { flex-wrap: wrap; }
        .kd .lab-grid { margin-top: 14px; }
        @media (max-width: 760px) {   /* 單欄時把兩欄攤平重排：終端機 → 統計 → 筆記 → 作答 → 說明 */
          .kd-col { display: contents; }
          .kd-o1 { order: 1; } .kd-o2 { order: 2; margin-top: 0; } .kd-o3 { order: 3; } .kd-o4 { order: 4; } .kd-o5 { order: 5; } .kd-o6 { order: 6; }
        }
        .kd-order { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-top: 10px; padding: 8px 12px; border: 1px dashed var(--lab-accent); border-radius: var(--radius); font-size: 0.82rem; color: var(--ink-2); line-height: 1.6; }
        .kd-order b { color: var(--ink-1); }
        .kd-order .g { flex-basis: 100%; color: var(--ink-3); font-size: 0.78rem; }
        .kd-term { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-2); overflow: hidden; }
        .kd-term-head { display: flex; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid var(--hairline); font-size: 0.7rem; letter-spacing: 0.1em; color: var(--ink-3); font-weight: 700; }
        .kd-cmds { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 0; }
        .kd-cmd { font-family: var(--mono); font-size: 0.76rem; padding: 5px 9px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); color: var(--ink-2); cursor: pointer; transition: border-color 0.15s ease, color 0.15s ease; }
        .kd-cmd:hover { border-color: var(--ink-3); color: var(--ink-1); }
        .kd-cmd.ran::after { content: ' ✓'; color: var(--good); }
        .kd-cmd.on { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); color: var(--ink-1); }
        .kd-out { margin: 0; padding: 10px 0 12px; min-height: 190px; overflow-x: auto; font-family: var(--mono); font-size: 0.76rem; line-height: 1.65; color: var(--ink-1); }
        .kd-out span { display: block; padding: 0 12px; white-space: pre; }
        .kd-out .p { color: var(--lab-accent); font-weight: 700; margin-bottom: 4px; }
        .kd-out .p em { font-style: normal; font-weight: 400; color: var(--ink-3); font-family: var(--sans); }
        .kd-out .l { animation: kd-in 0.25s ease both; }
        .kd-out .l.hl { background: color-mix(in srgb, var(--lab-accent) 14%, transparent); box-shadow: inset 3px 0 0 var(--lab-accent); }
        .kd-caret { display: inline-block; width: 7px; height: 1em; vertical-align: text-bottom; background: var(--lab-accent); animation: kd-blink 1s steps(2) infinite; }
        @keyframes kd-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @keyframes kd-blink { 50% { opacity: 0; } }
        .kd-notes, .kd-quiz { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px 12px; display: grid; gap: 8px; font-size: 0.82rem; color: var(--ink-2); line-height: 1.6; }
        .kd-notes h4, .kd-quiz h4 { font-size: 0.82rem; color: var(--ink-1); }
        .kd-notes .e, .kd-notes .x { color: var(--ink-3); }
        .kd-notes .x { color: var(--good); font-weight: 600; }
        .kd-notes .n { border-left: 3px solid var(--hairline); padding-left: 9px; }
        .kd-notes .n.key { border-left-color: var(--lab-accent); }
        .kd-notes .n p b { color: var(--ink-1); margin-right: 6px; font-size: 0.74rem; }
        .kd-key { margin-left: 6px; font-size: 0.7rem; font-weight: 700; color: var(--lab-accent); }
        .kd-opt { text-align: left; font: inherit; padding: 7px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); color: var(--ink-1); cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
        .kd-opt:hover { border-color: var(--ink-3); }
        .kd-opt.ok { border-color: var(--good); background: color-mix(in srgb, var(--good) 10%, var(--surface-1)); }
        .kd-opt.no { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .kd-fb { display: grid; gap: 6px; justify-items: start; }
        .kd-diff { margin: 0; width: 100%; box-sizing: border-box; padding: 8px 0; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-2); font-family: var(--mono); font-size: 0.76rem; line-height: 1.6; color: var(--ink-1); overflow-x: auto; }
        .kd-diff span { display: block; padding: 0 10px; white-space: pre; }
        .kd-diff .add { background: color-mix(in srgb, var(--good) 16%, transparent); }
        .kd-diff .del { background: color-mix(in srgb, var(--critical) 14%, transparent); color: var(--ink-2); }
        .kd-svg .box { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease, fill 0.25s ease; }
        .kd-svg .box.ok { stroke: var(--good); }
        .kd-svg .box.bad { stroke: var(--critical); stroke-width: 2.5; fill: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); }
        .kd-svg .edge { stroke: var(--ink-3); stroke-width: 1.5; transition: stroke 0.25s ease; }
        .kd-svg .head { fill: var(--ink-3); transition: fill 0.25s ease; }
        .kd-svg .edge.bad { stroke: var(--critical); stroke-width: 2.5; stroke-dasharray: 5 4; }
        .kd-svg .head.bad { fill: var(--critical); }
        .kd-svg .lbl { font-family: var(--sans); font-size: 12px; font-weight: 600; fill: var(--ink-1); }
        .kd-svg .sub { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-3); }
        .kd-svg .et { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .kd-svg .mk { font-family: var(--sans); font-size: 10.5px; font-weight: 700; }
        .kd-svg .mk.ok { fill: var(--good); } .kd-svg .mk.bad { fill: var(--critical); }
        @media (max-width: 640px) { .kd-out span, .kd-diff span { white-space: pre-wrap; overflow-wrap: anywhere; } .kd-out { min-height: 150px; } }
        @media (prefers-reduced-motion: reduce) { .kd-out .l, .kd-caret { animation: none; } }
      `}</style>
    </Lab>
  )
}

/* 關係圖：寬版橫排、窄版直排（viewBox = 實際寬度，文字不縮小）。Deployment → ReplicaSet → Pod ← Service ← Ingress */
function Chain({ sc, cleared, showFault }) {
  const ref = useRef(null)
  const W = Math.max(280, useWidth(ref, 900))
  const horiz = W >= 660
  const n = PARTS.length
  const sp = horiz ? W / n : 64, bw = horiz ? Math.min(160, sp - 78) : Math.min(170, W * 0.5), bh = 40
  const H = horiz ? 92 : n * sp
  const c = (i) => (horiz ? { x: sp * i + sp / 2, y: 34 } : { x: 8 + bw / 2, y: 26 + sp * i })
  const stateOf = (k) => (showFault && k === sc.fault ? 'bad' : cleared.has(k) ? 'ok' : '')
  return (
    <div ref={ref}>
      <svg className="kd-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Deployment、ReplicaSet、Pod、Service、Ingress 的關係${showFault ? `；故障在 ${PARTS.find((p) => p.k === sc.fault).label}：${sc.faultText}` : ''}`}>
        {EDGES.map((e, i) => {
          const a = c(i), b = c(i + 1)
          const bad = showFault && sc.fault === 'svc' && i === 2 ? ' bad' : ''
          const p1 = horiz ? { x: a.x + bw / 2, y: a.y } : { x: a.x, y: a.y + bh / 2 }
          const p2 = horiz ? { x: b.x - bw / 2, y: b.y } : { x: b.x, y: b.y - bh / 2 }
          const tip = e.rev ? p1 : p2, s = e.rev ? 1 : -1        // 箭頭尖端與朝向
          const head = horiz ? `M${tip.x} ${tip.y} l${s * 7} -4 v8 z` : `M${tip.x} ${tip.y} l-4 ${s * 7} h8 z`
          return (
            <g key={i}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className={`edge${bad}`} />
              <path d={head} className={`head${bad}`} />
              <text x={horiz ? (p1.x + p2.x) / 2 : p1.x + 10} y={horiz ? p1.y - 7 : (p1.y + p2.y) / 2 + 4} textAnchor={horiz ? 'middle' : 'start'} className="et">{e.t}</text>
            </g>
          )
        })}
        {PARTS.map((p, i) => {
          const q = c(i), st = stateOf(p.k)
          return (
            <g key={p.k}>
              <rect x={q.x - bw / 2} y={q.y - bh / 2} width={bw} height={bh} rx="5" className={`box ${st}`} />
              <text x={q.x} y={q.y - 3} textAnchor="middle" className="lbl">{p.label}</text>
              <text x={q.x} y={q.y + 12} textAnchor="middle" className="sub">{p.sub}</text>
              {st && <text x={horiz ? q.x : q.x + bw / 2 + 8} y={horiz ? q.y + bh / 2 + 16 : q.y + 4} textAnchor={horiz ? 'middle' : 'start'} className={`mk ${st}`}>{st === 'bad' ? `✕ ${sc.faultText}` : '✓ 可排除'}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
