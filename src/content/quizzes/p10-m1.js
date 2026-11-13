// 題庫：P10 新課（m1 批）：debugging、load-testing
export default [
  {
    skill: 'debugging',
    questions: [
      {
        q: 'log 裡有這段 traceback。要找出問題的根源，應該先看哪一個 frame？',
        code: `Traceback (most recent call last):
  File "/app/app/services/order_view.py", line 14, in render_item
    options = json.loads(item["options"])
  File "/usr/local/lib/python3.14/json/__init__.py", line 345, in loads
    raise TypeError(f'the JSON object must be str, bytes or bytearray, '
TypeError: the JSON object must be str, bytes or bytearray, not NoneType

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/app/app/api/orders.py", line 21, in get_order
    return {"id": order["id"], "lines": order_detail(order)}
  File "/app/app/services/order_view.py", line 31, in order_detail
    raise OrderViewError(f"cannot render order {order['id']}") from e
OrderViewError: cannot render order 1042`,
        lang: 'python',
        options: [
          'json/__init__.py 第 345 行：它是實際 raise TypeError 的地方，也是最底層的 frame',
          'order_view.py 第 31 行：它在整份 traceback 的最下面，是最後丟出例外的地方',
          'order_view.py 第 14 行：第一段裡最靠近出錯點、路徑在自己專案內的 frame',
          'orders.py 第 21 行：它是請求進到自己程式的第一個 frame，要從入口開始查',
        ],
        answer: 2,
        explain: '串接的 traceback 裡上面那段先發生，根源在第一段。第一段最底下的 frame 在標準函式庫，它只是照規則拒絕了傳進去的 None；往上一格的 order_view.py 第 14 行才是自己的程式，那一行的 item["options"] 是 None。第 31 行只是把例外轉換成 OrderViewError 再丟出去，orders.py 第 21 行則離出錯點更遠。',
      },
      {
        q: 'traceback 中間出現 `During handling of the above exception, another exception occurred:`，這代表什麼？',
        options: [
          '程式用 raise … from e 明確轉換了例外，上面那段是被包裝起來的原因',
          '在 except 或 finally 區塊執行途中又丟出了另一個例外，而且沒有寫 from',
          '同一個例外被重試機制重新丟出了第二次，所以 traceback 印了兩遍',
          '下面那段才是先發生的例外，上面那段是 Python 事後補上的呼叫堆疊',
        ],
        answer: 1,
        explain: '這一行對應的是 __context__：處理第一個例外的途中又出了第二個例外。可能是轉換例外時漏寫 from，也可能是處理錯誤的程式自己有 bug，後者代表有兩個地方要修。raise … from e 印出的是「The above exception was the direct cause of the following exception」。兩種寫法都是上面那段先發生，跟重試無關。',
      },
      {
        q: '報表的金額從某次發版後開始算錯，沒有任何例外。已知 tag v2.3.0 的結果正確、目前的 main 是錯的，中間隔了 200 個 commit，而且手上有一支能判斷結果對不對的腳本。接下來怎麼做最有效率？',
        options: [
          '從最新的 commit 開始逐一 revert，每 revert 一個就跑一次腳本，直到結果變正確',
          '把 200 個 commit 的 diff 依序讀過一遍，挑出有動到金額計算的再逐一檢查',
          '在計算金額的函式外層加上 try/except 與 log，部署後等問題再次出現',
          '用 git bisect 標記好壞兩端，搭配 git bisect run 執行腳本，大約 8 步找到第一個壞的 commit',
        ],
        answer: 3,
        explain: '已知一個好的版本和一個壞的版本，又有可以自動判斷的重現腳本，正是二分法的條件：200 個 commit 約 log₂200 ≈ 8 步。逐一 revert 最壞要測 200 次；讀 diff 依賴猜測，而且引入問題的改動不一定「看起來」跟金額有關；沒有例外的問題，try/except 什麼也接不到。',
      },
    ],
  },
  {
    skill: 'load-testing',
    questions: [
      {
        q: '用「固定 50 個虛擬使用者、收到回應才送下一個請求」的方式壓測，過程中系統卡住了 2 秒。這種量測方式對結果有什麼影響？',
        options: [
          '卡住期間請求會持續累積，所以量到的 p99 會比使用者實際感受到的更高',
          '卡住期間工具送出的請求變少，慢的時段被取樣得最少，p99 會被低估',
          '沒有影響：每個請求的延遲都有被記錄，百分位數就是實際的分佈',
          '只會影響吞吐的數字，延遲的百分位數與送出請求的方式無關',
        ],
        answer: 1,
        explain: '這是封閉模型：使用者要等到回應才送下一個，系統卡住時工具也跟著停下來，本來該在這 2 秒內送出、也會被卡住的請求沒有被送出，也沒有被記錄（coordinated omission）。結果是慢的時段樣本最少，百分位數偏樂觀。請求持續累積是開放模型（固定到達率）才有的行為。',
      },
      {
        q: '這是一次逐步加壓的結果（封閉模型，每一級維持 3 分鐘）。哪一個判讀是對的？',
        code: `[
  {"vus": 10, "rps": 195, "p95_ms": 60,  "error_rate": 0.0},
  {"vus": 20, "rps": 388, "p95_ms": 62,  "error_rate": 0.0},
  {"vus": 40, "rps": 610, "p95_ms": 95,  "error_rate": 0.0},
  {"vus": 60, "rps": 615, "p95_ms": 180, "error_rate": 0.0},
  {"vus": 80, "rps": 612, "p95_ms": 290, "error_rate": 0.004}
]`,
        lang: 'json',
        options: [
          '容量約 610 rps，在併發 40 附近就已經飽和；之後增加併發只是讓請求排隊更久',
          '錯誤率到併發 80 才出現，所以飽和點在併發 80，容量還有成長的空間',
          '系統還沒飽和：吞吐在每一級都沒有明顯下降，應該繼續加到吞吐掉下來為止',
          '併發 60 的吞吐最高，所以併發 60 是這個服務最適合的運作點',
        ],
        answer: 0,
        explain: '飽和的第一個訊號是吞吐不再跟著負載上升：併發從 20 到 40 加倍，吞吐只多了約 57%；40 到 60 幾乎沒變，p95 卻從 95 升到 180 ms。錯誤是最晚出現的訊號，等看到錯誤早就過了飽和點；吞吐不需要下降才算飽和。併發 60 只比 40 多了不到 1% 的吞吐，延遲卻將近兩倍，不是比較好的運作點。',
      },
      {
        q: '壓測到 300 rps 時 p95 開始飆高。此時 API 的 CPU 約 40%、資料庫的 CPU 約 35%，但請求等資料庫連線的時間明顯變長。下一步怎麼做比較合理？',
        options: [
          '把 API 的副本數加倍，分散每個副本上的請求量',
          '把 worker 數、連線池大小和資料庫規格一起調高，再壓一次',
          '改看平均延遲：只要平均還在目標內，p95 的波動可以先不處理',
          '查連線被佔住多久（慢查詢、交易裡的外部呼叫），只改一項後用同一份腳本重壓',
        ],
        answer: 3,
        explain: '兩邊的 CPU 都不高、等連線的時間卻變長，第一個滿的資源是連線池。先弄清楚每條連線被佔多久，再只改一項並重壓，才知道改動有沒有效。加 API 副本會開出更多連線池，可能把資料庫的連線數推到上限；同時改三項，結果無法歸因；平均值會把尾端的慢請求藏起來。',
      },
    ],
  },
]
