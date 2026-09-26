import React, { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import LabHarness from './harness.jsx'
import { initCloud } from './cloud/sync.js'
const VerifyHarness = lazy(() => import('./verify.jsx'))   // 開發用，不進正式站的主 chunk
import './styles.css'
import './labs/lab.css'

// ?lab=XxxLab → 隔離渲染單一實驗室（開發/截圖用）
// ?verify=1  → 用真實執行環境驗證所有練習題的解答（開發用）
// 否則進正式站
const params = new URLSearchParams(window.location.search)
const labName = params.get('lab')
const root = createRoot(document.getElementById('root'))
if (!labName && !params.get('verify')) initCloud()   // 登入同步（沒設定 Firebase 時什麼都不做）
root.render(labName ? <LabHarness name={labName} /> : params.get('verify') ? <Suspense fallback={null}><VerifyHarness /></Suspense> : <App />)
