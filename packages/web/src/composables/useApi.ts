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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export function useTasks() {
  const tasks = ref<Task[]>([])
  const loading = ref(false)

  async function refresh() {
    loading.value = true
    try {
      tasks.value = await fetchJson<Task[]>('/tasks')
    } finally {
      loading.value = false
    }
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

export type Improvement = {
  id: string
  trigger_analysis: string
  target: string
  action: string
  applied_at: string
  status: 'active' | 'reverted' | 'permanent'
  before_metrics: string | null
  after_metrics: string | null
  verdict: string | null
}

export async function fetchImprovements(status?: string): Promise<Improvement[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : ''
  return fetchJson<Improvement[]>(`/improvements${params}`)
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
