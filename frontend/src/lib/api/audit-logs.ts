import apiClient from './client'

export interface AuditLogItem {
  id: string
  operator_id?: string | null
  operator_name: string
  action: string
  resource_type: string
  resource_id?: string | null
  resource_name?: string | null
  detail?: string | null
  ip?: string | null
  created?: string | null
}

export interface AuditLogListResponse {
  total: number
  items: AuditLogItem[]
}

export interface AuditLogQueryParams {
  action?: string
  resource_type?: string
  operator_id?: string
  keyword?: string
  page?: number
  page_size?: number
}

export const auditLogsApi = {
  list: async (params: AuditLogQueryParams = {}): Promise<AuditLogListResponse> => {
    const response = await apiClient.get<AuditLogListResponse>('/audit-logs', { params })
    return response.data
  },
}

// 操作动作标签映射
export const ACTION_LABELS: Record<string, string> = {
  'user.create': '创建用户',
  'user.delete': '删除用户',
  'user.activate': '激活用户',
  'user.suspend': '封禁用户',
  'user.role_change': '修改角色',
  'member.add': '添加成员',
  'member.remove': '移除成员',
  'member.role_change': '修改组内角色',
  'org.create': '创建组织',
  'org.update': '更新组织',
  'org.delete': '删除组织',
  'auth.login': '用户登录',
  'auth.login_fail': '登录失败',
}

// 资源类型过滤选项
export const RESOURCE_TYPE_OPTIONS = ['用户', '组织', '组织成员', '认证']

// 操作动作过滤选项（按类别分组展示）
export const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}))
