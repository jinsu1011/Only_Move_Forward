import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api/client'
import type { LicenseType, User } from './api/types'

interface AuthValue {
  user: User | null | undefined
  login: (email: string, password: string) => Promise<User>
  signup: (body: { email: string; password: string; nickname: string; license_type: LicenseType }) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    api<User>('GET', '/me').then(setUser).catch(() => setUser(null))
    const onUnauthorized = () => setUser(null)
    window.addEventListener('lf:unauthorized', onUnauthorized)
    return () => window.removeEventListener('lf:unauthorized', onUnauthorized)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const u = await api<User>('POST', '/auth/login', { email, password })
    setUser(u)
    return u
  }, [])
  const signup = useCallback(async (body: { email: string; password: string; nickname: string; license_type: LicenseType }) => {
    const u = await api<User>('POST', '/auth/signup', body)
    setUser(u)
    return u
  }, [])
  const logout = useCallback(async () => {
    try {
      await api('POST', '/auth/logout')
    } finally {
      setUser(null)
    }
  }, [])

  return <AuthContext.Provider value={{ user, login, signup, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const v = useContext(AuthContext)
  if (!v) throw new Error('AuthProvider missing')
  return v
}
