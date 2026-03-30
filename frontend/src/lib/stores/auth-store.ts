import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getApiUrl } from '@/lib/config'

export interface MembershipInfo {
  org_id: string
  org_name: string
  role: 'member' | 'org_admin'
}

export interface UserInfo {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
  status: 'active' | 'pending' | 'suspended'
  org_id: string | null
  org_name: string | null
  memberships: MembershipInfo[]
  created?: string
  updated?: string
}

export function hasAdminAccess(user: UserInfo | null): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return user.memberships?.some(m => m.role === 'org_admin') ?? false
}

export function isSuperAdmin(user: UserInfo | null): boolean {
  if (!user) return false
  return user.role === 'admin'
}

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  user: UserInfo | null
  isLoading: boolean
  error: string | null
  lastAuthCheck: number | null
  isCheckingAuth: boolean
  isInitialized: boolean
  hasHydrated: boolean
  authRequired: boolean | null
  authMode: 'jwt' | 'password' | 'none' | null

  setHasHydrated: (state: boolean) => void
  initialize: () => Promise<void>
  login: (emailOrPassword: string, password?: string) => Promise<boolean>
  register: (data: RegisterData) => Promise<{ success: boolean; requiresApproval?: boolean; message?: string }>
  logout: () => void
  checkAuth: () => Promise<boolean>
  refreshUser: () => Promise<void>
}

export interface RegisterData {
  username: string
  email: string
  password: string
  org_id?: string
  org_name?: string
}

let _initPromise: Promise<void> | null = null

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      token: null,
      user: null,
      isLoading: false,
      error: null,
      lastAuthCheck: null,
      isCheckingAuth: false,
      isInitialized: false,
      hasHydrated: false,
      authRequired: null,
      authMode: null,

      setHasHydrated: (state: boolean) => {
        set({ hasHydrated: state })
      },

      initialize: async () => {
        if (_initPromise) return _initPromise

        _initPromise = (async () => {
          try {
            const apiUrl = await getApiUrl()
            const res = await fetch(`${apiUrl}/api/auth/status`, { cache: 'no-store' })
            if (!res.ok) throw new Error(`status ${res.status}`)

            const data = await res.json()
            const required: boolean = data.auth_enabled || false
            const mode = (data.auth_mode || 'none') as AuthState['authMode']

            set({ authRequired: required, authMode: mode, error: null })

            if (!required) {
              set({ isAuthenticated: true, token: 'not-required', isInitialized: true })
              return
            }

            const { token } = get()
            if (!token) {
              set({ isAuthenticated: false, user: null, isInitialized: true })
              return
            }

            const meRes = await fetch(`${apiUrl}/api/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (meRes.ok) {
              const user = await meRes.json()
              set({ isAuthenticated: true, user, lastAuthCheck: Date.now(), isInitialized: true })
            } else {
              set({ isAuthenticated: false, token: null, user: null, lastAuthCheck: null, isInitialized: true })
            }
          } catch (err) {
            console.error('Auth init failed:', err)
            if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
              set({
                error: 'Unable to connect to server. Please check if the API is running.',
                authRequired: null,
                isInitialized: true,
              })
            } else {
              set({ authRequired: true, authMode: 'jwt', isInitialized: true })
            }
          }
        })()

        try {
          await _initPromise
        } finally {
          _initPromise = null
        }
      },

      login: async (emailOrPassword: string, password?: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()

          if (password !== undefined) {
            const email = emailOrPassword
            const response = await fetch(`${apiUrl}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
            })

            if (response.ok) {
              const data = await response.json()
              set({
                isAuthenticated: true,
                token: data.access_token,
                user: data.user,
                isLoading: false,
                lastAuthCheck: Date.now(),
                error: null,
                isInitialized: true,
              })
              return true
            } else {
              const err = await response.json().catch(() => ({}))
              let msg = 'Authentication failed'
              if (response.status === 401) msg = 'Invalid email or password'
              else if (response.status === 403) msg = err.detail || 'Access denied'
              else if (response.status >= 500) msg = 'Server error. Please try again later.'
              set({ error: msg, isLoading: false, isAuthenticated: false, token: null, user: null })
              return false
            }
          }

          // Legacy password mode (single arg = password, no email)
          const pass = emailOrPassword
          const response = await fetch(`${apiUrl}/api/auth/me`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${pass}` },
          })

          if (response.ok) {
            const user = await response.json()
            set({
              isAuthenticated: true,
              token: pass,
              user,
              isLoading: false,
              lastAuthCheck: Date.now(),
              error: null,
              isInitialized: true,
            })
            return true
          } else {
            const msg = response.status === 401
              ? 'Invalid password. Please try again.'
              : `Authentication failed (${response.status})`
            set({ error: msg, isLoading: false, isAuthenticated: false, token: null, user: null })
            return false
          }
        } catch (error) {
          const msg =
            error instanceof TypeError && error.message.includes('Failed to fetch')
              ? 'Unable to connect to server.'
              : error instanceof Error
                ? `Network error: ${error.message}`
                : 'An unexpected error occurred'
          set({ error: msg, isLoading: false, isAuthenticated: false, token: null, user: null })
          return false
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()
          const response = await fetch(`${apiUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          })

          const result = await response.json().catch(() => ({}))

          if (response.ok) {
            set({ isLoading: false, error: null })
            return {
              success: true,
              requiresApproval: result.requires_approval,
              message: result.message,
            }
          } else {
            const msg = result.detail || 'Registration failed'
            set({ error: msg, isLoading: false })
            return { success: false, message: msg }
          }
        } catch (error) {
          const msg =
            error instanceof TypeError && error.message.includes('Failed to fetch')
              ? 'Unable to connect to server.'
              : 'An unexpected error occurred'
          set({ error: msg, isLoading: false })
          return { success: false, message: msg }
        }
      },

      logout: () => {
        set({
          isAuthenticated: false,
          token: null,
          user: null,
          error: null,
          lastAuthCheck: null,
        })
      },

      checkAuth: async () => {
        const { token, lastAuthCheck, isCheckingAuth, isAuthenticated } = get()

        if (isCheckingAuth) return isAuthenticated
        if (!token) return false

        const now = Date.now()
        if (isAuthenticated && lastAuthCheck && now - lastAuthCheck < 30_000) return true

        set({ isCheckingAuth: true })

        try {
          const apiUrl = await getApiUrl()
          const response = await fetch(`${apiUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (response.ok) {
            const user = await response.json()
            set({ isAuthenticated: true, user, lastAuthCheck: now, isCheckingAuth: false })
            return true
          } else {
            set({ isAuthenticated: false, token: null, user: null, lastAuthCheck: null, isCheckingAuth: false })
            return false
          }
        } catch {
          set({ isAuthenticated: false, token: null, user: null, lastAuthCheck: null, isCheckingAuth: false })
          return false
        }
      },

      refreshUser: async () => {
        const { token } = get()
        if (!token || token === 'not-required') return

        try {
          const apiUrl = await getApiUrl()
          const response = await fetch(`${apiUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (response.ok) {
            const user = await response.json()
            set({ user, lastAuthCheck: Date.now() })
          }
        } catch {
          // ignore
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        authMode: state.authMode,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    },
  ),
)