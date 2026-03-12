import { ref } from 'vue'

const BASE = '/api'

export type Task = {
  id: string
  title: string
  description: string
  status: 'pending' | 'running' | 'done' | 'failed'
  priority: number
  parent_id: string | null
  created_by: string
  assigned_to: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  result: string | null
}

export type TaskLog = {
  id: string
  task_id: string
  agent: string
  message: string
  timestamp: string
}

function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  const p = fetch(`${BASE}${path}`, { signal: controller.signal }).then(
    res => {
      clearTimeout(timeoutId)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json() as Promise<T>
    },
    err => {
      clearTimeout(timeoutId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('サーバーへの接続がタイムアウトしました (timeout)')
      }
      throw err
    },
  )

  // prevent unhandled rejection when abort fires during fake-timer advancement
  p.catch(() => {})

  return p
}

export function useTasks() {
  const tasks = ref<Task[]>([])
  const loading = ref(false)

  function refresh() {
    loading.value = true
    const p = fetchJson<Task[]>('/tasks')
      .then(data => { tasks.value = data })
      .finally(() => { loading.value = false })
    p.catch(() => {})
    return p
  }

  return { tasks, loading, refresh }
}

export async function createTask(data: { title: string; description: string; priority: number }): Promise<Task> {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export type CostStats = {
  total_cost: number
  total_tasks: number
  avg_cost: number
  cost_24h: number
  cost_7d: number
  daily: { date: string; cost: number; tasks: number }[]
}

export async function fetchCostStats(): Promise<CostStats> {
  return fetchJson<CostStats>('/stats/cost')
}

export type PipelineStats = {
  gate3_pass_rate: number
  avg_execution_time: number
  consecutive_failures: number
  tasks_today: number
  active_improvements: number
}

export function fetchPipelineStats(): Promise<PipelineStats> {
  return fetchJson<PipelineStats>('/stats/pipeline')
}

export type AgentEvent = {
  type: string
  taskId?: string
  [key: string]: unknown
}

export async function fetchEvents(limit = 100, type?: string): Promise<AgentEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (type) params.set('type', type)
  return fetchJson<AgentEvent[]>(`/events?${params}`)
}

export type Memory = {
  id: string
  category: 'feature' | 'decision' | 'lesson'
  content: string
  source_task_id: string | null
  created_at: string
  updated_at: string
}

export async function fetchMemories(category?: string): Promise<Memory[]> {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  const qs = params.toString()
  return fetchJson<Memory[]>(`/memories${qs ? `?${qs}` : ''}`)
}

export async function createMemory(data: { category: string; content: string }): Promise<Memory> {
  const res = await fetch(`${BASE}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function updateMemory(id: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/memories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export async function deleteMemory(id: string): Promise<void> {
  const res = await fetch(`${BASE}/memories/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export type SchedulerStatus = {
  alive: boolean
  rateLimitHits: number
  pmConsecutiveFailures: number
}

export function fetchSchedulerStatus(): Promise<SchedulerStatus> {
  return fetchJson<SchedulerStatus>('/scheduler/status')
}

export async function pauseScheduler(): Promise<void> {
  const res = await fetch(`${BASE}/scheduler/pause`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export async function resumeScheduler(): Promise<void> {
  const res = await fetch(`${BASE}/scheduler/resume`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

export function useTaskDetail(id: string) {
  const task = ref<Task | null>(null)
  const logs = ref<TaskLog[]>([])

  async function refresh() {
    const [t, l] = await Promise.all([
      fetchJson<Task>(`/tasks/${id}`),
      fetchJson<TaskLog[]>(`/tasks/${id}/logs`),
    ])
    task.value = t
    logs.value = l
  }

  return { task, logs, refresh }
}
