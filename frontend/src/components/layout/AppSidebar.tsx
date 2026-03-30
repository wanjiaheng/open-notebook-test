'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore, hasAdminAccess, isSuperAdmin } from '@/lib/stores/auth-store'
import { PUBLIC_ORG_NAME } from '@/lib/api/organizations'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import { useCreateDialogs } from '@/lib/hooks/use-create-dialogs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { LanguageToggle } from '@/components/common/LanguageToggle'
import { TranslationKeys } from '@/lib/locales'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Separator } from '@/components/ui/separator'
import {
  Book,
  Search,
  Mic,
  Bot,
  Shuffle,
  Settings,
  LogOut,
  ChevronLeft,
  Menu,
  FileText,
  Plus,
  Wrench,
  Command,
  ShieldCheck,
  Building2,
  User,
} from 'lucide-react'

const getNavigation = (t: TranslationKeys, isAdmin = false) => [
  {
    title: t.navigation.collect,
    items: [
      { name: t.navigation.sources, href: '/sources', icon: FileText },
    ],
  },
  {
    title: t.navigation.process,
    items: [
      { name: t.navigation.notebooks, href: '/notebooks', icon: Book },
      { name: t.navigation.askAndSearch, href: '/search', icon: Search },
    ],
  },
  {
    title: t.navigation.create,
    items: [
      { name: t.navigation.podcasts, href: '/podcasts', icon: Mic },
    ],
  },
  {
    title: t.navigation.manage,
    items: [
      { name: t.navigation.models, href: '/settings/api-keys', icon: Bot },
      { name: t.navigation.transformations, href: '/transformations', icon: Shuffle },
      { name: t.navigation.settings, href: '/settings', icon: Settings },
      { name: t.navigation.advanced, href: '/advanced', icon: Wrench },
      // Admin panel link – only included when the current user is an admin
      ...(isAdmin ? [{ name: t.auth.adminPanel, href: '/admin', icon: ShieldCheck }] : []),
    ],
  },
]

type CreateTarget = 'source' | 'notebook' | 'podcast'

export function AppSidebar() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const { user, refreshUser } = useAuthStore()
  const isAdmin = hasAdminAccess(user)
  const superAdmin = isSuperAdmin(user)
  const navigation = getNavigation(t, isAdmin)
  const pathname = usePathname()
  const { isCollapsed, toggleCollapse } = useSidebarStore()
  const { openSourceDialog, openNotebookDialog, openPodcastDialog } = useCreateDialogs()

  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [isMac, setIsMac] = useState(true) // Default to Mac for SSR

  // Detect platform for keyboard shortcut display
  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'))
  }, [])

  // Refresh user info on every page navigation to keep org display up-to-date
  useEffect(() => {
    refreshUser()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateSelection = (target: CreateTarget) => {
    setCreateMenuOpen(false)

    if (target === 'source') {
      openSourceDialog()
    } else if (target === 'notebook') {
      openNotebookDialog()
    } else if (target === 'podcast') {
      openPodcastDialog()
    }
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'app-sidebar flex h-full flex-col bg-sidebar border-sidebar-border border-r transition-all duration-300',
          isCollapsed ? 'w-16' : 'w-64'
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center group',
            isCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          )}
        >
          {isCollapsed ? (
            <div className="relative flex items-center justify-center w-full">
              <Image
                src="/logo.svg"
                alt="Open Notebook"
                width={32}
                height={32}
                className="transition-opacity group-hover:opacity-0"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapse}
                className="absolute text-sidebar-foreground hover:bg-sidebar-accent opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Image src="/logo.svg" alt={t.common.appName} width={32} height={32} />
                <span className="text-base font-medium text-sidebar-foreground">
                  {t.common.appName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapse}
                className="text-sidebar-foreground hover:bg-sidebar-accent"
                data-testid="sidebar-toggle"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        <nav
          className={cn(
            'flex-1 min-h-0 overflow-y-auto space-y-1 py-4',
            isCollapsed ? 'px-2' : 'px-3'
          )}
        >
          <div
            className={cn(
              'mb-4',
              isCollapsed ? 'px-0' : 'px-3'
            )}
          >
            <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              {isCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        onClick={() => setCreateMenuOpen(true)}
                        variant="default"
                        size="sm"
                        className="w-full justify-center px-2 bg-primary hover:bg-primary/90 text-primary-foreground border-0"
                        aria-label={t.common.create}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                   <TooltipContent side="right">{t.common.create}</TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuTrigger asChild>
                  <Button
                    onClick={() => setCreateMenuOpen(true)}
                    variant="default"
                    size="sm"
                    className="w-full justify-start bg-primary hover:bg-primary/90 text-primary-foreground border-0"
                   >
                    <Plus className="h-4 w-4 mr-2" />
                    {t.common.create}
                  </Button>
                </DropdownMenuTrigger>
              )}

              <DropdownMenuContent
                align={isCollapsed ? 'end' : 'start'}
                side={isCollapsed ? 'right' : 'bottom'}
                className="w-48"
              >
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleCreateSelection('source')
                  }}
                  className="gap-2"
                >
                   <FileText className="h-4 w-4" />
                  {t.common.source}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleCreateSelection('notebook')
                  }}
                  className="gap-2"
                >
                   <Book className="h-4 w-4" />
                  {t.common.notebook}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    handleCreateSelection('podcast')
                  }}
                  className="gap-2"
                >
                   <Mic className="h-4 w-4" />
                  {t.common.podcast}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {navigation.map((section, index) => (
            <div key={section.title}>
              {index > 0 && (
                <Separator className="my-3" />
              )}
              <div className="space-y-1">
                {!isCollapsed && (
                  <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                    {section.title}
                  </h3>
                )}

                {section.items.map((item) => {
                  const isActive = pathname?.startsWith(item.href) || false
                  const button = (
                    <Button
                      variant={isActive ? 'secondary' : 'ghost'}
                      className={cn(
                        'w-full gap-3 text-sidebar-foreground sidebar-menu-item',
                        isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                        isCollapsed ? 'justify-center px-2' : 'justify-start'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.name}</span>}
                    </Button>
                  )

                  if (isCollapsed) {
                    return (
                      <Tooltip key={item.name}>
                        <TooltipTrigger asChild>
                          <Link href={item.href}>
                            {button}
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">{item.name}</TooltipContent>
                      </Tooltip>
                    )
                  }

                  return (
                    <Link key={item.name} href={item.href}>
                      {button}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          className={cn(
            'border-t border-sidebar-border p-3 space-y-2',
            isCollapsed && 'px-2'
          )}
        >
          {/* Command Palette hint */}
          {!isCollapsed && (
            <div className="px-3 py-1.5 text-xs text-sidebar-foreground/60">
              <div className="flex items-center justify-between">
                 <span className="flex items-center gap-1.5">
                  <Command className="h-3 w-3" />
                  {t.common.quickActions}
                </span>
                <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  {isMac ? <span className="text-xs">⌘</span> : <span>Ctrl+</span>}K
                </kbd>
              </div>
               <p className="mt-1 text-[10px] text-sidebar-foreground/40">
                {t.common.quickActionsDesc}
              </p>
            </div>
          )}

           <div
            className={cn(
              'flex flex-col gap-2',
              isCollapsed ? 'items-center' : 'items-stretch'
            )}
          >
            {isCollapsed ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <ThemeToggle iconOnly />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t.common.theme}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <LanguageToggle iconOnly />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t.common.language}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <ThemeToggle />
                <LanguageToggle />
              </>
            )}
          </div>

          {/* User info + sign out */}
          {!isCollapsed && user && user.id !== 'legacy' && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground space-y-1.5">
              {/* User row */}
              <div className="flex items-center gap-1.5">
                <User className="h-3 w-3 shrink-0 opacity-60" />
                <span className="font-medium truncate">{user.username}</span>
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-medium">
                  {user.role === 'admin' ? '超管' : '用户'}
                </span>
              </div>
              {/* Org row */}
              {superAdmin ? (
                /* Super admins have implicit access to all orgs */
                <div className="flex items-center gap-1 opacity-70 cursor-default min-w-0 text-blue-500">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="text-[11px] font-medium">全组织权限</span>
                </div>
              ) : (() => {
                // Filter out the system public org from display
                const visibleOrgs = (user.memberships ?? []).filter(m => m.org_name !== PUBLIC_ORG_NAME)
                if (visibleOrgs.length > 0) {
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 opacity-70 cursor-default min-w-0">
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {visibleOrgs.length <= 2
                              ? visibleOrgs.map(m => m.org_name).join('、')
                              : `${visibleOrgs[0].org_name} 等${visibleOrgs.length}个组织`}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-[240px]">
                        <div className="space-y-1 text-xs">
                          <div className="font-medium pb-0.5 border-b mb-1">所属组织</div>
                          {visibleOrgs.map(m => (
                            <div key={m.org_id} className="flex items-center justify-between gap-2">
                              <span className="truncate">{m.org_name}</span>
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                m.role === 'org_admin'
                                  ? 'bg-amber-400/90 text-amber-950'
                                  : 'bg-white/20 text-white/90'
                              }`}>
                                {m.role === 'org_admin' ? '组管理员' : '成员'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                }
                return (
                  <div className="flex items-center gap-1 opacity-50">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="text-[11px]">暂无组织</span>
                  </div>
                )
              })()}
            </div>
          )}

          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-center sidebar-menu-item"
                  onClick={logout}
                  aria-label={t.common.signOut}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
               <TooltipContent side="right">{t.common.signOut}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              className="w-full justify-start gap-3 sidebar-menu-item"
              onClick={logout}
              aria-label={t.common.signOut}
             >
              <LogOut className="h-4 w-4" />
              {t.common.signOut}
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
