// 首頁學習路線圖：在每一種欄數（手機 2 欄、3 欄、4 欄、桌機 6 欄）下檢查
//   - 站數等於 roadmap.js 的 PATH，站序與 PATH 一致
//   - 站名與領域名彼此不重疊、不超出路線圖左右邊界、頁面不需要左右滑
//   - 每段文字都在遮罩挖掉的範圍裡（轉彎的線不會穿過文字）
// 前置：npm run build && npm run preview。改了 PATH 或 MetroMap 之後必跑。
// SHOTS=1 會把每種寬度的路線圖存成 e2e/shots/metro-<寬度>.png（已 gitignore），用來目視確認。
import { chromium } from 'playwright'
import { PATH } from '../src/content/roadmap.js'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const WIDTHS = [390, 600, 900, 1280]
const browser = await chromium.launch()
let failed = 0
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : extra}`) }

for (const width of WIDTHS) {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme })
    const errs = []
    page.on('pageerror', (e) => errs.push(e.message))
    await page.goto(base + '#/', { waitUntil: 'networkidle' })
    await page.waitForSelector('.metro svg')
    const r = await page.evaluate(() => {
      const svg = document.querySelector('.metro svg')
      const stations = [...svg.querySelectorAll('.metro-station')]
      const ids = stations.map((a) => a.getAttribute('href').replace('#/skill/', ''))
      // 文字框（SVG 使用者座標）：站名與領域名，不含圓圈裡的站號
      const texts = stations.flatMap((a) => [...a.querySelectorAll('text:not([font-size])')].map((el) => {
        const b = el.getBBox()
        return { t: el.textContent, x: b.x, y: b.y, w: b.width, h: b.height }
      }))
      const gaps = [...svg.querySelectorAll('mask .metro-gap')].map((g) => ({
        x: +g.getAttribute('x'), y: +g.getAttribute('y'), w: +g.getAttribute('width'), h: +g.getAttribute('height'),
      }))
      const vb = svg.viewBox.baseVal
      const overlaps = []
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 1 && oy > 1) overlaps.push(`${a.t} ✕ ${b.t}`)
      }
      const outside = texts.filter((a) => a.x < -0.5 || a.x + a.w > vb.width + 0.5).map((a) => a.t)
      const uncovered = texts.filter((a) => !gaps.some((g) => a.x >= g.x - 1 && a.y >= g.y - 1 && a.x + a.w <= g.x + g.w + 1 && a.y + a.h <= g.y + g.h + 1)).map((a) => a.t)
      const masked = [...svg.querySelectorAll('path')].filter((p) => p.closest('g[mask]')).length
      return { ids, overlaps, outside, uncovered, masked, paths: svg.querySelectorAll('g[mask] path').length, scrollW: document.documentElement.scrollWidth }
    })
    const tag = `${width}px ${scheme}`
    t(`${tag}：站數 ${r.ids.length} = PATH ${PATH.length}`, r.ids.length === PATH.length)
    t(`${tag}：站序與 PATH 一致`, r.ids.join() === PATH.map((p) => p.skill).join(), r.ids.join())
    t(`${tag}：文字不重疊`, r.overlaps.length === 0, r.overlaps.slice(0, 5).join(' | '))
    t(`${tag}：文字不超出路線圖`, r.outside.length === 0, r.outside.join(' | '))
    t(`${tag}：文字都在遮罩範圍內（線不穿過字）`, r.uncovered.length === 0, r.uncovered.join(' | '))
    t(`${tag}：線段都套了遮罩`, r.masked > 0 && r.masked === r.paths)
    t(`${tag}：頁面不需要左右滑`, r.scrollW <= width, `scrollWidth ${r.scrollW}`)
    t(`${tag}：沒有 page error`, errs.length === 0, errs.join(' | '))
    if (process.env.SHOTS && scheme === 'light') {
      await page.addStyleTag({ content: '.topnav { position: static !important; }' })
      await (await page.$('.metro')).screenshot({ path: `e2e/shots/metro-${width}.png` })
    }
    await page.close()
  }
}

await browser.close()
console.log(failed ? `${failed} FAILED` : 'metro: all passed')
process.exit(failed ? 1 : 0)
