// 주행 키 상태. 텍스트 입력 중에는 가로채지 않는다(R 은 일반 문자).
export interface KeyState {
  forward: boolean
  reverse: boolean
  left: boolean
  right: boolean
}

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export type DriveInputMode = 'KEYBOARD' | 'SENSOR'

export function applyKey(state: KeyState, e: KeyboardEvent, down: boolean, mode: DriveInputMode): boolean {
  if (mode === 'SENSOR') {
    if (e.code === 'ArrowUp') state.forward = down
    else if (e.code === 'ArrowDown') state.reverse = down
    else return false
  } else if (e.code === 'KeyW') state.forward = down
  else if (e.code === 'KeyS') state.reverse = down
  else if (e.code === 'KeyA') state.left = down
  else if (e.code === 'KeyD') state.right = down
  else return false
  return true
}

export const emptyKeys = (): KeyState => ({ forward: false, reverse: false, left: false, right: false })

export const isRestartKey = (e: KeyboardEvent) => e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)
