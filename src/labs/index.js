import { lazy } from 'react'

/* 實驗室登錄表：lab 元件用 import.meta.glob 懶載入（每個 lab 各自一個 chunk）。
   META 提供總覽頁與卡片用的標題/敘述；技能頁透過 skill.lab 對應到這裡的 key。 */
const modules = import.meta.glob('./*Lab.jsx')

export const LAB_META = {
  SqlJoinLab:        { title: 'JOIN 七兄弟', blurb: '切換 JOIN 類型，文氏圖與結果表同步變化；點掉一列看配對怎麼跟著改。', skill: 'sql-joins' },
  IndexLab:          { title: '索引為什麼快', blurb: '循序掃描 vs B-tree 走訪同時動畫，比較次數一目瞭然。', skill: 'indexes' },
  DocVsRelLab:       { title: '表格 vs 文件', blurb: '同一份資料在正規化表格、嵌入文件、參照文件三種長相。', skill: 'mongodb' },
  CacheLab:          { title: 'Cache-aside', blurb: 'Redis 擋在資料庫前：hit / miss / TTL 倒數 / 失效，親手打幾次請求。', skill: 'redis-cache' },
  JwtLab:            { title: 'JWT 解剖', blurb: '真的算 HMAC 簽章。改 payload 不重簽，看簽章怎麼失效。', skill: 'jwt' },
  OAuthLab:          { title: 'OAuth 授權碼流程', blurb: '四個角色、八個步驟的時序圖，每步的請求內容都看得到。', skill: 'oauth-oidc' },
  AccessControlLab:  { title: 'RBAC vs ABAC', blurb: '角色矩陣與屬性政策兩種授權模型，切屬性看規則逐條亮起。', skill: 'rbac-abac' },
  SqlInjectionLab:   { title: 'SQL Injection', blurb: '字串拼接 vs 參數化：同一個 payload，兩種結果。', skill: 'injection' },
  HashingLab:        { title: '編碼、雜湊、加密', blurb: 'Base64 / SHA-256 / PBKDF2 同時算，iterations 拉高真的變慢。', skill: 'password-storage' },
  HttpLab:           { title: 'HTTP 請求的一生', blurb: 'DNS 到回應七步驟，狀態碼情境切換，看原始請求與回應。', skill: 'http-basics' },
  DockerLab:         { title: 'Dockerfile 每行一層', blurb: '改了什麼、哪些層 cache hit、哪些重建——順序對不對一看就知道。', skill: 'docker-basics' },
  ComposeLab:        { title: 'docker-compose 拓樸', blurb: 'YAML 對應網路拓樸，服務名就是 DNS；depends_on 的坑親眼看。', skill: 'compose' },
  NginxLab:          { title: 'nginx 反向代理', blurb: '請求路徑對應 location、round-robin 到 upstream、TLS 終結在哪。', skill: 'nginx' },
  PipelineLab:       { title: 'CI/CD 管線對照', blurb: 'GitHub Actions 與 GitLab CI 同一條管線並排，逐階段跑給你看。', skill: 'ci-pipeline' },
  BigOLab:           { title: 'Big-O 成長曲線', blurb: '拉 n 看五條曲線誰先撐不住，對應到索引、掃描、N+1。', skill: 'big-o' },
  RateLimitLab:      { title: 'Token bucket 限流', blurb: '桶子、token、暴衝、429——固定視窗的邊界問題也畫出來。', skill: 'rate-limiting' },
  AsyncLab:          { title: '同步 vs 執行緒 vs async', blurb: '六個請求的甘特圖，I/O 等待時 CPU 在幹嘛一目瞭然。', skill: 'python-async' },
  RestLab:           { title: 'REST 資源設計', blurb: '選一個意圖，看正確的方法、路徑、狀態碼與冪等性。', skill: 'rest-design' },
  UvLab:             { title: 'uv 從零到能跑', blurb: '七個指令，檔案樹與 pyproject 跟著長出來。', skill: 'uv-packaging' },
}

export const LAB_NAMES = Object.keys(LAB_META)

const cache = {}
export function loadLab(name) {
  if (!modules[`./${name}.jsx`]) return null
  if (!cache[name]) cache[name] = lazy(modules[`./${name}.jsx`])
  return cache[name]
}

export function hasLab(name) {
  return Boolean(modules[`./${name}.jsx`])
}
