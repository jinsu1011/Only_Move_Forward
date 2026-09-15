// API 호출 공통: 세션 쿠키, CSRF 헤더, 재시도 중복 방지 키, 오류 형식 통일
export class ApiError extends Error {
  status: number
  code: string
  details?: { field: string; reason: string }[]
  constructor(status: number, code: string, message: string, details?: { field: string; reason: string }[]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const readCookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(name + '='))
    ?.split('=')[1] ?? null

async function ensureCsrf(): Promise<string> {
  let token = readCookie('lf_csrf')
  if (!token) {
    await fetch('/api/v1/auth/csrf', { credentials: 'include' })
    token = readCookie('lf_csrf')
  }
  return token ?? ''
}

export const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export async function api<T>(method: Method, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf()
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  let res: Response
  const attempt = () =>
    fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    res = await attempt()
  } catch {
    // 네트워크 오류: 조회나 재시도 키가 있는 요청만 한 번 더
    if (method === 'GET' || opts.idempotencyKey || method === 'PUT') {
      try {
        res = await attempt()
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결할 수 없습니다. 네트워크 또는 서버 실행 상태를 확인해 주세요.')
      }
    } else {
      throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결할 수 없습니다. 네트워크 또는 서버 실행 상태를 확인해 주세요.')
    }
  }
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: { field: string; reason: string }[] } })?.error
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('lf:unauthorized'))
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? '요청을 처리하지 못했습니다.', err?.details)
  }
  return data as T
}
