import type { ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { LICENSE_LABEL } from './api/types'
import { useAuth } from './auth'
import { useSerialLink } from './input/controller'
import Dashboard from './pages/Dashboard'
import DriveHome from './pages/DriveHome'
import DriveResult from './pages/DriveResult'
import DriveSession from './pages/DriveSession'
import DriveSetup from './pages/DriveSetup'
import Landing from './pages/Landing'
import { Login, Signup } from './pages/Auth'
import Report from './pages/Report'
import WrittenHome from './pages/WrittenHome'
import WrittenResult from './pages/WrittenResult'
import WrittenReview from './pages/WrittenReview'
import WrittenSolve from './pages/WrittenSolve'

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (user === undefined) return <div className="page"><div className="skeleton" style={{ height: 240 }} /></div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <>{children}</>
}

function TopBar() {
  const { user, logout } = useAuth()
  const link = useSerialLink()
  const nav = useNavigate()
  const sensorOn = link.status === 'open'
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={user ? '/app' : '/'} className="brand">
          <span className="brand-mark">🚘</span>
          전진만할게요
        </Link>
        {user && (
          <nav className="nav">
            <NavLink to="/app" end>대시보드</NavLink>
            <NavLink to="/written">필기</NavLink>
            <NavLink to="/drive">주행</NavLink>
            <NavLink to="/report">AI 리포트</NavLink>
          </nav>
        )}
        <div className="spacer" />
        {user && (
          <span className={`badge ${sensorOn ? 'teal' : ''}`} title="센서 연결 상태">
            <span className="dot" /> {sensorOn ? `센서 연결 · ${link.hz}Hz` : '센서 미연결'}
          </span>
        )}
        {user ? (
          <div className="user-chip">
            <span className="avatar">{user.nickname.slice(0, 1)}</span>
            <span>
              <b style={{ color: 'var(--ink)' }}>{user.nickname}</b> · {LICENSE_LABEL[user.license_type]}
            </span>
            <button
              className="btn sm ghost"
              onClick={async () => {
                await logout()
                nav('/')
              }}
            >
              로그아웃
            </button>
          </div>
        ) : (
          <div className="row">
            <Link className="btn sm ghost" to="/login">로그인</Link>
            <Link className="btn sm primary" to="/signup">무료로 시작</Link>
          </div>
        )}
      </div>
    </header>
  )
}

export default function App() {
  return (
    <div className="shell">
      <TopBar />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/app" element={<Protected><Dashboard /></Protected>} />
          <Route path="/written" element={<Protected><WrittenHome /></Protected>} />
          <Route path="/written/attempts/:attemptId" element={<Protected><WrittenSolve /></Protected>} />
          <Route path="/written/attempts/:attemptId/result" element={<Protected><WrittenResult /></Protected>} />
          <Route path="/written/answers/:answerId" element={<Protected><WrittenReview /></Protected>} />
          <Route path="/drive" element={<Protected><DriveHome /></Protected>} />
          <Route path="/drive/setup/:scenarioId" element={<Protected><DriveSetup /></Protected>} />
          <Route path="/drive/session/:sessionId" element={<Protected><DriveSession /></Protected>} />
          <Route path="/drive/result/:sessionId" element={<Protected><DriveResult /></Protected>} />
          <Route path="/report" element={<Protected><Report /></Protected>} />
          <Route path="*" element={<div className="page"><div className="card empty">페이지를 찾을 수 없습니다. <Link to="/" style={{ color: 'var(--primary)' }}>처음으로</Link></div></div>} />
        </Routes>
      </main>
      <footer className="footer-note">
        전진만할게요는 공식 운전면허 시험·실차교육을 대체하지 않는 학습 보조 서비스입니다. 주행 판정은 연습용이며 공식 채점이 아닙니다. 필기 문항은 자체 제작 연습 문항입니다.
      </footer>
    </div>
  )
}
