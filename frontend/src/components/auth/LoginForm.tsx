'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { getApiUrl, getConfig } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { AlertCircle, BookOpen, Building2, CheckCircle2, ChevronRight, Lock, Mail, User } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'

type Tab = 'login' | 'register'
type OrgMode = 'none' | 'join'

interface Organization {
  id: string
  name: string
  description?: string
}

export function LoginForm() {
  const { t } = useTranslation()
  const router = useRouter()

  const { login, register, isLoading, error, isAuthenticated, authRequired } = useAuth()

  // --- ui state ---
  const [tab, setTab] = useState<Tab>('login')
  const [configInfo, setConfigInfo] = useState<{ apiUrl: string; version: string } | null>(null)
  const [registrationDone, setRegistrationDone] = useState(false)
  const [registrationMsg, setRegistrationMsg] = useState('')
  const [registrationNeedsApproval, setRegistrationNeedsApproval] = useState(false)

  // --- login form ---
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // --- register form ---
  const [regUsername, setRegUsername] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [orgMode, setOrgMode] = useState<OrgMode>('none')
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [formError, setFormError] = useState('')

  useEffect(() => {
    getConfig().then(cfg => setConfigInfo({ apiUrl: cfg.apiUrl, version: cfg.version })).catch(() => null)
  }, [])

  useEffect(() => {
    if (tab !== 'register') return
    getApiUrl().then(apiUrl => {
      fetch(`${apiUrl}/api/organizations`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setOrgs(Array.isArray(data) ? data : []))
        .catch(() => setOrgs([]))
    })
  }, [tab])

  // Once auth verification finishes, redirect authenticated users away from login.
  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated) {
      router.replace('/notebooks')
    }
  }, [isLoading, isAuthenticated, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!loginEmail.trim() || !loginPassword.trim()) return
    await login(loginEmail.trim(), loginPassword)
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (regPassword !== regConfirm) {
      setFormError(t.auth.passwordMismatch)
      return
    }

    const result = await register({
      username: regUsername.trim(),
      email: regEmail.trim(),
      password: regPassword,
      org_id: orgMode === 'join' ? selectedOrgId || undefined : undefined,
    })

    if (result.success) {
      setRegistrationDone(true)
      setRegistrationMsg(result.message || '')
      setRegistrationNeedsApproval(result.requiresApproval || false)
    } else {
      setFormError(result.message || 'Registration failed')
    }
  }

  // ---- Loading state ----
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    )
  }

  // Connection error
  if (authRequired === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{t.common.connectionError}</CardTitle>
            <CardDescription>{t.common.unableToConnect}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error || t.auth.connectErrorHint}</span>
              </div>
              {configInfo && (
                <div className="text-xs text-muted-foreground border-t pt-3 space-y-1 font-mono">
                  <div>{t.common.version}: {configInfo.version}</div>
                  <div className="break-all">{t.common.apiUrl}: {configInfo.apiUrl}</div>
                </div>
              )}
              <Button onClick={() => window.location.reload()} className="w-full">
                {t.common.retryConnection}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Registration success
  if (registrationDone) {
    return (
      <AuthShell>
        <Card className="w-full max-w-md shadow-xl border-0">
          <CardHeader className="text-center space-y-3 pb-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-xl">{t.auth.registrationSuccess}</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              {registrationNeedsApproval ? t.auth.pendingApprovalDesc : registrationMsg}
            </CardDescription>
          </CardHeader>
          <CardFooter className="pt-4">
            <Button className="w-full" onClick={() => { setRegistrationDone(false); setTab('login') }}>
              {t.auth.backToLogin}
            </Button>
          </CardFooter>
        </Card>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <Card className="w-full max-w-md shadow-xl border-0">
        <CardHeader className="text-center space-y-1 pb-4">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {tab === 'login' ? t.auth.loginTitle : t.auth.registerTitle}
          </CardTitle>
          <CardDescription>
            {tab === 'login' ? t.auth.loginDesc : t.auth.registerDesc}
          </CardDescription>
        </CardHeader>

        {/* Tab switcher – always visible */}
        <div className="px-6 pb-2">
          <div className="flex rounded-lg bg-muted p-1">
            <button
              onClick={() => setTab('login')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'login' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.auth.signIn}
            </button>
            <button
              onClick={() => setTab('register')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${tab === 'register' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.auth.register}
            </button>
          </div>
        </div>

        <CardContent className="pt-2">
          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">{t.auth.email}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login-email"
                    type="email"
                    placeholder={t.auth.emailPlaceholder}
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    className="pl-9"
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">{t.auth.passwordPlaceholder}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="pl-9"
                    disabled={isLoading}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              {(error || formError) && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{formError || error}</span>
                </div>
              )}

              <Button type="submit" className="w-full h-10" disabled={isLoading}>
                {isLoading ? (
                  <span className="flex items-center gap-2"><LoadingSpinner />{t.auth.signingIn}</span>
                ) : (
                  <span className="flex items-center gap-2">{t.auth.signIn}<ChevronRight className="h-4 w-4" /></span>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-username">{t.auth.username}</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-username"
                      placeholder={t.auth.usernamePlaceholder}
                      value={regUsername}
                      onChange={e => setRegUsername(e.target.value)}
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">{t.auth.email}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder={t.auth.emailPlaceholder}
                      value={regEmail}
                      onChange={e => setRegEmail(e.target.value)}
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-password">{t.auth.passwordPlaceholder}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="••••••••"
                    value={regPassword}
                    onChange={e => setRegPassword(e.target.value)}
                    className="pl-9"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-confirm">{t.auth.confirmPassword}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="reg-confirm"
                    type="password"
                    placeholder="••••••••"
                    value={regConfirm}
                    onChange={e => setRegConfirm(e.target.value)}
                    className="pl-9"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              {/* Organization section – join only; creating orgs requires admin */}
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t.auth.orgSection}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t.auth.orgSectionDesc}</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {(['none', 'join'] as OrgMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOrgMode(mode)}
                      className={`text-xs py-1.5 px-2 rounded-md border transition-all ${orgMode === mode ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}
                    >
                      {mode === 'none' ? t.auth.noOrg : t.auth.joinExistingOrg}
                    </button>
                  ))}
                </div>

                {orgMode === 'join' && (
                  <select
                    value={selectedOrgId}
                    onChange={e => setSelectedOrgId(e.target.value)}
                    className="w-full mt-1 text-sm rounded-md border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={isLoading}
                  >
                    <option value="">{t.auth.selectOrg}</option>
                    {orgs.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {(error || formError) && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{formError || error}</span>
                </div>
              )}

              <Button type="submit" className="w-full h-10" disabled={isLoading}>
                {isLoading ? (
                  <span className="flex items-center gap-2"><LoadingSpinner />{t.auth.registering}</span>
                ) : (
                  <span className="flex items-center gap-2">{t.auth.register}<ChevronRight className="h-4 w-4" /></span>
                )}
              </Button>
            </form>
          )}
        </CardContent>

        {configInfo && (
          <CardFooter className="flex-col gap-1 pt-0 pb-4">
            <div className="text-[10px] text-muted-foreground text-center font-mono">
              {t.common.version} {configInfo.version} · {configInfo.apiUrl}
            </div>
          </CardFooter>
        )}
      </Card>
    </AuthShell>
  )
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/30">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  )
}
