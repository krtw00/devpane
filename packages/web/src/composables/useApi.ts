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
