'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore, isSuperAdmin } from '@/lib/stores/auth-store'
import { auditLogsApi, ACTION_LABELS, ACTION_OPTIONS, RESOURCE_TYPE_OPTIONS, type AuditLogItem } from '@/lib/api/audit-logs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search, X } from 'lucide-react'

const PAGE_SIZE = 20

function getActionColor(action: string): string {
  if (action.includes('delete') || action.includes('suspend') || action.includes('fail')) {
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  }
  if (action.includes('create') || action.includes('activate') || action.includes('add')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  }
  if (action.includes('update') || action.includes('role')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
  }
  if (action.includes('login')) {
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
  }
  return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr} 小时前`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 30) return `${diffDay} 天前`
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

export default function AuditLogsPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const superAdmin = isSuperAdmin(user)

  const [items, setItems] = useState<AuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const [keyword, setKeyword] = useState('')
  const [selectedAction, setSelectedAction] = useState<string>('')
  const [selectedResource, setSelectedResource] = useState<string>('')
  const [inputKeyword, setInputKeyword] = useState('')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchLogs = useCallback(async (pg: number) => {
    setLoading(true)
    try {
      const res = await auditLogsApi.list({
        page: pg,
        page_size: PAGE_SIZE,
        keyword: keyword || undefined,
        action: selectedAction || undefined,
        resource_type: selectedResource || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      console.error('Failed to fetch audit logs', e)
    } finally {
      setLoading(false)
    }
  }, [keyword, selectedAction, selectedResource])

  useEffect(() => {
    if (!superAdmin) {
      router.replace('/admin/users')
      return
    }
    fetchLogs(page)
  }, [superAdmin, page, fetchLogs, router])

  const handleSearch = () => {
    setKeyword(inputKeyword)
    setPage(1)
  }

  const handleClearFilters = () => {
    setKeyword('')
    setInputKeyword('')
    setSelectedAction('')
    setSelectedResource('')
    setPage(1)
  }

  const hasFilter = keyword || selectedAction || selectedResource

  if (!superAdmin) return null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">日志审计</h1>
            <p className="text-sm text-muted-foreground">查看所有管理员操作记录，共 {total} 条</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchLogs(page)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex gap-2 min-w-[260px] flex-1">
              <Input
                placeholder="搜索操作者、资源名称、详情..."
                value={inputKeyword}
                onChange={e => setInputKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="h-9"
              />
              <Button size="sm" onClick={handleSearch} className="h-9 px-3 shrink-0">
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <Select
              value={selectedAction || '__all__'}
              onValueChange={v => { setSelectedAction(v === '__all__' ? '' : v); setPage(1) }}
            >
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="操作类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部操作</SelectItem>
                {ACTION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedResource || '__all__'}
              onValueChange={v => { setSelectedResource(v === '__all__' ? '' : v); setPage(1) }}
            >
              <SelectTrigger className="h-9 w-36">
                <SelectValue placeholder="资源类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部资源</SelectItem>
                {RESOURCE_TYPE_OPTIONS.map(rt => (
                  <SelectItem key={rt} value={rt}>{rt}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-9 gap-1.5 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                清除筛选
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[150px]">时间</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[110px]">操作者</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[120px]">操作</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[90px]">资源类型</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[130px]">资源名称</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">操作详情</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>加载中...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="h-8 w-8 opacity-30" />
                      <span>暂无审计日志</span>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map(item => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(item.created)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{item.operator_name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getActionColor(item.action)}`}>
                        {ACTION_LABELS[item.action] ?? item.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">{item.resource_type}</Badge>
                    </td>
                    <td className="px-4 py-3 max-w-[130px]">
                      <span className="truncate block" title={item.resource_name ?? undefined}>
                        {item.resource_name || <span className="text-muted-foreground">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[300px]">
                      <span className="line-clamp-2 text-xs">{item.detail || '—'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            第 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} 条，共 {total} 条
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2">{page} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
