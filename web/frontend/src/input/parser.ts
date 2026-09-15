// 시리얼 한 줄을 해석한다. 지원 형식:
//  WME 펌웨어      : WME,<t_ms>,<roll>,<pitch>,<yaw>
//  프로토타입 펌웨어: <roll>,<pitch>
//  단일 값         : <roll>
// INFO,/ERR, 줄은 상태 메시지로 전달한다.
export type FirmwareFormat = 'WME' | 'ROLL_PITCH' | 'ROLL'

export type ParsedLine =
  | { kind: 'sample'; roll: number; pitch: number | null; format: FirmwareFormat }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'invalid'; text: string }

const angle = (v: string): number | null => {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null
}

export function parseLine(raw: string): ParsedLine {
  const line = raw.trim()
  if (!line) return { kind: 'invalid', text: raw }
  if (line.startsWith('INFO,')) return { kind: 'info', text: line.slice(5) }
  if (line.startsWith('ERR,')) return { kind: 'error', text: line.slice(4) }
  const f = line.split(',')
  if (f[0] === 'WME') {
    if (f.length !== 5) return { kind: 'invalid', text: line }
    const roll = angle(f[2])
    const pitch = angle(f[3])
    if (roll === null || pitch === null || angle(f[1]) === null && !Number.isFinite(Number(f[1]))) return { kind: 'invalid', text: line }
    return { kind: 'sample', roll, pitch, format: 'WME' }
  }
  if (f.length === 2) {
    const roll = angle(f[0])
    const pitch = angle(f[1])
    if (roll === null || pitch === null) return { kind: 'invalid', text: line }
    return { kind: 'sample', roll, pitch, format: 'ROLL_PITCH' }
  }
  if (f.length === 1) {
    const roll = angle(f[0])
    if (roll === null) return { kind: 'invalid', text: line }
    return { kind: 'sample', roll, pitch: null, format: 'ROLL' }
  }
  return { kind: 'invalid', text: line }
}

/** 조각난 바이트 스트림을 줄 단위로 나눈다. 너무 긴 쓰레기 버퍼는 버린다. */
export class LineSplitter {
  private buf = ''
  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split(/\r?\n/)
    this.buf = parts.pop() ?? ''
    if (this.buf.length > 512) this.buf = ''
    return parts
  }
}
