import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { AnswerReview, ExplanationResult } from '../api/types'
import { LoadError, Skeleton, useAsync } from '../components/ui'
import { useAiJob } from '../components/useAiJob'

export default function WrittenReview() {
  const { answerId } = useParams()
  const { data, error, loading, reload } = useAsync(() => api<AnswerReview>('GET', `/written/answers/${answerId}`), [answerId])
  const ai = useAiJob<ExplanationResult>(data?.latest_ai_job ?? null)

  if (error) return <div className="page"><LoadError error={error} onRetry={reload} /></div>
  if (loading || !data) return <div className="page"><Skeleton h={480} /></div>

  const q = data.question
  const job = ai.job

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">문항 {data.position} 해설</div>
          <h1>{data.is_correct ? '정답입니다' : '오답을 짚어 볼게요'}</h1>
          <p>정답은 문항 데이터가 정합니다. AI 는 설명만 합니다.</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to={`/written/attempts/${data.attempt_id}/result`}>결과로</Link>
          {data.prev_answer_id && <Link className="btn ghost" to={`/written/answers/${data.prev_answer_id}`}>← 이전 문항</Link>}
          {data.next_answer_id && <Link className="btn primary" to={`/written/answers/${data.next_answer_id}`}>다음 문항 →</Link>}
        </div>
      </div>
      <div className="grid side">
        <div className="stack lg">
          <div className="card" style={{ padding: 30 }}>
            <div className="row wrap">
              <span className={`badge ${data.is_correct ? 'green' : 'red'}`}>{data.is_correct ? '정답' : '오답'}</span>
              <span className="badge blue">{q.category.name}</span>
              <span className="badge amber">자체 제작 연습 · {q.code}</span>
            </div>
            <p className="q-prompt" style={{ marginTop: 18 }}>{q.prompt}</p>
            <div className="stack" style={{ marginTop: 20 }}>
              {q.options.map((o) => {
                const picked = data.selected_option_ids.includes(o.id)
                const cls = o.is_correct ? 'correct' : picked ? 'wrong' : ''
                return (
                  <div key={o.id} className={`option ${cls}`} style={{ cursor: 'default' }}>
                    <span className="no">{o.position}</span>
                    <span className="grow">{o.content}</span>
                    {picked && <span className="badge dark">내 선택</span>}
                    {o.is_correct && <span className="badge green">정답</span>}
                  </div>
                )
              })}
            </div>
            {data.selected_option_ids.length === 0 && <p className="small" style={{ color: 'var(--red)', marginTop: 12 }}>답을 선택하지 않아 오답 처리되었습니다.</p>}
          </div>
          <div className="card">
            <h3>검수 해설</h3>
            <p style={{ marginTop: 10, lineHeight: 1.75, fontSize: 16 }}>{q.explanation}</p>
            <div style={{ marginTop: 16 }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>근거 · {data.evidence.locator}</div>
              <span className="cite">{data.evidence.content}</span>
              <a className="tiny" href={data.evidence.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', display: 'inline-block', marginTop: 8 }}>
                {data.evidence.source_title} · 조회 {data.evidence.retrieved_at} ↗
              </a>
            </div>
          </div>
        </div>

        <div className="card ai-card stack">
          <div className="ai-title">✦ AI 오답 코칭</div>
          <p className="small muted" style={{ lineHeight: 1.6 }}>내 선택과 확정 정답, 위 조문 근거만 AI에 전달합니다. 근거 밖 인용은 서버가 차단합니다.</p>
          {!job && (
            <button className="btn primary block" onClick={() => ai.start({ kind: 'EXPLANATION', answer_id: data.answer_id })} disabled={ai.running}>
              {ai.running ? <span className="spinner" /> : 'AI 해설 요청'}
            </button>
          )}
          {ai.error && <div className="notice red small">{ai.error.message}</div>}
          {job && (job.status === 'QUEUED' || job.status === 'RUNNING') && (
            <div className="row small muted"><span className="spinner" /> AI가 근거를 읽고 설명을 작성하는 중…</div>
          )}
          {job?.status === 'SUCCEEDED' && job.result && (
            <div className="stack fade-in">
              <p style={{ fontWeight: 750, fontSize: 17, lineHeight: 1.5 }}>{job.result.summary}</p>
              <div>
                <div className="tiny muted" style={{ fontWeight: 700 }}>{data.is_correct ? '왜 맞았나' : '왜 틀렸나'}</div>
                <p style={{ lineHeight: 1.7, marginTop: 4 }}>{job.result.why_selected_wrong}</p>
              </div>
              <div>
                <div className="tiny muted" style={{ fontWeight: 700 }}>기억할 규칙</div>
                <p style={{ lineHeight: 1.7, marginTop: 4 }}>{job.result.key_rule}</p>
              </div>
              <div className="notice blue small">💡 {job.result.memory_tip}</div>
              {job.citations.map((c) => (
                <span key={c.chunk_id} className="cite tiny">인용: {c.locator}</span>
              ))}
              <span className="tiny muted">{job.model_version} · {job.prompt_version}</span>
            </div>
          )}
          {job?.status === 'FAILED' && (
            <div className="stack">
              <div className="notice amber small">
                <div><b>AI 해설을 표시할 수 없습니다.</b><br />{job.error_message} 왼쪽의 검수 해설과 근거는 그대로 확인할 수 있습니다.</div>
              </div>
              <button className="btn ghost block" onClick={() => ai.start({ kind: 'EXPLANATION', answer_id: data.answer_id })} disabled={ai.running}>다시 요청</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
