import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Attempt } from '../api/types'
import { LoadError, Skeleton, useAsync } from '../components/ui'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export default function WrittenSolve() {
  const { attemptId } = useParams()
  const nav = useNavigate()
  const { data, error, loading, reload, setData } = useAsync(() => api<Attempt>('GET', `/written/attempts/${attemptId}`), [attemptId])
  const [idx, setIdx] = useState(0)
  const [save, setSave] = useState<Record<string, SaveState>>({})
  const [submitError, setSubmitError] = useState<ApiError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  const persist = useCallback(
    async (questionId: string, optionIds: string[]) => {
      setSave((s) => ({ ...s, [questionId]: 'saving' }))
      try {
        await api('PUT', `/written/attempts/${attemptId}/answers/${questionId}`, { option_ids: optionIds })
        setSave((s) => ({ ...s, [questionId]: 'saved' }))
      } catch (e) {
        setSave((s) => ({ ...s, [questionId]: 'failed' }))
        if (e instanceof ApiError && e.code === 'ATTEMPT_ALREADY_SUBMITTED') nav(`/written/attempts/${attemptId}/result`, { replace: true })
      }
    },
    [attemptId, nav],
  )

  const choose = useCallback(
    (optionId: string) => {
      if (!data) return
      const q = data.questions[idx]
      let next: string[]
      if (q.required_selections === 1) next = [optionId]
      else if (q.selected_option_ids.includes(optionId)) next = q.selected_option_ids.filter((x) => x !== optionId)
      else next = [...q.selected_option_ids, optionId].slice(-q.required_selections)
      const questions = data.questions.map((x, i) => (i === idx ? { ...x, selected_option_ids: next } : x))
      setData({ ...data, questions })
      void persist(q.question_id, next)
    },
    [data, idx, persist, setData],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !data) return
      const q = data.questions[idx]
      if (/^[1-5]$/.test(e.key) && q.options[Number(e.key) - 1]) choose(q.options[Number(e.key) - 1].id)
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(data.questions.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, idx, choose])

  if (error) return <div className="page"><LoadError error={error} onRetry={reload} /></div>
  if (loading || !data) return <div className="page"><Skeleton h={420} /></div>
  if (data.status === 'SUBMITTED') return <Navigate to={`/written/attempts/${data.id}/result`} replace />

  const q = data.questions[idx]
  const answered = data.questions.filter((x) => x.selected_option_ids.length > 0).length
  const failed = Object.entries(save).filter(([, v]) => v === 'failed').map(([k]) => k)
  const state = save[q.question_id] ?? 'idle'

  const submit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api('POST', `/written/attempts/${data.id}/submit`)
      nav(`/written/attempts/${data.id}/result`, { replace: true })
    } catch (e) {
      setSubmitError(e as ApiError)
      setSubmitting(false)
    }
  }

  return (
    <div className="page fade-in">
      <div className="quiz">
        <div className="card" style={{ padding: 32 }}>
          <div className="row between wrap">
            <div className="row">
              <span className="badge dark num">{q.position} / {data.question_count}</span>
              <span className="badge blue">{q.category.name}</span>
              <span className="badge amber" title="공식 문제은행 문항이 아닙니다">자체 제작 연습</span>
              {q.required_selections > 1 && <span className="badge violet">{q.required_selections}개 선택</span>}
            </div>
            <span className="small muted num">{q.points}점</span>
          </div>
          <p className="q-prompt" style={{ marginTop: 22 }}>{q.prompt}</p>
          <div className="stack" style={{ marginTop: 24 }}>
            {q.options.map((o) => {
              const on = q.selected_option_ids.includes(o.id)
              return (
                <button key={o.id} className={`option ${on ? 'on' : ''}`} onClick={() => choose(o.id)} aria-pressed={on}>
                  <span className="no">{o.position}</span>
                  <span>{o.content}</span>
                </button>
              )
            })}
          </div>
          <div className="row between" style={{ marginTop: 24 }}>
            <button className="btn ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← 이전</button>
            <span className="small" style={{ color: state === 'failed' ? 'var(--red)' : 'var(--ink-3)' }}>
              {state === 'saving' && '저장 중…'}
              {state === 'saved' && '✓ 서버에 저장됨'}
              {state === 'failed' && (
                <>
                  저장 실패 — 선택은 화면에 남아 있습니다.{' '}
                  <button className="btn sm danger" onClick={() => persist(q.question_id, q.selected_option_ids)}>다시 저장</button>
                </>
              )}
              {state === 'idle' && <>키보드 <span className="kbd">1</span>~<span className="kbd">4</span> 선택 · <span className="kbd">←</span><span className="kbd">→</span> 이동</>}
            </span>
            {idx < data.questions.length - 1 ? (
              <button className="btn primary" onClick={() => setIdx(idx + 1)}>다음 →</button>
            ) : (
              <button className="btn dark" onClick={() => setConfirm(true)}>제출하기</button>
            )}
          </div>
        </div>

        <div className="card stack">
          <div className="row between">
            <h3>진행 현황</h3>
            <span className="small muted num">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
          </div>
          <div className="bar"><i style={{ width: `${(answered / data.question_count) * 100}%` }} /></div>
          <span className="small muted">{answered} / {data.question_count} 답변</span>
          <div className="q-grid">
            {data.questions.map((x, i) => (
              <button key={x.question_id} className={`${x.selected_option_ids.length ? 'answered' : ''} ${i === idx ? 'current' : ''}`} onClick={() => setIdx(i)}>
                {i + 1}
              </button>
            ))}
          </div>
          {failed.length > 0 && <div className="notice red small">저장되지 않은 답이 {failed.length}개 있습니다. 해당 문항에서 다시 저장해 주세요.</div>}
          <button className="btn dark block" onClick={() => setConfirm(true)} disabled={failed.length > 0}>제출하기</button>
          <p className="tiny muted">새로고침해도 저장된 답으로 이어서 풀 수 있습니다. 답하지 않은 문항은 오답 처리됩니다.</p>
        </div>
      </div>

      {confirm && (
        <div className="overlay" style={{ position: 'fixed', zIndex: 50 }} onClick={() => !submitting && setConfirm(false)}>
          <div className="card" style={{ color: 'var(--ink)', maxWidth: 440, textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 21 }}>제출할까요?</h3>
            <p className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
              {answered < data.question_count ? `답하지 않은 문항 ${data.question_count - answered}개는 오답으로 처리됩니다. ` : '모든 문항에 답했습니다. '}
              제출 후에는 답을 바꿀 수 없습니다.
            </p>
            {submitError && <div className="notice red" style={{ marginTop: 12 }}>{submitError.message}</div>}
            <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setConfirm(false)} disabled={submitting}>계속 풀기</button>
              <button className="btn primary" onClick={submit} disabled={submitting}>{submitting ? <span className="spinner" /> : '제출하고 채점'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
