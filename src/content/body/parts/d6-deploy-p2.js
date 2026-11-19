// 領域內文（d6-deploy，p2 批）：以技能 id 為 key，由 body/d6-deploy.js 合併。只放這些技能：container-registry
export default {
  'container-registry': {
    points: [
      { b: 'registry 存 manifest 與 layer，tag 只是指標', t: 'manifest 列出設定與每一層的 digest，layer 以內容雜湊存放、同一層只存一份，多架構映像多一層索引。刪 tag 只拿掉名字，空間要等垃圾回收把沒有任何 manifest 參照的 layer 清掉；被保留的映像共用的基底層與依賴層不會釋放。' },
      { b: 'Harbor 用專案分權限，CI 與叢集用機器人帳號', t: '專案分公開與私有，內建角色從 Limited Guest 到 Project Admin，Developer 起就能推送。人員帳號接 LDAP 或 OIDC，部署時就選定。CI 推送與叢集拉取各用一個機器人帳號，範圍限縮到專案與動作、設到期日；它不隨人員離職失效，要列冊、到期前輪替。' },
      { b: '推送後掃描，可以擋下有高風險弱點的映像', t: 'Harbor 內建 Trivy，可以推送時自動掃描、排程全部重掃，並設「某個等級以上就不准拉」。打開後沒掃過或掃描失敗的映像也拉不到，節點重排 Pod 時才會發現。確認不受影響的弱點加進 CVE allowlist 並寫理由；斷網時弱點資料庫要另外同步。' },
      { b: '保留規則、不可變 tag、垃圾回收與配額一起設', t: '保留規則依推送數、推送或拉取天數、tag 樣式保留，規則之間是 OR，一個 tag 符合就保留整個 artifact，執行後無法復原。規則不知道哪個映像正在跑，部署用的版本靠 release tag 加不可變規則保住。保留規則之後排垃圾回收，用配額限制每個專案的用量。' },
      { b: '外部映像走代理快取或事先同步，斷網就全部搬進來', t: 'Docker Hub 對未登入（依來源 IP 計算）與免費帳號有拉取次數上限。Harbor 的代理快取專案代理 Docker Hub、ghcr.io、quay.io 等，`FROM`、`COPY --from` 與 CI 的 `image:` 改指院內位址，官方映像要寫出 `library/`。斷網環境列出應用、基底、CI、K8s 元件與 Helm chart 用到的每個映像，用 skopeo 或 crane 保留 digest 與多架構複製，K8s 升級前先同步。' },
    ],
    checklist: [
      '能替院內 Harbor 規劃專案（基底、應用、代理快取、斷網同步）與機器人帳號，說出 CI 與叢集各拿什麼權限、憑證放在哪裡、到期前怎麼輪替',
      '能寫出一組保留規則，說明哪些 artifact 會被刪、為什麼刪完要跑垃圾回收、共用的 layer 為什麼不會釋放，以及怎麼避免刪到正在部署的映像',
      '能列出一座斷網叢集需要的所有映像（含 K8s 元件與 Helm chart 用到的），保留 digest 與多架構搬進院內，並讓節點信任院內 CA、透過 ServiceAccount 的 pull secret 拉得到',
    ],
    refs: [
      { label: 'Harbor：Configure Proxy Cache', url: 'https://goharbor.io/docs/main/administration/configure-proxy-cache/' },
      { label: 'Harbor：Create Tag Retention Rules', url: 'https://goharbor.io/docs/main/working-with-projects/working-with-images/create-tag-retention-rules/' },
      { label: 'Harbor：Garbage Collection', url: 'https://goharbor.io/docs/main/administration/garbage-collection/' },
      { label: 'Harbor：Create Project Robot Accounts', url: 'https://goharbor.io/docs/main/working-with-projects/project-configuration/create-robot-accounts/' },
      { label: 'Docker Hub：Usage and limits', url: 'https://docs.docker.com/docker-hub/usage/pulls/' },
      { label: 'Kubernetes：Images（私有 registry 與 pull secret）', url: 'https://kubernetes.io/docs/concepts/containers/images/' },
      { label: 'Kubernetes：Pull an Image from a Private Registry', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/' },
      { label: 'containerd：Registry Configuration（hosts.toml）', url: 'https://github.com/containerd/containerd/blob/main/docs/hosts.md' },
      { label: 'skopeo', url: 'https://github.com/containers/skopeo' },
      { label: 'crane', url: 'https://github.com/google/go-containerregistry/blob/main/cmd/crane/README.md' },
    ],
  },
}
