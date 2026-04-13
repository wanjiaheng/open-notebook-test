'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { NotebookList } from './components/NotebookList'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Filter } from 'lucide-react'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useAuthStore, MembershipInfo } from '@/lib/stores/auth-store'
import { NotebookResponse } from '@/lib/types/api'
import { organizationsApi, PUBLIC_ORG_NAME } from '@/lib/api/organizations'
import { parseAgentMeta } from '@/lib/agents/agent-meta'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export default function NotebooksPage() {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [orgFilter, setOrgFilter] = useState<string>('__all__')
  const { data: notebooks, isLoading, refetch } = useNotebooks(false)
  const { data: archivedNotebooks } = useNotebooks(true)
  const { data: orgs = [] } = useQuery({ queryKey: ['organizations'], queryFn: () => organizationsApi.list() })
  const { user } = useAuthStore()
  const memberships: MembershipInfo[] = user?.memberships ?? []

  const normalizedQuery = searchTerm.trim().toLowerCase()

  const matchesSearch = (notebook: NotebookResponse, query: string) => {
    return notebook.name.toLowerCase().includes(query)
      || notebook.description.toLowerCase().includes(query)
      || (notebook.creator_name?.toLowerCase().includes(query) ?? false)
      || notebook.orgs.some(o => o.name.toLowerCase().includes(query))
  }

  const matchesOrg = (notebook: NotebookResponse) => {
    if (orgFilter === '__all__') return true
    if (orgFilter === '__personal__') return notebook.orgs.length === 0
    return notebook.orgs.some(o => o.id === orgFilter)
  }

  const filteredActive = useMemo(() => {
    if (!notebooks) return undefined
    let filtered = notebooks.filter((nb) => !parseAgentMeta(nb.description).isAgent)
    if (normalizedQuery) filtered = filtered.filter((nb) => matchesSearch(nb, normalizedQuery))
    filtered = filtered.filter(matchesOrg)
    return filtered
  }, [notebooks, normalizedQuery, orgFilter])

  const filteredArchived = useMemo(() => {
    if (!archivedNotebooks) return undefined
    let filtered = archivedNotebooks.filter((nb) => !parseAgentMeta(nb.description).isAgent)
    if (normalizedQuery) filtered = filtered.filter((nb) => matchesSearch(nb, normalizedQuery))
    filtered = filtered.filter(matchesOrg)
    return filtered
  }, [archivedNotebooks, normalizedQuery, orgFilter])

  const hasArchived = (archivedNotebooks?.length ?? 0) > 0
  const isSearching = normalizedQuery.length > 0 || orgFilter !== '__all__'

  const orgOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { id: string; name: string }[] = []
    const publicOrg = orgs.find(o => o.name === PUBLIC_ORG_NAME)
    if (publicOrg && !seen.has(publicOrg.id)) {
      seen.add(publicOrg.id)
      options.push({ id: publicOrg.id, name: publicOrg.name })
    }
    const all = [...(notebooks || []), ...(archivedNotebooks || [])]
    for (const nb of all) {
      for (const o of nb.orgs) {
        if (!seen.has(o.id)) {
          seen.add(o.id)
          options.push({ id: o.id, name: o.name })
        }
      }
    }
    return options.sort((a, b) => a.name.localeCompare(b.name))
  }, [notebooks, archivedNotebooks, orgs])

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">{t.notebooks.title}</h1>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
            {(memberships.length > 0 || orgOptions.length > 0) && (
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger className="w-full sm:w-36 h-9 text-xs">
                  <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  <SelectValue placeholder="筛选组织" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  <SelectItem value="__personal__">仅个人</SelectItem>
                  {orgOptions.map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              id="notebook-search"
              name="notebook-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t.notebooks.searchPlaceholder}
              autoComplete="off"
              aria-label={t.common.accessibility?.searchNotebooks || "Search notebooks"}
              className="w-full sm:w-56"
            />
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t.notebooks.newNotebook}
            </Button>
          </div>
        </div>
        
        <div className="space-y-8">
          <NotebookList 
            notebooks={filteredActive} 
            isLoading={isLoading}
            title={t.notebooks.activeNotebooks}
            emptyTitle={isSearching ? t.common.noMatches : undefined}
            emptyDescription={isSearching ? t.common.tryDifferentSearch : undefined}
            onAction={!isSearching ? () => setCreateDialogOpen(true) : undefined}
            actionLabel={!isSearching ? t.notebooks.newNotebook : undefined}
          />
          
          {hasArchived && (
            <NotebookList 
              notebooks={filteredArchived} 
              isLoading={false}
              title={t.notebooks.archivedNotebooks}
              collapsible
              emptyTitle={isSearching ? t.common.noMatches : undefined}
              emptyDescription={isSearching ? t.common.tryDifferentSearch : undefined}
            />
          )}
        </div>
        </div>
      </div>

      <CreateNotebookDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </AppShell>
  )
}
