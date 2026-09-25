import React from 'react'
import { DOMAINS, PATH, WORK_KEYWORDS, allSkills, findSkill, skillsByKeyword } from '../content/roadmap.js'
import { LAB_META } from '../labs/index.js'
import { useProgress } from '../progress.js'
import { ProgressRing, LabIcon } from '../components/bits.jsx'
import MetroMap from '../components/MetroMap.jsx'
import HeroArt from '../components/HeroArt.jsx'
import { EXERCISES } from '../content/exercises/index.js'

const FEATURED_LABS = ['SqlJoinLab', 'JwtLab', 'IndexLab', 'OAuthLab', 'DockerLab', 'NginxLab']

export default function Home() {
  const { done, isDone } = useProgress()
  const skills = allSkills()
  const labCount = skills.filter((s) => s.lab).length
  const stations = PATH.map((p) => findSkill(p.skill)).filter(Boolean)
  const nextStation = stations.find((s) => !isDone(s.id)) || stations[0]

  return (
    <div className="fade-swap">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">BACKEND ATLAS · 給前端工程師的後端地圖</p>
          <h1 className="display">看得見的<br />後端基礎</h1>
          <p className="lede">
            JOIN 用文氏圖動、索引用 B-tree 走、JWT 真的算簽章、Docker 的層一層層疊起來。
            八個領域、{skills.length} 個技能、{labCount} 個互動實驗室，加上在瀏覽器裡真的執行的 SQL / Python 練習題與 Playground——從你工作上天天聽到的詞開始，把後端的地基打實。
          </p>
          <div className="hero-actions">
            <a className="btn" href={`#/skill/${nextStation.id}`}>
              {done.length ? '繼續路線' : '從第一站開始'} →
            </a>
            <a className="btn ghost" href="#/roadmap">看完整技能盤點</a>
            <a className="btn ghost" href="#/playground">打開 Playground</a>
          </div>
          <div className="hero-stats">
            <div className="stat"><b>{DOMAINS.length}</b><span>領域</span></div>
            <div className="stat"><b>{skills.length}</b><span>技能</span></div>
            <div className="stat"><b>{labCount}</b><span>互動實驗室</span></div>
            <div className="stat"><b>{EXERCISES.length}</b><span>程式題</span></div>
            <div className="stat"><b>{done.length}</b><span>已完成</span></div>
          </div>
        </div>
        <div className="hero-art"><HeroArt /></div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">建議學習路線</h2>
          <p>12 站、每站約一週。先看得見的、再打地基、最後上線。點站名進入該課。想要完整的 16 週計畫與里程碑專案，看 <a href="#/curriculum">課綱</a>。</p>
        </div>
        <MetroMap stations={stations} isDone={isDone} />
        <div className="metro-legend">
          {DOMAINS.map((d) => (
            <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--c-${d.color})`, display: 'inline-block' }} />{d.title}
            </span>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">八大領域</h2>
          <p>後端工程師的技能樹，每個領域以一項技術當範例；概念換到別的技術也通。</p>
        </div>
        <div className="domain-grid">
          {DOMAINS.map((d) => {
            const doneN = d.skills.filter((s) => isDone(s.id)).length
            const kws = [...new Set(d.skills.flatMap((s) => s.keywords))].slice(0, 4)
            return (
              <a key={d.id} href={`#/domain/${d.id}`} className="dcard" style={{ '--tint': `var(--c-${d.color})` }}>
                <div className="dcard-head">
                  <span className="dcard-no">0{d.no}</span>
                  <ProgressRing value={doneN} total={d.skills.length} color={`var(--c-${d.color})`} />
                </div>
                <h3>{d.title}</h3>
                <p>{d.tagline}</p>
                <div className="dcard-meta">
                  <span>{d.skills.length} 技能 · {d.skills.filter((s) => s.lab).length} 實驗室</span>
                </div>
                {kws.length > 0 && <div className="dcard-tags">{kws.map((k) => <span key={k}>{k}</span>)}</div>}
              </a>
            )
          })}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">你工作上聽到的詞</h2>
          <p>每個關鍵字對應到會用到它的課，從熟悉的詞切進去最快。</p>
        </div>
        <div className="kw-cloud">
          {WORK_KEYWORDS.map((k) => (
            <a key={k} href={`#/roadmap?kw=${encodeURIComponent(k)}`}>{k}<small>{skillsByKeyword(k).length} 課</small></a>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">互動實驗室精選</h2>
          <a href="#/labs" className="muted" style={{ fontSize: '0.88rem' }}>全部 {labCount} 個 →</a>
        </div>
        <div className="lab-strip">
          {FEATURED_LABS.map((name) => {
            const meta = LAB_META[name]
            const skill = findSkill(meta.skill)
            const color = `var(--c-${skill.domain.color})`
            return (
              <a key={name} href={`#/lab/${name}`} className="lcard">
                <div className="lcard-icon"><LabIcon name={name} color={color} /></div>
                <h4>{meta.title}</h4>
                <p>{meta.blurb}</p>
                <span className="pill tint" style={{ '--tint': color }}>{skill.domain.title}</span>
              </a>
            )
          })}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head"><h2 className="section-title">這個地圖怎麼用</h2></div>
        <div className="principles">
          <div className="principle"><div className="num">01</div><h4>先動手，再讀字</h4><p>每課有實驗室的先玩實驗室：切開關、拉滑桿、看畫面怎麼變。概念在畫面裡形成，文字只是把它說清楚。</p></div>
          <div className="principle"><div className="num">02</div><h4>一項技術當範例，概念是通用的</h4><p>PostgreSQL 教的索引在 MySQL 一樣；FastAPI 的依賴注入在 NestJS 也有。學的是模型，不是某個工具的按鈕。</p></div>
          <div className="principle"><div className="num">03</div><h4>用檢核表確認自己真的會了</h4><p>每課末尾的自我檢核是「能不能講給同事聽」的標準。三題都能答再標完成——進度只存在你的瀏覽器。</p></div>
        </div>
      </section>
    </div>
  )
}
