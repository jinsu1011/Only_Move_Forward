// 캔버스 렌더러: 주행 중에는 차 뒤를 따라가는 탑뷰(진행 방향이 위), 결과 화면에서는 코스 전체 보기.
import { courseToWorld, PHYS, pedestrianActive, signalState, TICK_HZ, type Sim } from './engine'

const C = {
  grass: '#15231b',
  grass2: '#1a2b21',
  sidewalk: '#3a414c',
  asphalt: '#2a2f37',
  asphaltFunc: '#30353d',
  school: 'rgba(190, 40, 40, 0.38)',
  line: '#e5e7eb',
  yellow: '#facc15',
  car: '#3b82f6',
}

function band(ctx: CanvasRenderingContext2D, sim: Sim, s0: number, s1: number, a: number, b: number) {
  const step = 2
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let s = s0; s <= s1 + 0.001; s += step) {
    const ss = Math.min(s, s1)
    left.push(courseToWorld(sim, ss, a))
    right.push(courseToWorld(sim, ss, b))
    if (ss === s1) break
  }
  ctx.beginPath()
  left.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
  ctx.closePath()
  ctx.fill()
}

function strokeOffset(ctx: CanvasRenderingContext2D, sim: Sim, s0: number, s1: number, off: number) {
  ctx.beginPath()
  for (let s = s0, i = 0; s <= s1 + 0.001; s += 2, i++) {
    const p = courseToWorld(sim, Math.min(s, s1), off)
    if (i) ctx.lineTo(p.x, p.y)
    else ctx.moveTo(p.x, p.y)
  }
  ctx.stroke()
}

function crossLine(ctx: CanvasRenderingContext2D, sim: Sim, s: number, a: number, b: number) {
  const p = courseToWorld(sim, s, a)
  const q = courseToWorld(sim, s, b)
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(q.x, q.y)
  ctx.stroke()
}

function stripes(ctx: CanvasRenderingContext2D, sim: Sim, s0: number, s1: number, a: number, b: number) {
  ctx.fillStyle = 'rgba(241, 245, 249, 0.92)'
  for (let off = a + 0.25; off < b - 0.2; off += 1.0) band(ctx, sim, s0, s1, off, off + 0.5)
}

export interface DrawOptions {
  mode: 'chase' | 'overview'
  throttle?: -1 | 0 | 1
  path?: { x: number; y: number }[]
  markers?: { x: number; y: number; label: string; danger: boolean }[]
  zoom?: number
}

export function drawScene(canvas: HTMLCanvasElement, sim: Sim, opt: DrawOptions) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')!
  const d = sim.d
  const road = d.kind === 'ROAD'
  const lane = d.lane_width
  const tick = sim.tick

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = C.grass
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  if (opt.mode === 'chase') {
    const k = (h / 58) * (opt.zoom ?? 1)
    ctx.translate(w / 2, h * 0.7)
    ctx.scale(k, -k)
    ctx.rotate(Math.PI / 2 - sim.h)
    ctx.translate(-sim.x, -sim.y)
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < sim.px.length; i++) {
      minX = Math.min(minX, sim.px[i]); maxX = Math.max(maxX, sim.px[i])
      minY = Math.min(minY, sim.py[i]); maxY = Math.max(maxY, sim.py[i])
    }
    const pad = 20
    const k = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2))
    ctx.translate(w / 2, h / 2)
    ctx.scale(k, -k)
    ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
  }
  const worldToScreen = (x: number, y: number) => {
    const m = ctx.getTransform()
    return { x: (m.a * x + m.c * y + m.e) / dpr, y: (m.b * x + m.d * y + m.f) / dpr }
  }

  const total = sim.total
  // 보도·도로
  if (road) {
    ctx.fillStyle = C.sidewalk
    band(ctx, sim, 0, total, -lane - 2.2, lane + 2.2)
    for (const sig of d.signals) {
      const a = courseToWorld(sim, (sig.intersection_from + sig.intersection_to) / 2, 0)
      ctx.save()
      ctx.translate(a.x, a.y)
      ctx.rotate(a.heading)
      ctx.fillStyle = C.sidewalk
      ctx.fillRect(-(sig.intersection_to - sig.intersection_from) / 2 - 2.2, -40, sig.intersection_to - sig.intersection_from + 4.4, 80)
      ctx.fillStyle = C.asphalt
      ctx.fillRect(-(sig.intersection_to - sig.intersection_from) / 2, -40, sig.intersection_to - sig.intersection_from, 80)
      ctx.restore()
    }
  }
  ctx.fillStyle = road ? C.asphalt : C.asphaltFunc
  if (road) band(ctx, sim, 0, total, -lane, lane)
  else band(ctx, sim, 0, total, -0.4, lane + 0.4)

  for (const z of d.school_zones) {
    ctx.fillStyle = C.school
    band(ctx, sim, z.from, z.to, 0, lane)
  }

  // 차선
  ctx.lineWidth = 0.15
  if (road) {
    ctx.strokeStyle = C.yellow
    strokeOffset(ctx, sim, 0, total, -0.12)
    strokeOffset(ctx, sim, 0, total, 0.12)
    ctx.strokeStyle = C.line
    strokeOffset(ctx, sim, 0, total, lane - 0.15)
    strokeOffset(ctx, sim, 0, total, -lane + 0.15)
  } else {
    ctx.strokeStyle = '#f59e0b'
    ctx.setLineDash([1.2, 0.8])
    ctx.lineWidth = 0.3
    strokeOffset(ctx, sim, 0, total, -0.2)
    strokeOffset(ctx, sim, 0, total, lane + 0.2)
    ctx.setLineDash([])
  }

  // 신호 교차로
  for (const sig of d.signals) {
    stripes(ctx, sim, sig.crosswalk_from, sig.crosswalk_to, -lane, lane)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.45
    crossLine(ctx, sim, sig.stop_s, 0, lane)
    const light = signalState(sig, tick)
    const pole = courseToWorld(sim, sig.stop_s + 1, lane + 1.6)
    ctx.fillStyle = '#0b1220'
    ctx.beginPath()
    ctx.arc(pole.x, pole.y, 1.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = light === 'RED' ? '#ef4444' : light === 'YELLOW' ? '#f59e0b' : '#22c55e'
    ctx.beginPath()
    ctx.arc(pole.x, pole.y, 0.9, 0, Math.PI * 2)
    ctx.fill()
  }

  // 신호 없는 횡단보도 + 보행자
  for (const cw of d.crosswalks) {
    stripes(ctx, sim, cw.from, cw.to, -lane, lane)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 0.3
    ctx.setLineDash([0.6, 0.5])
    crossLine(ctx, sim, cw.from - 1.5, 0, lane)
    ctx.setLineDash([])
    if (pedestrianActive(cw, tick)) {
      const ph = ((tick / TICK_HZ) % cw.ped_period - cw.ped_from) / (cw.ped_to - cw.ped_from)
      const pos = courseToWorld(sim, (cw.from + cw.to) / 2, lane + 1.5 - ph * (lane * 2 + 3))
      ctx.fillStyle = '#fde047'
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, 0.55, 0, Math.PI * 2)
      ctx.fill()
      const pos2 = courseToWorld(sim, (cw.from + cw.to) / 2 + 1.8, lane + 0.5 - ph * (lane * 2 + 3))
      ctx.fillStyle = '#fb923c'
      ctx.beginPath()
      ctx.arc(pos2.x, pos2.y, 0.45, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 과제 구역
  d.stages.forEach((stg, i) => {
    const active = i === sim.stage
    ctx.fillStyle = active ? 'rgba(34,197,94,0.22)' : i < sim.stage ? 'rgba(148,163,184,0.12)' : 'rgba(34,197,94,0.08)'
    band(ctx, sim, stg.from, stg.to, road ? 0.1 : 0, road ? lane - 0.1 : lane)
    ctx.strokeStyle = active ? '#4ade80' : 'rgba(148,163,184,0.6)'
    ctx.lineWidth = 0.25
    ctx.setLineDash([0.8, 0.6])
    crossLine(ctx, sim, stg.from, road ? 0 : 0, lane)
    crossLine(ctx, sim, stg.to, road ? 0 : 0, lane)
    ctx.setLineDash([])
  })

  // 경로·마커(결과 화면)
  if (opt.path && opt.path.length > 1) {
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = opt.mode === 'overview' ? 1.2 : 0.3
    ctx.beginPath()
    opt.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
  }

  // 차량
  ctx.save()
  ctx.translate(sim.x, sim.y)
  ctx.rotate(sim.h)
  const L = PHYS.halfLen
  const W = PHYS.halfWidth
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(-L + 0.2, -W - 0.2, L * 2, W * 2)
  ctx.fillStyle = sim.laneOut ? '#f97316' : C.car
  roundRect(ctx, -L, -W, L * 2, W * 2, 0.5)
  ctx.fill()
  ctx.fillStyle = '#bfdbfe'
  roundRect(ctx, L * 0.15, -W * 0.75, L * 0.55, W * 1.5, 0.25)
  ctx.fill()
  ctx.fillStyle = '#1e3a8a'
  roundRect(ctx, -L * 0.75, -W * 0.7, L * 0.5, W * 1.4, 0.2)
  ctx.fill()
  const braking = opt.throttle === 0 || (opt.throttle === -1 && sim.v > 0) || (opt.throttle === 1 && sim.v < 0)
  ctx.fillStyle = braking ? '#ff3b3b' : '#7f1d1d'
  ctx.fillRect(-L - 0.05, -W + 0.1, 0.25, 0.5)
  ctx.fillRect(-L - 0.05, W - 0.6, 0.25, 0.5)
  if (sim.v < -0.05) {
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(-L - 0.1, -0.25, 0.25, 0.5)
  }
  ctx.fillStyle = '#fef9c3'
  ctx.fillRect(L - 0.2, -W + 0.15, 0.25, 0.45)
  ctx.fillRect(L - 0.2, W - 0.6, 0.25, 0.45)
  ctx.restore()

  // 화면 좌표 라벨
  const labels: { x: number; y: number; text: string; color: string; bg: string }[] = []
  for (const z of d.school_zones) {
    const p = courseToWorld(sim, z.from + 3, lane / 2)
    labels.push({ ...worldToScreen(p.x, p.y), text: '어린이 보호구역 30', color: '#fff', bg: 'rgba(185,28,28,0.9)' })
  }
  for (const cw of d.crosswalks) {
    const p = courseToWorld(sim, cw.from - 6, lane / 2)
    labels.push({ ...worldToScreen(p.x, p.y), text: '일시정지', color: '#0b1220', bg: 'rgba(250,204,21,0.95)' })
  }
  d.stages.forEach((stg, i) => {
    if (i < sim.stage) return
    const p = courseToWorld(sim, (stg.from + stg.to) / 2, lane / 2)
    labels.push({ ...worldToScreen(p.x, p.y), text: stg.type === 'REVERSE_STOP_IN' ? '후진 정차' : '정차', color: '#052e16', bg: 'rgba(74,222,128,0.95)' })
  })
  ctx.restore()

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = '700 12px Pretendard Variable, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const lb of labels) {
    if (lb.x < -80 || lb.x > w + 80 || lb.y < -30 || lb.y > h + 30) continue
    const tw = ctx.measureText(lb.text).width + 14
    ctx.fillStyle = lb.bg
    roundRect(ctx, lb.x - tw / 2, lb.y - 11, tw, 22, 6)
    ctx.fill()
    ctx.fillStyle = lb.color
    ctx.fillText(lb.text, lb.x, lb.y + 0.5)
  }
  if (opt.markers) {
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.restore()
  }
}

export function drawMarkers(canvas: HTMLCanvasElement, sim: Sim, markers: { s: number; offset: number; label: string; danger: boolean }[]) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const ctx = canvas.getContext('2d')!
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < sim.px.length; i++) {
    minX = Math.min(minX, sim.px[i]); maxX = Math.max(maxX, sim.px[i])
    minY = Math.min(minY, sim.py[i]); maxY = Math.max(maxY, sim.py[i])
  }
  const pad = 20
  const k = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = '800 12px Pretendard Variable, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const m of markers) {
    const p = courseToWorld(sim, m.s, m.offset)
    const x = w / 2 + (p.x - (minX + maxX) / 2) * k
    const y = h / 2 - (p.y - (minY + maxY) / 2) * k
    ctx.fillStyle = m.danger ? '#ef4444' : '#f59e0b'
    ctx.beginPath()
    ctx.arc(x, y, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.fillText(m.label, x, y + 0.5)
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
