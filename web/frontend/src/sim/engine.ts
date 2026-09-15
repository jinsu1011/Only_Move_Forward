// 결정적 주행 시뮬레이션 sim-1.0.0 — 서버 web/backend/app/sim.py 와 한 줄씩 대응한다.
// 서버가 같은 입력 기록을 재생해 사건을 확정하므로, 수식·순서·반올림을 바꾸면 양쪽을 함께 바꾼다.
export const SIM_VERSION = 'sim-1.0.0'
export const TICK_HZ = 30

export const PHYS = {
  accel: 2.8,
  brake: 6.0,
  maxFwd: 16.7,
  maxRev: 3.0,
  steerRate: 2.2,
  maxSteer: 0.55,
  wheelbase: 2.6,
  halfLen: 2.2,
  halfWidth: 0.9,
}

export const DISQUALIFY_CODES = new Set([
  'SIGNAL_RED',
  'SCHOOL_ZONE_SPEEDING',
  'SPEEDING',
  'CENTER_LINE',
  'OFF_ROAD',
  'PEDESTRIAN_CONFLICT',
])

export interface Zone { from: number; to: number; limit_kmh: number; id?: string }
export interface SignalDef {
  id: string; stop_s: number; crosswalk_from: number; crosswalk_to: number
  intersection_from: number; intersection_to: number
  green: number; yellow: number; red: number; offset: number
}
export interface CrosswalkDef { id: string; from: number; to: number; ped_period: number; ped_from: number; ped_to: number }
export interface StageDef { type: 'STOP_IN' | 'REVERSE_STOP_IN'; from: number; to: number; label: string }
export interface CourseDefinition {
  kind: 'FUNCTION' | 'ROAD'
  sim_version: string
  lane_width: number
  time_limit_s: number
  centerline: [number, number][]
  segment_end_s: number[]
  length_m: number
  start: { x: number; y: number; heading: number }
  speed_limits: Zone[]
  school_zones: Zone[]
  signals: SignalDef[]
  crosswalks: CrosswalkDef[]
  stages: StageDef[]
}

export interface SimEvent {
  seq: number
  code: string
  tick: number
  s_m: number
  speed_kmh: number
  terminal: boolean
  evidence: Record<string, unknown>
}

export const r6 = (v: number) => Math.floor(v * 1e6 + 0.5) / 1e6
export const r2 = (v: number) => Math.floor(v * 100 + 0.5) / 100

export type Light = 'GREEN' | 'YELLOW' | 'RED'

export function signalState(sig: SignalDef, tick: number): Light {
  const cycle = sig.green + sig.yellow + sig.red
  const ph = (tick / TICK_HZ + sig.offset) % cycle
  if (ph < sig.green) return 'GREEN'
  if (ph < sig.green + sig.yellow) return 'YELLOW'
  return 'RED'
}

export function pedestrianActive(cw: CrosswalkDef, tick: number): boolean {
  if (!cw.ped_period) return false
  const ph = (tick / TICK_HZ) % cw.ped_period
  return cw.ped_from <= ph && ph < cw.ped_to
}

export class Sim {
  readonly d: CourseDefinition
  readonly px: number[]
  readonly py: number[]
  readonly cum: number[]
  readonly total: number
  x: number
  y: number
  h: number
  v = 0
  steer = 0
  tick = 0
  idx = 0
  events: SimEvent[] = []
  ended = false
  endCode: string | null = null
  s: number
  offset: number
  prevS: number
  startS: number
  maxS: number
  distance = 0
  maxSpeed = 0
  private clTicks = 0
  private lkTicks = 0
  private lkInTicks = 0
  private lkEmitted = false
  private szTicks = 0
  private spTicks = 0
  private startDelayEmitted = false
  private overrunEmitted = new Set<string>()
  stoppedBefore = new Set<string>()
  private pedEmitted = new Set<string>()
  stage = 0
  stopTicks = 0
  private reversedInStage = false
  laneOut = false

  constructor(definition: CourseDefinition) {
    this.d = definition
    this.px = definition.centerline.map((p) => p[0])
    this.py = definition.centerline.map((p) => p[1])
    this.cum = [0]
    for (let i = 0; i < this.px.length - 1; i++) {
      const dx = this.px[i + 1] - this.px[i]
      const dy = this.py[i + 1] - this.py[i]
      this.cum.push(this.cum[this.cum.length - 1] + Math.sqrt(dx * dx + dy * dy))
    }
    this.total = this.cum[this.cum.length - 1]
    this.x = definition.start.x
    this.y = definition.start.y
    this.h = definition.start.heading
    const [s, off] = this.project()
    this.s = s
    this.offset = off
    this.prevS = s
    this.startS = s
    this.maxS = s
  }

  private project(): [number, number] {
    const n = this.px.length
    const lo = Math.max(0, this.idx - 10)
    const hi = Math.min(n - 2, this.idx + 10)
    let bestJ = lo
    let bestT = 0
    let bestD2 = -1
    for (let j = lo; j <= hi; j++) {
      const ax = this.px[j]
      const ay = this.py[j]
      const dx = this.px[j + 1] - ax
      const dy = this.py[j + 1] - ay
      const l2 = dx * dx + dy * dy
      let t = ((this.x - ax) * dx + (this.y - ay) * dy) / l2
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const qx = ax + t * dx
      const qy = ay + t * dy
      const d2 = (this.x - qx) * (this.x - qx) + (this.y - qy) * (this.y - qy)
      if (bestD2 < 0 || d2 < bestD2) {
        bestD2 = d2
        bestJ = j
        bestT = t
      }
    }
    this.idx = bestJ
    const ax = this.px[bestJ]
    const ay = this.py[bestJ]
    const dx = this.px[bestJ + 1] - ax
    const dy = this.py[bestJ + 1] - ay
    const length = Math.sqrt(dx * dx + dy * dy)
    const s = this.cum[bestJ] + bestT * length
    const cross = dx * (this.y - ay) - dy * (this.x - ax)
    return [s, -cross / length]
  }

  speedLimit(s: number): number {
    let limit = 999
    for (const z of this.d.speed_limits) {
      if (z.from <= s && s <= z.to && z.limit_kmh < limit) limit = z.limit_kmh
    }
    return limit
  }

  schoolZoneAt(s: number): Zone | null {
    let school: Zone | null = null
    for (const z of this.d.school_zones) if (z.from <= s && s <= z.to) school = z
    return school
  }

  private emit(code: string, terminal: boolean, evidence: Record<string, unknown>) {
    this.events.push({
      seq: this.events.length + 1,
      code,
      tick: this.tick,
      s_m: r2(this.s),
      speed_kmh: r2(Math.abs(this.v) * 3.6),
      terminal,
      evidence,
    })
    if (terminal && !this.ended) {
      this.ended = true
      this.endCode = code
    }
  }

  step(throttle: -1 | 0 | 1, steerIn: -1 | 0 | 1): void {
    if (this.ended) return
    const p = PHYS
    let st = this.steer
    const rate = p.steerRate / TICK_HZ
    const target = steerIn
    if (target > st) st = Math.min(target, st + rate)
    else st = Math.max(target, st - rate)

    let v = this.v
    const a = p.accel / TICK_HZ
    const b = p.brake / TICK_HZ
    if (throttle === 1) v = v < 0 ? Math.min(0, v + b) : Math.min(p.maxFwd, v + a)
    else if (throttle === -1) v = v > 0 ? Math.max(0, v - b) : Math.max(-p.maxRev, v - a)
    else v = v > 0 ? Math.max(0, v - b) : Math.min(0, v + b)

    const yaw = (v / p.wheelbase) * -st * p.maxSteer
    const h = this.h + yaw / TICK_HZ
    const x = this.x + (v * Math.cos(h)) / TICK_HZ
    const y = this.y + (v * Math.sin(h)) / TICK_HZ

    this.steer = r6(st)
    this.v = r6(v)
    this.h = r6(h)
    this.x = r6(x)
    this.y = r6(y)
    this.tick += 1

    const [s, off] = this.project()
    this.s = s
    this.offset = off
    this.distance += Math.abs(this.v) / TICK_HZ
    const speedKmh = Math.abs(this.v) * 3.6
    if (speedKmh > this.maxSpeed) this.maxSpeed = speedKmh
    if (this.s > this.maxS) this.maxS = this.s
    if (this.v < -0.5) this.reversedInStage = true
    this.judge(speedKmh)
    this.prevS = this.s
  }

  /** 도로를 벗어나면 가까운 차로 중앙에 정지 상태로 되돌려 주행을 이어간다. (sim.py _recover 와 동일) */
  private recover(): void {
    const p = courseToWorld(this, this.s, this.d.lane_width / 2)
    this.x = r6(p.x)
    this.y = r6(p.y)
    this.h = r6(p.heading)
    this.v = 0
    this.steer = 0
    const [s, off] = this.project()
    this.s = s
    this.offset = off
    this.clTicks = 0
    this.lkTicks = 0
    this.lkInTicks = 0
    this.lkEmitted = false
  }

  private judge(speedKmh: number): void {
    // 실격 해당 사건도 기록만 하고 주행은 계속한다. 끝나는 경우는 완주·제한 시간뿐이다.
    const d = this.d
    const hl = PHYS.halfLen
    const hw = PHYS.halfWidth
    const lane = d.lane_width
    const road = d.kind === 'ROAD'

    const leftLimit = road ? -lane : -1.5
    if (this.offset > lane + 1.5 || this.offset < leftLimit || this.s < -3 || this.s > this.total + 3) {
      this.emit('OFF_ROAD', false, { offset_m: r2(this.offset), recovered: true })
      this.recover()
      this.prevS = this.s
      return
    }

    const s = this.s
    const off = this.offset
    const front = s + hl
    const prevFront = this.prevS + hl
    const rear = s - hl

    if (road) {
      this.clTicks = off < 0 ? this.clTicks + 1 : 0
      if (this.clTicks === 9) {
        this.emit('CENTER_LINE', false, { offset_m: r2(off), duration_s: 0.3 })
      }
    }

    const out = off < hw - 0.3 || off > lane - hw + 0.3
    this.laneOut = out
    if (out) {
      this.lkTicks += 1
      this.lkInTicks = 0
      if (this.lkTicks === TICK_HZ && !this.lkEmitted) {
        this.lkEmitted = true
        this.emit('LANE_KEEP', false, { offset_m: r2(off), lane_width_m: lane, duration_s: 1.0 })
      }
    } else {
      this.lkInTicks += 1
      if (this.lkInTicks >= 15) {
        this.lkTicks = 0
        this.lkEmitted = false
      }
    }

    if (road) {
      const school = this.schoolZoneAt(s)
      if (school !== null && speedKmh > school.limit_kmh) this.szTicks += 1
      else this.szTicks = 0
      if (this.szTicks === 15 && school !== null) {
        this.emit('SCHOOL_ZONE_SPEEDING', false, { limit_kmh: school.limit_kmh, speed_kmh: r2(speedKmh), duration_s: 0.5 })
      }
      const limit = this.speedLimit(s)
      this.spTicks = speedKmh > limit + 10 ? this.spTicks + 1 : 0
      if (this.spTicks === TICK_HZ) {
        this.emit('SPEEDING', false, { limit_kmh: limit, speed_kmh: r2(speedKmh), duration_s: 1.0 })
      }

      for (const sig of d.signals) {
        const light = signalState(sig, this.tick)
        if (this.v > 0 && prevFront < sig.stop_s && sig.stop_s <= front && light === 'RED') {
          this.emit('SIGNAL_RED', false, { signal_id: sig.id, light })
        }
        if (
          light === 'RED' &&
          Math.abs(this.v) < 0.1 &&
          sig.stop_s < front &&
          front <= sig.crosswalk_to &&
          !this.overrunEmitted.has(sig.id)
        ) {
          this.overrunEmitted.add(sig.id)
          this.emit('CROSSWALK_OVERRUN', false, { signal_id: sig.id, light, over_stop_line_m: r2(front - sig.stop_s) })
        }
      }

      for (const cw of d.crosswalks) {
        if (cw.from - 15 <= front && front <= cw.from && Math.abs(this.v) < 0.1) this.stoppedBefore.add(cw.id)
        if (this.v > 0 && prevFront < cw.from && cw.from <= front && !this.stoppedBefore.has(cw.id)) {
          this.emit('CROSSWALK_NO_STOP', false, { crosswalk_id: cw.id })
        }
        const overlap = front > cw.from && rear < cw.to
        if (!overlap) {
          this.pedEmitted.delete(cw.id)
        } else if (pedestrianActive(cw, this.tick) && Math.abs(this.v) > 0.5 && !this.pedEmitted.has(cw.id)) {
          this.pedEmitted.add(cw.id)
          this.emit('PEDESTRIAN_CONFLICT', false, { crosswalk_id: cw.id, pedestrian: true })
        }
      }

      if (!this.startDelayEmitted && this.tick >= 20 * TICK_HZ && this.maxS - this.startS < 1.0) {
        this.startDelayEmitted = true
        this.emit('START_DELAY', false, { waited_s: 20 })
      }
    }

    const stages = d.stages
    if (this.stage < stages.length) {
      const stg = stages[this.stage]
      let inBox = stg.from <= s && s <= stg.to && Math.abs(this.v) < 0.1 && !out
      if (stg.type === 'REVERSE_STOP_IN') inBox = inBox && this.reversedInStage
      this.stopTicks = inBox ? this.stopTicks + 1 : 0
      if (this.stopTicks === TICK_HZ) {
        this.stage += 1
        this.stopTicks = 0
        this.reversedInStage = false
        if (this.stage === stages.length) {
          this.emit('COURSE_COMPLETE', true, { stages: stages.length })
          return
        }
        this.emit('STAGE_CLEAR', false, { stage: this.stage, label: stg.label ?? '' })
      }
    }

    if (this.tick >= d.time_limit_s * TICK_HZ) {
      this.emit('TIME_LIMIT', true, { time_limit_s: d.time_limit_s })
    }
  }
}

export function replay(definition: CourseDefinition, inputs: [number, number, number][], totalTicks: number): Sim {
  const sim = new Sim(definition)
  let k = 0
  let thr = 0
  let ste = 0
  while (sim.tick < totalTicks && !sim.ended) {
    while (k < inputs.length && inputs[k][0] <= sim.tick) {
      thr = inputs[k][1]
      ste = inputs[k][2]
      k++
    }
    sim.step(thr as -1 | 0 | 1, ste as -1 | 0 | 1)
  }
  return sim
}

/** 코스 위 거리 s, 차로 오프셋(오른쪽 +)을 월드 좌표로 */
export function courseToWorld(sim: Sim, s: number, offset: number): { x: number; y: number; heading: number } {
  const cum = sim.cum
  let lo = 0
  let hi = cum.length - 1
  const target = Math.max(0, Math.min(sim.total, s))
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= target) lo = mid
    else hi = mid
  }
  const segLen = cum[hi] - cum[lo] || 1
  const t = (target - cum[lo]) / segLen
  const dx = sim.px[hi] - sim.px[lo]
  const dy = sim.py[hi] - sim.py[lo]
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = dy / len
  const ny = -dx / len
  return {
    x: sim.px[lo] + dx * t + nx * offset,
    y: sim.py[lo] + dy * t + ny * offset,
    heading: Math.atan2(dy, dx),
  }
}
