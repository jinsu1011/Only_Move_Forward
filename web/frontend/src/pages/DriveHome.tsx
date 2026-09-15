import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ScenarioItem, ScoringRule } from '../api/types'
import { controller, useController, useSerialLink } from '../input/controller'
import { LoadError, Skeleton, SupportBadge, useAsync } from '../components/ui'

export default function DriveHome() {
  const scenarios = useAsync(() => api<{ items: ScenarioItem[] }>('GET', '/scenarios'), [])
  const rules = useAsync(() => api<{ items: ScoringRule[] }>('GET', '/scoring-rules'), [])
  const ctl = useController()
  const link = useSerialLink()
  const [filter, setFilter] = useState<'ALL' | 'A' | 'B' | 'C'>('B')

  const count = (lvl: string) => rules.data?.items.filter((r) => r.support === lvl).length ?? 0
  const shown = rules.data?.items.filter((r) => filter === 'ALL' || r.support === filter) ?? []

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">주행 연습</div>
          <h1>코스를 고르고, 핸들을 정렬한 뒤 출발하세요</h1>
          <p>{ctl.mode === 'SENSOR' ? <>센서 조향 · <span className="kbd">↑</span> 전진 · <span className="kbd">↓</span> 후진</> : <>키보드 <span className="kbd">W</span><span className="kbd">A</span><span className="kbd">S</span><span className="kbd">D</span> 조작</>} · <span className="kbd">R</span> 즉시 정지·재정렬</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="입력 장치">
          <button className={ctl.mode === 'SENSOR' ? 'on' : ''} onClick={() => controller.set({ mode: 'SENSOR' })}>🎮 센서 핸들</button>
          <button className={ctl.mode === 'KEYBOARD' ? 'on' : ''} onClick={() => controller.set({ mode: 'KEYBOARD' })}>⌨️ 키보드</button>
        </div>
      </div>

      {ctl.mode === 'SENSOR' && link.status === 'unsupported' && (
        <div className="notice amber" style={{ marginBottom: 18 }}>
          <div className="grow"><b>이 브라우저에서는 센서를 연결할 수 없습니다.</b> {link.message} 키보드 모드로는 바로 연습할 수 있습니다.</div>
          <button className="btn sm dark" onClick={() => controller.set({ mode: 'KEYBOARD' })}>키보드로 전환</button>
        </div>
      )}

      {scenarios.error && <LoadError error={scenarios.error} onRetry={scenarios.reload} />}
      <div className="grid c2">
        {!scenarios.data
          ? [0, 1].map((i) => <Skeleton key={i} h={260} />)
          : scenarios.data.items.map((s) => (
              <div key={s.id} className="card scenario-card" style={{ padding: 26 }}>
                <div className="row between">
                  <span className={`badge ${s.kind === 'ROAD' ? 'blue' : 'teal'}`}>{s.kind === 'ROAD' ? '도로주행' : '기본조작'}</span>
                  <span className="tiny muted">v{s.version} · {s.sim_version}</span>
                </div>
                <h3 style={{ fontSize: 24, marginTop: 14 }}>{s.title}</h3>
                <p className="muted" style={{ marginTop: 8, lineHeight: 1.65 }}>{s.summary}</p>
                <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
                  <span className="badge">{Math.round(s.length_m)}m</span>
                  <span className="badge">제한 {Math.round(s.time_limit_s / 60)}분</span>
                  {s.features.signals > 0 && <span className="badge">신호 교차로 {s.features.signals}</span>}
                  {s.features.school_zones > 0 && <span className="badge red">어린이보호구역</span>}
                  {s.features.crosswalks > 0 && <span className="badge amber">신호 없는 횡단보도</span>}
                  {s.kind === 'FUNCTION' && <span className="badge teal">전진·후진 정차 {s.features.stages}단계</span>}
                  {s.practice_rule_count > 0 && <span className="badge violet">연습 판정 {s.practice_rule_count}항목</span>}
                </div>
                <div className="row" style={{ marginTop: 22 }}>
                  <Link className="btn lg primary grow" to={`/drive/setup/${s.id}`}>
                    {ctl.mode === 'SENSOR' ? '센서 정렬하고 시작' : '키보드 확인하고 시작'}
                  </Link>
                </div>
              </div>
            ))}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="card-head">
          <div>
            <h3>도로주행시험 채점기준(별표26) 지원 범위</h3>
            <p className="small muted" style={{ marginTop: 4 }}>
              전체 57개 항목을 조사해 이 시뮬레이션이 무엇을 판정하는지 표시합니다. 연습 판정은 공식 항목의 일부 조건만 확인하며 공식 채점이 아닙니다.
            </p>
          </div>
          <div className="seg">
            {(['B', 'C', 'A', 'ALL'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'ALL' ? `전체 ${rules.data?.items.length ?? ''}` : `${f} ${count(f)}`}
              </button>
            ))}
          </div>
        </div>
        {rules.error && <LoadError error={rules.error} onRetry={rules.reload} />}
        {filter === 'A' && count('A') === 0 && <div className="notice">A(자동 채점)는 공식 채점과 같은 방식으로 검증되기 전까지 활성화하지 않습니다. 현재 0개입니다.</div>}
        <div className="scroll-x" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th>코드</th><th>항목</th><th>구분</th><th>지원</th><th>판정 방법·한계</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code}>
                  <td className="num" style={{ fontWeight: 700 }}>{r.code}</td>
                  <td style={{ fontWeight: 650 }}>{r.name_ko}<div className="tiny muted">{r.locator}</div></td>
                  <td>{r.kind === 'DISQUALIFICATION' ? <span className="badge red">실격</span> : <span className="badge">감점 {r.deduction_points}</span>}</td>
                  <td><SupportBadge level={r.support} /></td>
                  <td className="small muted" style={{ maxWidth: 420 }}>{r.method}<br />{r.limitations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rules.data && <p className="tiny muted" style={{ marginTop: 10 }}>출처: {rules.data.items[0]?.source_title} ({rules.data.items[0]?.source_version}, 시행 {rules.data.items[0]?.effective_from})</p>}
      </div>
    </div>
  )
}
