import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, newKey } from '../api/client'
import type { ScenarioDetail, SessionSummary } from '../api/types'
import TiltGauge from '../components/TiltGauge'
import { LoadError, Skeleton, useAsync } from '../components/ui'
import { axisValue, controller, keyboardChecked, markKeyboardChecked, reusableCalibration, saveCalibration, tuningOf, useController, useSerialLink, type Calibration } from '../input/controller'
import { isRestartKey, isTyping } from '../input/keys'
import type { FirmwareFormat } from '../input/parser'
import { serialLink } from '../input/serialLink'
import { checkSignal, DEFAULT_SETUP, feedSample, initialSetup, PHASE_TEXT, resetSetup, resumeSetup, toggleInvert, type SetupPhase, type SetupState } from '../input/setup'
import { relativeAngle, SENSITIVITY_PRESETS, SteeringFilter, type Sensitivity, type Steer } from '../input/steering'

const ORDER: SetupPhase[] = ['CENTER_MEASURE', 'LEFT', 'CENTER_AFTER_LEFT', 'RIGHT', 'CENTER_AFTER_RIGHT', 'READY']
const STEP_LABEL: Record<string, string> = {
  CENTER_MEASURE: '중앙 3초 고정',
  LEFT: '왼쪽 확인',
  CENTER_AFTER_LEFT: '중앙 복귀',
  RIGHT: '오른쪽 확인',
  CENTER_AFTER_RIGHT: '중앙 복귀',
  READY: 'READY',
}

/** 이 탭에서 30분 안에 정렬한 값이 있으면 중앙 확인만 하고, 없거나 R 로 다시 정렬하면 처음부터 */
const startState = (full: boolean): SetupState => {
  const saved = full ? null : reusableCalibration()
  return saved ? resumeSetup(saved.center_deg) : initialSetup()
}

function SensorSetup({ onReady }: { onReady: (c: Calibration | null) => void }) {
  const link = useSerialLink()
  const ctl = useController()
  const forceFullRef = useRef(false)
  const [st, setSt] = useState<SetupState>(() => startState(false))
  const stRef = useRef(st)
  const [live, setLive] = useState<{ roll: number; pitch: number | null; format: FirmwareFormat; smoothed: number; rel: number | null } | null>(null)
  const [steer, setSteer] = useState<Steer>(0)
  const filterRef = useRef(new SteeringFilter(tuningOf(ctl)))
  const autoReconnectAttempted = useRef(false)
  const [flash, setFlash] = useState(false)

  const cfg = { ...DEFAULT_SETUP, enter: ctl.enter, exit: ctl.exit, invert: ctl.invert }
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  filterRef.current.tuning = tuningOf(ctl)

  const update = (next: SetupState) => {
    stRef.current = next
    setSt(next)
  }

  useEffect(() => {
    void serialLink.reconnectGranted()
  }, [])

  useEffect(() => {
    if (link.status === 'open' && link.hz > 0) autoReconnectAttempted.current = false
    if (link.status === 'lost' && !autoReconnectAttempted.current) {
      autoReconnectAttempted.current = true
      // lost 상태 알림 직후에는 이전 reader가 아직 잠금을 해제하는 중일 수 있다.
      // 닫기가 끝난 뒤 재시도해 "포트가 이미 열려 있음" 경합을 피한다.
      const timer = window.setTimeout(() => void serialLink.reconnectGranted(), 750)
      return () => window.clearTimeout(timer)
    }
  }, [link.status])

  useEffect(() => {
    let lastUi = 0
    const off = serialLink.onSample((s) => {
      const value = axisValue(s, controller.get().axis)
      if (value === null) return
      const f = filterRef.current
      const smoothed = f.smooth(value, s.at)
      const prevPhase = stRef.current.phase
      // 중앙 측정과 좌우 확인도 평활값으로 해 손떨림에 덜 흔들리게 한다
      const next = feedSample(stRef.current, smoothed, s.at, cfgRef.current)
      stRef.current = next
      let rel: number | null = null
      if (next.center !== null) {
        rel = relativeAngle(smoothed, next.center, cfgRef.current.invert)
        f.decide(rel, s.at)
      }
      if (s.at - lastUi > 40 || next.phase !== prevPhase) {
        lastUi = s.at
        setSt(next)
        setLive({ roll: s.roll, pitch: s.pitch, format: s.format, smoothed, rel })
        setSteer(f.current)
      }
    })
    const timer = window.setInterval(() => {
      const next = checkSignal(stRef.current, performance.now(), cfgRef.current)
      if (next !== stRef.current) {
        filterRef.current.reset()
        update(next.phase === 'NO_SIGNAL' ? startState(forceFullRef.current) : next)
      }
    }, 200)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [])

  const restart = useCallback(() => {
    forceFullRef.current = true
    filterRef.current.reset()
    setSteer(0)
    update(resetSetup(stRef.current))
    setFlash(true)
    window.setTimeout(() => setFlash(false), 500)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isRestartKey(e)) {
        e.preventDefault()
        restart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restart])

  useEffect(() => {
    if (st.phase === 'READY' && st.center !== null && live) {
      const cal: Calibration = {
        center_deg: Math.round(st.center * 100) / 100,
        invert: ctl.invert,
        enter_deg: ctl.enter,
        exit_deg: ctl.exit,
        smoothing_ms: ctl.smoothingMs,
        dwell_ms: ctl.dwellMs,
        stable_spread_deg: Math.min(10, Math.round(st.spread * 100) / 100),
        left_confirmed: st.leftConfirmed,
        right_confirmed: st.rightConfirmed,
        sample_hz: link.hz || null,
        firmware_format: live.format,
        steering_axis: ctl.axis,
      }
      saveCalibration(cal)
      onReady(cal)
    } else onReady(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.phase, ctl.invert, ctl.enter, ctl.exit, ctl.smoothingMs, ctl.dwellMs, ctl.axis])

  // 민감도는 중앙값과 무관하므로 정렬을 다시 하지 않고 바로 적용한다
  const choosePreset = (p: Sensitivity) => {
    const { enter, exit, smoothingMs, dwellMs } = SENSITIVITY_PRESETS[p]
    controller.set({ sensitivity: p, enter, exit, smoothingMs, dwellMs })
  }
  const setCustom = (patch: Partial<{ enter: number; exit: number; smoothingMs: number; dwellMs: number }>) => {
    controller.set({ sensitivity: 'CUSTOM', ...patch })
  }

  const saved = forceFullRef.current ? null : reusableCalibration()
  const resumed = saved !== null && st.leftConfirmed && st.rightConfirmed && (st.phase === 'CENTER_AFTER_RIGHT' || st.phase === 'READY')
  const connected = link.status === 'open'
  const phaseIdx = ORDER.indexOf(st.phase)
  const ready = st.phase === 'READY'

  return (
    <div className="grid side">
      <div className="card stack lg" style={{ padding: 28 }}>
        {!connected ? (
          <div className="stack lg center" style={{ padding: '30px 0' }}>
            <div style={{ fontSize: 54 }}>🔌</div>
            <h2 style={{ fontSize: 26 }}>센서 핸들을 연결하세요</h2>
            <p className="muted" style={{ lineHeight: 1.7 }}>
              아두이노(MPU-6050)를 USB로 연결하고 아래 버튼을 눌러 포트를 선택합니다.
              <br />
              115200bps · <code>WME,t,roll,pitch,yaw</code> 또는 <code>roll,pitch</code> 형식을 자동 인식합니다.
            </p>
            {link.message && <div className={`notice ${link.status === 'error' || link.status === 'lost' ? 'red' : ''}`} style={{ textAlign: 'left' }}>{link.message}</div>}
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn lg primary" onClick={() => serialLink.connect()} disabled={link.status === 'unsupported' || link.status === 'requesting' || link.status === 'opening'}>
                {link.status === 'opening' ? <span className="spinner" /> : '센서 연결'}
              </button>
              <button className="btn lg ghost" onClick={() => controller.set({ mode: 'KEYBOARD' })}>키보드로 진행</button>
            </div>
          </div>
        ) : (
          <>
            <div className="row between wrap">
              <div className="row">
                <span className="badge teal"><span className="dot" /> 연결됨 · {link.hz}Hz</span>
                {link.portLabel && <span className="badge">{link.portLabel}</span>}
                {live && <span className="badge">{live.format}</span>}
                {link.invalidLines > 0 && <span className="badge amber">해석 불가 줄 {link.invalidLines}</span>}
              </div>
              <button className="btn sm ghost" onClick={() => serialLink.disconnect()}>연결 해제</button>
            </div>
            {link.boardInfo && <div className="notice small">보드: {link.boardInfo}</div>}
            {resumed && saved && (
              <div className="notice green small">
                <div className="grow">
                  <b>이전 정렬을 이어서 씁니다.</b> 중앙 {saved.center_deg}° · {Math.max(1, Math.round(saved.age_ms / 60000))}분 전 정렬. 핸들을 가운데로 두면 바로 READY 가 됩니다.
                </div>
                <button className="btn sm ghost" onClick={restart}>처음부터 다시 정렬</button>
              </div>
            )}
            <div className="center" style={{ transition: 'background .3s', background: flash ? '#fee2e2' : 'transparent', borderRadius: 16, padding: '6px 0' }}>
              <div className={`big-state ${ready ? 'ready' : st.phase === 'CENTER_MEASURE' || st.phase === 'NO_SIGNAL' ? 'stop' : ''}`}>
                {ready ? 'READY' : st.phase === 'CENTER_MEASURE' || st.phase === 'NO_SIGNAL' ? 'CENTER / STOP' : PHASE_TEXT[st.phase].title}
              </div>
              <p className="muted" style={{ marginTop: 6, fontSize: 17 }}>{PHASE_TEXT[st.phase].hint}</p>
            </div>
            <div className="gauge-wrap">
              <TiltGauge rel={st.phase === 'CENTER_MEASURE' ? null : live?.rel ?? null} enter={ctl.enter} exit={ctl.exit} steer={st.center === null ? 0 : steer} size={380} />
            </div>
            {st.phase !== 'READY' && st.phase !== 'NO_SIGNAL' && (
              <div>
                <div className="row between small muted"><span>{STEP_LABEL[st.phase]}</span><span className="num">{Math.round(st.progress * 100)}%</span></div>
                <div className="bar" style={{ marginTop: 6, height: 10 }}><i style={{ width: `${st.progress * 100}%`, background: st.phase === 'CENTER_MEASURE' ? 'var(--teal)' : 'var(--primary)' }} /></div>
                {st.phase === 'CENTER_MEASURE' && <p className="tiny muted" style={{ marginTop: 6 }}>흔들림 {st.spread.toFixed(1)}° (허용 {DEFAULT_SETUP.stableSpread}° 이내) — 움직이면 3초를 다시 셉니다.</p>}
              </div>
            )}
            {st.wrongDirection && (
              <div className="notice amber">
                <div className="grow"><b>반대 방향으로 기울어진 것 같습니다.</b> 센서 장착 방향이 반대라면 방향을 반전하세요. 중앙값은 유지하고 좌 확인부터 다시 합니다.</div>
                <button className="btn sm dark" onClick={() => { controller.set({ invert: !ctl.invert }); update(toggleInvert(stRef.current)) }}>방향 반전</button>
              </div>
            )}
            <div className="row between wrap small">
              <span className="muted">
                원시 roll <b className="num">{live ? live.roll.toFixed(1) : '—'}°</b> → 보정 <b className="num">{live ? live.smoothed.toFixed(1) : '—'}°</b>
                {st.center !== null && <> · 중앙 <b className="num">{st.center.toFixed(1)}°</b></>}
              </span>
              <div className="row">
                <button className="btn sm ghost" onClick={() => { controller.set({ invert: !ctl.invert }); update(toggleInvert(stRef.current)) }}>
                  좌우 반전 {ctl.invert ? 'ON' : 'OFF'}
                </button>
                <button className="btn sm danger" onClick={restart}>R 다시 정렬</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="stack lg">
        <div className="card">
          <h3>조향 민감도</h3>
          <p className="tiny muted" style={{ marginTop: 4 }}>센서값이 너무 쉽게 바뀌면 둔감으로 낮추세요. 정렬은 유지한 채 바로 적용됩니다.</p>
          <div className="seg" style={{ marginTop: 12, display: 'flex' }}>
            {(['LOW', 'NORMAL', 'HIGH'] as const).map((p) => (
              <button key={p} className={ctl.sensitivity === p ? 'on' : ''} style={{ flex: 1 }} onClick={() => choosePreset(p)}>
                {SENSITIVITY_PRESETS[p].label}
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {ctl.sensitivity === 'CUSTOM' ? '직접 조정한 값' : SENSITIVITY_PRESETS[ctl.sensitivity].hint} · 진입 {ctl.enter}° / 복귀 {ctl.exit}° · 평활 {ctl.smoothingMs}ms · 유지 {ctl.dwellMs}ms
          </p>
        </div>
        <div className="card">
          <h3>정렬 순서</h3>
          <div className="setup-steps" style={{ marginTop: 12 }}>
            {ORDER.map((p, i) => (
              <div key={p} className={`setup-step ${i === phaseIdx ? 'now' : i < phaseIdx ? 'done' : ''}`}>
                <span className="ic">{i < phaseIdx ? '✓' : i + 1}</span>
                {STEP_LABEL[p]}
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 12, lineHeight: 1.6 }}>
            앞뒤 기울기(가속)는 사용하지 않습니다. 센서 모드의 전진·후진은 방향키 위·아래로 조작합니다. 정렬값은 새로고침·재연결 뒤 다시 측정합니다.
          </p>
        </div>
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 750 }}>세부 조정 (실측으로 맞추기)</summary>
          <div className="stack" style={{ marginTop: 14 }}>
            <label className="small">진입 각도 <b className="num">{ctl.enter}°</b> <span className="muted">— 이만큼 기울여야 LEFT/RIGHT</span>
              <input type="range" min={8} max={25} value={ctl.enter} onChange={(e) => { const enter = Number(e.target.value); setCustom({ enter, exit: Math.min(ctl.exit, enter - 2) }) }} style={{ width: '100%' }} />
            </label>
            <label className="small">복귀 각도 <b className="num">{ctl.exit}°</b> <span className="muted">— 이 안으로 돌아오면 CENTER</span>
              <input type="range" min={3} max={ctl.enter - 2} value={ctl.exit} onChange={(e) => setCustom({ exit: Number(e.target.value) })} style={{ width: '100%' }} />
            </label>
            <label className="small">평활 시간 <b className="num">{ctl.smoothingMs}ms</b> <span className="muted">— 클수록 떨림이 줄고 반응이 느려짐</span>
              <input type="range" min={0} max={400} step={10} value={ctl.smoothingMs} onChange={(e) => setCustom({ smoothingMs: Number(e.target.value) })} style={{ width: '100%' }} />
            </label>
            <label className="small">유지 시간 <b className="num">{ctl.dwellMs}ms</b> <span className="muted">— 방향이 이만큼 유지돼야 꺾임</span>
              <input type="range" min={0} max={400} step={10} value={ctl.dwellMs} onChange={(e) => setCustom({ dwellMs: Number(e.target.value) })} style={{ width: '100%' }} />
            </label>
            <div className="small">조향 축
              <div className="seg" style={{ marginTop: 6 }}>
                {(['ROLL', 'PITCH'] as const).map((a) => (
                  <button key={a} className={ctl.axis === a ? 'on' : ''} onClick={() => { controller.set({ axis: a }); restart() }}>{a === 'ROLL' ? 'roll (기본)' : 'pitch (센서를 90° 돌려 장착한 경우)'}</button>
                ))}
              </div>
            </div>
            <p className="tiny muted">프리셋 값은 초기 제안값입니다. 실제 핸들로 좌우를 여러 번 확인한 뒤 확정합니다.</p>
          </div>
        </details>
      </div>
    </div>
  )
}

function KeyboardSetup({ onReady }: { onReady: (ok: boolean) => void }) {
  // 이 탭에서 이미 확인했다면 다시 누르게 하지 않는다. R 로만 다시 확인한다.
  const [prechecked, setPrechecked] = useState(keyboardChecked)
  const all = { left: true, right: true, forward: true, reverse: true }
  const none = { left: false, right: false, forward: false, reverse: false }
  const [seen, setSeen] = useState(() => (keyboardChecked() ? all : none))
  const [flash, setFlash] = useState(false)
  const ok = seen.left && seen.right && seen.forward && seen.reverse

  useEffect(() => {
    if (ok) markKeyboardChecked(true)
    onReady(ok)
  }, [ok, onReady])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if (isRestartKey(e)) {
        markKeyboardChecked(false)
        setPrechecked(false)
        setSeen({ left: false, right: false, forward: false, reverse: false })
        setFlash(true)
        window.setTimeout(() => setFlash(false), 400)
        return
      }
      if (e.code === 'KeyW') { e.preventDefault(); setSeen((s) => ({ ...s, forward: true })) }
      if (e.code === 'KeyS') { e.preventDefault(); setSeen((s) => ({ ...s, reverse: true })) }
      if (e.code === 'KeyA') setSeen((s) => ({ ...s, left: true }))
      if (e.code === 'KeyD') setSeen((s) => ({ ...s, right: true }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const Key = ({ on, k, label }: { on: boolean; k: string; label: string }) => (
    <div className="card flat center" style={{ borderColor: on ? 'var(--green)' : undefined, background: on ? 'var(--green-soft)' : undefined, transition: 'all .2s' }}>
      <span className="kbd" style={{ fontSize: 18, height: 40, minWidth: 64 }}>{k}</span>
      <div style={{ marginTop: 10, fontWeight: 750 }}>{label}</div>
      <div className="tiny" style={{ color: on ? 'var(--green)' : 'var(--ink-3)', marginTop: 4 }}>{on ? '✓ 확인됨' : '눌러 보세요'}</div>
    </div>
  )

  return (
    <div className="card stack lg" style={{ padding: 28, background: flash ? '#fee2e2' : undefined, transition: 'background .3s' }}>
      <div className="center">
        <div className={`big-state ${ok ? 'ready' : 'stop'}`}>{ok ? 'READY' : 'CENTER / STOP'}</div>
        <p className="muted" style={{ marginTop: 6 }}>
          {prechecked ? '이번 접속에서 이미 키 입력을 확인했습니다. 바로 시작하세요.' : '네 가지 키를 한 번씩 눌러 입력을 확인하세요.'} <span className="kbd">R</span> 은 확인을 처음부터 다시 합니다.
        </p>
      </div>
      <div className="grid c4">
        <Key on={seen.left} k="A" label="왼쪽 조향" />
        <Key on={seen.right} k="D" label="오른쪽 조향" />
        <Key on={seen.forward} k="W" label="전진" />
        <Key on={seen.reverse} k="S" label="후진" />
      </div>
      <p className="tiny muted center">A·D 동시 입력은 중앙, W·S 동시 입력 또는 둘 다 떼면 정지합니다.</p>
    </div>
  )
}

export default function DriveSetup() {
  const { scenarioId } = useParams()
  const nav = useNavigate()
  const ctl = useController()
  const scenario = useAsync(() => api<ScenarioDetail>('GET', `/scenarios/${scenarioId}`), [scenarioId])
  const [calibration, setCalibration] = useState<Calibration | null>(null)
  const [keyboardOk, setKeyboardOk] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const canStart = ctl.mode === 'SENSOR' ? calibration !== null : keyboardOk

  const start = useCallback(async () => {
    if (!canStart || starting) return
    setStarting(true)
    setError(null)
    try {
      const body = { scenario_id: scenarioId, input_mode: ctl.mode, calibration: ctl.mode === 'SENSOR' ? calibration : null }
      const s = await api<SessionSummary>('POST', '/training/sessions', body, { idempotencyKey: newKey() })
      controller.set({ calibration: ctl.mode === 'SENSOR' ? calibration : null })
      nav(`/drive/session/${s.id}`)
    } catch (e) {
      setError(e as ApiError)
      setStarting(false)
    }
  }, [canStart, starting, scenarioId, ctl.mode, calibration, nav])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isTyping(e)) void start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [start])

  const onKeyboardReady = useCallback((ok: boolean) => setKeyboardOk(ok), [])

  if (scenario.error) return <div className="page"><LoadError error={scenario.error} onRetry={scenario.reload} /></div>
  if (!scenario.data) return <div className="page"><Skeleton h={480} /></div>

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="eyebrow">{scenario.data.title} · 출발 전 점검</div>
          <h1>{ctl.mode === 'SENSOR' ? '센서 핸들 정렬' : '키보드 입력 확인'}</h1>
          <p>READY 전에는 출발하지 못합니다. <span className="kbd">R</span> 을 누르면 언제든 처음부터 다시 합니다.</p>
        </div>
        <div className="row">
          <div className="seg">
            <button className={ctl.mode === 'SENSOR' ? 'on' : ''} onClick={() => controller.set({ mode: 'SENSOR' })}>🎮 센서</button>
            <button className={ctl.mode === 'KEYBOARD' ? 'on' : ''} onClick={() => controller.set({ mode: 'KEYBOARD' })}>⌨️ 키보드</button>
          </div>
          <Link to="/drive" className="btn ghost">코스 변경</Link>
        </div>
      </div>

      {ctl.mode === 'SENSOR' ? <SensorSetup onReady={setCalibration} /> : <KeyboardSetup onReady={onKeyboardReady} />}

      {error && <div className="notice red" style={{ marginTop: 16 }}>{error.message}</div>}
      <div className="card row between wrap" style={{ marginTop: 18, position: 'sticky', bottom: 16, zIndex: 5 }}>
        <div className="small">
          {canStart ? <b style={{ color: 'var(--green)' }}>준비 완료 — Enter 또는 시작 버튼</b> : <span className="muted">정렬(확인)을 끝내면 시작 버튼이 켜집니다.</span>}
          {scenario.data.kind === 'ROAD' && <div className="tiny muted">연습 판정 {scenario.data.practice_rules.length}항목 · {scenario.data.scoring_notice}</div>}
        </div>
        <button className="btn lg primary" disabled={!canStart || starting} onClick={start}>
          {starting ? <span className="spinner" /> : '주행 시작'}
        </button>
      </div>
    </div>
  )
}
