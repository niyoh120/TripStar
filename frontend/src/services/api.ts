import axios from 'axios'
import type { TripFormData, TripPlanResponse, TripTaskEvent } from '@/types'
import { i18n } from '@/i18n'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const t = i18n.global.t
const WS_BASE_URL = API_BASE_URL.replace(/^http/i, 'ws').replace(/\/+$/, '')

interface SubmitTripPlanResponse {
  task_id: string
  plan_id: string
  status: 'processing'
  ws_url: string
  message: string
}

interface GenerateTripPlanOptions {
  onTaskCreated?: (task: SubmitTripPlanResponse) => void
  onTaskEvent?: (event: TripTaskEvent) => void
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 0, // 无超时限制，等待后端返回结果
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    console.log('发送请求:', config.method?.toUpperCase(), config.url)
    return config
  },
  (error) => {
    console.error('请求错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    console.log('收到响应:', response.status, response.config.url)
    return response
  },
  (error) => {
    console.error('响应错误:', error.response?.status, error.message)
    return Promise.reject(error)
  }
)

/**
 * 提交旅行规划任务（立即返回 task_id）
 */
export async function submitTripPlan(formData: TripFormData): Promise<SubmitTripPlanResponse> {
  try {
    const response = await apiClient.post('/api/trip/plan', formData)
    return response.data
  } catch (error: any) {
    console.error('提交旅行计划失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.submitTripPlanFailed'))
  }
}

/**
 * 轮询任务状态
 */
export async function pollTaskStatus(taskId: string): Promise<any> {
  try {
    const response = await apiClient.get(`/api/trip/status/${taskId}`)
    return response.data
  } catch (error: any) {
    console.error('查询任务状态失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.queryTaskStatusFailed'))
  }
}

/**
 * 生成旅行计划（兼容旧接口，内部使用轮询）
 */
export async function generateTripPlan(
  formData: TripFormData,
  options?: GenerateTripPlanOptions
): Promise<TripPlanResponse> {
  const task = await submitTripPlan(formData)
  options?.onTaskCreated?.(task)

  const wsUrl = `${WS_BASE_URL}${task.ws_url}`

  return new Promise((resolve, reject) => {
    let settled = false
    const socket = new WebSocket(wsUrl)

    const safeResolve = (value: TripPlanResponse) => {
      if (settled) return
      settled = true
      socket.close()
      resolve(value)
    }

    const safeReject = (error: unknown) => {
      if (settled) return
      settled = true
      socket.close()
      reject(error)
    }

    socket.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as TripTaskEvent
        options?.onTaskEvent?.(event)

        if (event.status === 'completed') {
          if (!event.result) {
            safeReject(new Error(t('api.generateTripPlanFailed')))
            return
          }
          safeResolve(event.result)
          return
        }

        if (event.status === 'failed') {
          safeReject(new Error(event.error || event.message || t('api.generateTripPlanFailed')))
        }
      } catch (err) {
        safeReject(err)
      }
    }

    socket.onerror = () => {
      safeReject(new Error(t('api.generateTripPlanFailed')))
    }

    socket.onclose = () => {
      if (!settled) {
        safeReject(new Error(t('api.generateTripPlanFailed')))
      }
    }
  })
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<any> {
  try {
    const response = await apiClient.get('/health')
    return response.data
  } catch (error: any) {
    console.error('健康检查失败:', error)
    throw new Error(error.message || t('api.healthCheckFailed'))
  }
}

export default apiClient

