import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Dashboard as DashboardData } from '../api/types'
import { LICENSE_LABEL } from '../api/types'
import { useSerialLink } from '../input/controller'
import { Bar, fmtDate, LoadError, Ring, Skeleton, STATUS_BADGE, useAsync } from '../components/ui'

export default function Dashboard() {
  const { data, error, loading, reload } = useAsync(() => api<DashboardData>('GET', '/dashboard'), [])
  const link = useSerialLink()

  if (error) return <div className="page"><LoadError error={error} onRetry={reload} /></div>
  if (loading || !data) {
    return (
      <div className="page stack lg">
        <Skeleton h={60} />
        <div className="grid c4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={130} />)}</div>
        <Skeleton h={300} />
      </div>
    )
  }
  const w = data.written
  const d = data.driving
  const acc = w.answer_total ? Math.round((w.correct_total / w.answer_total) * 100) : 0
  const firstTime = w.submitted_count === 0 && d.session_count === 0

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">{LICENSE_LABEL[data.user.license_type]} 준비</div>
          <h1>{data.user.nickname}님, 오늘은 무엇을 연습할까요?</h1>
          <p>필기와 주행 기록이 쌓일수록 AI 리포트가 더 정확한 다음 연습을 제안합니다.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/written">필기 연습</Link>
          <Link className="btn primary" to="/drive">주행 연습</Link>
        </div>
      </div>

      {firstTime && (
        <div className="notice blue" style={{ marginBottom: 20 }}>
          <div className="grow">
            <b>처음 오셨네요.</b> 필기 10문항을 먼저 풀고, 기본조작 연습장에서 센서(또는 키보드) 주행을 해 보세요. 두 기록이 모이면 통합 리포트를 만들 수 있습니다.
          </div>
          <Link className="btn sm primary" to="/written">필기 10문항 시작</Link>
        </div>
      )}
      {w.in_progress && (
        <div className="notice amber" style={{ marginBottom: 20 }}>
          <div className="grow">
            <b>진행 중인 필기 연습이 있습니다.</b> {w.in_progress.question_count}문항 · 시작 {fmtDate(w.in_progress.started_at)}. 선택한 답은 서버에 저장되어 있습니다.
          </div>
          <Link className="btn sm dark" to={`/written/attempts/${w.in_progress.id}`}>이어서 풀기</Link>
        </div>
      )}

      <div className="metrics-grid">
        <div className="card">
          <div className="row between">
            <div className="stat">
              <span className="label">필기 누적 정답률</span>
              <span className="value num">{acc}<small>%</small></span>
              <span className="tiny muted">{w.correct_total}/{w.answer_total}문항</span>
            </div>
            <Ring value={w.correct_total} max={w.answer_total || 1} size={76} stroke={9} />
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="label">필기 제출</span>
            <span className="value num">{w.submitted_count}<small>회</small></span>
            <span className="tiny muted">연습 모드 · 합격 판정 없음</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="label">주행 완주</span>
            <span className="value num">{d.completed_count}<small>/ {d.session_count}회</small></span>
            <span className="tiny muted">실격 해당 {d.disqualified_count}회 (연습 판정)</span>
          </div>
        </div>
        <Link to="/drive" className="card link">
          <div className="stat">
            <span className="label">센서 핸들</span>
            <span className="value" style={{ fontSize: 22, color: link.status === 'open' ? 'var(--teal)' : 'var(--ink-3)' }}>
              {link.status === 'open' ? `연결됨 · ${link.hz}Hz` : link.status === 'unsupported' ? '미지원 브라우저' : '미연결'}
            </span>
            <span className="tiny muted">{link.status === 'open' ? '주행 전 정렬을 진행하세요' : '주행 화면에서 연결 → 정렬'}</span>
          </div>
        </Link>
      </div>

      <div className="grid side" style={{ marginTop: 20 }}>
        <div className="stack lg">
          <div className="card">
            <div className="card-head">
              <h3>최근 필기 연습</h3>
              <Link className="btn sm ghost" to="/written">새 연습</Link>
            </div>
            {w.recent.length === 0 ? (
              <div className="empty">아직 제출한 필기 연습이 없습니다.</div>
            ) : (
              <div className="list">
                {w.recent.map((r) => (
                  <Link key={r.id} to={`/written/attempts/${r.id}/result`} className="item">
                    <div style={{ width: 90 }} className="tiny muted">{fmtDate(r.submitted_at)}</div>
                    <div className="grow"><Bar value={r.correct_count} max={r.question_count} /></div>
                    <div className="num" style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>
                      {r.correct_count}/{r.question_count}문항
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <h3>최근 주행</h3>
              <Link className="btn sm ghost" to="/drive">코스 선택</Link>
            </div>
            {d.recent.length === 0 ? (
              <div className="empty">아직 주행 기록이 없습니다.</div>
            ) : (
              <div className="list">
                {d.recent.map((r) => (
                  <Link key={r.id} to={`/drive/result/${r.id}`} className="item">
                    <div style={{ width: 90 }} className="tiny muted">{fmtDate(r.ended_at)}</div>
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{r.title}</div>
                      <div className="tiny muted">{r.input_mode === 'SENSOR' ? '센서 핸들' : '키보드'} · 사건 {r.event_count}건</div>
                    </div>
                    <span className={`badge ${STATUS_BADGE[r.status]?.cls}`}>{STATUS_BADGE[r.status]?.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="card ai-card">
          <div className="ai-title">✦ AI 통합 리포트</div>
          <h3 style={{ fontSize: 21, marginTop: 10, lineHeight: 1.4 }}>필기 약점과 주행 사건을 함께 분석해 다음 연습을 정합니다</h3>
          <p className="muted small" style={{ marginTop: 10, lineHeight: 1.6 }}>
            서버가 실제 기록에서 계산한 숫자만 AI에 전달하고, AI 응답의 인용·수치를 다시 검증합니다.
          </p>
          <div className="divider" style={{ margin: '16px 0' }} />
          {data.latest_report ? (
            <p className="small">최근 생성: {fmtDate(data.latest_report.created_at)}</p>
          ) : (
            <p className="small muted">아직 생성한 리포트가 없습니다.</p>
          )}
          {!data.llm_configured && <p className="tiny" style={{ color: 'var(--amber)', marginTop: 6 }}>AI 미연결 상태: 규칙 기반 요약으로 대신 표시합니다.</p>}
          <Link className="btn primary block" to="/report" style={{ marginTop: 16 }}>리포트 보기</Link>
        </div>
      </div>
    </div>
  )
}
