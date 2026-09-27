import React, { useEffect, useRef, useState } from 'react'
import { useCloud, signIn, signOut, deleteCloudData, syncNow, preloadCloud, dismissMessage } from '../cloud/sync.js'

/* 頂端列的帳號按鈕：沒設定 Firebase 時不出現；沒登入是「登入」，登入後是頭像＋同步狀態點，點開是帳號選單。
   「登入」先打開一個小面板、同時在背景載入 Firebase：真正開 Google 視窗的按鈕等 SDK 就緒才能按，
   按下時視窗是在同一個點擊裡立刻開出來的——手機瀏覽器（尤其 Safari）只放行點擊後馬上開的視窗，下載 SDK 的空檔會讓視窗被擋。 */
const SYNC_TEXT = { idle: '', pending: '等待上傳…', syncing: '同步中…', synced: '已同步', offline: '離線中，連上網路後自動上傳', error: '同步失敗' }

export default function Account() {
  const c = useCloud()
  const [open, setOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    setConfirmDel(false)
    if (!open) return
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => { setOpen(false) }, [c.user])   // 登入、登出後收起面板

  if (c.status === 'off') return null
  const message = c.error || c.notice
  const syncLine = SYNC_TEXT[c.sync] + (c.sync === 'synced' && c.syncedAt ? ` · ${new Date(c.syncedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}` : '')

  return (
    <div className="account" ref={box} data-status={c.status} data-sync={c.sync}>
      {c.status === 'signed-in' ? (
        <button className="account-btn avatar" aria-expanded={open} aria-controls="account-pop" onClick={() => setOpen((o) => !o)}
                aria-label={`帳號：${c.user.name || c.user.email}${SYNC_TEXT[c.sync] ? `（${SYNC_TEXT[c.sync]}）` : ''}`}>
          <Avatar user={c.user} />
          <span className={`sync-dot ${c.sync}`} aria-hidden="true" />
        </button>
      ) : c.status === 'restoring' ? (
        <span className="account-btn avatar skeleton" role="status" aria-label="還原登入狀態中" />
      ) : (
        <button className="account-btn" aria-expanded={open} aria-controls="account-pop" title="用 Google 帳號登入，進度跨裝置同步"
                onClick={() => { preloadCloud(); setOpen((o) => !o) }} onPointerEnter={preloadCloud} onFocus={preloadCloud} onTouchStart={preloadCloud}>
          {c.status === 'signing-in' ? '登入中…' : '登入'}
        </button>
      )}

      {open && !c.user && c.status !== 'restoring' && (
        <div className="account-pop" id="account-pop" role="dialog" aria-label="登入">
          <b className="account-title">用 Google 帳號登入</b>
          <p className="account-note">
            {'登入後，完成的技能、清單勾選、題目與決策題的狀態會同步到你的其他裝置。不登入也能照常使用，進度只存在這台裝置。'}
          </p>
          {c.ready || !c.error
            ? <button className="btn small login-google" onClick={signIn} disabled={!c.ready || c.status === 'signing-in'}>
                {c.status === 'signing-in' ? '登入中…' : c.ready ? '使用 Google 帳號登入' : '準備中…'}
              </button>
            : <button className="btn small login-google" onClick={preloadCloud}>重新載入</button>}
          {c.error && <p className="account-err" role="alert">{c.error}</p>}
        </div>
      )}

      {open && c.user && (
        <div className="account-pop" id="account-pop" role="dialog" aria-label="帳號與同步">
          <div className="account-who">
            <Avatar user={c.user} big />
            <div><b>{c.user.name || 'Google 帳號'}</b><span>{c.user.email}</span></div>
          </div>
          <p className="account-sync">
            <span className={`sync-dot inline ${c.sync}`} aria-hidden="true" />
            <span className="account-sync-text">{syncLine}</span>
            {c.sync !== 'syncing' && <button className="linklike" onClick={syncNow}>立即同步</button>}
          </p>
          {c.error && <p className="account-err" role="alert">{c.error}</p>}
          <p className="account-note">
            {'同步的內容：完成的技能、清單勾選、練習題 / 選擇題 / 決策題的通過狀態、決策題理由；程式草稿只留在這台裝置。'
              + '登入由 Firebase 處理，進度存在以帳號 ID 命名的文件裡，只有登入的本人讀得到。'}
          </p>
          <div className="account-actions">
            <button className="btn ghost small" onClick={() => { setOpen(false); signOut() }}>登出</button>
            <button className="linklike" onClick={() => { setOpen(false); signOut({ clearLocal: true }) }}>登出並清除這台裝置的進度</button>
            <button className="linklike danger" onClick={() => { if (confirmDel) { setOpen(false); deleteCloudData() } else setConfirmDel(true) }}>
              {confirmDel ? '再按一次，確認刪除雲端進度' : '刪除雲端進度'}
            </button>
          </div>
        </div>
      )}

      {message && !open && (
        <p className={`account-msg${c.error ? ' bad' : ''}`} role={c.error ? 'alert' : 'status'}>
          <span>{message}</span>
          <button className="account-msg-x" aria-label="關閉訊息" onClick={dismissMessage}>×</button>
        </p>
      )}
    </div>
  )
}

function Avatar({ user, big }) {
  const [broken, setBroken] = useState(false)
  const cls = `avatar-img${big ? ' big' : ''}`
  if (user.photo && !broken) return <img className={cls} src={user.photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return <span className={`${cls} initial`} aria-hidden="true">{(user.name || user.email || '?').trim().charAt(0).toUpperCase()}</span>
}
