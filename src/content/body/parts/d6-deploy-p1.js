// 領域內文（d6-deploy，p1 批）：以技能 id 為 key，由 body/d6-deploy.js 合併。只放這些技能：container-operations
export default {
  'container-operations': {
    map: {
      names: [
        { n: '結束碼 137 與 143', t: '137 是被 SIGKILL（`OOMKilled=true` 是記憶體，`false` 多半是停止時等滿寬限期），143 是收到 SIGTERM 用預設動作結束。' },
        { n: '日誌輪替（`max-size`、`max-file`）', t: 'json-file 驅動預設不輪替；寫在 daemon.json 只對之後建立的容器生效，既有的要重建。' },
        { n: '記憶體上限與 OOM killer', t: '超過 `--memory` 時核心送 SIGKILL；被殺的是 PID 1 容器就結束，是 gunicorn 的 worker 則容器還在。' },
        { n: 'CPU 上限（`--cpus`）', t: '超過是節流，不會被殺；CPU 卡在 100% 而上限更高，通常是單一 Python 行程受 GIL 限制。' },
        { n: 'SIGTERM 與寬限期', t: '`docker stop` 先送 SIGTERM，等 `-t`（預設 10 秒）後送 SIGKILL；Kubernetes 對應 `terminationGracePeriodSeconds`。' },
        { n: '`--init`', t: '讓 tini 當 PID 1、轉送訊號；程式沒處理 SIGTERM 時一樣當場結束，手上的工作照樣被切斷。' },
        { n: '重啟策略', t: '`--restart unless-stopped`、`on-failure`；`RestartCount` 一直增加代表程式反覆崩潰。' },
        { n: '`crictl`', t: 'Kubernetes 節點上用 containerd 或 CRI-O，沒有 docker 指令，用 `crictl ps`、`crictl logs` 查容器。' },
      ],
      ask: [
        '日誌輪替的設定（`max-size`、`max-file`），寫在 daemon.json 還是 compose 的 `logging`。',
        '記憶體與 CPU 上限，以及超過時預期的行為（worker 被砍或整個容器結束）。',
        '收到 SIGTERM 之後程式做什麼：停收新請求、手上的工作最多等幾秒、再結束；寬限期多長。',
        '重啟策略，以及重啟幾次要告警。',
        '以哪個數字 UID 執行，哪些目錄要可寫。',
      ],
      prompt: '收據服務 `billing-api` 用 compose 部署：`logging` 用 json-file，`max-size: 50m`、`max-file: 5`；`mem_limit: 1g`、`cpus: 2`；`restart: unless-stopped`；`stop_grace_period: 30s`。程式收到 SIGTERM 後停收新請求，手上的請求最多等 20 秒（比 30 秒短）再結束。以 UID 10001 執行，只有 `/tmp` 可寫。',
      verify: [
        { c: '輪替有沒有套用', t: '`docker inspect --format \'{{json .HostConfig.LogConfig}}\' billing-api` 要看到 `max-size`；`Config` 是空的代表容器建立在改設定之前，要重建。' },
        { c: '停止要多久', t: '`time docker stop billing-api` 剛好等於寬限期、`docker inspect --format \'{{.State.ExitCode}}\'` 是 137，代表程式沒處理 SIGTERM；正常收尾的結束碼是 0。' },
        { c: '被殺的原因', t: '`docker inspect --format \'{{.State.OOMKilled}} {{.State.ExitCode}}\'` 得到 `true 137` 是記憶體；另開終端機跑 `docker events --filter container=billing-api` 看 `kill` 事件的 `signal`。' },
        { c: '資源用量', t: '`docker stats --no-stream` 的 CPU% 停在 100% 左右而上限是 200%，先懷疑單一行程，量測多開 worker 的效果，不是先調高上限。' },
        { c: '在 Kubernetes 上', t: '`kubectl describe pod` 的 `Last State` 看 `Reason: OOMKilled` 與 `Exit Code: 137`；節點上用 `crictl ps`、`crictl logs`。' },
      ],
    },
    points: [
      { b: '先查再動手', t: '`docker ps -a` 看結束碼、`docker logs --since 30m` 看程式說了什麼、`docker inspect` 看 `OOMKilled` 與 `RestartCount`、`docker events` 看誰送了什麼訊號。137 加上 `OOMKilled=true` 是記憶體，`false` 多半是停止時等滿寬限期；143 是程式收到 SIGTERM 用預設動作直接結束。' },
      { b: '日誌要輪替', t: '預設的 json-file 不輪替，log 會長到磁碟滿。用 `--log-opt max-size=50m --log-opt max-file=5`，或寫在 daemon.json（值一律是字串）；daemon.json 只對之後建立的容器生效，改完要重建。磁碟已滿時 `truncate` 清空，不要 `rm`。Kubernetes 上由 kubelet 輪替，`kubectl logs` 只看得到最新的檔案。' },
      { b: '記憶體與 CPU 的上限', t: '`--memory` 超過時 OOM killer 送 SIGKILL：PID 1 被殺容器就結束；gunicorn 的 worker 被殺時容器還在，線索在 log 的 `Perhaps out of memory?`。`--cpus` 超過是節流。CPU 卡在 100% 而上限更高，是單一 Python 行程受 GIL 限制，量測多個 worker 的效果。' },
      { b: '關機：SIGTERM 與寬限期', t: 'PID 1 沒處理 SIGTERM 時，`docker stop` 等滿 10 秒送 SIGKILL。`--init` 讓它立刻停，但程式用預設動作當場結束，交易一樣被切斷。程式要停收新連線、做完手上的、再結束；寬限期由內而外：程式的等待上限 < `docker stop -t` 或 `terminationGracePeriodSeconds`。' },
      { b: '同一個映像，不同的執行環境', t: 'OCI 映像在 Docker Engine、containerd、CRI-O、Podman 上都能跑。Kubernetes 1.24 起移除 dockershim，節點上用 `crictl` 查容器。Pod Security 的 restricted 會擋以 root 執行的 Pod，映像先改成數字 UID 的非 root 使用者，寫檔改到 `/tmp` 或 volume。' },
    ],
    checklist: [
      '能替一台主機設好日誌輪替，並用 `docker inspect` 確認既有的容器已經重建套用',
      '能分辨 `Exited (137)` 是記憶體超過上限還是停止逾時，並替 PID 1 的 Python 服務補上 SIGTERM 處理與足夠的寬限期',
      '能說明院內開發機使用 Docker Desktop 前要確認的授權條件，以及有哪些替代方案',
    ],
    challenge: {
      task: '用標準函式庫寫一個最小的 HTTP 服務，`/slow` 要 8 秒才回，跑在 `python:3.12-slim` 容器裡。另一個終端機每秒送一次 `/slow`（例如 `while true; do curl -s -o /dev/null -w \'%{http_code} %{time_total}\\n\' localhost:8000/slow & sleep 1; done`），第 5 秒時執行 `docker stop`。做三個版本：程式不處理 SIGTERM、加 `--init`、程式自己處理（停收新連線、做完手上的再結束）。動手前先預測每個版本有幾個請求拿到 200、幾個連線失敗。',
      deliver: '三個版本各一份：`curl` 的輸出、`time docker stop` 的秒數、`docker inspect --format \'{{.State.ExitCode}}\'` 的結果',
      check: [
        '三個版本的預測與實際結果並列',
        '從結束碼分得出三個版本（137、143、0）',
        '第三個版本裡，`docker stop` 之前送出的請求都拿到 200，之後的連線被拒絕',
        '寫出程式的等待上限與 `docker stop -t` 各設多少，以及前者為什麼要比較短',
      ],
      twist: '同一個服務搬到 Kubernetes，前面有 Service。先預測：Pod 收到 SIGTERM 之後的幾秒內還會不會有新請求進來，程式或 manifest 要多做什麼。',
    },
    refs: [
      { label: 'Docker：JSON File logging driver', url: 'https://docs.docker.com/engine/logging/drivers/json-file/' },
      { label: 'Docker：Resource constraints', url: 'https://docs.docker.com/engine/containers/resource_constraints/' },
      { label: 'Docker：Start containers automatically', url: 'https://docs.docker.com/engine/containers/start-containers-automatically/' },
      { label: 'Docker Desktop license agreement', url: 'https://docs.docker.com/subscription/desktop-license/' },
      { label: 'Kubernetes：Logging Architecture', url: 'https://kubernetes.io/docs/concepts/cluster-administration/logging/' },
      { label: 'Kubernetes：Debugging Kubernetes nodes with crictl', url: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/' },
    ],
  },
}
