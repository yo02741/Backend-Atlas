// 題庫：P11 新課（p1 批）：container-operations
export default [
  {
    skill: 'container-operations',
    questions: [
      {
        q: '主機磁碟被 `billing-api` 的 json-file 日誌塞滿。值班同事在 `/etc/docker/daemon.json` 加上 `"log-opts": {"max-size": "50m", "max-file": "5"}`、重啟 Docker，三天後磁碟又在長，那個日誌檔已經超過 5 GB。最可能的原因是什麼？',
        options: [
          'json-file 不支援 max-size，要把 log-driver 改成 local 才會輪替',
          'max-file 要搭配 compress 一起設定，否則舊檔不會被刪掉',
          'daemon.json 只套用到之後建立的容器，billing-api 沒有重建，還是原本的設定',
          '重啟 Docker 之後日誌檔被重新開啟，要先 truncate 清空舊檔，輪替才會開始',
        ],
        answer: 2,
        explain: 'daemon.json 的 log-opts 是新容器的預設值；已經存在的容器保留建立時的日誌設定，要重建（例如 `docker compose up -d --force-recreate`）才會套用，可以用 `docker inspect --format \'{{json .HostConfig.LogConfig}}\'` 確認。json-file 本身支援 max-size 與 max-file；compress 只決定舊檔要不要壓縮，和刪不刪無關；truncate 是磁碟已滿時的急救，不會啟動輪替。',
      },
      {
        q: '`billing-api` 用 `gunicorn -w 1 --threads 50` 跑，容器設了 `--cpus 4`。產生收據 PDF 的尖峰時段請求大量排隊，下面是當時的輸出。哪個判斷與下一步最合理？',
        code: '$ docker stats --no-stream billing-api\nCONTAINER ID   NAME          CPU %     MEM USAGE / LIMIT   MEM %     PIDS\n7f3e2a91c0d7   billing-api   100.82%   790MiB / 2GiB       38.57%    53\n\n$ docker inspect --format \'{{.State.OOMKilled}} {{.RestartCount}}\' billing-api\nfalse 0',
        lang: 'bash',
        options: [
          'CPU 只用到 1 顆，像是單一行程受 GIL 限制；壓測多個 worker 的設定',
          'CPU 被 --cpus 節流了，把上限調到 8 顆，排隊就會消失',
          '執行緒不夠用，把 --threads 調到 100，讓更多請求同時進行',
          '記憶體快到上限，Python 正在頻繁回收記憶體而變慢；把記憶體上限調到 4 GiB',
        ],
        answer: 0,
        explain: '上限是 400%，實際卻停在 100% 左右，請求還在排隊，這是一個行程裡的執行緒在搶同一把 GIL 的樣子：產生 PDF 的運算大部分在 Python 層時，同一時間只有一個執行緒能跑。調高 --cpus 或 --threads 都還是同一個行程；記憶體只用了 38%，也沒有 OOM。多個 worker 是多個行程、各有自己的 GIL，但也各有一份記憶體，要量測每秒完成數與記憶體再決定。',
      },
      {
        q: '付款的 socket 服務（`python payment_server.py` 是 PID 1，程式沒有處理 SIGTERM）每次 `docker stop` 都等 10 秒、交易被切斷。同事加上 `--init` 之後，`docker stop` 立刻完成、結束碼是 143，但櫃檯還是回報交易中斷。接下來該怎麼做？',
        options: [
          '把 `docker stop -t` 調成 60 秒，讓程式有足夠的時間把交易做完',
          '在 Dockerfile 加 `STOPSIGNAL SIGKILL`，讓容器直接結束，終端機就會馬上重連',
          '把重啟策略改成 `--restart always`，容器一結束就重新啟動，縮短中斷時間',
          '程式自己處理 SIGTERM：停收新連線、做完手上的交易再結束，`-t` 比等待上限長',
        ],
        answer: 3,
        explain: '加了 --init 後，tini 是 PID 1，把 SIGTERM 轉給 Python；Python 沒有處理函式，用預設動作當場結束（143），所以停得快，交易一樣被切斷。程式不處理 SIGTERM 時，調大 -t 沒有用：它在收到訊號的瞬間就結束了。STOPSIGNAL SIGKILL 等於每次都硬殺；重啟策略只影響結束之後，不會讓進行中的交易做完。',
      },
    ],
  },
]
