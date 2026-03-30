'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore, isSuperAdmin } from '@/lib/stores/auth-store'
import { getApiUrl } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Building2, Globe, Pencil, Plus, Trash2 } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PUBLIC_ORG_NAME } from '@/lib/api/organizations'
import { Badge } from '@/components/ui/badge'

interface Organization {
  id: string
  name: string
  description: string | null
  created: string | null
  updated: string | null
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

export default function OrganizationsAdminPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const router = useRouter()
  const { user } = useAuthStore()
  const superAdmin = isSuperAdmin(user)

  // Org management is super-admin only — redirect others away
  useEffect(() => {
    if (user && !superAdmin) {
      router.replace('/admin/users')
    }
  }, [user, superAdmin, router])

  if (!superAdmin) return null

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Organization | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data: orgs = [], isLoading } = useQuery<Organization[]>({
    queryKey: ['organizations'],
    queryFn: () => apiCall('/api/organizations'),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      apiCall('/api/organizations', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      toast.success(t.auth.orgCreated)
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description: string }) =>
      apiCall(`/api/organizations/${id}`, { method: 'PUT', body: JSON.stringify({ name, description }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      toast.success(t.auth.orgUpdated)
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiCall(`/api/organizations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      toast.success(t.auth.orgDeleted)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openCreate = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setDialogOpen(true)
  }

  const openEdit = (org: Organization) => {
    setEditing(org)
    setName(org.name)
    setDescription(org.description || '')
    setDialogOpen(true)
  }

  const handleSave = () => {
    if (!name.trim()) return
    if (editing) {
      updateMutation.mutate({ id: editing.id, name: name.trim(), description: description.trim() })
    } else {
      createMutation.mutate({ name: name.trim(), description: description.trim() })
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t.auth.orgManagement}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage organizations and data tenants</p>
        </div>
        {superAdmin && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {t.auth.createOrg}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16 space-y-3">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">{t.auth.noOrgs}</p>
            {superAdmin && (
              <Button variant="outline" onClick={openCreate} className="gap-2">
                <Plus className="h-4 w-4" />{t.auth.createOrg}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t.auth.organizations} ({orgs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {orgs.map(org => {
                const isPublic = org.name === PUBLIC_ORG_NAME
                return (
                  <div key={org.id} className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isPublic ? 'bg-blue-500/10' : 'bg-primary/10'}`}>
                      {isPublic
                        ? <Globe className="h-5 w-5 text-blue-500" />
                        : <Building2 className="h-5 w-5 text-primary" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{org.name}</span>
                        {isPublic && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/10 text-blue-600 border-blue-200">
                            系统保留
                          </Badge>
                        )}
                      </div>
                      {org.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{org.description}</div>
                      )}
                      {org.created && (
                        <div className="text-[10px] text-muted-foreground/60 mt-1">
                          Created {new Date(org.created).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isPublic && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(org)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {superAdmin && !isPublic && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t.auth.deleteOrg}</AlertDialogTitle>
                              <AlertDialogDescription>{t.auth.deleteOrgConfirm}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteMutation.mutate(org.id)}
                              >
                                {t.common.delete}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t.auth.editOrg : t.auth.createOrg}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update organization details.' : 'Create a new organization for data tenancy.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t.auth.orgNameLabel}</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Research Team Alpha"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t.auth.orgDescLabel} <span className="text-muted-foreground text-xs">({t.common.optional})</span></Label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
              {isSaving ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
