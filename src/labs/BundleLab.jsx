import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Code, Callout, Caption, Stats, Stat } from './ui.jsx'

/* ============================================================
   bundle、chunk 與 hash：門診前端的建置產物
   - 24 種設定（懶載入 × vendor 切法 × 圖表套件放哪 × lodash 引入方式）用 Vite 8.3.8 實際建置的檔名與大小
   - 再對每種設定改一行程式（或升級套件）重新建置，記下哪些檔名的 hash 變了
   - 首頁要下載的 chunk = 入口加上它靜態 import 的 chunk（index.html 的 modulepreload）
   資料：[名稱, hash, kB, gzip kB, 靜態 import, 動態 import, 內含模組]；e 是改動後換了 hash 的 chunk
   ============================================================ */

// key：懶載入(0/1) + vendor（n 不切、a 全部 node_modules、c 只切框架）+ 圖表（m main.js、r ReportsView）+ lodash（f 整包、e lodash-es）
const DATA = {
  '0nmf': { c: [['index','D1D7-8Db',568.3,188.5,'','','chart.js quill lodash vue vue-router lodash-es pinia rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js']], e: { r:'index:Bna-47gz',t:'index:CcyxG6q9',d:'index:CQtTo8W4',p:'index:BXg88xE1' } },
  '0nme': { c: [['index','Dy6FEMej',498.2,163.8,'','','chart.js quill vue vue-router lodash-es pinia rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js']], e: { r:'index:C2Yz2gm6',t:'index:BaZVoqQL',d:'index:iSoHxl9I',p:'index:-E5oJIWk' } },
  '0nrf': { c: [['index','ix1SbzRB',568.2,188.7,'','','chart.js quill lodash vue vue-router lodash-es pinia rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js']], e: { r:'index:kRbbJzv_',t:'index:DCuym9R-',d:'index:-AFLl003',p:'index:mup24n2t' } },
  '0nre': { c: [['index','Bucdi8VJ',498.1,163.7,'','','chart.js quill vue vue-router lodash-es pinia rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js']], e: { r:'index:Dwj1_Ld5',t:'index:okQ2Hudz',d:'index:Bhm3Ydzc',p:'index:Bk0LO0X8' } },
  '0amf': { c: [['index','ULiGkMdw',2.6,1.3,'rolldown-runtime vendor','','App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['rolldown-runtime','XKyaHtl9',0.7,0.4,'','','rolldown-runtime'],['vendor','DWZDQTzx',565.3,187.1,'rolldown-runtime','','chart.js quill lodash vue vue-router lodash-es pinia']], e: { r:'index:BqNt5FdH',t:'index:ZxI8KNg-',d:'index:liBDHRwB',p:'index:DLimH9sC vendor:BtuJcPL0' } },
  '0ame': { c: [['index','BsiOxZm3',2.5,1.3,'vendor','','App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['vendor','BCZyzhoV',495.9,162.6,'','','chart.js quill vue vue-router lodash-es pinia rolldown-runtime']], e: { r:'index:DuWWOXKv',t:'index:BwjJqgbq',d:'index:BEHcADno',p:'index:CjqxfHly vendor:Dw0EiuOO' } },
  '0arf': { c: [['index','CmjBSuNo',2.6,1.3,'rolldown-runtime vendor','','App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['rolldown-runtime','XKyaHtl9',0.7,0.4,'','','rolldown-runtime'],['vendor','DGZbIanm',565.3,187.2,'rolldown-runtime','','chart.js quill lodash vue vue-router lodash-es pinia']], e: { r:'index:FPHWLM_r',t:'index:CrXCLyWS',d:'index:CRc4q2n9',p:'index:ZUprmzeh vendor:CNBdDu4d' } },
  '0are': { c: [['index','BmH-TCxz',2.5,1.2,'vendor','','App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['vendor','DI0Q5kAk',495.9,162.4,'','','chart.js quill vue vue-router lodash-es pinia rolldown-runtime']], e: { r:'index:CrKgSKFa',t:'index:B-YuNXU3',d:'index:B3m3vR_V',p:'index:jUr1_7pr vendor:CsLf0zsz' } },
  '0cmf': { c: [['index','C45mgl0J',478.6,154.3,'vendor','','chart.js quill lodash lodash-es rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:C79N9mTz',t:'index:B1-FYumt',d:'index:CGSp2_wD',p:'index:DeneroRS vendor:CT0nxPaw' } },
  '0cme': { c: [['index','7A5A-69D',408.5,129.6,'vendor','','chart.js quill lodash-es rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:BOtPdv2g',t:'index:ZuO_5j4Y',d:'index:DSGOnnVv',p:'index:vekmEGA2 vendor:CT0nxPaw' } },
  '0crf': { c: [['index','CfsiK2nX',478.5,154.3,'vendor','','chart.js quill lodash lodash-es rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:BQKhGDp9',t:'index:BICGIVCG',d:'index:DxsBoU-r',p:'index:62ULuwcD vendor:CT0nxPaw' } },
  '0cre': { c: [['index','Dzt2QpUi',408.5,129.3,'vendor','','chart.js quill lodash-es rolldown-runtime App.vue TodayView.vue ReportsView.vue AdminView.vue BookingView.vue router.js utils/date.js main.js'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:DgnqEo2R',t:'index:D_MP7jzj',d:'index:CuN1l5de',p:'index:B-QRUL-E vendor:CT0nxPaw' } },
  '1nmf': { c: [['index','msL5nVxC',369.5,130.8,'','BookingView ReportsView AdminView','chart.js lodash vue vue-router pinia rolldown-runtime App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','Cc4D9si_',199.9,58.2,'index','','quill lodash-es AdminView.vue'],['BookingView','Cka9q6rI',0.2,0.2,'index','','BookingView.vue'],['ReportsView','BMV7ZcpC',0.4,0.3,'index','','ReportsView.vue']], e: { r:'index:BNbylwWX AdminView:Dcglv8b7 BookingView:BNzgP_5S ReportsView:C9FXlTBG',t:'index:DifvlYw_ AdminView:DIUP_Y50 BookingView:Cktu62Cp ReportsView:Bsxj1via',d:'index:DhMQankb AdminView:DESrmIQQ BookingView:Yezv2sFw ReportsView:CSnt78cC',p:'index:B3mDfoDB AdminView:DQxPL25J BookingView:Dp1bFX1m ReportsView:D_o8JVi_' } },
  '1nme': { c: [['index','DR1I-4Hh',299.5,105.7,'','BookingView ReportsView AdminView','chart.js vue vue-router lodash-es pinia App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','KS263iwC',199.9,58.3,'index','','quill lodash-es rolldown-runtime AdminView.vue'],['BookingView','sV78Z1FM',0.2,0.2,'index','','BookingView.vue'],['ReportsView','CzH9GFdC',0.4,0.3,'index','','ReportsView.vue']], e: { r:'index:D7XwRAMh AdminView:D83SLLWu BookingView:CYoRSwOP ReportsView:BI3Ur7IL',t:'index:DIfeXLpP AdminView:MK6hDQz6 BookingView:CJOPO0Kl ReportsView:BpKyS6C3',d:'index:BA7BCPuK AdminView:DiqvDWMc BookingView:BC1NCJhv ReportsView:DxBQ0xwV',p:'index:B0_EoUpY AdminView:CoquEgdO BookingView:DbpM7exs ReportsView:S419kFNe' } },
  '1nrf': { c: [['index','69HqEOVb',165.3,61.9,'','BookingView ReportsView AdminView','lodash vue vue-router pinia rolldown-runtime App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','CXrQ2ho7',199.9,58.2,'index','','quill lodash-es AdminView.vue'],['BookingView','wjV7Hq_d',0.2,0.2,'index','','BookingView.vue'],['ReportsView','CGDD81pO',204,69.4,'index','','chart.js ReportsView.vue']], e: { r:'index:B59A-4Xf AdminView:CcCpq9qZ BookingView:DSD89_g- ReportsView:F8wFO35Y',t:'index:42Rhyt8e AdminView:8kw_p_pw BookingView:Bh4Wxn4G ReportsView:D0uLSte0',d:'index:BlIbMxW_ AdminView:Clp7f2GE BookingView:D7oCvt9Z ReportsView:C5hfzERQ',p:'index:BGPo6uMQ AdminView:CueMiF4M BookingView:xbQ_He6y ReportsView:D2n2ACgC' } },
  '1nre': { c: [['index','BRQdCCnW',95.4,36.8,'','BookingView ReportsView AdminView','vue vue-router lodash-es pinia App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','D9vD0Wgf',199.9,58.3,'index','','quill lodash-es rolldown-runtime AdminView.vue'],['BookingView','54ssAZAg',0.2,0.2,'index','','BookingView.vue'],['ReportsView','Bs1RUUBg',204,69.4,'index','','chart.js ReportsView.vue']], e: { r:'index:CLZQESpG AdminView:DsFP0WyM BookingView:CAj5L0t4 ReportsView:BG2BaLMi',t:'index:C2j7Vgzc AdminView:B3_kMZMa BookingView:DeF5-LbS ReportsView:DELYBEzd',d:'index:kk37vGYe AdminView:csAGhJrO BookingView:aTsM1Zu_ ReportsView:B0I8-c7i',p:'index:D_75dcWa AdminView:CEAZVKxa BookingView:DvAknIiN ReportsView:DyuZiquP' } },
  '1amf': { c: [['index','CLhgNPj8',3.8,1.9,'rolldown-runtime vendor','BookingView ReportsView AdminView','App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','DTiHynUn',0.3,0.3,'vendor','','AdminView.vue'],['BookingView','Cx_gxE1d',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','T17eD4rk',0.4,0.3,'vendor','','ReportsView.vue'],['rolldown-runtime','XKyaHtl9',0.7,0.4,'','','rolldown-runtime'],['vendor','DGZbIanm',565.3,187.2,'rolldown-runtime','','chart.js quill lodash vue vue-router lodash-es pinia']], e: { r:'index:BuIXPewp BookingView:DtrlACck ReportsView:BZjTp82z',t:'index:CVxW04XF BookingView:DH0o7Set',d:'index:DoahVio1 BookingView:CpC8anCq',p:'index:D_zV_EoJ AdminView:DcDi9ywa BookingView:BSj4bmuP ReportsView:Ck6bfjV5 vendor:CNBdDu4d' } },
  '1ame': { c: [['index','v09LYduw',3.7,1.8,'vendor','BookingView ReportsView AdminView','App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','B5fuMLeT',0.3,0.3,'vendor','','AdminView.vue'],['BookingView','DC3TjwzC',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','DRQoEBw4',0.4,0.3,'vendor','','ReportsView.vue'],['vendor','DI0Q5kAk',495.9,162.4,'','','chart.js quill vue vue-router lodash-es pinia rolldown-runtime']], e: { r:'index:DNSvcyxH BookingView:CZjU-vk7 ReportsView:CvlhFBcE',t:'index:BWykNkII BookingView:DSPJ7712',d:'index:JQBmJZDo BookingView:CSxvDatz',p:'index:gtGKHW2L AdminView:kSMSL8F3 BookingView:BQPPxPsN ReportsView:BBpEM3Mr vendor:CsLf0zsz' } },
  '1arf': { c: [['index','BRv5aPjh',3.8,1.9,'rolldown-runtime vendor','BookingView ReportsView AdminView','App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','9LrI05nv',0.3,0.3,'vendor','','AdminView.vue'],['BookingView','BNHdunWs',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','B_KbQHqy',0.4,0.3,'vendor','','ReportsView.vue'],['rolldown-runtime','XKyaHtl9',0.7,0.4,'','','rolldown-runtime'],['vendor','DWZDQTzx',565.3,187.1,'rolldown-runtime','','chart.js quill lodash vue vue-router lodash-es pinia']], e: { r:'index:CQIIMC-R BookingView:BvUOJ40n ReportsView:BXwgMeaV',t:'index:mAm0C-yi BookingView:DSb-OZQY',d:'index:X17ocXfq BookingView:CXZEllbW',p:'index:Pl2QFJS3 AdminView:B1l185oE BookingView:CIB8T-df ReportsView:BP4gp4Db vendor:BtuJcPL0' } },
  '1are': { c: [['index','CUX0muH7',3.7,1.8,'vendor','BookingView ReportsView AdminView','App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','DLL1e6e9',0.3,0.3,'vendor','','AdminView.vue'],['BookingView','EJSjQ-bq',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','CZceBkKV',0.4,0.3,'vendor','','ReportsView.vue'],['vendor','BCZyzhoV',495.9,162.6,'','','chart.js quill vue vue-router lodash-es pinia rolldown-runtime']], e: { r:'index:HpUH6Ehs BookingView:BNvMGHkE ReportsView:DvVPIFPa',t:'index:DHpJGon1 BookingView:DwhKS4YD',d:'index:BanVPaB1 BookingView:Cr-cx0u6',p:'index:DJ-k_Nvk AdminView:yD1Z4n5H BookingView:B4DmiIbE ReportsView:BE2bwts5 vendor:Dw0EiuOO' } },
  '1cmf': { c: [['index','B50WmK4R',279,96.4,'rolldown-runtime vendor','BookingView ReportsView AdminView','chart.js lodash App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','DewZtAYY',199.9,58.2,'rolldown-runtime vendor','','quill lodash-es AdminView.vue'],['BookingView','DvIqVDC8',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','AL8enfQB',0.4,0.3,'vendor','','ReportsView.vue'],['rolldown-runtime','XKyaHtl9',0.7,0.4,'','','rolldown-runtime'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:B1_3BkWV BookingView:CmN021e2 ReportsView:DytLka3L',t:'index:Cz3gMsUn BookingView:D-X_A2XD',d:'index:BzS1XbAA BookingView:CwWfi_Y3',p:'index:BQlkuCXq AdminView:DgwBjLma BookingView:BeEfnlUN ReportsView:5_z2dkgF vendor:CT0nxPaw' } },
  '1cme': { c: [['index','BE2XMLP8',209.8,71.8,'vendor','BookingView ReportsView AdminView','chart.js lodash-es App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','DBe-WCWu',199.9,58.3,'vendor index','','quill lodash-es rolldown-runtime AdminView.vue'],['BookingView','Bw9HHZem',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','AL8enfQB',0.4,0.3,'vendor','','ReportsView.vue'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:B_d_g2pA AdminView:Bp-HNsS4 BookingView:CpyRgnOb ReportsView:DytLka3L',t:'index:BhaNMy2h AdminView:CEEnOtgw BookingView:BeabKddP',d:'index:B2f21Ol9 AdminView:QDZPzmGE BookingView:BftkR87Z',p:'index:CLEbCvEs AdminView:57o3yZkU BookingView:hOfUnrk8 ReportsView:5_z2dkgF vendor:CT0nxPaw' } },
  '1crf': { c: [['index','BB4eMs4l',74.9,27.7,'rolldown-runtime vendor','BookingView ReportsView AdminView','lodash App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','DewZtAYY',199.9,58.2,'rolldown-runtime vendor','','quill lodash-es AdminView.vue'],['BookingView','DPgzmvh8',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','jcdj3qFS',204,69.4,'vendor','','chart.js ReportsView.vue'],['rolldown-runtime','XKyaHtl9',0.7,0.4,'','','rolldown-runtime'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:MKUh8P3C BookingView:BanFe0Is ReportsView:YsHvoFSR',t:'index:CGFQI0ku BookingView:DAYESSUy',d:'index:B_uaH3ro BookingView:CIhkDHGn',p:'index:ELp6kpmG AdminView:DgwBjLma BookingView:f7SJxBER ReportsView:Bl1FZ4eS vendor:CT0nxPaw' } },
  '1cre': { c: [['index','D--8_Bxc',6,2.8,'vendor','BookingView ReportsView AdminView','lodash-es App.vue TodayView.vue router.js utils/date.js main.js'],['AdminView','CHNgg2R6',199.9,58.3,'vendor index','','quill lodash-es rolldown-runtime AdminView.vue'],['BookingView','ClWK3WDu',0.3,0.2,'vendor index','','BookingView.vue'],['ReportsView','jcdj3qFS',204,69.4,'vendor','','chart.js ReportsView.vue'],['vendor','Bhvzpxa7',89.5,34.4,'','','vue vue-router pinia']], e: { r:'index:CTKubnx3 AdminView:CjLf1rhZ BookingView:B8ohup0v ReportsView:YsHvoFSR',t:'index:CjaEh_Fl AdminView:CFdmqLWr BookingView:BWsJCUNL',d:'index:CkGF_hXQ AdminView:G5hwvqT4 BookingView:Dt_LL0wN',p:'index:YO6lK2fz AdminView:BrsJzZF1 BookingView:CiUgEGwG ReportsView:Bl1FZ4eS vendor:CT0nxPaw' } },
}

const EDITS = [
  { value: 'none', label: '不改' },
  { value: 'r', label: 'ReportsView.vue' },
  { value: 't', label: 'TodayView.vue' },
  { value: 'd', label: 'utils/date.js' },
  { value: 'p', label: '升級 pinia' },
]
const EDIT_TEXT = { r: '改了 ReportsView.vue 的一行', t: '改了 TodayView.vue（首頁）的一行', d: '改了共用的 utils/date.js', p: '升級 pinia（模擬套件內容改變）' }
const PAGES = [['今日門診（首頁）', 'TodayView.vue'], ['掛號', 'BookingView.vue'], ['報表', 'ReportsView.vue'], ['公告管理', 'AdminView.vue']]
const ROLE = { index: '入口', vendor: 'vendor', 'rolldown-runtime': 'CommonJS 執行時', BookingView: '掛號頁', ReportsView: '報表頁', AdminView: '公告管理頁' }
const LIB = new Set(['vue', 'vue-router', 'pinia', 'chart.js', 'quill', 'lodash', 'lodash-es'])

function load(key) {
  const d = DATA[key]
  const chunks = d.c.map(([n, h, kb, gz, imp, dyn, mods]) => ({ n, h, kb, gz, imp: imp ? imp.split(' ') : [], dyn: dyn ? dyn.split(' ') : [], mods: mods.split(' ') }))
  const edits = {}
  for (const [k, v] of Object.entries(d.e)) edits[k] = Object.fromEntries(v ? v.split(' ').map((p) => p.split(':')) : [])
  return { chunks, edits }
}
const keyOf = (c) => `${c.lazy ? 1 : 0}${c.vendor[0]}${c.chart[0]}${c.lodash[0]}`
const byName = (chunks) => Object.fromEntries(chunks.map((x) => [x.n, x]))
function closure(chunks, start) {
  const m = byName(chunks), seen = new Set(), stack = [start]
  while (stack.length) { const n = stack.pop(); if (!n || seen.has(n)) continue; seen.add(n); stack.push(...m[n].imp) }
  return seen
}
const sum = (chunks, names, f = 'gz') => chunks.filter((x) => names.has(x.n)).reduce((a, x) => a + x[f], 0)
const k1 = (v) => (Math.round(v * 10) / 10).toFixed(1)

function codeOf(c) {
  const views = ['Booking', 'Reports', 'Admin']
  return [
    '// router.js',
    "import TodayView from './views/TodayView.vue'",
    ...(c.lazy ? [] : views.map((v) => `import ${v}View from './views/${v}View.vue'`)),
    ...views.map((v) => `{ path: '/${v.toLowerCase()}', component: ${c.lazy ? `() => import('./views/${v}View.vue')` : `${v}View`} },`),
    '',
    c.chart === 'main' ? "// main.js\nimport Chart from 'chart.js/auto'   // 全域註冊" : "// ReportsView.vue\nimport Chart from 'chart.js/auto'",
    c.lodash === 'full' ? "// TodayView.vue\nimport _ from 'lodash'          // 只用 _.debounce" : "// TodayView.vue\nimport { debounce } from 'lodash-es'",
    '',
    '// vite.config.js（Vite 8）',
    c.vendor === 'none' ? 'build: {}   // 不另外切 chunk'
      : `build: { rolldownOptions: { output: { codeSplitting: { groups: [\n  { name: 'vendor', test: ${c.vendor === 'all' ? '/node_modules/' : '/node_modules[\\\\/](vue|@vue|vue-router|pinia)[\\\\/]/'} },\n] } } } }`,
  ].join('\n')
}

function explain(focus, c, v, extra) {
  const { homeGz, homeKb, changed, refetch, lodashDiff } = v
  if (focus === 'lazy') return c.lazy
    ? { title: '路由懶載入：每頁一個 chunk', text: [`掛號、報表、管理各用 \`() => import()\` 切出一個 chunk，進到那一頁才下載。首頁要下載 ${k1(homeGz)} kB（gzip）。`, '首頁 TodayView 仍是靜態 import，跟著入口 chunk。'] }
    : { title: '沒有懶載入：所有頁面都在入口', text: [`router.js 靜態 import 每一頁，連同報表用的 chart.js 與公告管理用的 quill 都進了首頁要下載的程式（${k1(homeKb)} kB，gzip ${k1(homeGz)} kB）。`] }
  if (focus === 'vendor') return c.vendor === 'all'
    ? { title: 'vendor 收了所有 node_modules', text: ['`test: /node_modules/` 把 chart.js、quill 也收進 vendor。入口靜態 import vendor，`index.html` 會預先載入它，懶載入頁面用的套件又回到首頁。', `首頁 ${k1(homeGz)} kB（gzip）。vendor 只放每一頁都要用的框架，或依套件分成幾組。`] }
    : c.vendor === 'core'
      ? { title: 'vendor 只放框架', text: ['vue、vue-router、pinia 每一頁都要用，切成 vendor 後，改自己的程式時它的檔名不變，回訪的人直接用快取。', 'chart.js 與 quill 留在用到它們的頁面。'] }
      : { title: '不切 vendor', text: ['套件和自己的程式在同一個 chunk。改任何一行程式，裡面的 vue 與其他套件也跟著換檔名，回訪的人整塊重新下載。'] }
  if (focus === 'chart') return c.chart === 'main'
    ? { title: 'main.js 靜態 import 了圖表套件', text: ['chart.js 跟著入口進了首頁，就算報表頁懶載入也帶不走它。只在報表頁用的套件，只在報表頁 import。'] }
    : { title: '圖表套件只在報表頁 import', text: [c.lazy && c.vendor !== 'all' ? 'chart.js 跟著 ReportsView 的 chunk，進報表頁才下載。' : 'chart.js 只在 ReportsView.vue 裡 import，但這個設定下它仍然在首頁要下載的 chunk 裡：要搭配懶載入，vendor 也不能把它收進去。'] }
  if (focus === 'lodash') return c.lodash === 'full'
    ? { title: 'lodash 整包進來', text: [`lodash 是 CommonJS，打包器拿不掉沒用到的函式，為了一個 debounce 多了 ${k1(lodashDiff)} kB（minify 後）。`, '產物裡還多一段 Rolldown 的 CommonJS 執行時程式（有些設定下會切成 `rolldown-runtime` 這個小 chunk）。'] }
    : { title: 'lodash-es：tree-shaking 拿掉沒用的部分', text: ['ES modules 的具名 import 讓打包器只留下 debounce 用到的程式。', 'quill 本身也依賴 lodash-es 與兩個 CommonJS 小套件，所以管理頁的 chunk 裡還看得到它們。'] }
  if (c.edit === 'none') return { title: '選一種改動，重新建置', text: ['檔名的 hash 由內容算出，內容不變檔名就不變，所以這些檔案可以快取一年。選一種改動，看哪些檔名會變。'] }
  return {
    title: `${EDIT_TEXT[c.edit]}：${changed.length} 個檔名變了`,
    text: [
      `換了檔名的：${changed.map((x) => `\`${x}\``).join('、') || '沒有'}。回訪首頁的使用者要重新下載 ${k1(refetch)} kB（gzip）。`,
      extra.vendorSame ? 'vendor 沒變，回訪的人直接用快取。' : c.edit === 'p' ? '套件內容變了，裝著它的 chunk 換檔名，所有 import 那個 chunk 的檔案也跟著換。' : '',
      extra.cascade ? '入口 chunk 裡寫著每個懶載入 chunk 的檔名，任何一個改名，入口就改名；從入口 import 共用程式的 chunk 再跟著改名。' : '',
    ],
  }
}

export default function BundleLab() {
  const [c, setC] = useState({ lazy: false, vendor: 'none', chart: 'main', lodash: 'full', edit: 'none' })
  const [focus, setFocus] = useState('lazy')
  const set = (k) => (val) => { setC((o) => ({ ...o, [k]: val })); setFocus(k) }
  const { chunks, edits } = load(keyOf(c))
  const nh = c.edit === 'none' ? {} : edits[c.edit]
  const home = closure(chunks, 'index')
  const homeGz = sum(chunks, home), homeKb = sum(chunks, home, 'kb')
  const changed = Object.keys(nh)
  const refetch = sum(chunks, new Set(changed.filter((n) => home.has(n))))
  const other = load(keyOf({ ...c, lodash: c.lodash === 'full' ? 'es' : 'full' })).chunks
  const totalKb = (cs) => cs.reduce((a, x) => a + x.kb, 0)
  const lodashDiff = c.lodash === 'full' ? totalKb(chunks) - totalKb(other) : totalKb(other) - totalKb(chunks)
  const owner = (mod) => chunks.find((x) => x.mods.includes(mod))?.n
  const pages = PAGES.map(([label, mod]) => {
    const own = owner(mod)
    const need = new Set([...home, ...closure(chunks, own)])
    const extra = [...need].filter((n) => !home.has(n))
    return { label, need, extra, extraGz: sum(chunks, new Set(extra)), gz: sum(chunks, need) }
  })
  const big = chunks.filter((x) => x.kb > 500)
  const maxKb = Math.max(...chunks.map((x) => x.kb), 100)
  const ex = explain(focus, c, { homeGz, homeKb, changed: changed.map((n) => `${n}-${nh[n]}.js`), refetch, lodashDiff },
    { vendorSame: chunks.some((x) => x.n === 'vendor') && !nh.vendor && c.edit !== 'none', cascade: changed.includes('index') && changed.length > 1 && c.edit !== 'p' })

  return (
    <Lab accent="magenta" kicker="FRONTEND LAB" title="bundle、chunk 與 hash"
         blurb="門診前端的建置產物：懶載入、vendor 切法、套件在哪裡 import、tree-shaking，決定首頁要下載哪些 chunk；改一行程式之後，哪些檔名的 hash 會變。">
      <LabControls>
        <Toggle label="掛號、報表、管理頁懶載入" checked={c.lazy} onChange={set('lazy')} />
        <Seg label="vendor" tinted value={c.vendor} onChange={set('vendor')} options={[{ value: 'none', label: '不切' }, { value: 'all', label: '全部 node_modules' }, { value: 'core', label: 'vue、router、pinia' }]} />
        <Seg label="chart.js 在" value={c.chart} onChange={set('chart')} options={[{ value: 'main', label: 'main.js' }, { value: 'reports', label: 'ReportsView' }]} />
        <Seg label="debounce 從" value={c.lodash} onChange={set('lodash')} options={[{ value: 'full', label: 'lodash（整包）' }, { value: 'es', label: 'lodash-es（具名）' }]} />
        <Seg label="改一行再建置" value={c.edit} onChange={set('edit')} options={EDITS} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="dist/assets 的 chunk 與每一頁要下載的檔案">
            <div className="bl-list">
              {chunks.map((x) => {
                const renamed = nh[x.n]
                return (
                  <div key={x.n} className={`bl-chunk${home.has(x.n) ? ' home' : ''}`}>
                    <div className="bl-name">
                      <code>{x.n}-<span className={renamed ? 'bl-new' : ''}>{renamed || x.h}</span>.js</code>
                      <span className="bl-tags">
                        <span className="tag">{ROLE[x.n] || x.n}</span>
                        {home.has(x.n) && <span className="tag a">首頁下載</span>}
                        {renamed && <span className="tag b">改名</span>}
                        {x.kb > 500 && <span className="tag bl-warn">超過 500 kB</span>}
                      </span>
                    </div>
                    <div className="bl-bar"><i style={{ width: `${Math.max(1, (x.kb / maxKb) * 100)}%` }} /><span>{k1(x.kb)} kB · gzip {k1(x.gz)} kB</span></div>
                    <div className="bl-mods">{x.mods.filter((m) => m !== 'rolldown-runtime' || x.n === 'rolldown-runtime').map((m) => <span key={m} className={LIB.has(m) ? 'lib' : ''}>{m}</span>)}</div>
                  </div>
                )
              })}
            </div>
            {big.length > 0 && (
              <div className="bl-warnbox" role="note">
                <b>vite build 的警告</b>
                <code>(!) Some chunks are larger than 500 kB after minification.</code>
                <span>{big.map((x) => `${x.n}-${nh[x.n] || x.h}.js`).join('、')} 超過 500 kB（minify 後、gzip 前）。</span>
              </div>
            )}
            <Stats min={130}>
              <Stat label="首頁要下載（gzip）" value={k1(homeGz)} unit="kB" tone={homeGz > 150 ? 'bad' : 'ok'} note="上限示意 150 kB" />
              <Stat label="chunk 數" value={chunks.length} />
              <Stat label="改完回訪要重新下載" value={c.edit === 'none' ? '—' : k1(refetch)} unit={c.edit === 'none' ? '' : 'kB'} tone={c.edit !== 'none' && refetch > 50 ? 'warn' : ''} />
            </Stats>
            <div className="dtable-wrap bl-pages">
              <table className="dtable">
                <caption>每一頁要下載的 JS</caption>
                <thead><tr><th>頁面</th><th>首頁之外再下載</th><th>合計 gzip</th></tr></thead>
                <tbody>
                  {pages.map((p) => <tr key={p.label}><td>{p.label}</td><td>{p.extra.length ? `${p.extra.join('、')}（${k1(p.extraGz)} kB）` : '—'}</td><td>{k1(p.gz)} kB</td></tr>)}
                </tbody>
              </table>
            </div>
          </LabStage>
          <Caption>檔名與大小取自 Vite 8.3.8 實際建置的示意專案（vue 3.5.45、vue-router 5.5.1、pinia 4.1.0、chart.js 4.6.1、quill 2.0.3、lodash 4.18.1）；gzip 用 Node 的 zlib 計算，和 vite build 印出的數字差 1% 左右。「升級 pinia」是直接改套件內容模擬。</Caption>
        </div>
        <div className="lab-stack">
          <Code lang="js" title="設定與 import（節錄）">{codeOf(c)}</Code>
          <LabExplain title={ex.title}>
            {ex.text.filter(Boolean).map((t) => <p key={t} dangerouslySetInnerHTML={{ __html: t.replace(/`([^`]+)`/g, '<code>$1</code>') }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">首頁變慢、建置出現 500 kB 警告，或每次部署使用者都要重新下載一大塊時：先看 Network 分頁首頁載入了哪些 chunk，再對照 import 的位置與 vendor 的切法。</Callout>
        </div>
      </LabGrid>

      <style>{`
        .bl-list { display: grid; gap: 8px; }
        .bl-chunk { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; transition: border-color 0.25s ease; }
        .bl-chunk.home { border-color: var(--c-blue); }
        .bl-name { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; align-items: center; }
        .bl-name code { font-family: var(--mono); font-size: 0.8rem; color: var(--ink-1); overflow-wrap: anywhere; }
        .bl-new { color: var(--lab-accent); font-weight: 700; animation: bl-flash 0.6s ease-out; }
        .bl-tags { display: flex; flex-wrap: wrap; gap: 4px; }
        .bl-warn { border-color: var(--critical); color: var(--critical); }
        .bl-bar { position: relative; margin-top: 6px; height: 16px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
        .bl-bar i { display: block; height: 100%; background: color-mix(in srgb, var(--lab-accent) 55%, var(--surface-2)); transition: width 0.4s ease; }
        .bl-bar span { position: absolute; left: 6px; top: 0; line-height: 16px; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-1); }
        .bl-mods { display: flex; flex-wrap: wrap; gap: 3px 6px; margin-top: 6px; font-family: var(--mono); font-size: 0.68rem; color: var(--ink-3); }
        .bl-mods .lib { color: var(--ink-1); font-weight: 700; }
        .bl-pages { margin-top: 12px; }
        .bl-warnbox { margin-top: 10px; display: grid; gap: 3px; border-left: 3px solid var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); padding: 8px 12px; border-radius: 0 var(--radius) var(--radius) 0; font-size: 0.8rem; color: var(--ink-2); }
        .bl-warnbox b { color: var(--ink-1); font-size: 0.78rem; }
        .bl-warnbox code { font-family: var(--mono); font-size: 0.74rem; color: var(--critical); overflow-wrap: anywhere; }
        .bl-pages td:nth-child(2) { white-space: normal !important; }
        @keyframes bl-flash { from { background: color-mix(in srgb, var(--lab-accent) 30%, transparent); } to { background: transparent; } }
        @media (prefers-reduced-motion: reduce) { .bl-new { animation: none; } .bl-bar i { transition: none; } }
      `}</style>
    </Lab>
  )
}
