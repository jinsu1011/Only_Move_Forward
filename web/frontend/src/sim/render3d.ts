import * as THREE from 'three'
import { courseToWorld, elevationAt, pedestrianActive, PHYS, signalState, type Sim } from './engine'

export interface Marker3D {
  s: number
  offset: number
  label: string
  danger: boolean
}

export interface Render3DOptions {
  mode: 'cockpit' | 'overview'
  path?: { x: number; y: number }[]
  markers?: Marker3D[]
}

type SignalVisual = {
  index: number
  lamps: Record<'RED' | 'YELLOW' | 'GREEN', THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>
}

type PedestrianVisual = {
  index: number
  group: THREE.Group
  start: THREE.Vector3
  delta: THREE.Vector3
}

const standard = (color: THREE.ColorRepresentation, roughness = 0.85, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function strip(
  sim: Sim,
  fromOffset: number,
  toOffset: number,
  material: THREE.Material,
  height = 0,
  fromS = 0,
  toS = sim.total,
) {
  const positions: number[] = []
  const indices: number[] = []
  const samples = [fromS, ...sim.cum.filter((s) => fromS < s && s < toS), toS]
  samples.forEach((s, index) => {
    const lift = elevationAt(sim.d, s)   // 경사로 구간은 도로 자체가 올라간다
    for (const offset of [fromOffset, toOffset]) {
      const p = courseToWorld(sim, s, offset)
      positions.push(p.x, height + lift, -p.y)
    }
    if (index < samples.length - 1) {
      const i = index * 2
      indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

function courseLine(parent: THREE.Object3D, sim: Sim, offset: number, color: number, dashed = false) {
  const step = dashed ? 5 : 1
  for (let index = 0; index < sim.cum.length - 1; index += step) {
    if (dashed && Math.floor(index / step) % 2) continue
    const endIndex = Math.min(index + step, sim.cum.length - 1)
    const a = courseToWorld(sim, sim.cum[index], offset)
    const b = courseToWorld(sim, sim.cum[endIndex], offset)
    const dx = b.x - a.x
    const dz = -(b.y - a.y)
    const length = Math.hypot(dx, dz)
    if (length < 0.05) continue
    const line = new THREE.Mesh(new THREE.BoxGeometry(length, 0.018, 0.11), standard(color, 0.65))
    const lift = (elevationAt(sim.d, sim.cum[index]) + elevationAt(sim.d, sim.cum[endIndex])) / 2
    line.position.set((a.x + b.x) / 2, 0.035 + lift, -(a.y + b.y) / 2)
    line.rotation.y = Math.atan2(-dz, dx)
    parent.add(line)
  }
}

function markerSprite(text: string, danger: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 160
  const context = canvas.getContext('2d')!
  context.fillStyle = danger ? '#dc2626' : '#2563eb'
  context.beginPath()
  context.arc(80, 80, 62, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = '#fff'
  context.lineWidth = 9
  context.stroke()
  context.fillStyle = '#fff'
  context.font = 'bold 72px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 80, 84)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.scale.set(3.2, 3.2, 1)
  return sprite
}

/** Three.js 표현 전용 계층. 판정과 차량 상태는 Sim이 계속 단독으로 계산한다. */
export class DriveScene3D {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.08, 1500)
  private readonly cockpit = new THREE.Group()
  private wheel: THREE.Group | null = null
  private readonly renderer: THREE.WebGLRenderer
  private readonly world = new THREE.Group()
  private readonly car = new THREE.Group()
  private readonly transient = new THREE.Group()
  private readonly signals: SignalVisual[] = []
  private readonly pedestrians: PedestrianVisual[] = []
  private readonly resizeObserver: ResizeObserver
  private disposed = false
  private rendered = false

  constructor(private readonly host: HTMLElement, private readonly initialSim: Sim) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.className = 'drive-webgl'
    host.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x9dccf2)
    this.scene.fog = new THREE.Fog(0x9dccf2, 90, 360)
    this.scene.add(this.world, this.car, this.transient)
    this.buildWorld(initialSim)
    this.buildCar()
    this.buildCockpit()
    this.scene.add(this.camera)   // 콕핏은 카메라에 붙어 함께 움직인다

    this.scene.add(new THREE.HemisphereLight(0xd9efff, 0x526640, 2.2))
    const sun = new THREE.DirectionalLight(0xfff3d6, 2.5)
    sun.position.set(-45, 85, 30)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -120
    sun.shadow.camera.right = 120
    sun.shadow.camera.top = 120
    sun.shadow.camera.bottom = -120
    this.scene.add(sun)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    // setSize 가 캔버스를 지우므로, 한 번만 그리는 결과 화면도 마지막 장면을 다시 그린다
    if (this.rendered && !this.disposed) this.renderer.render(this.scene, this.camera)
  }

  /** 운전석 내부. 카메라 자식이라 좌표는 "눈 기준"이다(-z 가 앞). */
  private buildCockpit() {
    const shell = standard(0x1b2026, 0.85)
    const dash = standard(0x232a31, 0.8)
    const trim = standard(0x0f1317, 0.7)
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(...pos)
      if (rot) m.rotation.set(...rot)
      this.cockpit.add(m)
      return m
    }
    // 대시보드 — 아래쪽을 가려 시야를 앞유리로 한정한다
    add(new THREE.BoxGeometry(1.9, 0.34, 0.6), dash, [0, -0.40, -0.60], [-0.16, 0, 0])
    add(new THREE.BoxGeometry(1.9, 0.5, 0.2), trim, [0, -0.62, -0.32])
    // 계기판 덮개와 화면
    add(new THREE.BoxGeometry(0.62, 0.08, 0.26), trim, [-0.24, -0.27, -0.56], [-0.34, 0, 0])
    const cluster = add(new THREE.PlaneGeometry(0.52, 0.17), new THREE.MeshBasicMaterial({ color: 0x0d3b2e }), [-0.24, -0.33, -0.53], [-0.38, 0, 0])
    cluster.renderOrder = 2
    // A 필러와 지붕 — 앞유리 테두리
    add(new THREE.BoxGeometry(0.13, 1.4, 0.13), shell, [-0.82, 0.18, -0.55], [0, 0, 0.2])
    add(new THREE.BoxGeometry(0.13, 1.4, 0.13), shell, [0.82, 0.18, -0.55], [0, 0, -0.2])
    add(new THREE.BoxGeometry(2.0, 0.26, 0.45), shell, [0, 0.72, -0.55])
    // 좌우 도어 트림(주변시 가림)
    add(new THREE.BoxGeometry(0.2, 1.5, 1.4), shell, [-0.9, -0.24, 0.12])
    add(new THREE.BoxGeometry(0.2, 1.5, 1.4), shell, [0.9, -0.24, 0.12])
    // 핸들
    const wheel = new THREE.Group()
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 12, 36), standard(0x14181d, 0.6))
    wheel.add(rim)
    for (const angle of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.024, 0.02), standard(0x1c2228, 0.6))
      spoke.position.set(Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, 0)
      spoke.rotation.z = angle
      wheel.add(spoke)
    }
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), standard(0x2a323a, 0.5)))
    wheel.children[wheel.children.length - 1].rotation.x = Math.PI / 2
    wheel.position.set(-0.24, -0.30, -0.44)
    wheel.rotation.x = -0.42
    this.cockpit.add(wheel)
    this.wheel = wheel
    this.camera.add(this.cockpit)
    this.cockpit.visible = false
  }

  private buildWorld(sim: Sim) {
    const lane = sim.d.lane_width
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), standard(0x487a3f))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.08
    ground.receiveShadow = true
    this.world.add(ground)

    this.world.add(strip(sim, -lane - 0.45, lane + 0.45, standard(0x30343a)))
    this.world.add(strip(sim, -lane - 1.7, -lane - 0.45, standard(0x8b9198), -0.01))
    this.world.add(strip(sim, lane + 0.45, lane + 1.7, standard(0x8b9198), -0.01))
    courseLine(this.world, sim, 0, sim.d.kind === 'ROAD' ? 0xf4c430 : 0xffffff, sim.d.kind !== 'ROAD')
    courseLine(this.world, sim, lane, 0xffffff)
    courseLine(this.world, sim, -lane, 0xffffff)

    // 피니시 라인 — 체크무늬. 이 선을 넘으면 주행이 끝난다.
    const finishS = sim.d.finish_s
    if (finishS != null) {
      const lift = elevationAt(sim.d, finishS)
      const cols = 10
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < cols; col++) {
          const off = -lane + ((col + 0.5) / cols) * lane * 2
          const p = courseToWorld(sim, finishS + (row ? 0.55 : 0), off)
          const tile = new THREE.Mesh(
            new THREE.BoxGeometry((lane * 2) / cols, 0.02, 0.55),
            standard((row + col) % 2 ? 0x111418 : 0xf8fafc, 0.6),
          )
          tile.position.set(p.x, 0.04 + lift, -p.y)
          tile.rotation.y = -p.heading
          this.world.add(tile)
        }
      }
      // 양쪽 기둥과 가로대
      for (const side of [-1, 1]) {
        const p = courseToWorld(sim, finishS, side * (lane + 1.1))
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.2, 0.22), standard(0xe2e8f0, 0.5))
        pole.position.set(p.x, 2.6 + lift, -p.y)
        this.world.add(pole)
      }
      const mid = courseToWorld(sim, finishS, 0)
      const beam = new THREE.Mesh(new THREE.BoxGeometry(lane * 2 + 2.4, 0.55, 0.18), standard(0x164936, 0.5))
      beam.position.set(mid.x, 4.9 + lift, -mid.y)
      beam.rotation.y = -mid.heading
      this.world.add(beam)
    }

    for (const zone of sim.d.school_zones) {
      this.world.add(strip(
        sim,
        -lane,
        lane,
        new THREE.MeshStandardMaterial({ color: 0x9e3d34, roughness: 0.95, transparent: true, opacity: 0.5 }),
        0.024,
        zone.from,
        zone.to,
      ))
    }

    sim.d.crosswalks.forEach((crosswalk, index) => {
      for (let s = crosswalk.from; s < crosswalk.to; s += 1.25) {
        const p = courseToWorld(sim, s + 0.42, 0)
        const stripeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.022, lane * 2), standard(0xf5f5f4))
        stripeMesh.position.set(p.x, 0.045, -p.y)
        stripeMesh.rotation.y = p.heading
        this.world.add(stripeMesh)
      }
      this.addPedestrian(sim, index)
    })
    sim.d.signals.forEach((signal, index) => this.addSignal(sim, signal.stop_s, index))
    this.addRoadside(sim)
  }

  private addSignal(sim: Sim, s: number, index: number) {
    const lane = sim.d.lane_width
    const p = courseToWorld(sim, s, lane + 1.15)
    const group = new THREE.Group()
    group.position.set(p.x, 0, -p.y)
    group.rotation.y = p.heading
    addSignalPole(group, lane)
    const lamps = {} as SignalVisual['lamps']
    const colors = { RED: 0xef4444, YELLOW: 0xf59e0b, GREEN: 0x22c55e }
    ;(['RED', 'YELLOW', 'GREEN'] as const).forEach((name, lampIndex) => {
      const material = new THREE.MeshStandardMaterial({ color: 0x20262e, emissive: colors[name], emissiveIntensity: 0.02 })
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), material)
      lamp.position.set(-lane * 2 - 0.2, 4.52 - lampIndex * 0.48, -0.22)
      group.add(lamp)
      lamps[name] = lamp
    })
    this.signals.push({ index, lamps })
    this.world.add(group)
  }

  private addPedestrian(sim: Sim, index: number) {
    const definition = sim.d.crosswalks[index]
    const centerS = (definition.from + definition.to) / 2
    const a = courseToWorld(sim, centerS, -sim.d.lane_width - 0.4)
    const b = courseToWorld(sim, centerS, sim.d.lane_width + 0.4)
    const group = new THREE.Group()
    box(group, [0.38, 1.05, 0.3], [0, 1.05, 0], standard(0xf97316))
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), standard(0xf1c8a6))
    head.position.y = 1.78
    group.add(head)
    group.visible = false
    this.pedestrians.push({ index, group, start: new THREE.Vector3(a.x, 0, -a.y), delta: new THREE.Vector3(b.x - a.x, 0, -(b.y - a.y)) })
    this.world.add(group)
  }

  private addRoadside(sim: Sim) {
    const materials = [standard(0xd6c7ae), standard(0xaebdca), standard(0xc8b7bf), standard(0xb7c5a7)]
    for (let s = 18, i = 0; s < sim.total - 10; s += 24, i++) {
      for (const side of [-1, 1]) {
        const p = courseToWorld(sim, s, side * (sim.d.lane_width + 8 + (i % 3)))
        const height = 5 + ((i * 7 + (side < 0 ? 2 : 0)) % 5) * 1.8
        const building = new THREE.Mesh(new THREE.BoxGeometry(8, height, 8), materials[(i + (side > 0 ? 1 : 0)) % materials.length])
        building.position.set(p.x, height / 2, -p.y)
        building.castShadow = true
        building.receiveShadow = true
        this.world.add(building)
        const tree = new THREE.Group()
        box(tree, [0.35, 2.4, 0.35], [0, 1.2, 0], standard(0x76543c))
        const crown = new THREE.Mesh(new THREE.SphereGeometry(1.45, 12, 9), standard(0x2f6c3e))
        crown.position.y = 3.1
        crown.castShadow = true
        tree.add(crown)
        const tp = courseToWorld(sim, s + 8, side * (sim.d.lane_width + 3.2))
        tree.position.set(tp.x, 0, -tp.y)
        this.world.add(tree)
      }
    }
  }

  private buildCar() {
    box(this.car, [PHYS.halfLen * 2, 0.65, PHYS.halfWidth * 2], [0, 0.58, 0], standard(0x2563eb, 0.32, 0.25))
    box(this.car, [1.9, 0.66, 1.58], [-0.15, 1.16, 0], standard(0x1e293b, 0.2, 0.15))
    for (const x of [-1.35, 1.35]) for (const z of [-0.96, 0.96]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18), standard(0x111827))
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.36, z)
      this.car.add(wheel)
    }
  }

  private clearTransient() {
    for (const child of [...this.transient.children]) {
      this.transient.remove(child)
      disposeObject(child)
    }
  }

  render(sim: Sim, options: Render3DOptions) {
    if (this.disposed) return
    this.car.position.set(sim.x, 0, -sim.y)
    this.car.rotation.y = sim.h

    for (const visual of this.signals) {
      const active = signalState(this.initialSim.d.signals[visual.index], sim.tick)
      ;(['RED', 'YELLOW', 'GREEN'] as const).forEach((name) => {
        const material = visual.lamps[name].material
        material.color.set(name === active ? material.emissive : 0x20262e)
        material.emissiveIntensity = name === active ? 3.5 : 0.02
      })
    }
    for (const visual of this.pedestrians) {
      const definition = this.initialSim.d.crosswalks[visual.index]
      const active = pedestrianActive(definition, sim.tick)
      visual.group.visible = active
      if (active) {
        const phase = ((sim.tick / 30) % definition.ped_period - definition.ped_from) / Math.max(0.01, definition.ped_to - definition.ped_from)
        visual.group.position.copy(visual.start).addScaledVector(visual.delta, phase)
      }
    }

    this.clearTransient()
    if (options.path && options.path.length > 1) {
      const points = options.path.map((p) => new THREE.Vector3(p.x, 0.16, -p.y))
      this.transient.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x38bdf8 })))
    }
    for (const marker of options.markers ?? []) {
      const p = courseToWorld(sim, marker.s, marker.offset)
      const sprite = markerSprite(marker.label, marker.danger)
      sprite.position.set(p.x, 3.2, -p.y)
      this.transient.add(sprite)
    }

    if (options.mode === 'cockpit') {
      this.car.visible = false
      this.cockpit.visible = true
      const forward = new THREE.Vector3(Math.cos(sim.h), 0, -Math.sin(sim.h))
      const right = new THREE.Vector3(Math.sin(sim.h), 0, Math.cos(sim.h))
      const lift = elevationAt(sim.d, sim.s)   // 경사로에서는 시점도 같이 올라간다
      this.camera.position.set(sim.x, 1.48 + lift, -sim.y).addScaledVector(forward, 0.52).addScaledVector(right, -0.34)
      this.camera.up.set(0, 1, 0)
      // 앞쪽 노면 높이를 함께 보므로 오르막에서는 시선이 위로, 내리막에서는 아래로 향한다
      const aheadS = Math.min(sim.total, sim.s + 24)
      this.camera.lookAt(new THREE.Vector3(sim.x, 1.25 + elevationAt(sim.d, aheadS), -sim.y).addScaledVector(forward, 24))
      this.camera.fov = 64
      // 핸들은 조향 입력만큼 돌린다(엔진의 steer 는 -1~1)
      if (this.wheel) this.wheel.rotation.z = -sim.steer * 2.1
    } else {
      this.car.visible = true
      this.cockpit.visible = false
      const bounds = new THREE.Box3()
      for (let index = 0; index < sim.px.length; index++) bounds.expandByPoint(new THREE.Vector3(sim.px[index], 0, -sim.py[index]))
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const height = Math.max(90, Math.max(size.x, size.z) * 0.72)
      this.camera.position.set(center.x + height * 0.28, height, center.z + height * 0.36)
      this.camera.up.set(0, 1, 0)
      this.camera.lookAt(center.x, 0, center.z)
      this.camera.fov = 48
    }
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.scene, this.camera)
    this.rendered = true
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver.disconnect()
    disposeObject(this.scene)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

function addSignalPole(group: THREE.Group, lane: number) {
  const pole = standard(0x26313c, 0.45, 0.5)
  box(group, [0.18, 4.8, 0.18], [0, 2.4, 0], pole)
  box(group, [lane * 2 + 1, 0.18, 0.18], [-lane, 4.65, 0], pole)
  box(group, [0.5, 1.6, 0.38], [-lane * 2, 4.05, 0], standard(0x111827, 0.35))
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite)) return
    object.geometry?.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (material instanceof THREE.SpriteMaterial) material.map?.dispose()
      material.dispose()
    }
  })
}
