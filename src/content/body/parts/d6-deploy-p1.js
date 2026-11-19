// 領域內文（d6-deploy，p1 批）：以技能 id 為 key，由 body/d6-deploy.js 合併。只放這些技能：container-operations
export default {
  'container-operations': {
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
