import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, newKey } from '../api/client'
import type { AiJob } from '../api/types'

const DONE = new Set(['SUCCEEDED', 'FALLBACK', 'INSUFFICIENT_DATA', 'FAILED'])

/** AI 작업 생성(202) → 완료까지 1초 간격 조회 */
export function useAiJob<R>(initial: AiJob<R> | null) {
  const [job, setJob] = useState<AiJob<R> | null>(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [starting, setStarting] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => setJob(initial), [initial])

  const poll = useCallback((id: string) => {
    if (timer.current) window.clearTimeout(timer.current)
    const tick = async () => {
      try {
        const j = await api<AiJob<R>>('GET', `/ai/jobs/${id}`)
        setJob(j)
        if (!DONE.has(j.status)) timer.current = window.setTimeout(tick, 1000)
      } catch (e) {
        setError(e as ApiError)
      }
    }
    timer.current = window.setTimeout(tick, 700)
  }, [])

  useEffect(() => {
    if (job && !DONE.has(job.status)) poll(job.id)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id])

  const start = useCallback(
    async (body: { kind: 'EXPLANATION' | 'REPORT'; answer_id?: string }) => {
      setStarting(true)
      setError(null)
      try {
        const j = await api<AiJob<R>>('POST', '/ai/jobs', body, { idempotencyKey: newKey() })
        setJob(j)
        if (!DONE.has(j.status)) poll(j.id)
      } catch (e) {
        setError(e as ApiError)
      } finally {
        setStarting(false)
      }
    },
    [poll],
  )

  const running = starting || (job !== null && !DONE.has(job.status))
  return { job, error, running, start }
}
