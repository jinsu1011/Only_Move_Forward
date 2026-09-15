import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { WrittenResult as Result } from '../api/types'
import { Bar, fmtDate, LoadError, Ring, Skeleton, useAsync } from '../components/ui'

export default function WrittenResult() {
  const { attemptId } = useParams()
  const { data, error, loading, reload } = useAsync(() => api<Result>('GET', `/written/attempts/${attemptId}/result`), [attemptId])

  if (error) return <div className="page"><LoadError error={error} onRetry={reload} />{error.code === 'ATTEMPT_NOT_SUBMITTED' && <Link className="btn primary" style={{ marginTop: 12 }} to={`/written/attempts/${attemptId}`}>이어서 풀기</Link>}</div>
  if (loading || !data) return <div className="page"><Skeleton h={420} /></div>

  const pct = Math.round((data.correct_count / data.question_count) * 100)
  const firstWrong = data.items.find((i) => !i.is_correct)
  const cats = [...data.by_category].sort((a, b) => a.correct / a.total - b.correct / b.total)

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">필기 결과 · {fmtDate(data.submitted_at)}</div>
          <h1>{pct >= 80 ? '좋아요! 이 흐름을 유지하세요' : pct >= 60 ? '조금만 더 다듬으면 됩니다' : '약한 주제부터 다시 잡아 봐요'}</h1>
          <p>{data.outcome_notice}</p>
        </div>
        <div className="row">
          {firstWrong && <Link className="btn primary" to={`/written/answers/${firstWrong.answer_id}`}>오답 해설 보기</Link>}
          <Link className="btn ghost" to="/written">새 연습</Link>
        </div>
      </div>
      <div className="grid side">
        <div className="card">
          <h3>문항별 결과</h3>
          <div className="list" style={{ marginTop: 8 }}>
            {data.items.map((it) => (
              <Link key={it.answer_id} to={`/written/answers/${it.answer_id}`} className="item">
                <span className={`badge ${it.is_correct ? 'green' : 'red'}`} style={{ width: 52, justifyContent: 'center' }}>{it.is_correct ? '정답' : '오답'}</span>
                <span className="tiny muted num" style={{ width: 24 }}>{it.position}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.prompt}</div>
                  <div className="tiny muted">{it.category.name}</div>
                </div>
                <span className="small num muted">{it.earned_points}/{it.points}점</span>
                <span style={{ color: 'var(--primary)' }}>›</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="stack lg">
          <div className="card center" style={{ display: 'grid', placeItems: 'center', gap: 12 }}>
            <Ring value={data.correct_count} max={data.question_count} color={pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)'}>
              <div>
                <div style={{ fontSize: 38, fontWeight: 850 }} className="num">{data.score}</div>
                <div className="small muted num">/ {data.max_score}점</div>
              </div>
            </Ring>
            <div className="row" style={{ gap: 18 }}>
              <div className="stat"><span className="label">정답</span><span className="value num" style={{ fontSize: 24 }}>{data.correct_count}<small>/ {data.question_count}</small></span></div>
              <div className="stat"><span className="label">정답률</span><span className="value num" style={{ fontSize: 24 }}>{pct}<small>%</small></span></div>
            </div>
            <span className="badge">연습 모드 · 합격 판정 없음</span>
          </div>
          <div className="card">
            <h3>주제별 정답</h3>
            <div className="stack" style={{ marginTop: 12 }}>
              {cats.map((c) => (
                <div key={c.category_id}>
                  <div className="row between small"><span style={{ fontWeight: 650 }}>{c.name}</span><span className="num muted">{c.correct}/{c.total}</span></div>
                  <div style={{ marginTop: 6 }}><Bar value={c.correct} max={c.total} color={c.correct / c.total >= 0.7 ? 'var(--green)' : c.correct / c.total >= 0.5 ? 'var(--amber)' : 'var(--red)'} /></div>
                </div>
              ))}
            </div>
            <Link className="btn soft block" to="/report" style={{ marginTop: 18 }}>AI 통합 리포트에 반영하기</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
