'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore, hasAdminAccess, isSuperAdmin } from '@/lib/stores/auth-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowLeft, Building2, ClipboardList, ShieldCheck, Users } from 'lucide-react'
import { useEffect } from 'react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuthStore()
  const superAdmin = isSuperAdmin(user)

  // Build nav dynamically: org management is super-admin only
  const menuItems = [
    { href: '/admin/users', label: t.auth.userManagement, icon: Users },
    ...(superAdmin ? [{ href: '/admin/organizations', label: t.auth.orgManagement, icon: Building2 }] : []),
    ...(superAdmin ? [{ href: '/admin/audit-logs', label: '日志审计', icon: ClipboardList }] : []),
  ]

  useEffect(() => {
    if (user && !hasAdminAccess(user)) {
      router.replace('/notebooks')
    }
  }, [user, router])

  if (!user || !hasAdminAccess(user)) return null

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">{t.auth.adminPanel}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs text-muted-foreground"
            onClick={() => router.push('/notebooks')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t.auth.backToHome}
          </Button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {menuItems.map(item => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/')
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'w-full justify-start gap-2 text-sm',
                    active && 'bg-accent font-medium',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            )
          })}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
