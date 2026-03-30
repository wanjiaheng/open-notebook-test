'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { NotebookResponse } from '@/lib/types/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MoreHorizontal, Archive, ArchiveRestore, Trash2, FileText, StickyNote, User, Building2, Settings2, Globe } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { useState, useMemo } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { useAuthStore, MembershipInfo, isSuperAdmin } from '@/lib/stores/auth-store'
import { organizationsApi, PUBLIC_ORG_NAME } from '@/lib/api/organizations'

interface OrgOption {
  id: string
  name: string
  isPublic: boolean
}

interface NotebookCardProps {
  notebook: NotebookResponse
}

export function NotebookCard({ notebook }: NotebookCardProps) {
  const { t, language } = useTranslation()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showOrgDialog, setShowOrgDialog] = useState(false)
  const router = useRouter()
  const updateNotebook = useUpdateNotebook()
  const { user } = useAuthStore()
  const memberships: MembershipInfo[] = user?.memberships ?? []
  const superAdmin = isSuperAdmin(user)

  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.list(),
    enabled: showOrgDialog,
  })

  const publicOrg = useMemo(() => orgs.find(o => o.name === PUBLIC_ORG_NAME), [orgs])
  const orgOptions: OrgOption[] = useMemo(() => {
    const opts: OrgOption[] = []
    if (publicOrg) opts.push({ id: publicOrg.id, name: publicOrg.name, isPublic: true })

    if (superAdmin) {
      // 超级管理员可选所有组织
      orgs.forEach(o => {
        if (o.id !== publicOrg?.id) opts.push({ id: o.id, name: o.name, isPublic: false })
      })
    } else {
      // 普通用户只能选自己所属的组织
      memberships.forEach(m => {
        if (m.org_id !== publicOrg?.id) opts.push({ id: m.org_id, name: m.org_name, isPublic: false })
      })
    }
    return opts
  }, [publicOrg, orgs, memberships, superAdmin])

  const [editOrgIds, setEditOrgIds] = useState<Set<string>>(new Set())

  const handleArchiveToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived }
    })
  }

  const handleCardClick = () => {
    router.push(`/notebooks/${encodeURIComponent(notebook.id)}`)
  }

  const openOrgDialog = () => {
    setEditOrgIds(new Set(notebook.orgs.map(o => o.id)))
    // Defer opening so DropdownMenu can fully close and clean up first, avoiding focus/click conflicts
    setTimeout(() => setShowOrgDialog(true), 50)
  }

  const toggleEditOrg = (opt: OrgOption) => {
    setEditOrgIds(prev => {
      const next = new Set(prev)
      if (opt.isPublic) {
        if (next.has(opt.id)) next.clear()
        else return new Set([opt.id])
      } else {
        if (next.has(opt.id)) next.delete(opt.id)
        else {
          next.add(opt.id)
          if (publicOrg) next.delete(publicOrg.id)
        }
      }
      return next
    })
  }

  const handleSaveOrgs = () => {
    updateNotebook.mutate({
      id: notebook.id,
      data: { org_ids: Array.from(editOrgIds) }
    })
    setShowOrgDialog(false)
  }

  return (
    <>
      <Card 
        className="group card-hover"
        onClick={handleCardClick}
        style={{ cursor: 'pointer' }}
      >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base truncate group-hover:text-primary transition-colors">
                  {notebook.name}
                </CardTitle>
                {notebook.archived && (
                  <Badge variant="secondary" className="mt-1">
                    {t.notebooks.archived}
                  </Badge>
                )}
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-50 hover:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {orgOptions.length > 0 && (
                    <>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openOrgDialog() }}>
                        <Settings2 className="h-4 w-4 mr-2" />
                        管理组织
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={handleArchiveToggle}>
                    {notebook.archived ? (
                      <>
                        <ArchiveRestore className="h-4 w-4 mr-2" />
                        {t.notebooks.unarchive}
                      </>
                    ) : (
                      <>
                        <Archive className="h-4 w-4 mr-2" />
                        {t.notebooks.archive}
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowDeleteDialog(true)
                    }}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t.common.delete}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          
          <CardContent>
            <CardDescription className="line-clamp-2 text-sm">
              {notebook.description || t.chat.noDescription}
            </CardDescription>

            {/* Org badges */}
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {notebook.orgs.length > 0 ? (
                notebook.orgs.map(o => (
                  <Badge key={o.id} variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                    {o.name === PUBLIC_ORG_NAME ? (
                      <Globe className="h-2.5 w-2.5" />
                    ) : (
                      <Building2 className="h-2.5 w-2.5" />
                    )}
                    {o.name}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal text-muted-foreground">
                  <User className="h-2.5 w-2.5" />
                  个人
                </Badge>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t.common.updated.replace('{time}', formatDistanceToNow(new Date(notebook.updated), { 
                  addSuffix: true,
                  locale: getDateLocale(language)
                }))}
              </span>
              {notebook.creator_name && (
                <span className="flex items-center gap-1 shrink-0 ml-2">
                  <User className="h-3 w-3" />
                  {notebook.creator_name}
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-1.5 border-t pt-3">
              <Badge variant="outline" className="text-xs flex items-center gap-1 px-1.5 py-0.5 text-primary border-primary/50">
                <FileText className="h-3 w-3" />
                <span>{notebook.source_count}</span>
              </Badge>
              <Badge variant="outline" className="text-xs flex items-center gap-1 px-1.5 py-0.5 text-primary border-primary/50">
                <StickyNote className="h-3 w-3" />
                <span>{notebook.note_count}</span>
              </Badge>
            </div>
          </CardContent>
      </Card>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
      />

      {/* Org management dialog */}
      <Dialog open={showOrgDialog} onOpenChange={setShowOrgDialog}>
        <DialogContent
          className="sm:max-w-[400px]"
          onClick={e => e.stopPropagation()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>管理组织关联</DialogTitle>
            <DialogDescription>
              选择该笔记本对哪些组织可见
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {orgOptions.map(opt => (
              <label
                key={opt.id}
                className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5 transition-colors"
              >
                <Checkbox
                  checked={editOrgIds.has(opt.id)}
                  onCheckedChange={() => toggleEditOrg(opt)}
                />
                {opt.isPublic ? (
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm">{opt.name}</span>
                {opt.isPublic && (
                  <span className="text-[10px] text-muted-foreground">(与其它组互斥)</span>
                )}
              </label>
            ))}
            {orgOptions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">暂无可关联的组织</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowOrgDialog(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSaveOrgs} disabled={updateNotebook.isPending}>
              {updateNotebook.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
