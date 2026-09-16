import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Guide } from '../api/types'
import { useAuth } from '../auth'
import { useAsync } from '../components/ui'

function HeroVisual() {
  return (
    <div className="hero-visual">
      <svg viewBox="0 0 520 360" width="100%" role="img" aria-label="센서 핸들을 기울여 조향하는 주행 연습 화면 예시">
        <defs>
          <linearGradient id="road" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1f2937" />
            <stop offset="1" stopColor="#111827" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="520" height="360" rx="16" fill="#0f172a" />
        <path d="M60 360 C 120 250, 200 190, 260 120 S 400 20, 470 0" stroke="url(#road)" strokeWidth="96" fill="none" />
        <path d="M60 360 C 120 250, 200 190, 260 120 S 400 20, 470 0" stroke="#facc15" strokeWidth="3" fill="none" />
        <path d="M60 360 C 120 250, 200 190, 260 120 S 400 20, 470 0" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="0" fill="none" transform="translate(40 8)" opacity="0.5" />
        <g transform="translate(236 150)">
          <rect x="-9" y="-14" width="18" height="30" rx="4" fill="#3b82f6" />
          <rect x="-6" y="-9" width="12" height="7" rx="2" fill="#bfdbfe" />
        </g>
        <g transform="translate(318 84)">
          <rect x="-4" y="-28" width="8" height="30" fill="#334155" />
          <rect x="-11" y="-58" width="22" height="34" rx="6" fill="#0b1220" stroke="#475569" />
          <circle cx="0" cy="-49" r="5" fill="#ef4444" />
          <circle cx="0" cy="-35" r="5" fill="#334155" />
        </g>
        <g transform="translate(24 20)">
          <rect width="118" height="62" rx="12" fill="rgba(8,12,20,.8)" stroke="rgba(255,255,255,.12)" />
          <text x="14" y="40" fill="#fff" fontSize="30" fontWeight="800">28</text>
          <text x="58" y="40" fill="#94a3b8" fontSize="12" fontWeight="700">km/h</text>
          <circle cx="98" cy="31" r="14" fill="#fff" stroke="#e11d48" strokeWidth="4" />
          <text x="98" y="36" fill="#0b1220" fontSize="12" fontWeight="900" textAnchor="middle">30</text>
        </g>
        <g transform="translate(24 290)">
          <rect width="220" height="50" rx="12" fill="rgba(8,12,20,.8)" stroke="rgba(255,255,255,.12)" />
          {['LEFT', 'CENTER', 'RIGHT'].map((t, i) => (
            <g key={t} transform={`translate(${10 + i * 68} 9)`}>
              <rect width="62" height="32" rx="8" fill={i === 0 ? '#2563eb' : 'rgba(255,255,255,.08)'} />
              <text x="31" y="21" fill={i === 0 ? '#fff' : '#64748b'} fontSize="11" fontWeight="800" textAnchor="middle">{t}</text>
            </g>
          ))}
        </g>
        <g transform="translate(400 270)">
          <rect x="-86" y="-10" width="190" height="80" rx="14" fill="rgba(8,12,20,.8)" stroke="rgba(255,255,255,.12)" />
          <text x="-72" y="14" fill="#94a3b8" fontSize="11" fontWeight="700">MPU-6050 ROLL</text>
          <path d="M-60 52 A 50 50 0 0 1 60 52" stroke="#334155" strokeWidth="8" fill="none" strokeLinecap="round" />
          <line x1="0" y1="52" x2="-34" y2="20" stroke="#5eead4" strokeWidth="4" strokeLinecap="round" />
          <text x="46" y="36" fill="#fff" fontSize="18" fontWeight="800">-16°</text>
        </g>
      </svg>
    </div>
  )
}

export default function Landing() {
  const { user } = useAuth()
  const { data: guide } = useAsync(() => api<Guide>('GET', '/guide'), [])
  const support = (lvl: string) => guide?.road_rule_support.filter((r) => r.support === lvl).reduce((a, r) => a + r.n, 0) ?? 0

  return (
    <div>
      <section className="hero">
        <div className="hero-inner">
          <div className="fade-in">
            <div className="hero-kicker">1·2종 보통 운전면허 학습 보조</div>
            <h1 style={{ marginTop: 18 }}>
              학과시험 문제도, 주행 연습도
              <br />
              <em>여기서</em> 같이 합니다
            </h1>
            <p className="lead">
              운전면허를 준비하면서 필기는 문제집으로, 주행은 학원에서 따로 하셨다면.
              틀린 문제는 조문 근거까지 확인하고, 기능·도로주행은 브라우저에서 직접 몰아 봅니다.
              두 기록을 묶어 다음에 무엇을 연습할지 짚어 드립니다.
            </p>
            <div className="cta">
              <Link className="btn lg primary" to={user ? '/app' : '/signup'}>
                {user ? '대시보드로 이동' : '무료로 시작하기'}
              </Link>
              <a className="btn lg ghost" href="#how">어떻게 동작하나요</a>
            </div>
            <div className="trust">
              <span>01 주행 입력 서버 재생 검증</span>
              <span>02 AI 수치·근거 검증</span>
              <span>03 공식 기준과 연습 판정 구분</span>
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="section" id="how">
        <div className="eyebrow">핵심 기능</div>
        <h2>세 가지 학습을 하나의 흐름으로</h2>
        <p className="sub">따로 노는 문제집·주행 연습 영상 대신, 내 기록에서 약점을 찾아 바로 다음 연습으로 연결합니다.</p>
        <div className="grid c3" style={{ marginTop: 28 }}>
          <div className="card pillar">
            <div className="feature-no">01 / WRITTEN</div>
            <h3>필기 연습 · 오답 해설</h3>
            <p>주제별 연습 문항을 풀고, 제출 후에만 정답과 조문 근거를 확인합니다. AI는 확정된 정답을 바꾸지 않고 내 선택이 왜 틀렸는지만 설명합니다.</p>
          </div>
          <div className="card pillar">
            <div className="feature-no">02 / DRIVE</div>
            <h3>센서 핸들 주행</h3>
            <p>MPU-6050을 좌우로 기울여 조향하고 방향키 위·아래로 전진과 후진을 제어합니다. 중앙 3초 고정 뒤 좌·우를 확인하며 자세를 보정합니다. 키보드 모드는 W/A/S/D를 사용합니다.</p>
          </div>
          <div className="card pillar">
            <div className="feature-no">03 / REPORT</div>
            <h3>근거 있는 AI 리포트</h3>
            <p>필기 주제별 정답률과 주행 사건을 서버가 계산하고, AI는 그 숫자만 인용해 다음 연습을 제안합니다. 측정하지 않은 거울 확인·반응시간은 말하지 않습니다.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="eyebrow">면허 취득 과정</div>
        <h2>지금 어느 단계를 준비하고 있나요?</h2>
        <p className="sub">도로교통공단 공식 안내 기준 요약입니다. 세부 조건은 원문을 확인하세요.</p>
        <div className="timeline">
          {(guide?.steps ?? Array.from({ length: 7 }, (_, i) => ({ order: i + 1, title: '', content: '' }))).map((s) => (
            <div key={s.order} className="step">
              <div className="n">STEP {s.order}</div>
              <h4>{s.title || <span className="skeleton" style={{ display: 'block', height: 18 }} />}</h4>
              <p>{s.content}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" style={{ paddingBottom: 72 }}>
        <div className="grid c2">
          <div className="card">
            <div className="eyebrow">정직한 채점 범위</div>
            <h3 style={{ fontSize: 22 }}>도로주행 평가 57개 항목, 무엇을 판정하나요?</h3>
            <p className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
              별표26 감점 46·실격 11 항목을 모두 조사해 시뮬레이션으로 확인 가능한 범위만 분류했습니다.
            </p>
            <div className="grid c3" style={{ marginTop: 18 }}>
              <div className="stat"><span className="label">A 자동 채점</span><span className="value num">{support('A')}<small>개</small></span></div>
              <div className="stat"><span className="label">B 연습 표시</span><span className="value num">{support('B')}<small>개</small></span></div>
              <div className="stat"><span className="label">C 안내만</span><span className="value num">{support('C')}<small>개</small></span></div>
            </div>
            <p className="tiny muted" style={{ marginTop: 14 }}>A는 공식 채점과 같은 방식으로 검증되기 전까지 활성화하지 않습니다.</p>
          </div>
          <div className="card">
            <div className="eyebrow">데이터 출처</div>
            <h3 style={{ fontSize: 22 }}>출처와 버전을 함께 저장합니다</h3>
            <div className="list" style={{ marginTop: 10 }}>
              {guide?.sources.map((s) => (
                <a key={s.id} className="item" href={s.url} target="_blank" rel="noreferrer">
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>{s.title}</div>
                    <div className="tiny muted">{s.publisher} · {s.version} · 조회 {s.retrieved_at}</div>
                  </div>
                  <span className="tiny" style={{ color: 'var(--primary)' }}>원문 ↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
