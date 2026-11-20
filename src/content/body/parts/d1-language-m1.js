// 領域內文（d1-language，m1 批）：以技能 id 為 key，由 body/d1-language.js 合併。只放這些技能：debugging
export default {
  'debugging': {
    challenge: {
      task: '從自己的專案或[參考專案 clinic-api](https://github.com/yo02741/Backend-Atlas/tree/main/companion/clinic-api)挑一個錯誤（例如對 clinic-api 送 `GET /appointments?limit=1000` 或 `?cursor=abc`，看它回什麼），把它縮成不需要網路與資料庫的最小重現，寫成第三個人照做就看得到同樣結果的紀錄。',
      deliver: '一份最小重現紀錄：環境與版本、步驟、預期、實際、最小程式，加上你刪減過程的記錄。',
      check: [
        '請另一個人（或在乾淨的環境）只照紀錄做一次，附上他得到的結果',
        '最小程式再刪任何一行就不再重現，紀錄裡寫出試刪過哪幾行',
        '紀錄裡有 traceback 中第一個屬於自己程式的 frame；沒有 traceback 時說明改用什麼證據',
      ],
      twist: '重現只在 Python 3.12 出現、3.14 不會。先預測要用哪一種二分（git bisect、切資料、切版本）找原因，再寫出第一步的指令。',
    },
    points: [
      { b: '先重現，再修', t: '最小重現是一段每次執行都失敗、不能再刪的程式：固定輸入、拿掉外層與相依、一次拿掉一樣就重跑。拿掉之後不壞了，那樣東西就是發生條件之一。它之後直接變成回歸測試。' },
      { b: 'traceback 由下往上讀', t: '最後一行是例外型別與訊息；最下面的 frame 常在標準函式庫或 `site-packages` 裡，往上找第一個路徑在自己專案裡的 frame，看那一行用到的值，再往上查這個值從哪裡來。' },
      { b: '兩種串接，根源都在最上面那段', t: '`The above exception was the direct cause…` 來自 `raise … from e`，是刻意轉換；`During handling of the above exception…` 是 `except` 區塊執行途中又丟出例外，可能是處理錯誤的程式自己有 bug，這時要修的地方有兩個。' },
      { b: '定位不到就二分', t: '知道一個好的版本、一個壞的版本，就用 `git bisect start` / `bad` / `good`：每一步測中間的 commit，N 個 commit 約 log₂N 步；`git bisect run <指令>` 依結束碼自動判斷（0 是 good、125 是跳過）。程式碼、資料、設定也能用同樣的方式切半。' },
      { b: 'pdb 看現場，profiler 看時間', t: '`breakpoint()` 停下來後用 `p`、`n`、`s`、`w`、`u` 檢查實際的值與呼叫堆疊。變慢的問題先用 cProfile 量：`tottime` 是函式自己花的時間、`cumtime` 含它呼叫的函式。py-spy 對執行中的行程取樣，不用改程式。' },
    ],
    checklist: [
      '能把一個只在正式環境偶爾發生的錯誤，縮成不需要資料庫與網路的最小重現，並寫成測試',
      '能從一段串接的 traceback 指出根源例外與第一個屬於自己程式的 frame，並分辨 `direct cause` 與 `During handling` 兩種串接',
      '能用 `git bisect`（或對資料、設定切半）在約 log₂N 步內找到引入問題的改動，並用 cProfile 找出一段程式的熱點',
    ],
    refs: [
      { label: 'Python 文件：traceback', url: 'https://docs.python.org/3/library/traceback.html' },
      { label: 'Python 文件：pdb', url: 'https://docs.python.org/3/library/pdb.html' },
      { label: 'Python 文件：The Python Profilers', url: 'https://docs.python.org/3/library/profile.html' },
      { label: 'Git：git-bisect', url: 'https://git-scm.com/docs/git-bisect' },
    ],
  },
}
