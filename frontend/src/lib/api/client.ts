import axios, { AxiosResponse } from 'axios'
import { getApiUrl } from '@/lib/config'
import { useAuthStore } from '@/lib/stores/auth-store'

// Timeout increased to 10 minutes to accommodate slow LLM operations
export const apiClient = axios.create({
  timeout: 600000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false,
})

apiClient.interceptors.request.use(async (config) => {
  if (!config.baseURL) {
    const apiUrl = await getApiUrl()
    config.baseURL = `${apiUrl}/api`
  }

  if (typeof window !== 'undefined') {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }

  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  } else if (config.method && ['post', 'put', 'patch'].includes(config.method.toLowerCase())) {
    config.headers['Content-Type'] = 'application/json'
  }

  return config
})

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const store = useAuthStore.getState()
      if (store.isAuthenticated) {
        store.logout()
      }
    }
    return Promise.reject(error)
  }
)

export default apiClient
