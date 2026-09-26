import React, { Suspense, lazy, useMemo } from 'react'

/* 開發用 harness：網址帶 ?lab=IndexLab 就只渲染該 lab（隔離開發與截圖用）。
   main.jsx 偵測到 ?lab= 參數時走這裡，正式站不受影響。 */
const modules = { ...import.meta.glob('./labs/*Lab.jsx'), ...import.meta.glob('./labs/scenarios/*Lab.jsx') }

export default function LabHarness({ name }) {
  const Comp = useMemo(() => {
    const key = modules[`./labs/${name}.jsx`] ? `./labs/${name}.jsx` : `./labs/scenarios/${name}.jsx`
    return modules[key] ? lazy(modules[key]) : null
  }, [name])
  return (
    <div className="page">
      <div className="bg-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div style={{ padding: '40px 0' }}>
        {Comp
          ? <Suspense fallback={<p className="status-msg">載入 {name}…</p>}><Comp /></Suspense>
          : <p className="status-msg">找不到 lab：{name}。可用：{Object.keys(modules).map((k) => k.split('/').pop().replace('.jsx', '')).join('、')}</p>}
      </div>
    </div>
  )
}
