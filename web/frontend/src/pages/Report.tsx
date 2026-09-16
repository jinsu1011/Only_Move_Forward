import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { AiJob, ReportResult, ScenarioItem } from '../api/types'
import { Bar, fmtDate, LoadError, Skeleton, useAsync } from '../components/ui'
import { useAiJob } from '../components/useAiJob'

export default function Report() {
  const history = useAsync(() => api<{ items: AiJob<ReportResult>[] }>('GET', '/ai/jobs?kind=REPORT&limit=5'), [])
  const scenarios = useAsync(() => api<{ items: ScenarioItem[] }>('GET', '/scenarios'), [])
  const ai = useAiJob<ReportResult>(history.data?.items[0] ?? null)
  const job = ai.job
  const r = job?.result

  const evidenceLabel = (id: string) => {
    const [type, key] = id.split(':')
    if (!r) return id
    if (type === 'CAT') return `필기 · ${r.stats.written.categories.find((c) => c.id === key)?.name ?? key}`
    if (type === 'EV') return `주행 · ${r.stats.driving.event_counts.find((e) => e.code === key)?.label ?? key}`
    if (type === 'WA') return `필기 시도 ${fmtDate(r.stats.written.attempts.find((a) => a.id === key)?.submitted_at)}`
    if (type === 'TS') return `주행 기록 · ${r.stats.driving.sessions.find((s) => s.id === key)?.scenario ?? ''}`
    return id
  }
  const stepLink = (target: string, ref: string) => {
    if (target === 'WRITTEN') return `/written?category=${ref}`
    const s = scenarios.data?.items.find((x) => x.code === ref)
    return s ? `/drive/setup/${s.id}` : '/drive'
  }
  // 사건이 실제로 나는 코스로 보낸다. 기본조작 과제에서만 나는 사건은 기본조작으로,
  // 신호·보호구역·차로처럼 도로에서만 나는 사건은 도로주행으로. 코스를 못 찾으면 코스 선택 화면.
  const eventCourseLink = (code: string) => {
    const kind = code.startsWith('STAGE') || code === 'COURSE_COMPLETE' ? 'FUNCTION' : 'ROAD'
    const s = scenarios.data?.items.find((x) => x.kind === kind)
    return s ? `/drive/setup/${s.id}` : '/drive'
  }

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">AI 통합 리포트</div>
          <h1>내 기록에서 찾은 다음 연습</h1>
          <p>서버가 최근 필기 10회·주행 10회에서 계산한 숫자만 AI에 전달합니다. AI 응답의 수치·근거 id는 서버가 다시 검사합니다.</p>
        </div>
        <button className="btn lg primary" onClick={() => ai.start({ kind: 'REPORT' })} disabled={ai.running}>
          {ai.running ? <><span className="spinner" /> 분석 중…</> : job ? '최신 기록으로 다시 분석' : '리포트 만들기'}
        </button>
      </div>
      {history.error && <LoadError error={history.error} onRetry={history.reload} />}
      {ai.error && <div className="notice red" style={{ marginBottom: 16 }}>{ai.error.message}</div>}
      {history.loading && <Skeleton h={360} />}

      {!history.loading && !job && (
        <div className="card center" style={{ padding: 48 }}>
          <div style={{ fontSize: 48 }}>✦</div>
          <h2 style={{ fontSize: 24, marginTop: 10 }}>아직 리포트가 없습니다</h2>
          <p className="muted" style={{ marginTop: 8 }}>필기 5문항 이상 또는 주행 1회 이상 기록이 있으면 분석할 수 있습니다.</p>
        </div>
      )}
      {job && (job.status === 'QUEUED' || job.status === 'RUNNING') && (
        <div className="card row" style={{ padding: 28 }}><span className="spinner" /> 기록을 모으고 AI가 근거를 검토하는 중입니다…</div>
      )}
      {job?.status === 'FAILED' && <div className="notice red">리포트를 만들지 못했습니다. {job.error_message}</div>}

      {r && (
        <div className="stack lg">
          <div className="card ai-card" style={{ padding: 30 }}>
            <div className="row between wrap">
              <div className="ai-title">✦ {r.narrative_source === 'llm' ? `AI 분석 · ${job?.model_version ?? ''}` : '규칙 기반 요약'}</div>
              <span className="tiny muted">{fmtDate(job?.finished_at)} · {job?.prompt_version}</span>
            </div>
            {job?.status === 'FALLBACK' && <div className="notice amber small" style={{ marginTop: 12 }}>AI 대신 서버 규칙으로 요약했습니다: {job.error_message}</div>}
            {job?.status === 'INSUFFICIENT_DATA' && <div className="notice small" style={{ marginTop: 12 }}>기록이 부족해 분석을 보류했습니다.</div>}
            <h2 style={{ fontSize: 28, marginTop: 14, lineHeight: 1.35 }}>{r.narrative.headline}</h2>
            <p style={{ marginTop: 10, fontSize: 17, lineHeight: 1.75, color: 'var(--ink-2)' }}>{r.narrative.summary}</p>
            <div className="grid c3" style={{ marginTop: 22 }}>
              {r.narrative.focus_areas.map((f, i) => (
                <div key={i} className="card flat">
                  <div className="badge violet">집중 {i + 1}</div>
                  <h3 style={{ marginTop: 10 }}>{f.title}</h3>
                  <p className="small" style={{ marginTop: 6, lineHeight: 1.65, color: 'var(--ink-2)' }}>{f.reason}</p>
                  <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>{f.evidence_ids.map((id) => <span key={id} className="badge" title={id}>근거: {evidenceLabel(id)}</span>)}</div>
                </div>
              ))}
            </div>
            {r.narrative.next_steps.length > 0 && (
              <>
                <h3 style={{ marginTop: 24 }}>바로 해 볼 다음 연습</h3>
                <div className="grid c3" style={{ marginTop: 10 }}>
                  {r.narrative.next_steps.map((s, i) => (
                    <Link key={i} to={stepLink(s.target, s.ref)} className="card flat link">
                      <span className={`badge ${s.target === 'WRITTEN' ? 'blue' : 'teal'}`}>{s.target === 'WRITTEN' ? '필기' : '주행'}</span>
                      <h3 style={{ marginTop: 8 }}>{s.title}</h3>
                      <p className="small muted" style={{ marginTop: 6, lineHeight: 1.6 }}>{s.detail}</p>
                      <div className="small" style={{ color: 'var(--primary)', fontWeight: 700, marginTop: 10 }}>시작하기 →</div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="grid c2">
            <div className="card">
              <div className="card-head"><h3>필기 주제별 정답률</h3><span className="small muted num">{r.stats.written.total_correct}/{r.stats.written.total_answers}</span></div>
              {r.stats.written.categories.length === 0 ? <div className="empty">제출한 필기 기록이 없습니다.</div> : (
                <div className="stack" style={{ gap: 10 }}>
                  {/* 약한 주제가 위로 오게 정렬한다. 행을 누르면 그 주제만 골라 바로 연습을 시작한다. */}
                  {[...r.stats.written.categories].sort((a, b) => a.accuracy_pct - b.accuracy_pct).map((c) => {
                    const tone = c.accuracy_pct >= 70 ? 'ok' : c.accuracy_pct >= 50 ? 'mid' : 'weak'
                    const color = tone === 'ok' ? 'var(--green)' : tone === 'mid' ? 'var(--amber)' : 'var(--red)'
                    return (
                      <Link key={c.id} className={`stat-row ${tone}`} to={`/written?category=${c.id}`}>
                        <div className="sr-top">
                          <span className="sr-name">{c.name}</span>
                          <span className="sr-figure" style={{ color }}>{c.accuracy_pct}%</span>
                        </div>
                        <div style={{ marginTop: 8 }}><Bar value={c.correct} max={c.total} color={color} /></div>
                        <div className="row between" style={{ marginTop: 6 }}>
                          <span className="sr-sub num">{c.total}문항 중 {c.correct}개 정답</span>
                          <span className="sr-go">이 주제 연습하기 →</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h3>주행 사건 빈도</h3><span className="small muted">주행 {r.stats.driving.total_sessions}회 · 완주 {r.stats.driving.completed_sessions} · 실격 해당 {r.stats.driving.disqualified_sessions}</span></div>
              {r.stats.driving.event_counts.length === 0 ? <div className="empty">{r.stats.driving.total_sessions ? '기록된 사건이 없습니다.' : '주행 기록이 없습니다.'}</div> : (
                <div className="stack" style={{ gap: 10 }}>
                  {/* 사건은 이미 많이 난 순서로 온다. 행을 누르면 그 사건이 나는 코스로 바로 간다. */}
                  {r.stats.driving.event_counts.map((e) => (
                    <Link key={e.code} className="stat-row weak" to={eventCourseLink(e.code)}>
                      <div className="sr-top">
                        <span className="sr-name">{e.label}</span>
                        <span className="sr-figure" style={{ color: 'var(--amber)' }}>{e.count}<small style={{ fontSize: 13, fontWeight: 700, marginLeft: 2 }}>회</small></span>
                      </div>
                      <div style={{ marginTop: 8 }}><Bar value={e.count} max={r.stats.driving.event_counts[0].count} color="var(--amber)" /></div>
                      <div className="row between" style={{ marginTop: 6 }}>
                        <span className="sr-sub">{e.code}</span>
                        <span className="sr-go">이 코스 다시 달리기 →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <div className="divider" style={{ margin: '16px 0' }} />
              <div className="small"><b>분석하지 않는 항목(측정 안 함)</b></div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>{r.stats.unmeasured.map((u) => <span key={u} className="badge">{u}</span>)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
