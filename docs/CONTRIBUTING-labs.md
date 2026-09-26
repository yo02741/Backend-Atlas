# 互動實驗室（Lab）撰寫合約

專案：`./`（Vite + React 18，無其他依賴）。
這是一個「後端學習地圖」網站，給有 5 年前端經驗、後端基礎拼拼湊湊的工程師學後端。
每個 lab 是一個**視覺化、可互動**的小教具，讓抽象概念「看得見」。

## 硬性規則

1. 檔案：`src/labs/<Name>Lab.jsx`，`export default function <Name>Lab()`，**無必填 props**。
2. 只能 `import React…` 與 `import { … } from './ui.jsx'`。**不得新增 npm 依賴**，不得 import 其他 lab。
3. **不得修改**共用檔：`ui.jsx`、`lab.css`、`styles.css`、`App.jsx`、`main.jsx`、`harness.jsx`、`SqlJoinLab.jsx`。缺的小元件就在自己的檔案裡寫。
4. 顏色**只能**用 CSS token：`var(--lab-accent)`、`var(--c-blue|orange|aqua|yellow|magenta|green|violet|red)`、`var(--ink-1|2|3)`、`var(--hairline)`、`var(--surface-1|2)`、`var(--page)`、`var(--good|warning|serious|critical)`。**不寫死 hex**。亮/暗主題都要好看。
5. 視覺用 **inline SVG**（帶 `viewBox`，寬度 100% 自適應）或 `.dtable` 表格；動畫用 CSS transition / keyframes；step-through 用 `usePlayer` + `<Stepper>`。
6. Lab 專屬 CSS 寫在元件最後的 `<style>{`…`}</style>`，class 一律加獨特前綴（如 `.idx-`），避免互相污染。可參考 `SqlJoinLab.jsx` 的做法。
7. 文案：**繁體中文（台灣用語）**，技術名詞保留英文。每個 lab 要有：kicker、標題、一句 blurb、舞台（視覺）、說明（`<LabExplain>`：每個狀態/步驟 2–4 句，講「發生了什麼、為什麼」）、一個 `<Callout title="工作上什麼時候用">`。內容要**正確**，不確定的不要寫。**不放任何超連結**。
8. 手機（390px 寬）不得橫向溢出：SVG 靠 viewBox 縮放；表格包在 `.dtable-wrap`；控制列會自動換行。
9. 尊重 `prefers-reduced-motion`（共用 CSS 已處理大多數；自訂 keyframes 請加 media query 關掉）。
10. 檔案長度 200–500 行。不要過度工程；但互動要真的「動」，不是靜態圖。
11. **不要**執行 `npm run build`、不要 git commit/push、不要碰 `src/labs/` 以外的檔案。

## 共用元件（`./ui.jsx`）

```jsx
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer, Code, Callout, Status, useWidth, useTicker, useReducedMotion } from './ui.jsx'

<Lab accent="violet" kicker="SQL LAB" title="…" blurb="…">           // accent: blue|orange|aqua|yellow|magenta|green|violet|red
  <LabControls> <Seg label="模式" tinted value={v} onChange={setV} options={[{value,label,title?}]}/> <Toggle label checked onChange/> <Slider label min max step value onChange format?/> <span className="spacer"/> <Stepper step total onStep playing onPlay labels?/> </LabControls>
  <LabGrid variant="" | "even" | "wide">                              // 舞台+說明兩欄，手機自動疊
    <LabStage caption="…" plain? label="aria">…svg / 表格…</LabStage>  // .lab-stage 有邊框底色；plain=無框
    <div className="lab-stack"> <Code lang="sql|python|yaml|bash|nginx|js|http|json" title="…" highlight={[3]} dim marks={[{line,text,ok?}]}>{src}</Code> <LabExplain title="…">…</LabExplain> <Callout tone=""|"warn"|"good" title="…">…</Callout> </div>
  </LabGrid>
</Lab>

const { step, setStep, playing, toggle } = usePlayer(total, intervalMs)   // 自動播放 step-through
<Stepper step={step} total={total} onStep={setStep} playing={playing} onPlay={toggle} />
<Status ok>有效</Status> <Status>無效</Status> <Status warn>過期</Status>
```

SVG 可用 class：`.svg-text`（12px ink-1）`.svg-text.small`（10.5px ink-3）`.svg-mono`、`.svg-node`（surface 底＋hairline 框；`.on` 用 accent）、`.svg-edge`（`.on` 加粗 accent）、`.svg-flow`（虛線流動動畫）、`.svg-pulse`、`.svg-pop`、`.svg-dash`。
表格 class：`.dtable`（`caption` / `th` / `td`），列 `.row-in`（進場動畫）`.off`（劃掉）`.dim`（變淡）`.hit`（高亮）`.clickable`；格 `.null`（NULL 樣式）`.src-a`/`.src-b`（左/右來源色條）。
小標籤：`.tag`、`.tag.a`（藍）`.tag.b`（橘）；`.pill`、`.muted`、`.btn.ghost.small`。

## 品質基準

`src/labs/SqlJoinLab.jsx` 是參考實作，**先讀它**。要達到同等：資訊密度高但不擁擠、互動即時、狀態切換有過渡動畫、說明文字跟著狀態變、兩個主題都乾淨。

## 驗證流程（必做）

```bash
cd <專案根目錄>
# 1. 語法/import 檢查（不寫進專案）
npx esbuild src/labs/<Name>Lab.jsx --bundle --jsx=automatic --log-level=warning --outfile=/tmp/<Name>.bundle.js
# 2. 起自己的 dev server（用指派給你的 port），背景執行
npx vite --port <PORT> --strictPort > /tmp/dev-<PORT>.log 2>&1 &
# 3. 截圖（亮 / 暗 / 手機），看圖修問題；PAGEERROR / CONSOLE 輸出必須為空
cd e2e
node shot.mjs "http://localhost:<PORT>/?lab=<Name>Lab" shots/<Name>-light.png 1100 light
node shot.mjs "http://localhost:<PORT>/?lab=<Name>Lab" shots/<Name>-dark.png 1100 dark
node shot.mjs "http://localhost:<PORT>/?lab=<Name>Lab" shots/<Name>-mobile.png 390 light
cd ..
# 4. smoke：把 lab 上每個控制項都動過一遍（Seg / Toggle / Slider / Stepper / 按鈕），無錯誤且畫面有變化才算過
E2E_BASE=http://localhost:<PORT>/ LAB=<Name>Lab node e2e/labs-smoke.mjs
```
用 Read 工具打開 png 看圖。也可以寫小段 playwright 腳本點按鈕、切步驟後再截圖，確認互動狀態正常（例如切到最後一步）。
完成後把 dev server 殺掉（`pkill -f "vite --port <PORT>"`）。

## 回報格式

- 建立的檔案清單
- 每個 lab 一行：做了什麼互動、教了什麼
- 已驗證：亮/暗/手機截圖無錯、無 console error
- 任何不確定或簡化之處
