import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { ScenarioDetail, SessionSummary, TrainingResult } from '../api/types'
import { LoadError, Skeleton } from '../components/ui'
import { axisValue, controller, useSerialLink } from '../input/controller'
import { applyKey, emptyKeys, isRestartKey, isTyping } from '../input/keys'
import { serialLink } from '../input/serialLink'
import { relativeAngle, steerFromKeys, SteeringFilter, throttleFromKeys, type Steer, type Throttle } from '../input/steering'
import { DISQUALIFY_CODES, signalState, Sim, TICK_HZ, type SimEvent } from '../sim/engine'
import { DriveScene3D } from '../sim/render3d'

const LABEL: Record<string, string> = {
  SIGNAL_RED: '적색 신호 위반', CROSSWALK_OVERRUN: '정지선 넘어 정지', CROSSWALK_NO_STOP: '횡단보도 앞 일시정지 안 함',
  PEDESTRIAN_CONFLICT: '보행자 보호 위반', SCHOOL_ZONE_SPEEDING: '보호구역 속도 초과', SPEEDING: '제한속도 10km/h 초과',
  CENTER_LINE: '중앙선 침범', LANE_KEEP: '차로 이탈', OFF_ROAD: '도로 이탈', START_DELAY: '20초 내 미출발',
  STAGE_CLEAR: '구간 통과', COURSE_COMPLETE: '코스 완주', TIME_LIMIT: '제한 시간 초과',
}

type Phase = 'LOADING' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'SAVING' | 'SAVE_FAILED' | 'STALE'
type PauseReason = 'BLUR' | 'SENSOR_LOST' | 'USER'

interface Pending { total_ticks: number; inputs: [number, number, number][]; client_events: { code: string; tick: number }[]; end_reason: 'TERMINAL_EVENT' | 'USER_END'; pause_count: number }
const pendingKey = (id: string) => `lf.pending.${id}`

export default function DriveSession() {
  const { sessionId } = useParams()
  const nav = useNavigate()
  const link = useSerialLink()
  const stageRef = useRef<HTMLDivElement>(null)
  const scene3dRef = useRef<DriveScene3D | null>(null)
  const simRef = useRef<Sim | null>(null)
  const keysRef = useRef(emptyKeys())
  const steerRef = useRef<Steer>(0)
  const lastSampleRef = useRef<number>(0)
  const inputsRef = useRef<[number, number, number][]>([])
  const lastInputRef = useRef<string>('')
  const throttleRef = useRef<Throttle>(0)
  const phaseRef = useRef<Phase>('LOADING')
  const pausesRef = useRef(0)
  const finishRef = useRef<(reason: 'TERMINAL_EVENT' | 'USER_END') => void>(() => undefined)
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [scenario, setScenario] = useState<ScenarioDetail | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [phase, setPhaseState] = useState<Phase>('LOADING')
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null)
  const [countdown, setCountdown] = useState(3)
  const [hud, setHud] = useState({ speed: 0, limit: 0, light: null as string | null, steer: 0 as Steer, throttle: 0 as Throttle, time: 0, progress: 0, stage: '', school: false, rel: null as number | null })
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([])
  const [events, setEvents] = useState<SimEvent[]>([])
  const [saveError, setSaveError] = useState<ApiError | null>(null)

  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }

  const toast = useCallback((text: string, kind = '') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  // 로드
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await api<SessionSummary>('GET', `/training/sessions/${sessionId}`)
        if (cancelled) return
        if (s.status !== 'RUNNING') {
          nav(s.status === 'ABORTED' ? '/drive' : `/drive/result/${s.id}`, { replace: true })
          return
        }
        const sc = await api<ScenarioDetail>('GET', `/scenarios/${s.scenario.id}`)
        if (cancelled) return
        setSession(s)
        setScenario(sc)
        simRef.current = new Sim(sc.definition)
        const pending = sessionStorage.getItem(pendingKey(s.id))
        setPhase(pending ? 'SAVE_FAILED' : 'COUNTDOWN')
      } catch (e) {
        if (!cancelled) setLoadError(e as ApiError)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, nav])

  // 카운트다운
  useEffect(() => {
    if (phase !== 'COUNTDOWN') return
    setCountdown(3)
    let n = 3
    const t = window.setInterval(() => {
      n -= 1
      setCountdown(n)
      if (n <= 0) {
        window.clearInterval(t)
        keysRef.current = emptyKeys()
        lastSampleRef.current = performance.now()
        setPhase('RUNNING')
      }
    }, 700)
    return () => window.clearInterval(t)
  }, [phase])

  const save = useCallback(
    async (payload: Pending) => {
      if (!session) return
      setPhase('SAVING')
      setSaveError(null)
      sessionStorage.setItem(pendingKey(session.id), JSON.stringify(payload))
      try {
        await api<TrainingResult>('POST', `/training/sessions/${session.id}/complete`, payload)
        sessionStorage.removeItem(pendingKey(session.id))
        nav(`/drive/result/${session.id}`, { replace: true })
      } catch (e) {
        setSaveError(e as ApiError)
        setPhase('SAVE_FAILED')
      }
    },
    [session, nav],
  )

  const finish = useCallback(
    (reason: 'TERMINAL_EVENT' | 'USER_END') => {
      const sim = simRef.current
      if (!sim || !session) return
      void save({
        total_ticks: sim.tick,
        inputs: inputsRef.current,
        client_events: sim.events.map((e) => ({ code: e.code, tick: e.tick })),
        end_reason: reason,
        pause_count: pausesRef.current,
      })
    },
    [save, session],
  )

  finishRef.current = finish

  const pause = useCallback((reason: PauseReason) => {
    if (phaseRef.current !== 'RUNNING' && phaseRef.current !== 'COUNTDOWN') return
    keysRef.current = emptyKeys()
    pausesRef.current += 1
    setPauseReason(reason)
    setPhase('PAUSED')
  }, [])

  const restart = useCallback(
    async (reason: 'RESTART' | 'SENSOR_LOST' | 'USER_EXIT', to?: string) => {
      if (!session) return
      keysRef.current = emptyKeys()
      setPhase('SAVING')
      try {
        await api('POST', `/training/sessions/${session.id}/abort`, { reason })
      } catch {
        /* 서버가 다음 시작 때 이전 RUNNING 세션을 중단 처리한다 */
      }
      nav(to ?? `/drive/setup/${session.scenario.id}`, { replace: true })
    },
    [session, nav],
  )

  // 입력
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if (isRestartKey(e)) {
        e.preventDefault()
        if (['RUNNING', 'PAUSED', 'COUNTDOWN'].includes(phaseRef.current)) void restart('RESTART')
        return
      }
      const mode = session?.input_mode ?? 'KEYBOARD'
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault()
      applyKey(keysRef.current, e, true, mode)
      if (e.key === 'Escape') {
        // Esc 한 번: 일시정지 메뉴, 한 번 더: 지금까지 기록을 저장하고 나가기
        e.preventDefault()
        if (phaseRef.current === 'RUNNING' || phaseRef.current === 'COUNTDOWN') pause('USER')
        else if (phaseRef.current === 'PAUSED') finishRef.current('USER_END')
      }
    }
    const up = (e: KeyboardEvent) => {
      applyKey(keysRef.current, e, false, session?.input_mode ?? 'KEYBOARD')
    }
    const blur = () => pause('BLUR')
    const vis = () => document.hidden && pause('BLUR')
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [pause, restart, session?.input_mode])

  // 센서
  useEffect(() => {
    if (!session || session.input_mode !== 'SENSOR' || !session.calibration) return
    const cal = session.calibration
    // 정렬 화면과 같은 보정(평활·튐 제거·유지 시간)을 적용한다. 이전 기록에는 값이 없어 0(보정 없음)으로 본다.
    const filter = new SteeringFilter({ enter: cal.enter_deg, exit: cal.exit_deg, smoothingMs: cal.smoothing_ms ?? 0, dwellMs: cal.dwell_ms ?? 0 })
    const off = serialLink.onSample((s) => {
      const value = axisValue(s, cal.steering_axis)
      if (value === null) return
      lastSampleRef.current = s.at
      const rel = relativeAngle(filter.smooth(value, s.at), cal.center_deg, cal.invert)
      steerRef.current = filter.decide(rel, s.at)
      relRef.current = rel
    })
    return () => {
      off()
    }
  }, [session])
  const relRef = useRef<number | null>(null)

  useEffect(() => {
    if (session?.input_mode === 'SENSOR' && link.status !== 'open' && (phaseRef.current === 'RUNNING' || phaseRef.current === 'COUNTDOWN')) pause('SENSOR_LOST')
  }, [link.status, session, pause])

  // 게임 루프
  useEffect(() => {
    if (!scenario || !session) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    let hudAt = 0
    const sensor = session.input_mode === 'SENSOR'
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const sim = simRef.current
      const stage = stageRef.current
      if (!sim || !stage) return
      if (!scene3dRef.current) scene3dRef.current = new DriveScene3D(stage, sim)
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const k = keysRef.current
      const throttle = throttleFromKeys(k.forward, k.reverse)
      const steer: Steer = sensor ? steerRef.current : steerFromKeys(k.left, k.right)
      throttleRef.current = throttle

      if (phaseRef.current === 'RUNNING') {
        if (sensor && now - lastSampleRef.current > 600) {
          pause('SENSOR_LOST')
        } else {
          acc += dt
          const before = sim.events.length
          while (acc >= 1 / TICK_HZ && !sim.ended) {
            const sig = `${throttle},${steer}`
            if (sig !== lastInputRef.current) {
              inputsRef.current.push([sim.tick, throttle, steer])
              lastInputRef.current = sig
            }
            sim.step(throttle, steer)
            acc -= 1 / TICK_HZ
          }
          if (sim.events.length > before) {
            const fresh = sim.events.slice(before)
            setEvents([...sim.events])
            for (const ev of fresh) {
              const kind = ev.code === 'COURSE_COMPLETE' || ev.code === 'STAGE_CLEAR' ? 'info' : DISQUALIFY_CODES.has(ev.code) ? '' : 'warn'
              toast(LABEL[ev.code] ?? ev.code, kind)
            }
          }
          if (sim.ended) {
            acc = 0
            window.setTimeout(() => finish('TERMINAL_EVENT'), 900)
            setPhase('SAVING')
          }
        }
      } else {
        acc = 0
      }

      scene3dRef.current.render(sim, { mode: 'cockpit' })
      if (now - hudAt > 80) {
        hudAt = now
        const sig = sim.d.signals.find((s) => sim.s < s.intersection_to && s.stop_s - sim.s < 90)
        const stg = sim.d.stages[sim.stage]
        setHud({
          speed: Math.abs(sim.v) * 3.6,
          limit: sim.schoolZoneAt(sim.s)?.limit_kmh ?? (sim.speedLimit(sim.s) < 999 ? sim.speedLimit(sim.s) : 0),
          light: sig ? signalState(sig, sim.tick) : null,
          steer,
          throttle,
          time: sim.tick / TICK_HZ,
          progress: Math.max(0, Math.min(1, sim.s / sim.total)),
          stage: stg ? stg.label : '',
          school: sim.schoolZoneAt(sim.s) !== null,
          rel: relRef.current,
        })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [scenario, session, finish, pause, toast])

  useEffect(() => () => {
    scene3dRef.current?.dispose()
    scene3dRef.current = null
  }, [])

  const resume = () => {
    if (session?.input_mode === 'SENSOR' && (link.status !== 'open' || performance.now() - lastSampleRef.current > 600)) return
    setPauseReason(null)
    setPhase('COUNTDOWN')
  }

  if (loadError) return <div className="page"><LoadError error={loadError} /></div>
  if (!session || !scenario) return <div className="page"><Skeleton h={560} /></div>

  const pending = sessionStorage.getItem(pendingKey(session.id))
  const lightColor = hud.light === 'RED' ? '#ef4444' : hud.light === 'YELLOW' ? '#f59e0b' : '#22c55e'

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <div className="row">
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{scenario.title}</h1>
          <span className={`badge ${session.input_mode === 'SENSOR' ? 'teal' : ''}`}>{session.input_mode === 'SENSOR' ? '🎮 센서 핸들' : '⌨️ 키보드'}</span>
          <span className="badge amber">연습 판정 · 공식 채점 아님</span>
        </div>
        <div className="row">
          <button className="btn sm ghost" onClick={() => pause('USER')} disabled={phase !== 'RUNNING'}>일시정지 (Esc)</button>
          <button className="btn sm danger" onClick={() => restart('RESTART')}>R 즉시 정지·재정렬</button>
          <button className="btn sm dark" onClick={() => finish('USER_END')} disabled={phase !== 'RUNNING' && phase !== 'PAUSED'}>주행 종료</button>
        </div>
      </div>
      <div className="drive-layout">
        <div className="stage" ref={stageRef}>
          <div className="hud">
            <div className="hud-box row" style={{ gap: 14 }}>
              <div>
                <div className="hud-speed num">{Math.round(hud.speed)}<small>km/h</small></div>
                <div className="tiny" style={{ color: '#94a3b8', marginTop: 4 }}>{hud.throttle === 1 ? '전진' : hud.throttle === -1 ? '후진' : '정지(제동)'}</div>
              </div>
              {hud.limit > 0 && <div className="hud-limit num" style={hud.speed > hud.limit ? { animation: 'spin 0s', boxShadow: '0 0 0 4px rgba(239,68,68,.6)' } : undefined}>{hud.limit}</div>}
            </div>
            <div className="hud-box" style={{ minWidth: 220 }}>
              <div className="row between tiny" style={{ color: '#94a3b8' }}><span>진행</span><span className="num">{Math.floor(hud.time / 60)}:{String(Math.floor(hud.time % 60)).padStart(2, '0')}</span></div>
              <div className="bar" style={{ background: 'rgba(255,255,255,.15)', marginTop: 6 }}><i style={{ width: `${hud.progress * 100}%`, background: '#60a5fa' }} /></div>
              <div className="tiny" style={{ marginTop: 6, color: '#cbd5e1' }}>{hud.stage ? `다음 과제: ${hud.stage}` : ''}</div>
            </div>
            {hud.light && (
              <div className="hud-box row" style={{ gap: 8 }}>
                {(['RED', 'YELLOW', 'GREEN'] as const).map((l) => (
                  <span key={l} style={{ width: 22, height: 22, borderRadius: '50%', background: hud.light === l ? lightColor : '#1f2937', boxShadow: hud.light === l ? `0 0 14px ${lightColor}` : undefined }} />
                ))}
              </div>
            )}
          </div>
          {hud.school && <div className="toast-stack" style={{ top: 96 }}><div className="toast" style={{ background: 'rgba(185,28,28,.9)' }}>어린이 보호구역 · 30km/h</div></div>}
          <div className="toast-stack" style={{ top: hud.school ? 146 : 96 }}>
            {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
          </div>
          <div className="hud-bottom">
            <div className="hud-box steer-ind">
              {(['LEFT', 'CENTER', 'RIGHT'] as const).map((l, i) => <span key={l} className={hud.steer === i - 1 ? 'on' : ''}>{l}</span>)}
            </div>
            <div className="hud-box steer-ind pedal-ind">
              <span className={hud.throttle === -1 ? 'on rev' : ''}>후진</span>
              <span className={hud.throttle === 0 ? 'on stop' : ''}>정지</span>
              <span className={hud.throttle === 1 ? 'on' : ''}>전진</span>
            </div>
          </div>

          {phase === 'COUNTDOWN' && (
            <div className="overlay"><div className="box"><div style={{ fontSize: 110, fontWeight: 900, lineHeight: 1 }}>{countdown > 0 ? countdown : 'GO'}</div><p>{session.input_mode === 'SENSOR' ? '↑를 누르고 있으면 전진합니다' : 'W를 누르고 있으면 전진합니다'}</p></div></div>
          )}
          {phase === 'PAUSED' && (
            <div className="overlay">
              <div className="box">
                {pauseReason === 'SENSOR_LOST' ? (
                  <>
                    <div style={{ fontSize: 46 }}>⚠️</div>
                    <h2>센서 신호가 끊겨 정지했습니다</h2>
                    <p>{link.message ?? '0.6초 이상 센서 데이터가 들어오지 않았습니다.'} 이전 정렬값으로 자동 재개하지 않고, 다시 정렬한 새 주행으로 시작합니다.</p>
                    <div className="row" style={{ justifyContent: 'center' }}>
                      <button className="btn lg primary" onClick={() => restart('SENSOR_LOST')}>재연결 후 다시 시작</button>
                      <button className="btn lg ghost" style={{ color: '#fff', background: 'rgba(255,255,255,.08)' }} onClick={() => { controller.set({ mode: 'KEYBOARD' }); void restart('SENSOR_LOST') }}>키보드로 새로 시작</button>
                    </div>
                    <button className="btn ghost" style={{ color: '#cbd5e1', background: 'transparent', borderColor: 'rgba(255,255,255,.2)' }} onClick={() => finish('USER_END')}>지금까지 기록 저장하고 나가기 (Esc)</button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 46 }}>⏸</div>
                    <h2>{pauseReason === 'BLUR' ? '화면을 벗어나 일시정지했습니다' : '일시정지'}</h2>
                    <p>눌려 있던 키 입력을 모두 해제했습니다. 준비되면 3초 카운트다운 후 이어서 달립니다.</p>
                    <div className="row" style={{ justifyContent: 'center' }}>
                      <button className="btn lg primary" onClick={resume}>계속 주행</button>
                      <button className="btn lg ghost" style={{ color: '#fff', background: 'rgba(255,255,255,.08)' }} onClick={() => restart('RESTART')}>R 처음부터</button>
                      <button className="btn lg ghost" style={{ color: '#fff', background: 'rgba(255,255,255,.08)' }} onClick={() => finish('USER_END')}>나가기 (Esc)</button>
                    </div>
                    <p className="small">나가면 지금까지의 주행과 사건이 ‘미완료’로 저장됩니다.</p>
                  </>
                )}
              </div>
            </div>
          )}
          {phase === 'SAVING' && (
            <div className="overlay"><div className="box"><span className="spinner" style={{ width: 36, height: 36 }} /><h2>서버가 주행을 다시 재생해 검증하는 중…</h2><p>입력 기록으로 사건을 다시 계산합니다.</p></div></div>
          )}
          {phase === 'SAVE_FAILED' && (
            <div className="overlay">
              <div className="box">
                <div style={{ fontSize: 46 }}>💾</div>
                <h2>주행 결과가 아직 저장되지 않았습니다</h2>
                <p>{saveError?.message ?? '이전에 저장하지 못한 주행 기록이 있습니다.'} 입력 기록은 이 브라우저에 보존되어 있습니다. 저장 완료 전에는 결과로 표시하지 않습니다.</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn lg primary" onClick={() => pending && save(JSON.parse(pending))}>다시 저장</button>
                  <button className="btn lg ghost" style={{ color: '#fff', background: 'rgba(255,255,255,.08)' }} onClick={() => { sessionStorage.removeItem(pendingKey(session.id)); void restart('USER_EXIT', '/drive') }}>기록 버리고 나가기</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card tight">
            <h3>조작</h3>
            <div className="stack small" style={{ marginTop: 10, gap: 8 }}>
              <div className="row between"><span><span className="kbd">{session.input_mode === 'SENSOR' ? '↑' : 'W'}</span> 전진</span><span><span className="kbd">{session.input_mode === 'SENSOR' ? '↓' : 'S'}</span> 후진</span></div>
              <div className="row between"><span>{session.input_mode === 'SENSOR' ? 'MPU-6050 좌우 기울기' : <><span className="kbd">A</span><span className="kbd">D</span> 조향</>}</span><span><span className="kbd">R</span> 즉시 정지</span></div>
              <div className="muted tiny">둘 다 누르거나 둘 다 떼면 정지(제동)</div>
            </div>
            {session.input_mode === 'SENSOR' && session.calibration && (
              <div className="tiny muted" style={{ marginTop: 10 }}>
                기울기 <b className="num">{hud.rel === null ? '—' : `${hud.rel.toFixed(1)}°`}</b> · 중앙 {session.calibration.center_deg}° · 진입 {session.calibration.enter_deg}°/복귀 {session.calibration.exit_deg}° · 평활 {session.calibration.smoothing_ms ?? 0}ms · 유지 {session.calibration.dwell_ms ?? 0}ms {session.calibration.invert && '· 반전'}
              </div>
            )}
          </div>
          <div className="card tight grow" style={{ minHeight: 200 }}>
            <div className="row between"><h3>사건 기록</h3><span className="badge">{events.filter((e) => !['STAGE_CLEAR', 'COURSE_COMPLETE'].includes(e.code)).length}건</span></div>
            {events.length === 0 ? (
              <div className="empty">아직 기록된 사건이 없습니다.</div>
            ) : (
              <div style={{ marginTop: 6, maxHeight: 360, overflowY: 'auto' }}>
                {[...events].reverse().map((e) => (
                  <div key={e.seq} className="ev">
                    <span className="t num">{(e.tick / TICK_HZ).toFixed(1)}s</span>
                    <div className="grow">
                      <div style={{ fontWeight: 700, color: DISQUALIFY_CODES.has(e.code) ? 'var(--red)' : e.code === 'COURSE_COMPLETE' || e.code === 'STAGE_CLEAR' ? 'var(--green)' : 'var(--amber)' }}>{LABEL[e.code] ?? e.code}</div>
                      <div className="tiny muted num">{e.speed_kmh}km/h · {Math.round(e.s_m)}m 지점</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {scenario.kind === 'ROAD' && (
            <div className="card tight small">
              <b>이 코스의 판정</b>
              <div className="muted tiny" style={{ marginTop: 6, lineHeight: 1.6 }}>
                사건은 기록만 하고 주행은 끝까지 계속됩니다. 신호위반·보호구역 속도·중앙선·보행자·10km/h 초과·도로 이탈은 실격 해당(연습)으로, 차로 이탈·횡단보도 일시정지·20초 미출발은 참고 감점으로 결과에 모입니다. 도로를 벗어나면 가까운 차로로 돌아옵니다.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
