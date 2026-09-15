// 입력 장치 선택과 정렬 결과를 화면 사이에서 공유한다.
import { useSyncExternalStore } from 'react'
import type { FirmwareFormat } from './parser'
import { serialLink, type LinkSnapshot } from './serialLink'
import { DEFAULT_TUNING, type SensorTuning, type Sensitivity } from './steering'

export type InputMode = 'KEYBOARD' | 'SENSOR'
export type SteeringAxis = 'ROLL' | 'PITCH'

export interface Calibration {
  center_deg: number
  invert: boolean
  enter_deg: number
  exit_deg: number
  smoothing_ms: number
  dwell_ms: number
  stable_spread_deg: number
  left_confirmed: boolean
  right_confirmed: boolean
  sample_hz: number | null
  firmware_format: FirmwareFormat
  steering_axis: SteeringAxis
}

interface ControllerState extends SensorTuning {
  mode: InputMode
  calibration: Calibration | null
  invert: boolean
  axis: SteeringAxis
  sensitivity: Sensitivity | 'CUSTOM'
}

const KEY = 'lf.controller.prefs'
// v2: 민감도 보정(평활·유지 시간) 도입. 이전 12°/7° 저장값은 버리고 '보통'으로 시작한다.
const PREFS_VERSION = 2

function loadPrefs(): Partial<ControllerState> {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (p.v !== PREFS_VERSION) return { mode: p.mode, invert: p.invert, axis: p.axis }
    return p
  } catch {
    return {}
  }
}

let state: ControllerState = {
  mode: 'KEYBOARD',
  calibration: null,
  invert: false,
  axis: 'ROLL',
  sensitivity: 'NORMAL',
  ...DEFAULT_TUNING,
}
state = { ...state, ...Object.fromEntries(Object.entries(loadPrefs()).filter(([, v]) => v !== undefined)) }
// 정렬값은 새로고침·재연결 뒤 재사용하지 않는다(매번 다시 정렬)
state.calibration = null

const listeners = new Set<() => void>()

export const controller = {
  get: () => state,
  set(patch: Partial<ControllerState>) {
    state = { ...state, ...patch }
    try {
      const { mode, invert, axis, sensitivity, enter, exit, smoothingMs, dwellMs } = state
      localStorage.setItem(KEY, JSON.stringify({ v: PREFS_VERSION, mode, invert, axis, sensitivity, enter, exit, smoothingMs, dwellMs }))
    } catch {
      /* 저장 불가 환경 */
    }
    listeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

// 정렬·키 확인은 브라우저 탭 단위로 기억한다. 탭을 닫거나 30분이 지나면 다시 한다.
const CAL_KEY = 'lf.calibration'
const KB_KEY = 'lf.keyboardChecked'
const CAL_TTL_MS = 30 * 60 * 1000

export function saveCalibration(cal: Calibration) {
  try {
    sessionStorage.setItem(CAL_KEY, JSON.stringify({ cal, at: Date.now() }))
  } catch {
    /* 저장 불가 환경 */
  }
}

export function clearCalibration() {
  try {
    sessionStorage.removeItem(CAL_KEY)
  } catch {
    /* 저장 불가 환경 */
  }
}

/** 같은 축·방향으로 30분 안에 정렬한 값이 있으면 돌려준다 */
export function reusableCalibration(): (Calibration & { age_ms: number }) | null {
  try {
    const raw = sessionStorage.getItem(CAL_KEY)
    if (!raw) return null
    const { cal, at } = JSON.parse(raw) as { cal: Calibration; at: number }
    const age = Date.now() - at
    if (age > CAL_TTL_MS || cal.steering_axis !== state.axis || cal.invert !== state.invert) return null
    return { ...cal, age_ms: age }
  } catch {
    return null
  }
}

export const keyboardChecked = () => {
  try {
    return sessionStorage.getItem(KB_KEY) === '1'
  } catch {
    return false
  }
}

export function markKeyboardChecked(ok: boolean) {
  try {
    if (ok) sessionStorage.setItem(KB_KEY, '1')
    else sessionStorage.removeItem(KB_KEY)
  } catch {
    /* 저장 불가 환경 */
  }
}

export const tuningOf =(s: SensorTuning): SensorTuning => ({ enter: s.enter, exit: s.exit, smoothingMs: s.smoothingMs, dwellMs: s.dwellMs })

export function useController() {
  return useSyncExternalStore(controller.subscribe, controller.get)
}

export function useSerialLink(): LinkSnapshot {
  return useSyncExternalStore(
    (fn) => serialLink.subscribe(fn),
    () => serialLink.snapshot,
  )
}

export function axisValue(sample: { roll: number; pitch: number | null }, axis: SteeringAxis): number | null {
  return axis === 'ROLL' ? sample.roll : sample.pitch
}
