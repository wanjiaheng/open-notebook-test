'use client'

import { useAuthStore, RegisterData } from '@/lib/stores/auth-store'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function useAuth() {
  const router = useRouter()
  const {
    isAuthenticated,
    isLoading,
    isCheckingAuth,
    isInitialized,
    hasHydrated,
    login,
    register,
    logout,
    initialize,
    error,
    authMode,
    authRequired,
    user,
  } = useAuthStore()

  useEffect(() => {
    if (!hasHydrated || isInitialized) return
    void initialize()
  }, [hasHydrated, isInitialized, initialize])

  const handleLogin = async (emailOrPassword: string, password?: string) => {
    const success = await login(emailOrPassword, password)
    if (success) {
      const redirectPath = sessionStorage.getItem('redirectAfterLogin')
      if (redirectPath && redirectPath !== '/login') {
        sessionStorage.removeItem('redirectAfterLogin')
        router.replace(redirectPath)
      } else {
        sessionStorage.removeItem('redirectAfterLogin')
        router.replace('/notebooks')
      }
    }
    return success
  }

  const handleRegister = async (data: RegisterData) => {
    return register(data)
  }

  const handleLogout = () => {
    logout()
    router.replace('/login')
  }

  const isVerifying = !hasHydrated || !isInitialized || isLoading || isCheckingAuth

  return {
    isAuthenticated,
    isLoading: isVerifying,
    error,
    user,
    authMode,
    authRequired,
    login: handleLogin,
    register: handleRegister,
    logout: handleLogout,
  }
}
