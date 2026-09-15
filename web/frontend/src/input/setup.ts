// 센서 정렬(보정) 상태 기계. 순수 함수라 테스트로 검증한다.
// 중앙 3초 안정 → 좌 확인 → 중앙 복귀 → 우 확인 → 중앙 복귀 → READY
// R(리셋)은 언제든 중앙 측정부터 다시 시작하며 READY 로 표시하지 않는다.
import { relativeAngle } from './steering'

export type SetupPhase =
  | 'NO_SIGNAL'
  | 'CENTER_MEASURE'
  | 'LEFT'
  | 'CENTER_AFTER_LEFT'
  | 'RIGHT'
  | 'CENTER_AFTER_RIGHT'
  | 'READY'

export interface SetupConfig {
  enter: number
  exit: number
  invert: boolean
  stableSeconds: number
  stableSpread: number
  holdSeconds: number
  signalTimeoutMs: number
}

export const DEFAULT_SETUP: SetupConfig = {
  enter: 12,
  exit: 7,
  invert: false,
  stableSeconds: 3,
  stableSpread: 3,
  holdSeconds: 0.4,
  signalTimeoutMs: 600,
}

export interface SetupState {
  phase: SetupPhase
  center: number | null
  window: { t: number; v: number }[]
  spread: number
  holdSince: number | null
  wrongSince: number | null
  wrongDirection: boolean
  progress: number
  lastSampleAt: number | null
  lastRel: number | null
  leftConfirmed: boolean
  rightConfirmed: boolean
}

export function initialSetup(): SetupState {
  return {
    phase: 'NO_SIGNAL',
    center: null,
    window: [],
    spread: 0,
    holdSince: null,
    wrongSince: null,
    wrongDirection: false,
    progress: 0,
    lastSampleAt: null,
    lastRel: null,
    leftConfirmed: false,
    rightConfirmed: false,
  }
}

/** R: 정렬을 처음부터. 신호가 살아 있으면 중앙 측정 단계로 */
export function resetSetup(s: SetupState): SetupState {
  return { ...initialSetup(), phase: s.lastSampleAt === null ? 'NO_SIGNAL' : 'CENTER_MEASURE', lastSampleAt: s.lastSampleAt }
}

/** 저장된 중앙값으로 이어서 시작: 좌우 확인은 끝난 것으로 보고 중앙 복귀(0.4초)만 확인한다 */
export function resumeSetup(center: number): SetupState {
  return { ...initialSetup(), phase: 'CENTER_AFTER_RIGHT', center, leftConfirmed: true, rightConfirmed: true }
}

export function checkSignal(s: SetupState, now: number, cfg: SetupConfig): SetupState {
  if (s.lastSampleAt !== null && now - s.lastSampleAt > cfg.signalTimeoutMs && s.phase !== 'NO_SIGNAL') {
    return { ...initialSetup() }
  }
  return s
}

/** 방향 반전: 좌/우 의미가 바뀌므로 중앙은 유지하고 좌 확인부터 다시 */
export function toggleInvert(s: SetupState): SetupState {
  if (s.center === null) return { ...s, wrongDirection: false, wrongSince: null }
  return { ...s, phase: 'LEFT', holdSince: null, wrongSince: null, wrongDirection: false, progress: 0, leftConfirmed: false, rightConfirmed: false }
}

export function feedSample(prev: SetupState, value: number, now: number, cfg: SetupConfig): SetupState {
  let s: SetupState = { ...prev, lastSampleAt: now }
  if (s.phase === 'NO_SIGNAL') s = { ...s, phase: 'CENTER_MEASURE', window: [] }

  if (s.phase === 'CENTER_MEASURE') {
    let win = [...s.window, { t: now, v: value }].filter((p) => now - p.t <= cfg.stableSeconds * 1000)
    let min = Infinity
    let max = -Infinity
    for (const p of win) {
      if (p.v < min) min = p.v
      if (p.v > max) max = p.v
    }
    let spread = max - min
    if (spread > cfg.stableSpread) {
      win = [{ t: now, v: value }]
      spread = 0
    }
    const elapsed = (now - win[0].t) / 1000
    const progress = Math.min(1, elapsed / cfg.stableSeconds)
    if (elapsed >= cfg.stableSeconds * 0.98 && win.length >= 5) {
      const center = win.reduce((a, p) => a + p.v, 0) / win.length
      return { ...s, window: [], spread, center, phase: 'LEFT', progress: 0, holdSince: null, lastRel: 0 }
    }
    return { ...s, window: win, spread, progress }
  }

  const center = s.center ?? value
  const rel = relativeAngle(value, center, cfg.invert)
  s = { ...s, lastRel: rel }
  const hold = cfg.holdSeconds * 1000

  const confirmTilt = (dir: -1 | 1, next: SetupPhase, mark: 'leftConfirmed' | 'rightConfirmed'): SetupState => {
    const toward = dir * rel
    const progress = Math.max(0, Math.min(1, toward / cfg.enter))
    if (toward >= cfg.enter) {
      const since = s.holdSince ?? now
      if (now - since >= hold) {
        return { ...s, phase: next, holdSince: null, wrongSince: null, wrongDirection: false, progress: 0, [mark]: true }
      }
      return { ...s, holdSince: since, wrongSince: null, progress }
    }
    if (-toward >= cfg.enter) {
      const since = s.wrongSince ?? now
      return { ...s, holdSince: null, wrongSince: since, wrongDirection: s.wrongDirection || now - since >= hold, progress: 0 }
    }
    return { ...s, holdSince: null, wrongSince: null, progress }
  }

  const confirmCenter = (next: SetupPhase): SetupState => {
    if (Math.abs(rel) < cfg.exit) {
      const since = s.holdSince ?? now
      if (now - since >= hold) return { ...s, phase: next, holdSince: null, progress: 0 }
      return { ...s, holdSince: since, progress: Math.min(1, (now - since) / hold) }
    }
    return { ...s, holdSince: null, progress: 0 }
  }

  switch (s.phase) {
    case 'LEFT':
      return confirmTilt(-1, 'CENTER_AFTER_LEFT', 'leftConfirmed')
    case 'CENTER_AFTER_LEFT':
      return confirmCenter('RIGHT')
    case 'RIGHT':
      return confirmTilt(1, 'CENTER_AFTER_RIGHT', 'rightConfirmed')
    case 'CENTER_AFTER_RIGHT':
      return confirmCenter('READY')
    default:
      return s
  }
}

export const PHASE_TEXT: Record<SetupPhase, { title: string; hint: string }> = {
  NO_SIGNAL: { title: '센서 신호 대기', hint: '센서를 연결하면 자동으로 중앙 측정을 시작합니다.' },
  CENTER_MEASURE: { title: '중앙 고정', hint: '핸들을 수평으로 잡고 3초간 움직이지 마세요.' },
  LEFT: { title: '왼쪽으로 기울이기', hint: '핸들을 왼쪽으로 끝까지 기울이고 잠시 유지하세요.' },
  CENTER_AFTER_LEFT: { title: '중앙으로 복귀', hint: '다시 수평으로 돌아오세요.' },
  RIGHT: { title: '오른쪽으로 기울이기', hint: '핸들을 오른쪽으로 끝까지 기울이고 잠시 유지하세요.' },
  CENTER_AFTER_RIGHT: { title: '중앙으로 복귀', hint: '다시 수평으로 돌아오면 준비가 끝납니다.' },
  READY: { title: 'READY', hint: '정렬 완료. 시작 버튼을 누르거나 Enter 를 누르세요.' },
}
