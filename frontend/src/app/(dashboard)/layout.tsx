'use client'

import { useAuth } from '@/lib/hooks/use-auth'
import { useVersionCheck } from '@/lib/hooks/use-version-check'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { ModalProvider } from '@/components/providers/ModalProvider'
import { CreateDialogsProvider } from '@/lib/hooks/use-create-dialogs'
import { CommandPalette } from '@/components/common/CommandPalette'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // isLoading is true until store hydration + auth verification are both complete.
  // Only once isLoading === false do we know the definitive isAuthenticated value.
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useVersionCheck()

  useEffect(() => {
    // Never redirect while verification is still in progress.
    if (isLoading) return

    if (!isAuthenticated) {
      const currentPath = window.location.pathname + window.location.search
      sessionStorage.setItem('redirectAfterLogin', currentPath)
      router.replace('/login')
    }
  }, [isAuthenticated, isLoading, router])

  // Show spinner until we know for certain whether the user is authenticated.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  // Render nothing while the redirect to /login is in flight.
  if (!isAuthenticated) {
    return null
  }

  return (
    <ErrorBoundary>
      <CreateDialogsProvider>
        {children}
        <ModalProvider />
        <CommandPalette />
      </CreateDialogsProvider>
    </ErrorBoundary>
  )
}
