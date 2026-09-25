# 題庫（選擇題）撰寫合約

目的：Backend Atlas 每個技能（skill）都要能「驗收」。你負責替指派的技能各寫 **3 題選擇題**（繁體中文、台灣用語）。

## 檔案與格式
每個領域一個檔：`./src/content/quizzes/<domainId>.js`（domainId 見 roadmap.js：language / web / data / auth / security / deploy / cicd / algo）。內容：

```js
// 題庫：<領域名>
export default [
  {
    skill: 'sql-joins',            // 必須是該領域 dN-*.js 裡真實存在的 skill id
    questions: [
      {
        q: '題幹（一句話問清楚，不要「以下何者正確」這種空泛問法）',
        code: 'SELECT …',           // 選填：題幹附的程式碼／設定片段（純字串，可多行）
        lang: 'sql',                // code 存在時必填：sql | python | js | yaml | bash | nginx | http | json
        options: ['選項 A', '選項 B', '選項 C', '選項 D'],   // 恰好 4 個，順序打亂、長度相近
        answer: 2,                  // 正確選項的索引（0–3）；3 題的正解索引不要全一樣
        explain: '為什麼是這個答案、其他選項錯在哪（2–4 句，這是教學的核心）',
      },
      // …共 3 題
    ],
  },
  // …該領域每個 skill 一組
]
```

## 出題原則
1. **先讀該技能的內容**（`src/content/dN-*.js` 的 summary / why / points / checklist），題目要對準 points 與 checklist 講的東西，不要考冷知識。
2. 三題的形式盡量不同：一題「概念判斷」、一題「看程式碼／設定／輸出判斷」（用 `code`）、一題「情境選擇」（工作上遇到 X 該怎麼做）。
3. 干擾選項要「像對的」——常見誤解、似是而非的說法，不要一眼就假的。
4. 內容必須**正確**。不確定就換題。不放任何超連結。
5. `explain` 要能讓答錯的人學到東西，指出錯誤選項為何錯。
6. 語氣：直接、專業、不油。中英夾雜自然即可（技術名詞保留英文）。

## 驗證（必做）
寫完後執行：
```bash
npm run validate:quizzes
```
必須印出 OK 且沒有你負責的領域的錯誤。**不要**修改 `quizzes/` 以外的檔案、不要 build、不要 git commit。

## 回報
- 建立的檔案、各領域題數
- 你覺得題目品質最沒把握的 3 題（skill id + 題幹前 20 字）與原因
