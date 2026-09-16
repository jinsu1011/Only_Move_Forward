import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, newKey } from '../api/client'
import type { Attempt, Catalog } from '../api/types'
import { LICENSE_LABEL } from '../api/types'
import { fmtDate, LoadError, Skeleton, useAsync } from '../components/ui'

interface AttemptRow { id: string; status: string; question_count: number; correct_count: number | null; started_at: string; submitted_at: string | null }

export default function WrittenHome() {
  const nav = useNavigate()
  const catalog = useAsync(() => api<Catalog>('GET', '/written/catalog'), [])
  const history = useAsync(() => api<{ items: AttemptRow[] }>('GET', '/written/attempts?limit=8'), [])
  const [params] = useSearchParams()
  const [selected, setSelected] = useState<string[]>(() => (params.get('category') ? [params.get('category')!] : []))
  const [count, setCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [key] = useState(newKey)

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const a = await api<Attempt>('POST', '/written/attempts', { mode: 'PRACTICE', category_ids: selected, question_count: count }, { idempotencyKey: `${key}-${selected.join('.')}-${count}` })
      nav(`/written/attempts/${a.id}`)
    } catch (e) {
      setError(e as ApiError)
      setBusy(false)
    }
  }

  const c = catalog.data
  const available = c ? (selected.length ? c.categories.filter((x) => selected.includes(x.id)) : c.categories).reduce((a, x) => a + x.question_count, 0) : 0

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">필기 연습</div>
          <h1>약한 주제만 골라서 풀어 보세요</h1>
          <p>고를 때마다 바로 저장됩니다. 정답과 근거 조문은 제출한 뒤에 열립니다.</p>
        </div>
      </div>
      {catalog.error && <LoadError error={catalog.error} onRetry={catalog.reload} />}
      {!c ? (
        <Skeleton h={320} />
      ) : (
        <div className="grid side">
          <div className="card stack lg">
            <div>
              <div className="row between">
                <h3>1. 주제 선택</h3>
                <button className="btn sm ghost" onClick={() => setSelected([])}>전체 주제</button>
              </div>
              <p className="small muted" style={{ marginTop: 4 }}>선택하지 않으면 모든 주제에서 무작위로 출제합니다.</p>
              <div className="row wrap" style={{ marginTop: 14 }}>
                {c.categories.map((cat) => (
                  <button key={cat.id} className={`chip ${selected.includes(cat.id) ? 'on' : ''}`} aria-pressed={selected.includes(cat.id)} onClick={() => toggle(cat.id)}>
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3>2. 문항 수</h3>
              <div className="seg" style={{ marginTop: 12 }}>
                {[5, 10, 20, 40].map((n) => (
                  <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n}문항</button>
                ))}
              </div>
              {count > available && <p className="tiny" style={{ color: 'var(--amber)', marginTop: 8 }}>선택한 주제의 문항이 {available}개라 {available}문항으로 출제됩니다.</p>}
            </div>
            <div>
              <h3>3. 모드</h3>
              <div className="grid c2" style={{ marginTop: 12 }}>
                {c.modes.map((m) => (
                  <div key={m.mode} className="card flat tight" style={{ opacity: m.available ? 1 : 0.6, borderColor: m.available ? 'var(--primary)' : undefined }}>
                    <div className="row between">
                      <b>{m.label}</b>
                      {m.available ? <span className="badge blue">선택됨</span> : <span className="badge">비활성</span>}
                    </div>
                    <p className="tiny muted" style={{ marginTop: 6 }}>{m.available ? '합격 판정 없이 점수와 주제별 결과를 보여 줍니다.' : m.reason}</p>
                  </div>
                ))}
              </div>
            </div>
            {error && <div className="notice red">{error.message}</div>}
            <div className="row between wrap">
              <span className="small muted">{LICENSE_LABEL[c.license_type]} 기준 · 출제 가능 {available}문항</span>
              <button className="btn lg primary" disabled={busy || available === 0} onClick={start}>
                {busy ? <span className="spinner" /> : `${Math.min(count, available)}문항 시작`}
              </button>
            </div>
          </div>
          <div className="stack lg">
            <div className="notice amber">
              <div><b>데이터 안내</b><br />{c.data_notice}</div>
            </div>
            <div className="card">
              <h3>내 필기 기록</h3>
              {history.data?.items.length ? (
                <div className="list" style={{ marginTop: 8 }}>
                  {history.data.items.map((a) => (
                    <Link key={a.id} className="item" to={a.status === 'SUBMITTED' ? `/written/attempts/${a.id}/result` : `/written/attempts/${a.id}`}>
                      <div className="grow">
                        <div style={{ fontWeight: 700 }}>{a.status === 'SUBMITTED' ? `${a.correct_count}/${a.question_count} 정답` : `${a.question_count}문항 진행 중`}</div>
                        <div className="tiny muted">{fmtDate(a.submitted_at ?? a.started_at)}</div>
                      </div>
                      <span className={`badge ${a.status === 'SUBMITTED' ? 'green' : 'amber'}`}>{a.status === 'SUBMITTED' ? '제출' : '이어 풀기'}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="empty">기록이 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
