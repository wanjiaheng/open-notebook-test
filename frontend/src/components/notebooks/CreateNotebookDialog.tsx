'use client'

import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useCreateNotebook } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useAuthStore, MembershipInfo } from '@/lib/stores/auth-store'
import { organizationsApi, PUBLIC_ORG_NAME } from '@/lib/api/organizations'
import { Building2, Globe } from 'lucide-react'

const createNotebookSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})

type CreateNotebookFormData = z.infer<typeof createNotebookSchema>

interface OrgOption {
  id: string
  name: string
  isPublic: boolean
}

interface CreateNotebookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateNotebookDialog({ open, onOpenChange }: CreateNotebookDialogProps) {
  const { t } = useTranslation()
  const createNotebook = useCreateNotebook()
  const { user } = useAuthStore()
  const memberships: MembershipInfo[] = user?.memberships ?? []

  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.list(),
    enabled: open,
  })

  const publicOrg = useMemo(() => orgs.find(o => o.name === PUBLIC_ORG_NAME), [orgs])
  const orgOptions: OrgOption[] = useMemo(() => {
    const opts: OrgOption[] = []
    if (publicOrg) opts.push({ id: publicOrg.id, name: publicOrg.name, isPublic: true })
    memberships.forEach(m => {
      if (m.org_id !== publicOrg?.id) opts.push({ id: m.org_id, name: m.org_name, isPublic: false })
    })
    return opts
  }, [publicOrg, memberships])

  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set())

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<CreateNotebookFormData>({
    resolver: zodResolver(createNotebookSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
    },
  })

  const closeDialog = () => onOpenChange(false)

  const toggleOrg = (opt: OrgOption) => {
    setSelectedOrgIds(prev => {
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

  const onSubmit = async (data: CreateNotebookFormData) => {
    const orgIds = Array.from(selectedOrgIds)
    await createNotebook.mutateAsync({
      ...data,
      org_ids: orgIds.length > 0 ? orgIds : undefined,
    })
    closeDialog()
    reset()
    setSelectedOrgIds(new Set())
  }

  useEffect(() => {
    if (!open) {
      reset()
      setSelectedOrgIds(new Set())
    }
  }, [open, reset])

  const hasPublicSelected = publicOrg && selectedOrgIds.has(publicOrg.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t.notebooks.createNew}</DialogTitle>
          <DialogDescription>
            {t.notebooks.createNewDesc}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notebook-name">{t.common.name} *</Label>
            <Input
              id="notebook-name"
              {...register('name')}
              placeholder={t.notebooks.namePlaceholder}
              autoComplete="off"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-description">{t.common.description}</Label>
            <Textarea
              id="notebook-description"
              {...register('description')}
              placeholder={t.notebooks.descPlaceholder}
              rows={3}
            />
          </div>

          {orgOptions.length > 0 && (
            <div className="space-y-2">
              <Label>可见范围</Label>
              <div className="rounded-md border p-3 space-y-2">
                {orgOptions.map(opt => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1 -mx-1.5 transition-colors"
                  >
                    <Checkbox
                      checked={selectedOrgIds.has(opt.id)}
                      onCheckedChange={() => toggleOrg(opt)}
                    />
                    {opt.isPublic ? (
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm truncate">{opt.name}</span>
                    {opt.isPublic && (
                      <span className="text-[10px] text-muted-foreground">(与其它组互斥)</span>
                    )}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {selectedOrgIds.size === 0
                  ? '未选择组织，仅自己和管理员可见'
                  : hasPublicSelected
                    ? '公开组：所有人可见'
                    : `已选 ${selectedOrgIds.size} 个组织，组织内成员均可查看`}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!isValid || createNotebook.isPending}>
              {createNotebook.isPending ? t.common.creating : t.notebooks.createNew}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
