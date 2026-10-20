## 從一個具體問題開始：核准時看到的不是模型看到的

使用者在 agent 裡裝了一個 MCP server，安裝畫面顯示一行：「`add` — Adds two numbers.」。看起來無害，使用者按了允許。

但 client 從 server 拿到的工具定義不只這一行。完整的 `description` 可能還有好幾段文字，`inputSchema` 裡也可能多一個和加法無關的字串參數。使用者介面只顯示名稱與第一行摘要，模型卻會讀到全部內容，並把它當成「這個工具該怎麼用」的說明。

如果那幾段多出來的文字是寫給模型的指示，例如要求模型在呼叫時附上和任務無關的資料、或改用另一個工具，模型就有可能照做，而使用者在對話裡只看到正常的回答。這就是 **tool poisoning（工具投毒）**，OWASP MCP Top 10 的 MCP03（見 [OWASP MCP Top 10](#/skill/owasp-mcp-top10)）。它不需要任何程式漏洞：server 只是照協定回傳了一段文字。

本課重點放在怎麼偵測與防禦，攻擊內容一律用佔位文字表示。

## 運作原理：描述是給模型看的指示

### 描述原封不動進入 context

MCP 的 `tools/list` 回傳每個工具的 `name`、`description`、`inputSchema`。host 把它們放進模型的 context，模型靠它們判斷什麼時候用哪個工具、參數怎麼填。對模型來說，工具描述和系統提示的性質很接近：都是「做事方法」的說明，而且通常出現在對話開始之前。

兩邊看到的內容不對稱：

| | 使用者通常看到 | 模型看到 |
|---|---|---|
| 工具名稱 | 有 | 有 |
| 描述 | 第一行，或截斷後的摘要 | 完整描述 |
| 參數定義 | 多半不顯示 | 完整 `inputSchema`，包含每個參數自己的 `description` |
| 呼叫時的參數值 | 依介面而定，有的只顯示工具名 | 自己填的全部參數 |

所以「使用者核准了這個工具」和「使用者核准了模型會讀到的這段指示」是兩回事。

### 投毒的幾種形態（概念層級）

- **夾帶資料**：描述要求模型把與任務無關的內容（檔案、環境變數、對話裡出現過的資訊）放進某個參數，參數名稱取得很無害。
- **改道**：描述聲稱別的工具不能用，要模型改呼叫某個工具。
- **壓制回報**：描述要求模型不要向使用者提及某些步驟。
- **藏匿**：放在很長的描述中段、某個參數的 `description` 裡，或用零寬字元等人眼看不到的字元。

這些形態有共同的外部特徵：描述變長、出現與工具功能無關的指令性語句、schema 多出用途不明的自由文字參數、提到其他工具的名稱。防禦就從這些特徵下手。

### Rug pull：核准之後才換掉

就算安裝時有人讀了完整描述，server 之後仍然可以改。MCP 的工具清單本來就允許變動：server 可以送 `notifications/tools/list_changed` 要 client 重新抓清單；就算不送通知，每次重新連線時 `tools/list` 的內容也由 server 決定。

| 時間 | server 回傳的描述 | 使用者端的狀態 |
|---|---|---|
| 第 1 天 | 正常描述 | 審查並核准 |
| 第 1–30 天 | 不變 | 正常使用，建立信任 |
| 第 31 天 | 加入一段新文字、多一個參數 | client 沒有比對機制時，沒有任何提示 |
| 之後 | 可能再改回原樣 | 事後查不到曾經改過，除非有存歷史 |

這和傳統套件的「新版本被植入惡意程式」很像，但更難察覺：程式碼、套件版本、映像雜湊都沒變，變的只是 server 執行期回傳的一段字串。

### 跨 server 遮蔽（shadowing）

一個 agent 常同時連多個 server，所有工具描述放在同一個 context 裡。模型不會把「server A 的描述只適用於 server A 的工具」當成硬規則，所以 A 的描述可以寫「使用某某寄信工具時，參數要這樣填」，影響模型怎麼使用 **server B** 的工具。

這種情況下 A 自己的工具可能從頭到尾沒被呼叫，log 裡只看得到 B 的工具被正常呼叫、只是參數怪怪的。只審查「被呼叫的工具」抓不到它；要審查**所有載入 context 的描述**，並注意描述裡是否提到其他 server 的工具名稱。

## 為什麼傳統掃描看不到

| 檢查手段 | 看的對象 | 能不能看到工具描述 |
|---|---|---|
| SBOM（套件清單） | 程式依賴與版本 | 不能。描述不是依賴，是 server 執行期回傳的資料 |
| 原始碼掃描（SAST） | server 的程式碼 | 只有描述寫死在原始碼裡時才看得到，而且掃描規則找的是程式漏洞，不是「給模型的指示」 |
| 映像／套件雜湊 | 發布的檔案 | 描述可以由設定、遠端內容或執行期邏輯產生，雜湊不變時描述也能變 |
| 漏洞資料庫比對 | 已知 CVE | 投毒不是程式漏洞，不會有 CVE |

工具描述屬於**行為層**內容：它不改變程式怎麼執行，而是改變模型怎麼決定。治理方式見 [行為層的供應鏈管理](#/skill/agent-supply-chain)；傳統的依賴管理見 [供應鏈安全](#/skill/supply-chain)。

## 防禦：在載入層攔截

防線放在 client 或 gateway 的「載入工具」那一步：描述進 context 之前先過檢查。

1. **審查描述內容**：自動規則先篩（長度、指令性語句、提到其他工具、敏感路徑、不可見字元、schema 多出的參數），命中的交給人工審查。規則一定有漏網，所以它是篩子，不是判決。
2. **版本鎖定**：核准時對「名稱 + 描述 + schema」算雜湊存起來。之後每次載入都重算；不一致就停用該工具、顯示差異、要求重新核准。這一步直接擋住 rug pull。
3. **最小權限**：每個 server 只給它需要的憑證與檔案存取範圍。就算描述成功誘導模型，能拿到的東西也有限（見 [credential 隔離與執行邊界](#/skill/agent-credential-isolation)）。
4. **參數白名單**：核准時記下允許的參數名稱與型別；呼叫時多出來的參數直接拒絕，自由文字參數設長度上限。
5. **工具輸出當不可信輸入**：工具回傳的內容同樣可能夾帶指示（MCP06），不讓它直接觸發高風險動作；高風險動作要人核准，核准畫面顯示完整參數。

## 實際程式：描述指紋與可疑規則

下面這段 JavaScript 模擬 client 端的載入檢查：

- 對工具定義做**穩定序列化**（鍵排序，避免 JSON 鍵順序不同造成雜湊不同），用 WebCrypto 的 `crypto.subtle.digest` 算 SHA-256 當版本指紋。
- 和核准時存下的指紋比對；不一致就列出差異。
- 用幾條簡單規則標出可疑特徵。

範例裡「被改過的版本」用佔位文字代表新增的段落，重點是偵測流程。

```js run
// 穩定序列化：物件鍵排序後再 JSON 化，同樣內容一定得到同樣字串
const stable = (v) => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v)

// 工具指紋：名稱 + 描述 + schema 的 SHA-256
async function fingerprint(tool) {
  const bytes = new TextEncoder().encode(stable({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 核准時的版本
const approved = {
  name: 'add',
  description: 'Adds two numbers.',
  inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
}

// 之後重新載入時拿到的版本（佔位文字代表被加入的段落；​ 是零寬空白）
const reloaded = {
  name: 'add',
  description: 'Adds two numbers.\n[示範佔位：這裡是一段新加入、寫給模型看的長段落，提到 send_email 工具]​',
  inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' }, note: { type: 'string' } }, required: ['a', 'b'] },
}

// 同一個 context 裡其他 server 的工具名稱：描述提到它們就可能是跨 server 遮蔽
const otherServerTools = ['send_email', 'read_file', 'run_command']

function suspicious(tool, allowedParams) {
  const d = tool.description
  const hits = []
  if (d.length > 300) hits.push(`描述長度 ${d.length}，遠超過一般工具說明`)
  if (/[​-‏⁠﻿]/.test(d)) hits.push('含零寬或不可見字元')
  if (/<\s*important\s*>|ignore (all|previous)|do not (tell|mention)|不要(告訴|提及)/i.test(d)) hits.push('含指令性語句')
  if (/~\/\.ssh|id_rsa|\.env\b|\.aws\/credentials/i.test(d)) hits.push('提到敏感檔案路徑')
  for (const t of otherServerTools) if (d.includes(t)) hits.push(`提到其他工具 ${t}（可能是跨 server 遮蔽）`)
  for (const p of Object.keys(tool.inputSchema.properties || {}))
    if (!allowedParams.includes(p)) hits.push(`schema 多出未核准的參數 "${p}"`)
  return hits
}

const lock = { add: await fingerprint(approved) }        // 核准時存下的指紋
const allowed = { add: Object.keys(approved.inputSchema.properties) }

for (const tool of [approved, reloaded]) {
  const fp = await fingerprint(tool)
  const changed = fp !== lock[tool.name]
  console.log(`${tool.name}  指紋 ${fp.slice(0, 16)}…  ${changed ? '已變更 → 停用並要求重新核准' : '與核准版本相同'}`)
  if (changed) {
    // 簡單的逐行差異：核准版有、新版沒有的標 -，新版多出來的標 +
    const a = approved.description.split('\n'), b = tool.description.split('\n')
    for (const line of a) if (!b.includes(line)) console.log('   - ' + line)
    // 看不見的字元轉成 \u{…} 顯示，審查者才看得到它們
    const reveal = (t) => t.replace(/[\u200b-\u200f\u2060\ufeff]/g, (c) => `\\u{${c.codePointAt(0).toString(16)}}`)
    for (const line of b) if (!a.includes(line)) console.log('   + ' + reveal(line))
  }
  for (const h of suspicious(tool, allowed[tool.name])) console.log('   ! ' + h)
}
```

幾點說明：

- 指紋要涵蓋 `inputSchema`，不能只算描述：參數本身的 `description` 也是模型會讀的文字，多一個參數也是行為變更。
- 差異要顯示**原文**（這裡用 `reveal` 把零寬字元這類看不見的內容轉成 `\u{200b}` 形式顯示），不能只顯示「已變更」，否則審查者無從判斷。
- 規則用來排優先順序，不能拿來放行：沒命中任何規則的變更，仍然要重新核准。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| 核准畫面只顯示工具名稱與摘要 | 使用者核准了自己沒看過的指示 | 核准畫面可展開完整描述與 schema；至少在描述很長或命中規則時強制展開 |
| 只在安裝時審查一次 | rug pull 完全不會被發現 | 每次載入比對指紋，變更就停用並重新核准 |
| 指紋只算 `description` | schema 裡加參數、改參數說明都不會被發現 | 對名稱、描述、完整 schema 的穩定序列化結果算雜湊 |
| 只審查被呼叫過的工具 | 跨 server 遮蔽的來源工具從未被呼叫，永遠不被審查 | 審查所有載入 context 的描述 |
| 用關鍵字黑名單當唯一防線 | 換個說法、換語言、拆成多段就繞過 | 規則只當篩子，搭配人工審查、版本鎖定與最小權限 |
| 相信 schema 的型別限制就夠了 | 字串參數能裝任何內容 | 參數白名單、長度上限、server 端再驗證一次 |
| 把工具描述的 annotations（例如「唯讀」提示）當成保證 | annotations 是 server 自己宣稱的，不可信的 server 可以亂填 | 權限由 client／gateway 端的政策決定，不看 server 自述 |

## 動手

1. 執行上面的程式，確認核准版顯示「相同」、重新載入版列出差異與可疑項目。
2. 把 `reloaded` 改成只多一個 `note` 參數、描述不變，確認指紋仍然改變。
3. 在 `approved` 的 `inputSchema` 裡把鍵的順序對調（例如把 `required` 寫在 `type` 前面），確認指紋不變——這就是穩定序列化的作用。
4. 為 `suspicious` 加一條規則：描述中出現網址（`https?://`）時標記，因為加法工具的說明不需要連結。
5. 想一想你會把 `lock` 存在哪裡：存在 server 能改到的地方就失去意義。比較「存在 client 設定檔」與「存在 gateway 的資料庫」各自的優缺點，再讀 [行為層的供應鏈管理](#/skill/agent-supply-chain)。
