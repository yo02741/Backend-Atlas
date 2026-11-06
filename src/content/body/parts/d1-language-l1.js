// 領域內文（d1-language，P9 新課）：以技能 id 為 key，由 body/d1-language.js 合併。只放這些技能：test-quality
export default {
  'test-quality': {
    points: [
      { b: '覆蓋率只說「跑過」', t: '一行被執行到就算覆蓋，不管有沒有任何斷言檢查它的結果。100% 覆蓋、零斷言的測試套件完全做得出來，而且全綠。' },
      { b: '假綠燈一：斷言太弱', t: '`assertIsInstance(x, int)`、`assertIn(x, (0, 80))`、`assert result`、try/except 裡沒有 `self.fail()`——程式算錯也照樣通過。期望值要是一個具體的值，例外要用 `assertRaises` / `pytest.raises`。' },
      { b: '假綠燈二：測實作不測行為', t: '檢查內部函式被呼叫幾次、私有欄位的值、mock 的呼叫參數。重構不改行為也會紅，真的改壞行為反而可能還綠。測試透過公開介面檢查輸入與輸出。' },
      { b: '假綠燈三：把現況當規範', t: '先有程式、再叫 AI「補測試」，它會執行程式、把目前的輸出抄成期望值——bug 也一起被寫成規範。期望值要從規格來，不從程式的輸出來。' },
      { b: '突變測試量的是「抓不抓得到錯」', t: '工具一次改程式的一個地方（`>=` 換 `>`、`+` 換 `-`、常數加一），產生突變體，再跑測試。測試變紅 = 突變體被殺；仍然全綠 = 存活，代表那個改動沒有任何測試在看。Python 有 mutmut，JS 有 Stryker。' },
    ],
    checklist: [
      '能指出一組測試裡斷言太弱、測實作細節、把現況當期望值的寫法並改寫',
      '能說明突變測試的流程，以及「存活的突變體」代表什麼',
      '能為一個有門檻的函式在邊界兩側寫出殺得掉 `>=` / `>` 突變的測試',
    ],
    refs: [
      { label: 'pytest 文件', url: 'https://docs.pytest.org/' },
      { label: 'Hypothesis 文件', url: 'https://hypothesis.readthedocs.io/' },
      { label: 'Stryker Mutator', url: 'https://stryker-mutator.io/' },
    ],
  },
}
