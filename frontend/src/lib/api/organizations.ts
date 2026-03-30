import apiClient from './client'

export interface OrganizationResponse {
  id: string
  name: string
  description?: string | null
}

export const organizationsApi = {
  list: async () => {
    const response = await apiClient.get<OrganizationResponse[]>('/organizations')
    return response.data
  },
}

export const PUBLIC_ORG_NAME = '公开'
