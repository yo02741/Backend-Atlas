import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Stepper, usePlayer, Code, Callout, Status } from './ui.jsx'

/* ============================================================
   兩個交易同時搶最後一件商品（PostgreSQL 語意）
   - 隔離等級 × 做法 = 6 條時間線，每條逐步播放
   - 舞台：T1 / products(id=1) / T2 三條泳道 + 逐列時間軸（誰送了哪句、結果、是否等鎖）
   ============================================================ */

const SEL = 'SELECT stock FROM products\n WHERE id = 1;'
const UPD0 = 'UPDATE products SET stock = 0\n WHERE id = 1;'
const COND = 'UPDATE products SET stock = stock - 1\n WHERE id = 1 AND stock > 0\n RETURNING stock;'
const FOR = 'SELECT stock FROM products\n WHERE id = 1 FOR UPDATE;'
const ORDER = 'INSERT INTO orders (product_id)\n VALUES (1);\nCOMMIT;'
const ERR = 'ERROR: could not serialize access due to concurrent update\n(SQLSTATE 40001)'

const HOWS = {
  rmw: { label: '讀→算→寫', code: `BEGIN;
SELECT stock FROM products
 WHERE id = 1;            -- 讀
-- 應用程式：stock < 1 → 售完
--          否則 new = stock - 1
UPDATE products SET stock = 0
 WHERE id = 1;            -- 寫回
${ORDER}` },
  cond: { label: '一句條件 UPDATE', code: `BEGIN;
UPDATE products
   SET stock = stock - 1
 WHERE id = 1 AND stock > 0
 RETURNING stock;
-- 應用程式：0 列 → 售完
--          1 列 → 建單
${ORDER}` },
  lock: { label: 'SELECT … FOR UPDATE', code: `BEGIN;
SELECT stock FROM products
 WHERE id = 1 FOR UPDATE; -- 讀＋鎖
-- 應用程式：stock < 1 → 售完
--          否則 new = stock - 1
UPDATE products SET stock = 0
 WHERE id = 1;
${ORDER}` },
}
const ISOS = { rc: 'READ COMMITTED', rr: 'REPEATABLE READ' }

/* 每一步：who 送了 sql、得到 out；其餘欄位是這一步之後的整體狀態 */
function build(iso, how) {
  const rr = iso === 'rr'
  const steps = []
  let s = { t1: { st: 'run', sees: '—' }, t2: { st: 'run', sees: '—' }, stock: 1, pend: null, lock: null, orders: 0 }
  const add = (who, sql, out, kind, patch, title, text) => {
    s = { ...s, ...patch, t1: { ...s.t1, ...patch.t1 }, t2: { ...s.t2, ...patch.t2 } }
    steps.push({ ...s, who, sql, out, kind, title, text })
  }
  add('both', `BEGIN ISOLATION LEVEL ${ISOS[iso]};`, '兩邊各自開始交易', 'info', {},
    '起點：庫存只剩 1 件，兩個人同時按購買',
    [`後端各開一個交易 T1、T2，隔離等級 ${ISOS[iso]}${rr ? '' : '（PostgreSQL 預設）'}。正確結果只能有 1 張訂單。`,
      rr ? 'REPEATABLE READ 下，交易在第一句查詢時拍下快照，之後的普通 SELECT 都讀這份快照，看不到別人後來提交的變更。'
        : 'READ COMMITTED 下，每一句 SQL 開始時都重新看「目前已提交」的資料，所以同一個交易裡兩次讀可能讀到不同值。'])
  const wake = rr
    ? ['這一列在 T2 的快照之後被別人改過並提交了。REPEATABLE READ 不允許 T2 在「它沒看過的新版本」上繼續寫，PostgreSQL 直接報 40001（serialization_failure），整個交易只能 ROLLBACK。']
    : null
  if (how === 'rmw') {
    add('T1', SEL, 'stock = 1', 'ok', { t1: { sees: '1' } }, 'T1 讀到 1，應用程式算出新值 0',
      ['普通 SELECT 不加鎖。應用程式判斷「還有貨」，在記憶體裡算 1 − 1 = 0，準備寫回去。'])
    add('T2', SEL, 'stock = 1', 'ok', { t2: { sees: '1' } }, 'T2 也讀到 1，也算出 0',
      ['T1 還沒寫，T2 讀到的一樣是 1、一樣判斷有貨。兩邊都根據同一個即將過時的值做決定——問題在這裡埋下。'])
    add('T1', UPD0, 'UPDATE 1', 'ok', { lock: 'T1', pend: 0, t1: { sees: '0' } }, 'T1 寫回 0，拿到列鎖',
      ['UPDATE 會鎖住這一列（row lock），直到 T1 COMMIT 或 ROLLBACK 才放。新版本 stock = 0 尚未提交，只有 T1 自己看得到。'])
    add('T2', UPD0, '等待 T1 的列鎖…', 'wait', { t2: { st: 'wait' } }, 'T2 也要寫，卡在鎖上',
      ['鎖在 T1 手上，T2 只能等。注意 T2 要寫的是它自己先前算好的常數 0，而不是「現在的值減 1」。'])
    add('T1', ORDER, 'COMMIT', 'ok', { lock: null, pend: null, stock: 0, orders: 1, t1: { st: 'done' } }, 'T1 建單、提交，鎖釋放',
      ['stock = 0 正式生效，等在後面的 T2 被喚醒。接下來 T2 那句 UPDATE 怎麼處理，就是兩種隔離等級的差別。'])
    if (!rr) {
      add('T2', '（剛才的 UPDATE 拿到鎖，繼續執行）', 'UPDATE 1', 'ok', { lock: 'T2', pend: 0, t2: { st: 'run', sees: '1' } }, 'T2 的 UPDATE 照樣成功',
        ['READ COMMITTED 下，T2 拿到鎖後會對最新版本重新檢查 WHERE：條件只有 id = 1，仍然成立，於是照寫 stock = 0。資料庫不知道這個 0 是根據舊讀數算出來的。'])
      add('T2', ORDER, 'COMMIT', 'ok', { lock: null, pend: null, orders: 2, t2: { st: 'done' } }, '結果：1 件商品，2 張訂單',
        ['T2 也建單並提交。庫存顯示 0，訂單卻有 2 張：T1 的扣減被 T2 的覆寫吃掉了，這叫 lost update（遺失更新），也就是超賣。'])
    } else {
      add('T2', '（剛才的 UPDATE 被喚醒）', ERR, 'err', { t2: { st: 'err' } }, 'T2 的 UPDATE 失敗：40001', wake)
      add('T2', `ROLLBACK;\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n${SEL}`, 'stock = 0', 'ok', { t2: { st: 'run', sees: '0' } }, 'T2 重試：重新開交易、重新讀',
        ['應用程式捕捉 40001 後重跑整個交易。新交易、新快照，這次讀到的是已提交的 stock = 0。'])
      add('T2', 'ROLLBACK;  -- 售完，不下單', '回覆使用者：已售完', 'ok', { t2: { st: 'done' } }, '結果：1 張訂單，正確',
        ['庫存 0，應用程式判斷售完、不建單。代價是：用 REPEATABLE READ 就必須寫「遇到 40001 重試」的迴圈，不然使用者只會看到 500。'])
    }
  } else if (how === 'cond') {
    add('T1', COND, 'UPDATE 1 · 回傳 stock = 0', 'ok', { lock: 'T1', pend: 0, t1: { sees: '0' } }, 'T1 一句話「有貨才扣 1」',
      ['檢查（stock > 0）與扣減在同一句 SQL 裡完成，中間沒有應用程式的空檔。回傳 1 列表示扣成功；這一列被 T1 鎖住。'])
    add('T2', COND, '等待 T1 的列鎖…', 'wait', { t2: { st: 'wait' } }, 'T2 送同一句，卡在鎖上',
      ['T2 要改同一列，鎖在 T1 手上，只能等。它還沒拿到任何值，所以也還沒做任何決定。'])
    add('T1', ORDER, 'COMMIT', 'ok', { lock: null, pend: null, stock: 0, orders: 1, t1: { st: 'done' } }, 'T1 建單、提交，鎖釋放',
      ['stock = 0 生效，T2 被喚醒。'])
    if (!rr) {
      add('T2', '（剛才的 UPDATE 拿到鎖，繼續執行）', 'UPDATE 0 · 沒有回傳任何列', 'ok', { t2: { sees: '0' } }, 'T2 重新檢查 WHERE：不成立',
        ['READ COMMITTED 下，T2 拿到鎖後用最新已提交版本重新檢查整個 WHERE：stock > 0 不再成立，所以更新 0 列、RETURNING 是空的。'])
      add('T2', 'ROLLBACK;  -- 0 列 → 售完', '回覆使用者：已售完', 'ok', { t2: { st: 'done' } }, '結果：1 張訂單，正確，而且不用重試',
        ['條件寫在 WHERE 裡，資料庫在拿到鎖之後替你用最新值判斷。這是扣庫存、扣額度最省事的寫法。'])
    } else {
      add('T2', '（剛才的 UPDATE 被喚醒）', ERR, 'err', { t2: { st: 'err' } }, 'T2 的 UPDATE 失敗：40001', wake)
      add('T2', `ROLLBACK;\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n${COND}`, 'UPDATE 0 · 沒有回傳任何列', 'ok', { t2: { sees: '0' } }, 'T2 重試：同一句，更新 0 列',
        ['新快照裡 stock = 0，WHERE 不成立，更新 0 列。應用程式判斷售完、不建單。'])
      add('T2', 'ROLLBACK;  -- 0 列 → 售完', '回覆使用者：已售完', 'ok', { t2: { st: 'done' } }, '結果：1 張訂單，正確',
        ['條件 UPDATE 在 REPEATABLE READ 下一樣正確，只是多一次 40001 與重試。'])
    }
  } else {
    add('T1', FOR, 'stock = 1（並鎖住這一列）', 'ok', { lock: 'T1', t1: { sees: '1' } }, 'T1 讀的時候就上鎖',
      ['SELECT … FOR UPDATE 回傳 stock = 1，同時鎖住這一列：其他交易要 UPDATE 或 FOR UPDATE 它都得等。'])
    add('T2', FOR, '等待 T1 的列鎖…', 'wait', { t2: { st: 'wait' } }, 'T2 在「讀」這一步就被擋下',
      ['T2 用同樣的寫法讀，連舊值都拿不到，所以不可能根據舊值做決定。'])
    add('T1', UPD0, 'UPDATE 1', 'ok', { pend: 0, t1: { sees: '0' } }, 'T1 在鎖的保護下寫回 0',
      ['從讀到寫的整段期間沒有人能插隊。讀→算→寫的邏輯不變，差別只在讀的時候加了 FOR UPDATE。'])
    add('T1', ORDER, 'COMMIT', 'ok', { lock: null, pend: null, stock: 0, orders: 1, t1: { st: 'done' } }, 'T1 建單、提交，鎖釋放',
      ['stock = 0 生效，T2 被喚醒。'])
    if (!rr) {
      add('T2', '（剛才的 FOR UPDATE 拿到鎖）', 'stock = 0（最新已提交的值）', 'ok', { lock: 'T2', t2: { sees: '0' } }, 'T2 讀到最新的 0',
        ['READ COMMITTED 下，FOR UPDATE 等到鎖之後回傳的是最新已提交版本，所以 T2 看到 0。'])
      add('T2', 'ROLLBACK;  -- 售完，不下單', '回覆使用者：已售完', 'ok', { lock: null, t2: { st: 'done' } }, '結果：1 張訂單，正確',
        ['代價是排隊：持鎖期間別的交易都在等，所以 FOR UPDATE 之後的動作要短，不要在鎖裡呼叫外部 API。'])
    } else {
      add('T2', '（剛才的 FOR UPDATE 被喚醒）', ERR, 'err', { t2: { st: 'err' } }, 'T2 的 FOR UPDATE 失敗：40001', wake)
      add('T2', `ROLLBACK;\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n${FOR}`, 'stock = 0', 'ok', { t2: { st: 'run', sees: '0' } }, 'T2 重試：讀到 0',
        ['新交易、新快照，FOR UPDATE 拿到的是 stock = 0。'])
      add('T2', 'ROLLBACK;  -- 售完，不下單', '回覆使用者：已售完', 'ok', { t2: { st: 'done' } }, '結果：1 張訂單，正確',
        ['FOR UPDATE 在 REPEATABLE READ 下也正確，一樣要準備好 40001 的重試。'])
    }
  }
  return steps
}

const RESULTS = Object.fromEntries(Object.keys(HOWS).flatMap((h) => Object.keys(ISOS).map((i) => [`${h}-${i}`, build(i, h).at(-1).orders])))
const ST = { run: '執行中', wait: '等鎖中', done: '已結束', err: '錯誤' }

export default function TxnLab() {
  const [iso, setIso] = useState('rc')
  const [how, setHow] = useState('rmw')
  const steps = build(iso, how)
  const { step, setStep, playing, toggle } = usePlayer(steps.length, 1700)
  const i = Math.min(step, steps.length - 1)
  const cur = steps[i]
  const last = i === steps.length - 1
  const pick = (h, s) => { setHow(h); setIso(s); setStep(0) }

  return (
    <Lab accent="orange" className="tx" kicker="DATABASE LAB" title="兩個交易同時搶最後一件商品"
         blurb="庫存剩 1，T1、T2 同時下單。切換隔離等級與扣庫存的寫法，逐步看每句 SQL 看到什麼、誰在等鎖、最後成立幾張訂單。">
      <LabControls>
        <Seg label="隔離等級" tinted value={iso} onChange={(v) => pick(how, v)}
             options={[{ value: 'rc', label: 'READ COMMITTED' }, { value: 'rr', label: 'REPEATABLE READ' }]} />
        <Seg label="做法" value={how} onChange={(v) => pick(v, iso)}
             options={Object.entries(HOWS).map(([value, h]) => ({ value, label: h.label }))} />
      </LabControls>
      <LabControls>
        <Stepper step={i} total={steps.length} onStep={setStep} playing={playing} onPlay={toggle} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="T1、T2 與 products 這一列的即時狀態">
            <div className="tx-lanes">
              <Lane name="T1" t={cur.t1} active={cur.who === 'T1' || cur.who === 'both'} kind={cur.who !== 'T2' ? cur.kind : ''} />
              <div className={`tx-row${cur.lock ? ' locked' : ''}`}>
                <div className="tx-row-h">products · id = 1</div>
                <div className="tx-stock" key={cur.stock}>{cur.stock}</div>
                <div className="tx-row-s">已提交的 stock</div>
                <div className="tx-lock">{cur.lock ? `列鎖：${cur.lock} 持有` : '沒有鎖'}</div>
                {cur.pend !== null && <div className="tx-pend">{cur.lock} 未提交：stock = {cur.pend}</div>}
              </div>
              <Lane name="T2" t={cur.t2} active={cur.who === 'T2' || cur.who === 'both'} kind={cur.who !== 'T1' ? cur.kind : ''} />
            </div>
            <div className={`tx-orders${last ? (cur.orders > 1 ? ' bad' : ' good') : ''}`}>
              成立訂單 <b>{cur.orders}</b> 張 / 庫存原本 1 件
              {last && (cur.orders > 1 ? <Status>超賣（lost update）</Status> : <Status ok>正確</Status>)}
            </div>
          </LabStage>

          <div className="tx-log" role="list" aria-label="時間軸：每一步送出的 SQL">
            <div className="tx-log-h" aria-hidden="true"><span>T1</span><span>stock</span><span>T2</span></div>
            {steps.slice(0, i + 1).map((s, k) => (
              <div key={`${iso}-${how}-${k}`} role="listitem" className={`tx-ln${k === i ? ' now' : ''}`}>
                <Cell s={s} side="T1" />
                <div className="tx-mid"><b>{s.stock}</b>{s.lock && <small>鎖 {s.lock}</small>}</div>
                <Cell s={s} side="T2" />
              </div>
            ))}
          </div>
        </div>

        <div className="lab-stack">
          <LabExplain title={`${i + 1}. ${cur.title}`}>
            {cur.text.map((t, k) => <p key={k}>{t}</p>)}
          </LabExplain>
          <div className="dtable-wrap">
            <table className="dtable tx-matrix">
              <caption>六種組合的結果（點一格切換）</caption>
              <thead><tr><th>做法</th><th>READ<br />COMMITTED</th><th>REPEATABLE<br />READ</th></tr></thead>
              <tbody>
                {Object.entries(HOWS).map(([h, v]) => (
                  <tr key={h}>
                    <td className="tx-mh">{v.label}</td>
                    {Object.keys(ISOS).map((s) => {
                      const n = RESULTS[`${h}-${s}`]
                      return (
                        <td key={s} className={`tx-mc${h === how && s === iso ? ' on' : ''}${n > 1 ? ' bad' : ''}`}
                            onClick={() => pick(h, s)} title="切換到這個組合">
                          <b>{n} 張</b>{n > 1 ? <small>超賣</small> : s === 'rr' ? <small>40001 重試後</small> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tx-verdict">只有「讀→算→寫 ＋ READ COMMITTED」會超賣。</p>
          <Code lang="sql" title={`每個交易執行的內容：${HOWS[how].label}`}>{HOWS[how].code}</Code>
          <Callout title="實際用在哪裡">
            扣庫存、搶票、優惠券剩餘次數、帳戶餘額扣款都是同一個形狀。優先用<b>一句條件 UPDATE</b>（看回傳列數決定成不成功）；需要先讀出來做複雜判斷時用 <b>FOR UPDATE</b>，鎖內動作要短。
            用 REPEATABLE READ 或 SERIALIZABLE 時，一定要捕捉 SQLSTATE <code>40001</code> 並重跑整個交易。以上是 PostgreSQL 的行為；MySQL（InnoDB）的 REPEATABLE READ 不會報 40001，讀→算→寫在那裡照樣會超賣。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .tx-lanes { display: grid; grid-template-columns: 1fr 150px 1fr; gap: 12px; align-items: stretch; }
        .tx-lane, .tx-row { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px 12px; transition: border-color 0.3s ease, box-shadow 0.3s ease; min-width: 0; }
        .tx-lane.active { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .tx-lane.wait { border-style: dashed; border-color: var(--serious); box-shadow: none; }
        .tx-lane.err { border-color: var(--critical); box-shadow: inset 0 0 0 1px var(--critical); }
        .tx-lane-h { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-family: var(--mono); font-weight: 700; color: var(--ink-1); }
        .tx-pill { font-family: var(--sans); font-size: 0.7rem; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--ink-2); }
        .tx-pill.wait { color: var(--serious); border-color: var(--serious); animation: tx-blink 1.1s ease-in-out infinite; }
        .tx-pill.err { color: var(--critical); border-color: var(--critical); }
        .tx-pill.done { color: var(--ink-3); }
        .tx-sees { margin-top: 8px; font-size: 0.78rem; color: var(--ink-3); }
        .tx-sees b { font-family: var(--mono); font-size: 1.3rem; color: var(--ink-1); margin-left: 4px; }
        .tx-bar { margin-top: 8px; height: 4px; border-radius: 2px; background: var(--hairline); overflow: hidden; }
        .tx-lane.wait .tx-bar i { display: block; height: 100%; width: 40%; background: var(--serious); animation: tx-slide 1.2s ease-in-out infinite; }
        .tx-row { text-align: center; }
        .tx-row.locked { border-color: var(--c-slate); box-shadow: inset 0 0 0 1px var(--c-slate); }
        .tx-row-h { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
        .tx-stock { font-family: var(--mono); font-size: 2rem; font-weight: 700; color: var(--ink-1); line-height: 1.2; animation: tx-pop 0.35s ease-out both; }
        .tx-row-s { font-size: 0.7rem; color: var(--ink-3); }
        .tx-lock { margin-top: 6px; font-size: 0.72rem; font-weight: 600; color: var(--c-slate); }
        .tx-pend { margin-top: 4px; font-family: var(--mono); font-size: 0.7rem; color: var(--c-brown); border: 1px dashed var(--c-brown); border-radius: 3px; padding: 1px 4px; }
        .tx-orders { margin-top: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; font-size: 0.86rem; color: var(--ink-2); }
        .tx-orders b { font-family: var(--mono); font-size: 1.15rem; color: var(--ink-1); }
        .tx-orders.bad b { color: var(--critical); }
        .tx-orders.good b { color: var(--good); }
        .tx-log { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); overflow: hidden; }
        .tx-log-h, .tx-ln { display: grid; grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr); }
        .tx-log-h { background: var(--surface-2); font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); border-bottom: 1px solid var(--hairline); }
        .tx-log-h span { padding: 5px 10px; } .tx-log-h span:nth-child(2) { text-align: center; }
        .tx-ln { border-bottom: 1px solid var(--hairline); animation: tx-in 0.35s ease-out both; }
        .tx-ln:last-child { border-bottom: none; }
        .tx-ln.now { background: color-mix(in srgb, var(--lab-accent) 8%, transparent); }
        .tx-cell { padding: 6px 10px; min-width: 0; }
        .tx-cell pre { margin: 0; font-family: var(--mono); font-size: 0.72rem; white-space: pre-wrap; word-break: break-word; color: var(--ink-1); line-height: 1.5; }
        .tx-out { margin-top: 3px; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); white-space: pre-wrap; word-break: break-word; }
        .tx-out.wait { color: var(--serious); } .tx-out.err { color: var(--critical); font-weight: 600; } .tx-out.ok { color: var(--good); }
        .tx-tag { display: none; font-family: var(--mono); font-size: 0.66rem; font-weight: 700; color: var(--ink-3); margin-right: 6px; }
        .tx-mid { display: flex; flex-direction: column; align-items: center; justify-content: center; border-left: 1px solid var(--hairline); border-right: 1px solid var(--hairline); font-family: var(--mono); }
        .tx-mid b { color: var(--ink-1); } .tx-mid small { font-size: 0.64rem; color: var(--c-slate); }
        .tx-matrix th, .tx-matrix td { white-space: normal; padding: 5px 8px; }
        .tx-matrix td.tx-mh { font-family: var(--sans); color: var(--ink-2); }
        .tx-matrix td.tx-mc { cursor: pointer; }
        .tx-matrix td.tx-mc:hover { background: color-mix(in srgb, var(--ink-1) 5%, transparent); }
        .tx-matrix td.tx-mc b { display: block; color: var(--ink-1); }
        .tx-matrix td.tx-mc small { display: block; font-size: 0.66rem; color: var(--ink-3); }
        .tx-matrix td.tx-mc.bad b, .tx-matrix td.tx-mc.bad small { color: var(--critical); }
        .tx-matrix td.tx-mc.on { box-shadow: inset 0 0 0 2px var(--lab-accent); }
        .tx-verdict { font-size: 0.9rem; font-weight: 700; color: var(--ink-1); }
        .tx .callout code { font-family: var(--mono); font-size: 0.9em; }
        @keyframes tx-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @keyframes tx-pop { from { opacity: 0.2; transform: scale(0.8); } to { opacity: 1; transform: none; } }
        @keyframes tx-blink { 50% { opacity: 0.45; } }
        @keyframes tx-slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
        @media (max-width: 560px) {
          .tx-lanes { grid-template-columns: 1fr 1fr; }
          .tx-row { grid-column: 1 / -1; order: -1; }
          .tx-log-h { display: none; }
          .tx-ln { grid-template-columns: minmax(0, 1fr) 52px; }
          .tx-cell.empty { display: none; }
          .tx-ln > .tx-cell:last-child:not(.empty) { grid-column: 1; }
          .tx-mid { grid-column: 2; grid-row: 1 / span 2; border-right: none; }
          .tx-tag { display: inline; }
        }
        @media (prefers-reduced-motion: reduce) { .tx-ln, .tx-stock, .tx-pill.wait, .tx-lane.wait .tx-bar i { animation: none; } }
      `}</style>
    </Lab>
  )
}

function Lane({ name, t, active, kind }) {
  const cls = t.st === 'wait' ? 'wait' : t.st === 'err' ? 'err' : active ? 'active' : ''
  return (
    <div className={`tx-lane ${cls}`}>
      <div className="tx-lane-h">{name}<span className={`tx-pill ${t.st}`}>{ST[t.st]}</span></div>
      <div className="tx-sees">看到的 stock<b>{t.sees}</b></div>
      <div className="tx-bar" aria-hidden="true"><i /></div>
      {kind === 'err' && t.st === 'err' && <div className="tx-out err">40001 → 必須 ROLLBACK</div>}
    </div>
  )
}

function Cell({ s, side }) {
  const mine = s.who === side || s.who === 'both'
  if (!mine) return <div className="tx-cell empty" />
  return (
    <div className="tx-cell">
      <pre><span className="tx-tag">{side}</span>{s.sql}</pre>
      <div className={`tx-out ${s.kind}`}>→ {s.out}</div>
    </div>
  )
}
