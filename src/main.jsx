import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import LabHarness from './harness.jsx'
import VerifyHarness from './verify.jsx'
import './styles.css'
import './labs/lab.css'

// ?lab=XxxLab → 隔離渲染單一實驗室（開發/截圖用）
// ?verify=1  → 用真實執行環境驗證所有練習題的解答（開發用）
// 否則進正式站
const params = new URLSearchParams(window.location.search)
const labName = params.get('lab')
const root = createRoot(document.getElementById('root'))
root.render(labName ? <LabHarness name={labName} /> : params.get('verify') ? <VerifyHarness /> : <App />)
