import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { LicenseType } from '../api/types'
import { useAuth } from '../auth'

const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/app')

function Side() {
  return (
    <aside className="auth-side">
      <span className="brand" style={{ color: '#fff' }}>
        <span className="brand-mark">전</span>전진만할게요
      </span>
      <h2>
        오늘 틀린 문제와
        <br />
        오늘 놓친 신호를
        <br />
        내일의 연습으로
      </h2>
      <ul>
        <li>제출 후에만 공개되는 정답과 조문 근거</li>
        <li>센서 핸들 정렬(중앙·좌·우) 후 주행 연습</li>
        <li>내 기록만 인용하는 AI 통합 리포트</li>
      </ul>
    </aside>
  )
}

export function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to={safeNext(params.get('next'))} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      nav(safeNext(params.get('next')), { replace: true })
    } catch (err) {
      setPassword('')
      setError(err instanceof ApiError ? err.message : '로그인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <Side />
      <div className="auth-form">
        <form onSubmit={submit} className="fade-in">
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800 }}>로그인</h1>
            <p className="muted" style={{ marginTop: 6 }}>학습 기록을 이어서 확인하세요.</p>
          </div>
          {error && <div className="notice red" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pw">비밀번호</label>
            <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn lg primary block" disabled={busy}>
            {busy ? <span className="spinner" /> : '로그인'}
          </button>
          <p className="small muted center">
            처음이신가요? <Link to="/signup" style={{ color: 'var(--primary)', fontWeight: 700 }}>회원가입</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export function Signup() {
  const { user, signup } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', nickname: '', license_type: 'CLASS2_ORDINARY' as LicenseType })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />

  const pwOk = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await signup(form)
      nav('/app', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.reason])))
        setError(err.code === 'EMAIL_TAKEN' ? '이미 가입된 이메일입니다. 로그인해 주세요.' : err.message)
      } else setError('가입하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <Side />
      <div className="auth-form">
        <form onSubmit={submit} className="fade-in">
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800 }}>회원가입</h1>
            <p className="muted" style={{ marginTop: 6 }}>준비 중인 면허 종류에 맞춰 연습을 구성합니다.</p>
          </div>
          {error && <div className="notice red" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            {errors.email && <span className="err">{errors.email}</span>}
          </div>
          <div className="field">
            <label htmlFor="pw">비밀번호</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <span className={`tiny ${form.password && !pwOk ? '' : 'muted'}`} style={{ color: form.password && !pwOk ? 'var(--red)' : undefined }}>
              8자 이상, 영문과 숫자를 함께 사용
            </span>
          </div>
          <div className="field">
            <label htmlFor="nick">닉네임</label>
            <input id="nick" className="input" maxLength={20} value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} required />
            {errors.nickname && <span className="err">{errors.nickname}</span>}
          </div>
          <div className="field">
            <label>준비 중인 면허</label>
            <div className="seg" role="radiogroup">
              {(['CLASS1_ORDINARY', 'CLASS2_ORDINARY'] as LicenseType[]).map((t) => (
                <button type="button" key={t} className={form.license_type === t ? 'on' : ''} aria-pressed={form.license_type === t} onClick={() => setForm({ ...form, license_type: t })}>
                  {t === 'CLASS1_ORDINARY' ? '1종 보통' : '2종 보통'}
                </button>
              ))}
            </div>
          </div>
          <button className="btn lg primary block" disabled={busy || !pwOk}>
            {busy ? <span className="spinner" /> : '가입하고 시작하기'}
          </button>
          <p className="small muted center">
            이미 계정이 있나요? <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 700 }}>로그인</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
