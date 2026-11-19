// 題庫：P11 新課（p2 批）：container-registry
export default [
  {
    skill: 'container-registry',
    questions: [
      {
        q: '`clinic/api` 套用保留規則後刪掉了 8,000 個舊 tag，Harbor 的磁碟用量卻幾乎沒變。最可能的原因是什麼？',
        options: [
          '保留規則刪掉的 tag 會先進資源回收筒，要過 30 天才會從磁碟移除',
          '專案配額把已刪除映像的空間保留給同一個專案，要把配額調低才會釋放',
          '刪 tag 只拿掉指向 manifest 的名字，layer 要等垃圾回收才會移除；被保留的映像共用的層也不會釋放',
          '被刪的都成了 untagged artifact，Harbor 不計算它們的大小，所以用量看不出變化',
        ],
        answer: 2,
        explain: 'Harbor 的文件寫明刪除映像不會自動釋放空間，要跑垃圾回收，把不再被任何 manifest 參照的 blob 移除。即使跑了垃圾回收，被保留的映像共用的基底層與依賴層也不會被刪，釋放的量常比「刪掉的映像大小加總」小很多。Harbor 沒有資源回收筒，保留規則執行後無法復原；配額只限制用量、不保留空間；untagged artifact 一樣占用儲存空間。',
      },
      {
        q: '在跳板機（一台 arm64 筆電）上用下面的指令把 `pause` 複製進院內 Harbor。斷網叢集的 manifest 照上游的寫法，用上游的 digest 釘版本，只把 registry 改成院內位址。節點拉取時回 `manifest unknown`。原因與修法是什麼？',
        code: 'skopeo copy docker://registry.k8s.io/pause:3.10.1 \\\n  docker://harbor.example.org/k8s/pause:3.10.1\n\n# manifest 裡\nimage: harbor.example.org/k8s/pause:3.10.1@sha256:<上游的 digest>',
        lang: 'bash',
        options: [
          '沒加 `--all`，skopeo 只複製了跳板機架構的那一份、沒有複製多架構索引，院內沒有上游的那個 digest；加 `--all`（搭配 `--preserve-digests`）重新複製',
          'Harbor 收到映像後會重新壓縮 layer，digest 一定會變；斷網環境只能用 tag，不能用 digest',
          'Harbor 裡沒有事先建立 `pause` 這個 repository，skopeo 推送到不存在的 repository 時只寫入 tag、不寫入 manifest',
          'digest 綁定原本的 registry，換了 registry 就要用 `crane digest` 重算，把新的值寫回 manifest 就好',
        ],
        answer: 0,
        explain: 'digest 是內容的雜湊，內容相同、放在哪個 registry 都一樣，所以 manifest 可以帶著上游的 digest 進斷網環境。`pause` 是多架構映像，上游的 digest 指的是多架構索引；skopeo 預設只複製符合執行機器架構的那一份（這裡是 arm64），索引沒有過來。加 `--all` 複製每個架構與索引，`--preserve-digests` 在 digest 保不住時讓複製失敗。Harbor 不會重新壓縮 layer；repository 在推送時自動建立。照 D 重算只會得到 arm64 那一份的 digest，amd64 的節點仍然不能用。',
      },
      {
        q: 'CI 推送 `clinic/api` 與叢集拉取，目前都用一位已離職同事的 Harbor 個人帳號（他是 `clinic` 專案的 Developer）。要收掉這個帳號，又不讓 CI 與叢集中斷，哪個做法最合適？',
        options: [
          '先停用他的帳號，Harbor 偵測到帳號停用後，CI 與叢集會自動改用 admin 繼續存取，之後再慢慢換',
          '建一個 system 機器人帳號，勾選 Cover all projects 並給推送與拉取權限，CI 與叢集共用，設成永不過期以免中斷',
          '把 `clinic` 專案改成公開，叢集就不需要 pull secret；CI 改用另一位在職同事的個人帳號推送',
          '建兩個設了到期日的機器人帳號，CI 的能推送、叢集的只能拉取，放進受保護變數與 pull secret；確認正常後再移除他的帳號',
        ],
        answer: 3,
        explain: '機器人帳號不隨人員異動失效，範圍限縮到專案、推送與拉取分開，到期日提醒輪替；CI 的憑證放受保護變數，只有受保護分支的 pipeline 拿得到。先換憑證再收帳號，CI 與新排程的 Pod 才不會失敗。A 停用帳號後 CI 與叢集會因登入失敗而中斷，Harbor 不會自動改用 admin。B 的範圍是現在與未來的所有專案、又不過期，外洩時影響整座 Harbor。C 讓院內任何人都能拉應用程式映像，CI 也只是換成依賴另一個人的帳號。',
      },
    ],
  },
]
