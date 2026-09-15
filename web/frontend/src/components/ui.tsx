import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api/client'

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const reload = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    fn()
      .then((d) => id === seq.current && setData(d))
      .catch((e) => id === seq.current && setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e))))
      .finally(() => id === seq.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

export function LoadError({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="notice red fade-in" role="alert">
      <div className="grow">
        <b>불러오지 못했습니다.</b> {error.message}
        <div className="tiny" style={{ opacity: 0.7, marginTop: 4 }}>
          {error.code}
        </div>
      </div>
      {onRetry && (
        <button className="btn sm ghost" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />
}

export function Ring({ value, max, size = 168, stroke = 14, color = 'var(--primary)', children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="inner">{children}</div>
    </div>
  )
}

export function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="bar">
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  COMPLETED: { cls: 'green', label: '완주' },
  DISQUALIFIED: { cls: 'red', label: '완주 · 실격 사유 포함' },
  INCOMPLETE: { cls: 'amber', label: '미완료' },
  ABORTED: { cls: '', label: '중단' },
  RUNNING: { cls: 'blue', label: '주행 중' },
}

export function SupportBadge({ level }: { level: string }) {
  if (level === 'A') return <span className="badge green">A 자동 채점</span>
  if (level === 'B') return <span className="badge amber">B 연습 표시</span>
  return <span className="badge">C 안내만</span>
}
