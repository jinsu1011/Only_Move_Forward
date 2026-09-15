import { describe, expect, it } from 'vitest'
import golden from '../sim/golden.json'
import { replay, type CourseDefinition } from '../sim/engine'
import { applyKey, emptyKeys } from './keys'
import { LineSplitter, parseLine } from './parser'
import { DEFAULT_SETUP, feedSample, initialSetup, resetSetup, resumeSetup, toggleInvert, checkSignal, type SetupState } from './setup'
import { nextSteer, SENSITIVITY_PRESETS, SteeringFilter, steerFromKeys, throttleFromKeys, type Steer } from './steering'

describe('parser', () => {
  it('reads WME, roll/pitch and roll-only lines', () => {
    expect(parseLine('WME,3067,-2.70,60.00,0.00')).toEqual({ kind: 'sample', roll: -2.7, pitch: 60, format: 'WME' })
    expect(parseLine('12.5,-3.0')).toEqual({ kind: 'sample', roll: 12.5, pitch: -3, format: 'ROLL_PITCH' })
    expect(parseLine('-8')).toEqual({ kind: 'sample', roll: -8, pitch: null, format: 'ROLL' })
    expect(parseLine('INFO,READY').kind).toBe('info')
    expect(parseLine('ERR,MPU6050_NOT_FOUND').kind).toBe('error')
  })
  it('rejects broken frames', () => {
    for (const bad of ['WME,1,2', 'WME,1,abc,2,3', 'nan,1', '999,0', '1,2,3', '', 'roll=1 pitch=2']) {
      expect(parseLine(bad).kind).toBe('invalid')
    }
  })
  it('splits partial chunks into lines', () => {
    const s = new LineSplitter()
    expect(s.push('WME,1,2')).toEqual([])
    expect(s.push('.0,3,4\r\nWME,2,')).toEqual(['WME,1,2.0,3,4'])
    expect(s.push('1,1,1\n')).toEqual(['WME,2,1,1,1'])
  })
})

describe('steering hysteresis', () => {
  it('enters at 12 and exits at 7 without chatter', () => {
    let s: Steer = 0
    const seq = [0, 11.9, 12, 9, 7.1, 6.9, -11, -12, -8, -6.9]
    const out = seq.map((v) => (s = nextSteer(s, v, 12, 7)))
    expect(out).toEqual([0, 0, 1, 1, 1, 0, 0, -1, -1, 0])
  })
  it('jumps directly across when fully tilted the other way', () => {
    expect(nextSteer(-1, 13, 12, 7)).toBe(1)
    expect(nextSteer(1, -13, 12, 7)).toBe(-1)
  })
  it('keyboard: both or none means stop / center', () => {
    expect(throttleFromKeys(true, false)).toBe(1)
    expect(throttleFromKeys(false, true)).toBe(-1)
    expect(throttleFromKeys(true, true)).toBe(0)
    expect(throttleFromKeys(false, false)).toBe(0)
    expect(steerFromKeys(true, true)).toBe(0)
    expect(steerFromKeys(true, false)).toBe(-1)
  })
})

describe('mode-specific keys', () => {
  const key = (code: string) => ({ code, key: code.startsWith('Arrow') ? code : code.slice(-1).toLowerCase() } as KeyboardEvent)
  it('uses WASD only in keyboard mode', () => {
    const state = emptyKeys()
    expect(applyKey(state, key('KeyW'), true, 'KEYBOARD')).toBe(true)
    expect(applyKey(state, key('KeyA'), true, 'KEYBOARD')).toBe(true)
    expect(state).toEqual({ forward: true, reverse: false, left: true, right: false })
    expect(applyKey(state, key('ArrowUp'), true, 'KEYBOARD')).toBe(false)
  })
  it('uses up/down only for throttle in sensor mode', () => {
    const state = emptyKeys()
    expect(applyKey(state, key('ArrowUp'), true, 'SENSOR')).toBe(true)
    expect(applyKey(state, key('KeyA'), true, 'SENSOR')).toBe(false)
    expect(state).toEqual({ forward: true, reverse: false, left: false, right: false })
  })
})

describe('sensor sensitivity filter', () => {
  const feed = (preset: keyof typeof SENSITIVITY_PRESETS, values: number[]) => {
    const f = new SteeringFilter(SENSITIVITY_PRESETS[preset])
    const out: { steer: Steer; smoothed: number }[] = []
    values.forEach((v, i) => {
      const at = i * 20
      const smoothed = f.smooth(v, at)
      out.push({ steer: f.decide(smoothed, at), smoothed })
    })
    return out
  }
  const changes = (xs: Steer[]) => xs.filter((s, i) => i > 0 && s !== xs[i - 1]).length

  it('hand tremor around center no longer flips LEFT/RIGHT', () => {
    const tremor = Array.from({ length: 100 }, (_, i) => (i % 2 ? 16 : -16))
    let raw: Steer = 0
    const rawSteer = tremor.map((v) => (raw = nextSteer(raw, v, 12, 7)))
    expect(changes(rawSteer)).toBeGreaterThan(50)
    const out = feed('NORMAL', tremor)
    expect(changes(out.map((o) => o.steer))).toBe(0)
    expect(Math.max(...out.slice(25).map((o) => Math.abs(o.smoothed)))).toBeLessThan(8)
  })

  it('a deliberate tilt still turns within about 0.3s', () => {
    const out = feed('NORMAL', [...Array(10).fill(0), ...Array(25).fill(25)])
    const firstTurn = out.findIndex((o) => o.steer === 1)
    expect(firstTurn).toBeGreaterThan(10 + 5)
    expect((firstTurn - 10) * 20).toBeLessThanOrEqual(320)
    expect(out[out.length - 1].steer).toBe(1)
  })

  it('ignores a single-sample shock', () => {
    const out = feed('NORMAL', [...Array(10).fill(0), 80, ...Array(10).fill(0)])
    expect(out.every((o) => o.steer === 0)).toBe(true)
    expect(Math.max(...out.map((o) => o.smoothed))).toBeLessThan(1)
  })

  it('presets order sensitivity: a moderate 14° tilt turns only on HIGH', () => {
    const tilt = [...Array(5).fill(0), ...Array(40).fill(14)]
    expect(feed('HIGH', tilt).at(-1)!.steer).toBe(1)
    expect(feed('NORMAL', tilt).at(-1)!.steer).toBe(0)
    expect(feed('LOW', tilt).at(-1)!.steer).toBe(0)
  })
})

function run(state: SetupState, values: number[], start: number, dt = 20, cfg = DEFAULT_SETUP) {
  let s = state
  let t = start
  for (const v of values) {
    s = feedSample(s, v, t, cfg)
    t += dt
  }
  return { s, t }
}
const hold = (v: number, ms: number) => Array.from({ length: Math.ceil(ms / 20) }, () => v)

describe('setup machine', () => {
  it('center 3s → left → center → right → center → READY', () => {
    let { s, t } = run(initialSetup(), hold(-3, 3100), 0)
    expect(s.phase).toBe('LEFT')
    expect(s.center).toBeCloseTo(-3, 5)
    ;({ s, t } = run(s, hold(-20, 600), t))
    expect(s.phase).toBe('CENTER_AFTER_LEFT')
    ;({ s, t } = run(s, hold(-2, 600), t))
    expect(s.phase).toBe('RIGHT')
    ;({ s, t } = run(s, hold(15, 600), t))
    expect(s.phase).toBe('CENTER_AFTER_RIGHT')
    ;({ s, t } = run(s, hold(-4, 600), t))
    expect(s.phase).toBe('READY')
    expect(s.leftConfirmed && s.rightConfirmed).toBe(true)
  })
  it('movement during center measurement restarts the 3s window', () => {
    let { s, t } = run(initialSetup(), hold(0, 2000), 0)
    ;({ s, t } = run(s, [8], t))
    ;({ s } = run(s, hold(8, 2000), t))
    expect(s.phase).toBe('CENTER_MEASURE')
  })
  it('flags reversed direction and invert restarts left check', () => {
    let { s, t } = run(initialSetup(), hold(0, 3100), 0)
    ;({ s, t } = run(s, hold(20, 600), t))
    expect(s.phase).toBe('LEFT')
    expect(s.wrongDirection).toBe(true)
    s = toggleInvert(s)
    const cfg = { ...DEFAULT_SETUP, invert: true }
    ;({ s } = run(s, hold(20, 600), t, 20, cfg))
    expect(s.phase).toBe('CENTER_AFTER_LEFT')
  })
  it('resuming a saved center only needs a short center hold', () => {
    let { s, t } = run(resumeSetup(-3), hold(10, 600), 0)
    expect(s.phase).toBe('CENTER_AFTER_RIGHT')
    ;({ s } = run(s, hold(-2, 500), t))
    expect(s.phase).toBe('READY')
    expect(s.center).toBe(-3)
  })
  it('R reset never shows READY and signal loss drops calibration', () => {
    let { s, t } = run(initialSetup(), hold(0, 3100), 0)
    ;({ s, t } = run(s, [...hold(-20, 600), ...hold(0, 600), ...hold(20, 600), ...hold(0, 600)], t))
    expect(s.phase).toBe('READY')
    const r = resetSetup(s)
    expect(r.phase).toBe('CENTER_MEASURE')
    expect(r.center).toBeNull()
    const lost = checkSignal(s, t + 1000, DEFAULT_SETUP)
    expect(lost.phase).toBe('NO_SIGNAL')
    expect(lost.center).toBeNull()
  })
})

describe('engine matches server replay (golden fixture from Python)', () => {
  for (const name of ['road', 'function', 'road_violations'] as const) {
    it(`${name} course events and final pose are identical`, () => {
      const g = golden[name]
      const sim = replay(g.definition as unknown as CourseDefinition, g.inputs as [number, number, number][], g.total_ticks)
      expect(sim.events).toEqual(g.events)
      expect({ x: sim.x, y: sim.y, h: sim.h, v: sim.v }).toEqual(g.final)
    })
  }
})
