'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore, isSuperAdmin } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  CheckCircle,
  XCircle,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Building2,
  Users,
  Clock,
  UserX,
  Plus,
  X,
  Crown,
  Search,
  Filter,
} from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PUBLIC_ORG_NAME } from '@/lib/api/organizations'

interface MembershipInfo {
  org_id: string
  org_name: string
  role: string
}

interface UserRecord {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
  status: 'pending' | 'active' | 'suspended'
  org_id: string | null
  memberships: MembershipInfo[]
  created: string | null
  updated: string | null
}

interface Organization {
  id: string
  name: string
}

async function apiCall(url: string, options: RequestInit = {}) {
  const apiUrl = await getApiUrl()
  const { token } = useAuthStore.getState()
  const res = await fetch(`${apiUrl}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

function statusBadge(status: string) {
  const m: Record<string, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    pending: { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    suspended: { label: 'Suspended', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  }
  const v = m[status] || { label: status, cls: '' }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${v.cls}`}>{v.label}</span>
}

export default function UsersAdminPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { user: currentUser, refreshUser } = useAuthStore()
  const superAdmin = isSuperAdmin(currentUser)

  const [addUserOpen, setAddUserOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [newOrgId, setNewOrgId] = useState('')

  const [membershipDialogUserId, setMembershipDialogUserId] = useState<string | null>(null)
  const [addOrgId, setAddOrgId] = useState('')
  const [addOrgRole, setAddOrgRole] = useState('member')

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOrgId, setFilterOrgId] = useState('__all__')
  const [filterStatus, setFilterStatus] = useState('__all__')

  const { data: users = [], isLoading: loadingUsers } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => apiCall('/api/users'),
  })

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ['organizations'],
    queryFn: () => apiCall('/api/organizations'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: string }) =>
      apiCall(`/api/users/${userId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(
        status === 'active' ? t.auth.userApproved :
        status === 'suspended' ? t.auth.userSuspended : 'Status updated',
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiCall(`/api/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(t.auth.roleUpdated)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => apiCall(`/api/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(t.auth.userDeleted)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createUserMutation = useMutation({
    mutationFn: (data: { username: string; email: string; password: string; role: string; org_id?: string }) =>
      apiCall('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(t.auth.userCreated)
      setAddUserOpen(false)
      setNewUsername('')
      setNewEmail('')
      setNewPassword('')
      setNewRole('user')
      setNewOrgId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addMembershipMutation = useMutation({
    mutationFn: ({ userId, org_id, role }: { userId: string; org_id: string; role: string }) =>
      apiCall(`/api/users/${userId}/memberships`, { method: 'POST', body: JSON.stringify({ org_id, role }) }),
    onSuccess: (_, { userId }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      if (currentUser?.id === userId) refreshUser()
      toast.success('组织关联成功')
      setAddOrgId('')
      setAddOrgRole('member')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMembershipMutation = useMutation({
    mutationFn: ({ userId, orgId }: { userId: string; orgId: string }) =>
      apiCall(`/api/users/${userId}/memberships/${orgId}`, { method: 'DELETE' }),
    onSuccess: (_, { userId }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      if (currentUser?.id === userId) refreshUser()
      toast.success('已移除组织关联')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMembershipRoleMutation = useMutation({
    mutationFn: ({ userId, orgId, role }: { userId: string; orgId: string; role: string }) =>
      apiCall(`/api/users/${userId}/memberships/${orgId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
    onSuccess: (_, { userId }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      if (currentUser?.id === userId) refreshUser()
      toast.success('组内角色已更新')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pending = users.filter(u => u.status === 'pending')
  const active = users.filter(u => u.status === 'active')
  const suspended = users.filter(u => u.status === 'suspended')

  // Filtered user list
  const filteredUsers = users.filter(u => {
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      const matchesText =
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      if (!matchesText) return false
    }
    if (filterStatus !== '__all__' && u.status !== filterStatus) return false
    if (filterOrgId !== '__all__') {
      const inOrg = u.memberships?.some(m => m.org_id === filterOrgId)
      if (!inOrg) return false
    }
    return true
  })
  const hasActiveFilter = searchQuery.trim() !== '' || filterOrgId !== '__all__' || filterStatus !== '__all__'

  const managedUser = membershipDialogUserId ? users.find(u => u.id === membershipDialogUserId) : null
  const managedMemberships = managedUser?.memberships || []
  // Exclude "公开" from displayed memberships (it's auto-managed)
  const visibleMemberships = managedMemberships.filter(m => m.org_name !== PUBLIC_ORG_NAME)

  // IDs of orgs where the current user has org_admin role
  const adminOrgIds = new Set(
    (currentUser?.memberships ?? [])
      .filter(m => m.role === 'org_admin')
      .map(m => m.org_id)
  )

  // Exclude "公开", already-joined orgs, and (for org-admins) non-admin orgs from the add dropdown
  const availableOrgsForAdd = orgs.filter(o => {
    if (o.name === PUBLIC_ORG_NAME) return false
    if (managedMemberships.some(m => m.org_id === o.id)) return false
    // Org admins can only assign orgs they administer
    if (!superAdmin && !adminOrgIds.has(o.id)) return false
    return true
  })

  // "初始组织" options for new user: super admin sees all; org admin sees only their admin orgs
  const createUserOrgOptions = orgs.filter(o =>
    o.name !== PUBLIC_ORG_NAME && (superAdmin || adminOrgIds.has(o.id))
  )

  const handleAddUser = () => {
    if (!newUsername.trim() || !newEmail.trim() || !newPassword.trim()) return
    createUserMutation.mutate({
      username: newUsername.trim(),
      email: newEmail.trim(),
      password: newPassword,
      role: newRole,
      org_id: newOrgId || undefined,
    })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t.auth.userManagement}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {superAdmin ? '管理所有用户账号和权限' : '管理您所辖组织的用户'}
          </p>
        </div>
        <Button onClick={() => setAddUserOpen(true)} className="gap-2">
          <Plus className="h-4 w-5" />
          {t.auth.addUser}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Clock className="h-5 w-5 text-yellow-500" />} label={t.auth.pendingUsers} count={pending.length} color="yellow" />
        <StatCard icon={<CheckCircle className="h-5 w-5 text-green-500" />} label={t.auth.activeUsers} count={active.length} color="green" />
        <StatCard icon={<UserX className="h-5 w-5 text-red-500" />} label={t.auth.suspendedUsers} count={suspended.length} color="red" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-9 text-sm"
            placeholder="搜索用户名 / 邮箱..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={filterOrgId} onValueChange={setFilterOrgId}>
          <SelectTrigger className="w-40 h-9 text-sm">
            <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <SelectValue placeholder="所有组织" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">所有组织</SelectItem>
            {orgs.filter(o => o.name !== PUBLIC_ORG_NAME).map(o => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32 h-9 text-sm">
            <SelectValue placeholder="所有状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">所有状态</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-xs text-muted-foreground"
            onClick={() => { setSearchQuery(''); setFilterOrgId('__all__'); setFilterStatus('__all__') }}
          >
            <X className="h-3.5 w-3.5 mr-1" />清除筛选
          </Button>
        )}
      </div>

      {loadingUsers ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">{t.auth.noUsers}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t.auth.users} ({filteredUsers.length}{hasActiveFilter && users.length !== filteredUsers.length ? ` / ${users.length}` : ''})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredUsers.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">未找到符合条件的用户</div>
            ) : (
            <div className="divide-y">
              {filteredUsers.map(user => (
                <div key={user.id} className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-semibold text-primary text-sm">
                    {user.username.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{user.username}</span>
                      <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                        {user.role === 'admin' ? '超级管理员' : '普通用户'}
                      </Badge>
                      {statusBadge(user.status)}
                      {user.id === currentUser?.id && (
                        <Badge variant="outline" className="text-xs">You</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{user.email}</span>
                      {user.role === 'admin' ? (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5 text-blue-500">
                            <Building2 className="h-3 w-3" />
                            <span>全组织权限</span>
                          </span>
                        </>
                      ) : (
                        (() => {
                          const visibleOrgs = user.memberships?.filter(m => m.org_name !== PUBLIC_ORG_NAME) || []
                          return visibleOrgs.length > 0 ? (
                            <>
                              <span>·</span>
                              {visibleOrgs.map(m => (
                                <span key={m.org_id} className="inline-flex items-center gap-0.5">
                                  <Building2 className="h-3 w-3" />
                                  <span>{m.org_name}</span>
                                  {m.role === 'org_admin' && (
                                    <Crown className="h-3 w-3 text-amber-500" />
                                  )}
                                </span>
                              ))}
                            </>
                          ) : null
                        })()
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {/* Super admins have implicit access to all orgs — no manual org management needed */}
                    {user.role !== 'admin' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => {
                          setMembershipDialogUserId(user.id)
                          setAddOrgId('')
                          setAddOrgRole('member')
                        }}
                      >
                        <Building2 className="h-3 w-3" />管理组织
                      </Button>
                    )}

                    {user.status === 'pending' && (
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 bg-green-600 hover:bg-green-700"
                        onClick={() => statusMutation.mutate({ userId: user.id, status: 'active' })}
                        disabled={statusMutation.isPending}
                      >
                        <CheckCircle className="h-3 w-3" />{t.auth.approve}
                      </Button>
                    )}
                    {user.status === 'active' && user.id !== currentUser?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => statusMutation.mutate({ userId: user.id, status: 'suspended' })}
                        disabled={statusMutation.isPending}
                      >
                        <XCircle className="h-3 w-3" />{t.auth.suspend}
                      </Button>
                    )}
                    {user.status === 'suspended' && user.id !== currentUser?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => statusMutation.mutate({ userId: user.id, status: 'active' })}
                        disabled={statusMutation.isPending}
                      >
                        <CheckCircle className="h-3 w-3" />{t.auth.reactivate}
                      </Button>
                    )}

                    {superAdmin && user.id !== currentUser?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => roleMutation.mutate({ userId: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
                        disabled={roleMutation.isPending}
                      >
                        {user.role === 'admin'
                          ? <><ShieldOff className="h-3 w-3" />{t.auth.makeUser}</>
                          : <><ShieldCheck className="h-3 w-3" />{t.auth.makeAdmin}</>
                        }
                      </Button>
                    )}

                    {user.id !== currentUser?.id && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t.auth.deleteUser}</AlertDialogTitle>
                            <AlertDialogDescription>{t.auth.deleteUserConfirm}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteMutation.mutate(user.id)}
                            >
                              {t.common.delete}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              ))}
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Membership Management Dialog */}
      <Dialog open={!!membershipDialogUserId} onOpenChange={(open) => { if (!open) setMembershipDialogUserId(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              管理组织 - {managedUser?.username}
            </DialogTitle>
            <DialogDescription>为用户分配或移除组织关联，并设置组内角色</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {visibleMemberships.length > 0 ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">已关联组织</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {visibleMemberships.map(m => {
                    // Only show action buttons if the current user has admin rights over this org
                    const canManage = superAdmin || adminOrgIds.has(m.org_id)
                    return (
                      <div key={m.org_id} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{m.org_name}</span>
                          <Badge variant={m.role === 'org_admin' ? 'default' : 'secondary'} className="text-[10px]">
                            {m.role === 'org_admin' ? '组管理员' : '普通成员'}
                          </Badge>
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1.5"
                              onClick={() => {
                                updateMembershipRoleMutation.mutate({
                                  userId: membershipDialogUserId!,
                                  orgId: m.org_id,
                                  role: m.role === 'org_admin' ? 'member' : 'org_admin',
                                })
                              }}
                              disabled={updateMembershipRoleMutation.isPending}
                            >
                              {m.role === 'org_admin' ? (
                                <><ShieldOff className="h-3 w-3" />取消管理员</>
                              ) : (
                                <><Crown className="h-3 w-3" />设为管理员</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                removeMembershipMutation.mutate({
                                  userId: membershipDialogUserId!,
                                  orgId: m.org_id,
                                })
                              }}
                              disabled={removeMembershipMutation.isPending}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-muted-foreground">
                该用户尚未关联任何组织（默认自动关联&quot;公开&quot;）
              </div>
            )}

            {availableOrgsForAdd.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">添加组织关联</Label>
                <div className="flex items-center gap-2">
                  <Select value={addOrgId || '__none__'} onValueChange={v => setAddOrgId(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="flex-1 h-9 text-sm">
                      <SelectValue placeholder="选择组织..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">选择组织...</SelectItem>
                      {availableOrgsForAdd.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={addOrgRole} onValueChange={setAddOrgRole}>
                    <SelectTrigger className="w-32 h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">普通成员</SelectItem>
                      <SelectItem value="org_admin">组管理员</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-9 px-3"
                    disabled={!addOrgId || addMembershipMutation.isPending}
                    onClick={() => {
                      if (addOrgId && membershipDialogUserId) {
                        addMembershipMutation.mutate({
                          userId: membershipDialogUserId,
                          org_id: addOrgId,
                          role: addOrgRole,
                        })
                      }
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembershipDialogUserId(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.auth.addUser}</DialogTitle>
            <DialogDescription>{t.auth.addUserDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t.auth.username}</Label>
              <Input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder={t.auth.usernamePlaceholder} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t.auth.email}</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder={t.auth.emailPlaceholder} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t.auth.password}</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>角色</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">普通用户</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>初始组织</Label>
                <Select value={newOrgId || '__none__'} onValueChange={v => setNewOrgId(v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {createUserOrgOptions.map(o => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddUserOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleAddUser} disabled={createUserMutation.isPending || !newUsername.trim() || !newEmail.trim() || !newPassword.trim()}>
              {createUserMutation.isPending ? t.common.saving : t.auth.addUser}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    yellow: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800',
    green: 'bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800',
    red: 'bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800',
  }
  return (
    <Card className={`border ${colorMap[color] || ''}`}>
      <CardContent className="p-4 flex items-center gap-3">
        {icon}
        <div>
          <div className="text-2xl font-bold">{count}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}
