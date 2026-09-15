// 기울기 → LEFT(-1) / CENTER(0) / RIGHT(1).
// MPU-6050 roll 은 가속도로 계산해 손떨림·충격에 그대로 흔들린다. 그래서
//  1) 한 샘플만 크게 튀는 값은 버리고
//  2) 시간 상수(smoothingMs) 지수 평활로 잡음을 줄이고
//  3) 히스테리시스(진입/복귀 각도)로 경계 떨림을 막고
//  4) 새 방향이 dwellMs 동안 유지될 때만 조향을 바꾼다.
export type Steer = -1 | 0 | 1
export type Throttle = -1 | 0 | 1
export type Sensitivity = 'LOW' | 'NORMAL' | 'HIGH'

export interface SensorTuning {
  enter: number
  exit: number
  smoothingMs: number
  dwellMs: number
}

export const SENSITIVITY_PRESETS: Record<Sensitivity, SensorTuning & { label: string; hint: string }> = {
  LOW: { label: '둔감', hint: '크게 기울여야 꺾입니다. 손떨림이 심할 때', enter: 18, exit: 10, smoothingMs: 220, dwellMs: 180 },
  NORMAL: { label: '보통', hint: '기본값', enter: 15, exit: 8, smoothingMs: 150, dwellMs: 120 },
  HIGH: { label: '민감', hint: '조금만 기울여도 꺾입니다', enter: 11, exit: 6, smoothingMs: 80, dwellMs: 60 },
}

export const DEFAULT_TUNING: SensorTuning = {
  enter: SENSITIVITY_PRESETS.NORMAL.enter,
  exit: SENSITIVITY_PRESETS.NORMAL.exit,
  smoothingMs: SENSITIVITY_PRESETS.NORMAL.smoothingMs,
  dwellMs: SENSITIVITY_PRESETS.NORMAL.dwellMs,
}
export const DEFAULT_ENTER = DEFAULT_TUNING.enter
export const DEFAULT_EXIT = DEFAULT_TUNING.exit

/** 한 샘플 사이에 이보다 크게 바뀌면 충격으로 보고 한 번은 무시한다 */
const SPIKE_DEG = 30

export function relativeAngle(raw: number, center: number, invert: boolean): number {
  return (invert ? -1 : 1) * (raw - center)
}

export function nextSteer(prev: Steer, rel: number, enter: number, exit: number): Steer {
  if (prev === 0) {
    if (rel <= -enter) return -1
    if (rel >= enter) return 1
    return 0
  }
  if (prev === -1) {
    if (rel >= enter) return 1
    if (rel > -exit) return 0
    return -1
  }
  if (rel <= -enter) return -1
  if (rel < exit) return 0
  return 1
}

export class SteeringFilter {
  tuning: SensorTuning
  private value: number | null = null
  private lastAt = 0
  private spike: number | null = null
  private lastSpikeAt = -Infinity
  private steer: Steer = 0
  private pending: Steer = 0
  private pendingSince = 0

  constructor(tuning: SensorTuning) {
    this.tuning = tuning
  }

  reset() {
    this.value = null
    this.spike = null
    this.lastSpikeAt = -Infinity
    this.steer = 0
    this.pending = 0
    this.pendingSince = 0
  }

  get current(): Steer {
    return this.steer
  }

  /** 원시 각도 → 평활 각도 */
  smooth(raw: number, at: number): number {
    if (this.value === null) {
      this.value = raw
      this.lastAt = at
      return raw
    }
    const dt = Math.max(0, at - this.lastAt)
    this.lastAt = at
    const isolated = at - this.lastSpikeAt > 100
    if (isolated && Math.abs(raw - this.value) > SPIKE_DEG && (this.spike === null || Math.abs(raw - this.spike) > SPIKE_DEG / 2)) {
      // 고립된 한 샘플짜리 튐만 버린다(100ms 에 한 번까지). 연속된 큰 흔들림은 평활로 처리한다.
      this.spike = raw
      this.lastSpikeAt = at
      return this.value
    }
    this.spike = null
    const tau = this.tuning.smoothingMs
    const alpha = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau)
    this.value += alpha * (raw - this.value)
    return this.value
  }

  /** 중앙 기준 상대 각도 → 조향. 중앙 복귀는 안전을 위해 절반 시간만 기다린다. */
  decide(rel: number, at: number): Steer {
    const cand = nextSteer(this.steer, rel, this.tuning.enter, this.tuning.exit)
    if (cand === this.steer) {
      this.pending = cand
      return this.steer
    }
    if (cand !== this.pending) {
      this.pending = cand
      this.pendingSince = at
    }
    const need = cand === 0 ? this.tuning.dwellMs / 2 : this.tuning.dwellMs
    if (at - this.pendingSince >= need) this.steer = cand
    return this.steer
  }
}

/** 모드별 전진/후진 키를 공통 엔진 입력으로 변환. 둘 다/둘 다 없음=정지. */
export function throttleFromKeys(forward: boolean, reverse: boolean): Throttle {
  if (forward === reverse) return 0
  return forward ? 1 : -1
}

/** A=좌, D=우, 동시 입력=중앙 */
export function steerFromKeys(left: boolean, right: boolean): Steer {
  if (left === right) return 0
  return left ? -1 : 1
}

export const steerLabel = (s: Steer) => (s === -1 ? 'LEFT' : s === 1 ? 'RIGHT' : 'CENTER')
