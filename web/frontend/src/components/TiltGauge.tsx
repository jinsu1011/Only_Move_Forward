// 기울기 게이지: 중앙(복귀 각도 이내) / 히스테리시스 구간 / LEFT·RIGHT 진입 구간을 색으로 보여 준다.
const RANGE = 45

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => {
    const t = ((a / RANGE) * 90 - 90) * (Math.PI / 180)
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)]
  }
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
}

export default function TiltGauge({ rel, enter, exit, steer, size = 320 }: { rel: number | null; enter: number; exit: number; steer: -1 | 0 | 1; size?: number }) {
  const cx = 160
  const cy = 170
  const r = 130
  const v = rel === null ? 0 : Math.max(-RANGE, Math.min(RANGE, rel))
  const t = ((v / RANGE) * 90 - 90) * (Math.PI / 180)
  const nx = cx + (r - 18) * Math.cos(t)
  const ny = cy + (r - 18) * Math.sin(t)
  return (
    <svg viewBox="0 0 320 210" width={size} role="img" aria-label={`현재 기울기 ${rel === null ? '없음' : rel.toFixed(1) + '도'}`}>
      <path d={arc(cx, cy, r, -RANGE, RANGE)} stroke="#e2e8f0" strokeWidth="22" fill="none" strokeLinecap="round" />
      <path d={arc(cx, cy, r, -RANGE, -enter)} stroke={steer === -1 ? '#2563eb' : '#bfdbfe'} strokeWidth="22" fill="none" />
      <path d={arc(cx, cy, r, enter, RANGE)} stroke={steer === 1 ? '#2563eb' : '#bfdbfe'} strokeWidth="22" fill="none" />
      <path d={arc(cx, cy, r, -enter, -exit)} stroke="#fde68a" strokeWidth="22" fill="none" />
      <path d={arc(cx, cy, r, exit, enter)} stroke="#fde68a" strokeWidth="22" fill="none" />
      <path d={arc(cx, cy, r, -exit, exit)} stroke={steer === 0 ? '#34d399' : '#bbf7d0'} strokeWidth="22" fill="none" />
      <text x="22" y="198" fontSize="15" fontWeight="800" fill={steer === -1 ? '#1d4ed8' : '#94a3b8'}>LEFT</text>
      <text x="298" y="198" fontSize="15" fontWeight="800" textAnchor="end" fill={steer === 1 ? '#1d4ed8' : '#94a3b8'}>RIGHT</text>
      <text x={cx} y="22" fontSize="12" fontWeight="700" textAnchor="middle" fill="#64748b">CENTER ±{exit}°  ·  진입 ±{enter}°</text>
      {rel !== null && (
        <>
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#0b1220" strokeWidth="6" strokeLinecap="round" style={{ transition: 'all 60ms linear' }} />
          <circle cx={cx} cy={cy} r="11" fill="#0b1220" />
        </>
      )}
      <text x={cx} y={cy + 36} fontSize="26" fontWeight="850" textAnchor="middle" fill="#0b1220" className="num">
        {rel === null ? '—' : `${rel > 0 ? '+' : ''}${rel.toFixed(1)}°`}
      </text>
    </svg>
  )
}
