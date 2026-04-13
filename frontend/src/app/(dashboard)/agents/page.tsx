'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '@/components/layout/AppShell'
import { ChatColumn } from '@/app/(dashboard)/notebooks/components/ChatColumn'
import { SourcesColumn } from '@/app/(dashboard)/notebooks/components/SourcesColumn'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useCreateNotebook, useNotebooks, useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Building2, Globe, Plus } from 'lucide-react'
import { useAuthStore, MembershipInfo } from '@/lib/stores/auth-store'
import { organizationsApi, PUBLIC_ORG_NAME } from '@/lib/api/organizations'
import { buildAgentDescription, parseAgentMeta } from '@/lib/agents/agent-meta'

type ContextMode = 'off' | 'insights' | 'full'

interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, ContextMode>
}

export default function AgentsPage() {
  const { t } = useTranslation()
  const { data: notebooks = [], isLoading: notebooksLoading } = useNotebooks(false)
  const createNotebook = useCreateNotebook()
  const updateNotebook = useUpdateNotebook()
  const { user } = useAuthStore()
  const memberships: MembershipInfo[] = user?.memberships ?? []
  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.list(),
  })
  const [selectedNotebookId, setSelectedNotebookId] = useState('')
  const [newAgentName, setNewAgentName] = useState('')
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set())
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {},
  })

  const publicOrg = useMemo(() => orgs.find((org) => org.name === PUBLIC_ORG_NAME), [orgs])
  const orgOptions = useMemo(() => {
    const options: Array<{ id: string; name: string; isPublic: boolean }> = []
    if (publicOrg) options.push({ id: publicOrg.id, name: publicOrg.name, isPublic: true })
    memberships.forEach((membership) => {
      if (membership.org_id !== publicOrg?.id) {
        options.push({ id: membership.org_id, name: membership.org_name, isPublic: false })
      }
    })
    return options
  }, [memberships, publicOrg])

  const agentNotebooks = useMemo(
    () => notebooks.filter((notebook) => parseAgentMeta(notebook.description).isAgent),
    [notebooks]
  )

  const selectedAgent = useMemo(
    () => agentNotebooks.find((notebook) => notebook.id === selectedNotebookId) ?? null,
    [agentNotebooks, selectedNotebookId]
  )
  const selectedAgentMeta = useMemo(
    () =>
      selectedAgent
        ? parseAgentMeta(selectedAgent.description)
        : { isAgent: false, published: false, plainDescription: '' },
    [selectedAgent]
  )

  useEffect(() => {
    if (!selectedNotebookId && agentNotebooks.length > 0) {
      setSelectedNotebookId(agentNotebooks[0].id)
    }
  }, [agentNotebooks, selectedNotebookId])

  const {
    sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(selectedNotebookId)
  const { data: notes = [] } = useNotes(selectedNotebookId)

  useEffect(() => {
    setContextSelections({ sources: {}, notes: {} })
  }, [selectedNotebookId])

  useEffect(() => {
    if (sources.length === 0) return

    setContextSelections((prev) => {
      const next = { ...prev.sources }
      for (const source of sources) {
        if (!(source.id in next)) {
          next[source.id] = source.insights_count > 0 ? 'insights' : 'full'
        }
      }
      return { ...prev, sources: next }
    })
  }, [sources])

  useEffect(() => {
    if (notes.length === 0) return

    setContextSelections((prev) => {
      const next = { ...prev.notes }
      for (const note of notes) {
        if (!(note.id in next)) {
          next[note.id] = 'full'
        }
      }
      return { ...prev, notes: next }
    })
  }, [notes])

  const hasNotebooks = agentNotebooks.length > 0
  const notebookOptions = useMemo(
    () => agentNotebooks.map((notebook) => ({ id: notebook.id, name: notebook.name })),
    [agentNotebooks]
  )

  const handleContextModeChange = (itemId: string, mode: ContextMode, type: 'source' | 'note') => {
    setContextSelections((prev) => ({
      ...prev,
      [type === 'source' ? 'sources' : 'notes']: {
        ...(type === 'source' ? prev.sources : prev.notes),
        [itemId]: mode,
      },
    }))
  }

  const toggleOrg = (orgId: string, isPublic: boolean) => {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev)
      if (isPublic) {
        if (next.has(orgId)) next.clear()
        else return new Set([orgId])
      } else {
        if (next.has(orgId)) next.delete(orgId)
        else {
          next.add(orgId)
          if (publicOrg) next.delete(publicOrg.id)
        }
      }
      return next
    })
  }

  const handleCreateAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newAgentName.trim()
    if (!name) return

    const agentNotebook = await createNotebook.mutateAsync({
      name,
      description: buildAgentDescription(t.agents.defaultAgentDescription, false),
      org_ids: selectedOrgIds.size > 0 ? Array.from(selectedOrgIds) : undefined,
    })
    setNewAgentName('')
    setSelectedOrgIds(new Set())
    setSelectedNotebookId(agentNotebook.id)
  }

  const handleTogglePublish = async () => {
    if (!selectedAgent) return
    await updateNotebook.mutateAsync({
      id: selectedAgent.id,
      data: {
        description: buildAgentDescription(
          selectedAgentMeta.plainDescription || t.agents.defaultAgentDescription,
          !selectedAgentMeta.published
        ),
      },
    })
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 h-full flex flex-col min-h-0">
        <div className="mb-4 md:mb-6 space-y-2">
          <h1 className="text-xl md:text-2xl font-bold">{t.navigation.agents}</h1>
          <p className="text-sm text-muted-foreground">{t.agents.pageDescription}</p>
        </div>

        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t.agents.selectNotebook}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {notebooksLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingSpinner size="sm" />
                {t.common.loading}
              </div>
            ) : !hasNotebooks ? (
              <p className="text-sm text-muted-foreground">{t.chat.startByCreating}</p>
            ) : (
              <Select value={selectedNotebookId} onValueChange={setSelectedNotebookId}>
                <SelectTrigger className="w-full md:w-[360px]">
                  <SelectValue placeholder={t.agents.selectNotebookPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {notebookOptions.map((notebook) => (
                    <SelectItem key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <form className="flex flex-col md:flex-row gap-2" onSubmit={handleCreateAgent}>
              <Input
                value={newAgentName}
                onChange={(event) => setNewAgentName(event.target.value)}
                placeholder={t.agents.newAgentPlaceholder}
              />
              <Button
                type="submit"
                disabled={createNotebook.isPending || !newAgentName.trim()}
                className="md:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                {createNotebook.isPending ? t.common.creating : t.agents.createAgent}
              </Button>
            </form>

            {orgOptions.length > 0 && (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">{t.agents.visibilityScope}</p>
                {orgOptions.map((orgOption) => (
                  <label
                    key={orgOption.id}
                    className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1 -mx-1.5 transition-colors"
                  >
                    <Checkbox
                      checked={selectedOrgIds.has(orgOption.id)}
                      onCheckedChange={() => toggleOrg(orgOption.id, orgOption.isPublic)}
                    />
                    {orgOption.isPublic ? (
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm truncate">{orgOption.name}</span>
                  </label>
                ))}
              </div>
            )}

            {selectedAgent && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selectedAgentMeta.published ? 'default' : 'secondary'}>
                  {selectedAgentMeta.published ? t.agents.published : t.agents.unpublished}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTogglePublish}
                  disabled={updateNotebook.isPending}
                >
                  {selectedAgentMeta.published ? t.agents.unpublish : t.agents.publish}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 min-h-0">
          {selectedNotebookId ? (
            <div className="h-full min-h-0 flex flex-col lg:flex-row gap-4">
              <div className="lg:basis-2/5 lg:min-w-[360px] lg:max-w-[520px] min-h-[280px] lg:min-h-0">
                <SourcesColumn
                  sources={sources}
                  isLoading={sourcesLoading}
                  notebookId={selectedNotebookId}
                  onRefresh={refetchSources}
                  contextSelections={contextSelections.sources}
                  onContextModeChange={(sourceId, mode) =>
                    handleContextModeChange(sourceId, mode, 'source')
                  }
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                />
              </div>
              <div className="flex-1 min-h-[380px] lg:min-h-0">
                <ChatColumn
                  notebookId={selectedNotebookId}
                  contextSelections={contextSelections}
                  sources={sources}
                  sourcesLoading={sourcesLoading}
                />
              </div>
            </div>
          ) : (
            <Card className="h-full">
              <CardContent className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">{t.agents.emptyState}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  )
}
