import { useEffect, useMemo, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ScenarioDetail, TrainingResult } from '../api/types'
import { fmtDate, LoadError, Skeleton, STATUS_BADGE, useAsync } from '../components/ui'
import { DISQUALIFY_CODES, Sim, TICK_HZ } from '../sim/engine'
import { DriveScene3D } from '../sim/render3d'

export default function DriveResult() {
  const { sessionId } = useParams()
  const res = useAsync(() => api<TrainingResult>('GET', `/training/sessions/${sessionId}`), [sessionId])
  const scen = useAsync(async () => (res.data ? api<ScenarioDetail>('GET', `/scenarios/${res.data.scenario.id}`) : null), [res.data?.scenario.id])
  const stageRef = useRef<HTMLDivElement>(null)
  const data = res.data

  const replayed = useMemo(() => {
    if (!data?.replay || !scen.data) return null
    const sim = new Sim(scen.data.definition)
    const path: { x: number; y: number }[] = []
    let k = 0, thr = 0, ste = 0
    const inputs = data.replay.inputs
    while (sim.tick < data.replay.total_ticks && !sim.ended) {
      while (k < inputs.length && inputs[k][0] <= sim.tick) { thr = inputs[k][1]; ste = inputs[k][2]; k++ }
      sim.step(thr as -1 | 0 | 1, ste as -1 | 0 | 1)
      if (sim.tick % 5 === 0) path.push({ x: sim.x, y: sim.y })
    }
    return { sim, path }
  }, [data, scen.data])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !replayed || !data) return
    const scene = new DriveScene3D(stage, replayed.sim)
    scene.render(replayed.sim, {
      mode: 'overview',
      path: replayed.path,
      markers: data.events
        .filter((e) => !['STAGE_CLEAR', 'COURSE_COMPLETE'].includes(e.code))
        .map((e) => ({ s: e.s_m, offset: 1.75, label: String(e.seq), danger: DISQUALIFY_CODES.has(e.code) })),
    })
    return () => scene.dispose()
  }, [replayed, data])

  if (res.error) return <div className="page"><LoadError error={res.error} onRetry={res.reload} /></div>
  if (!data) return <div className="page"><Skeleton h={520} /></div>

  const issues = data.events.filter((e) => !['STAGE_CLEAR', 'COURSE_COMPLETE'].includes(e.code))
  const dqCount = data.events.filter((e) => DISQUALIFY_CODES.has(e.code)).length
  const road = data.scenario.kind === 'ROAD'
  const title =
    data.status === 'COMPLETED' ? (issues.length ? '완주! 짚고 넘어갈 장면이 있어요' : '깔끔한 완주입니다') : data.status === 'DISQUALIFIED' ? `완주했지만 실격 사유 ${dqCount}건이 있어요` : data.status === 'ABORTED' ? '중단된 주행' : '끝까지 달리지 못했어요'

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">{data.scenario.title} · {fmtDate(data.ended_at)}</div>
          <h1>{title}</h1>
          <p>{data.scoring_notice}</p>
        </div>
        <div className="row">
          <Link className="btn primary" to={`/drive/setup/${data.scenario.id}`}>같은 코스 다시</Link>
          <Link className="btn ghost" to="/report">AI 리포트</Link>
        </div>
      </div>

      <div className="grid c4">
        <div className="card"><div className="stat"><span className="label">결과</span><span className={`badge ${STATUS_BADGE[data.status]?.cls}`} style={{ height: 32, fontSize: 15, alignSelf: 'flex-start', marginTop: 4 }}>{STATUS_BADGE[data.status]?.label}</span></div></div>
        <div className="card">
          <div className="stat">
            <span className="label">서버 재생 검증</span>
            {data.verification_status === 'VERIFIED' ? <span className="value" style={{ fontSize: 20, color: 'var(--green)' }}>✓ 일치</span> : data.verification_status === 'MISMATCH' ? <span className="value" style={{ fontSize: 20, color: 'var(--amber)' }}>불일치 → 서버 기준</span> : <span className="value" style={{ fontSize: 20 }}>해당 없음</span>}
            <span className="tiny muted">입력 기록을 서버가 다시 주행해 사건을 확정</span>
          </div>
        </div>
        <div className="card"><div className="stat"><span className="label">주행</span><span className="value num">{data.duration_s}<small>초</small></span><span className="tiny muted num">{data.distance_m ?? 0}m · 최고 {data.max_speed_kmh ?? 0}km/h · 일시정지 {data.pause_count}회</span></div></div>
        <div className="card">
          <div className="stat">
            <span className="label">{road ? '참고 감점 합계' : '기록된 사건'}</span>
            <span className="value num">{road ? (data.reference_deduction ? `-${data.reference_deduction}` : 0) : issues.length}<small>{road ? '점' : '건'}</small></span>
            <span className="tiny muted">{road ? '별표26 해당 항목 감점값 합 · 공식 채점 아님' : '기본조작 연습은 공식 항목과 연결하지 않음'}</span>
          </div>
        </div>
      </div>

      <div className="grid side" style={{ marginTop: 20 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div ref={stageRef} className="result-stage-3d" style={{ position: 'relative', background: '#15231b', height: 460 }}>
            {!replayed && <div className="overlay" style={{ background: 'transparent' }}>{data.status === 'ABORTED' ? '중단된 주행은 경로 기록이 없습니다.' : <span className="spinner" />}</div>}
            <div className="hud"><div className="hud-box tiny">파란 선: 서버에 저장된 입력으로 다시 그린 실제 주행 경로 · 번호: 사건 위치</div></div>
          </div>
        </div>
        <div className="card">
          <h3>사건 타임라인</h3>
          {data.events.length === 0 ? (
            <div className="empty">기록된 사건이 없습니다.</div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {data.events.map((e) => (
                <div key={e.seq} className="ev">
                  <span className="t num">{e.time_s.toFixed(1)}s</span>
                  <div className="grow">
                    <div className="row between">
                      <b style={{ color: DISQUALIFY_CODES.has(e.code) ? 'var(--red)' : ['STAGE_CLEAR', 'COURSE_COMPLETE'].includes(e.code) ? 'var(--green)' : 'var(--ink)' }}>
                        {!['STAGE_CLEAR', 'COURSE_COMPLETE'].includes(e.code) && `${e.seq}. `}{e.label}
                      </b>
                    </div>
                    <div className="tiny muted num">{e.speed_kmh}km/h · {Math.round(e.s_m)}m{e.evidence.limit_kmh ? ` · 제한 ${e.evidence.limit_kmh}km/h` : ''}{e.evidence.light ? ` · 신호 ${e.evidence.light}` : ''}</div>
                    {e.rule && (
                      <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                        <span className={`badge ${e.rule.kind === 'DISQUALIFICATION' ? 'red' : 'amber'}`}>{e.rule.code} {e.rule.name_ko}</span>
                        <span className="badge">{e.rule.kind === 'DISQUALIFICATION' ? '실격 항목' : `감점 ${e.rule.deduction_points}`} · 연습 판정</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="small"><b>측정하지 않은 항목</b></div>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>{data.unmeasured.map((u) => <span key={u} className="badge">{u}</span>)}</div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            {data.input_mode === 'SENSOR' && data.calibration ? `센서 정렬: 중앙 ${data.calibration.center_deg}° · 진입 ${data.calibration.enter_deg}°/복귀 ${data.calibration.exit_deg}° · ${data.calibration.firmware_format}` : '키보드 입력'} · {TICK_HZ}Hz 틱 {data.total_ticks}
          </p>
        </div>
      </div>
    </div>
  )
}
