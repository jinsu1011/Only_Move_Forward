// Web Serial 연결을 화면 이동과 무관하게 유지하는 단일 링크.
import { LineSplitter, parseLine, type FirmwareFormat } from './parser'

export type LinkStatus = 'unsupported' | 'idle' | 'requesting' | 'opening' | 'open' | 'lost' | 'error'

export interface Sample {
  roll: number
  pitch: number | null
  format: FirmwareFormat
  at: number
}

export interface LinkSnapshot {
  status: LinkStatus
  message: string | null
  boardInfo: string | null
  lastSample: Sample | null
  hz: number
  invalidLines: number
  portLabel: string | null
}

type Listener = (s: LinkSnapshot) => void
type SampleListener = (s: Sample) => void

const supported = () => typeof navigator !== 'undefined' && 'serial' in navigator

const preferredPort = (ports: SerialPort[]): SerialPort | null =>
  ports.find((port) => {
    const { usbVendorId, usbProductId } = port.getInfo()
    return usbVendorId === 0x2341 && usbProductId === 0x0043
  }) ?? ports.find((port) => port.getInfo().usbVendorId !== undefined) ?? ports[0] ?? null

class SerialLink {
  private snap: LinkSnapshot = {
    status: supported() ? 'idle' : 'unsupported',
    message: supported() ? null : '이 브라우저는 Web Serial 을 지원하지 않습니다. 데스크톱 Chrome 또는 Edge 에서 열어 주세요.',
    boardInfo: null,
    lastSample: null,
    hz: 0,
    invalidLines: 0,
    portLabel: null,
  }
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private listeners = new Set<Listener>()
  private sampleListeners = new Set<SampleListener>()
  private stamps: number[] = []
  private notifyScheduled = false
  private openedAt = 0

  constructor() {
    if (supported()) {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (this.port && e.target === this.port) this.handleLost('USB 연결이 끊어졌습니다. 케이블을 확인하고 다시 연결하세요.')
      })
      window.setInterval(() => {
        if (this.snap.status !== 'open') return
        const lastDataAt = this.snap.lastSample?.at ?? this.openedAt
        // UNO는 포트를 열 때 리셋되고 펌웨어가 약 2초간 영점을 잡는다.
        // USB 재열거 시간까지 고려해 첫 샘플에만 넉넉한 시작 유예를 둔다.
        const silenceLimit = this.snap.lastSample ? 4500 : 10000
        if (lastDataAt && performance.now() - lastDataAt > silenceLimit) {
          this.handleLost(
            this.snap.lastSample
              ? '센서에서 4.5초 동안 데이터가 오지 않았습니다. 포트를 다시 연결하세요.'
              : '센서 시작 신호를 10초 동안 받지 못했습니다. 보드와 배선을 확인한 뒤 다시 연결하세요.',
          )
        }
      }, 500)
    }
  }

  get snapshot() {
    return this.snap
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onSample(fn: SampleListener) {
    this.sampleListeners.add(fn)
    return () => this.sampleListeners.delete(fn)
  }

  private set(patch: Partial<LinkSnapshot>, immediate = true) {
    this.snap = { ...this.snap, ...patch }
    if (immediate) {
      this.listeners.forEach((l) => l(this.snap))
      return
    }
    if (!this.notifyScheduled) {
      this.notifyScheduled = true
      setTimeout(() => {
        this.notifyScheduled = false
        this.listeners.forEach((l) => l(this.snap))
      }, 50)
    }
  }

  async connect(): Promise<void> {
    if (!supported()) return
    if (this.snap.status === 'open') return

    // 이미 권한을 받은 장치는 선택 창 없이 먼저 다시 연다. 포트 점유가
    // 해제된 직후 사용자가 "센서 연결"을 누르면 이 경로로 바로 복구된다.
    const granted = await navigator.serial.getPorts()
    const knownPort = preferredPort(granted)
    if (knownPort) {
      await this.open(knownPort)
      return
    }

    this.set({ status: 'requesting', message: '연결할 장치를 선택하세요.' })
    let port: SerialPort
    try {
      port = await navigator.serial.requestPort()
    } catch {
      this.set({ status: 'idle', message: '장치 선택이 취소되었습니다.' })
      return
    }
    await this.open(port)
  }

  /** 이전에 허용한 포트가 있으면 선택 창 없이 다시 연결 */
  async reconnectGranted(): Promise<boolean> {
    if (!supported() || this.snap.status === 'open') return this.snap.status === 'open'
    const ports = await navigator.serial.getPorts()
    const port = preferredPort(ports)
    if (!port) return false
    await this.open(port)
    return this.port !== null
  }

  private async open(port: SerialPort) {
    this.set({ status: 'opening', message: '포트를 여는 중…', invalidLines: 0, boardInfo: null, lastSample: null, hz: 0 })
    try {
      await port.open({ baudRate: 115200 })
      // Arduino CLI 시리얼 모니터와 같은 제어 신호를 사용한다. 일부 UNO의
      // USB-Serial 칩은 DTR/RTS가 꺼져 있으면 열린 포트로 데이터를 보내지 않는다.
      await port.setSignals({ dataTerminalReady: true, requestToSend: false, break: false })
    } catch (err) {
      const text = String(err)
      const busy = /already open|Failed to open/i.test(text)
      this.set({
        status: 'error',
        message: busy
          ? '포트를 열 수 없습니다. 아두이노 IDE 시리얼 모니터나 이 포트를 쓰는 다른 브라우저 탭을 닫고 다시 시도하세요.'
          : `포트를 열 수 없습니다: ${text}`,
      })
      return
    }
    this.port = port
    this.openedAt = performance.now()
    const info = port.getInfo()
    this.set({
      status: 'open',
      message: '연결됨. 센서 신호를 기다리는 중…',
      portLabel: info.usbVendorId ? `USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : 'Serial',
    })
    void this.readLoop(port)
  }

  private async readLoop(port: SerialPort) {
    const decoder = new TextDecoder()
    const splitter = new LineSplitter()
    while (port.readable && this.port === port) {
      const reader = port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue
          for (const line of splitter.push(decoder.decode(value, { stream: true }))) this.handleLine(line)
        }
      } catch {
        if (this.port === port) this.handleLost('센서 데이터 수신이 끊어졌습니다.')
      } finally {
        reader.releaseLock()
        this.reader = null
      }
    }
  }

  private handleLine(line: string) {
    const parsed = parseLine(line)
    const now = performance.now()
    if (parsed.kind === 'sample') {
      this.stamps.push(now)
      while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift()
      const sample: Sample = { roll: parsed.roll, pitch: parsed.pitch, format: parsed.format, at: now }
      this.sampleListeners.forEach((l) => l(sample))
      this.set({ lastSample: sample, hz: this.stamps.length, message: null }, false)
    } else if (parsed.kind === 'info') {
      const text =
        parsed.text === 'KEEP_STILL_CALIBRATING'
          ? '보드가 자이로 영점을 잡는 중입니다. 2초간 움직이지 마세요.'
          : parsed.text === 'READY'
            ? '보드 준비 완료'
            : parsed.text
      this.set({ boardInfo: text })
    } else if (parsed.kind === 'error') {
      const text =
        parsed.text === 'MPU6050_NOT_FOUND'
          ? 'MPU-6050 을 찾지 못했습니다. 배선(VCC·GND·SDA·SCL)을 확인하세요.'
          : parsed.text === 'KEEP_STILL_RETRY'
            ? '보정 중 움직임이 감지되어 다시 보정합니다.'
            : parsed.text
      this.set({ boardInfo: text })
    } else {
      this.set({ invalidLines: this.snap.invalidLines + 1 }, false)
    }
  }

  private handleLost(message: string) {
    const port = this.port
    this.port = null
    this.openedAt = 0
    this.stamps = []
    this.set({ status: 'lost', message, hz: 0, lastSample: null })
    if (port) {
      void (async () => {
        try {
          await this.reader?.cancel()
        } catch {
          /* 이미 읽기 스트림이 종료됨 */
        }
        try {
          await port.close()
        } catch {
          /* 연결 해제 이벤트가 먼저 포트를 닫음 */
        }
      })()
    }
  }

  async disconnect() {
    const port = this.port
    this.port = null
    try {
      await this.reader?.cancel()
    } catch {
      /* 이미 닫힘 */
    }
    try {
      await port?.close()
    } catch {
      /* 이미 닫힘 */
    }
    this.stamps = []
    this.set({ status: supported() ? 'idle' : 'unsupported', message: '연결을 해제했습니다.', hz: 0, lastSample: null })
  }
}

export const serialLink = new SerialLink()
