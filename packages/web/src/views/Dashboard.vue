<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useTasks, type Task } from '../composables/useApi'

const { tasks, loading, refresh } = useTasks()

let timer: ReturnType<typeof setInterval>

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 5000) // poll every 5s
})

onUnmounted(() => clearInterval(timer))

const statusOrder: Record<string, number> = { running: 0, pending: 1, failed: 2, done: 3 }

const sorted = computed(() =>
  [...tasks.value].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))
)

const counts = computed(() => {
  const c = { pending: 0, running: 0, done: 0, failed: 0 }
  for (const t of tasks.value) c[t.status]++
  return c
})

function statusIcon(s: Task['status']) {
  return { pending: '⏳', running: '⚡', done: '✅', failed: '❌' }[s]
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}
</script>

<template>
  <div class="dashboard">
    <header>
      <h1>DevPane</h1>
      <span class="subtitle">the office window</span>
    </header>

    <div class="stats">
      <div class="stat">
        <span class="stat-num">{{ counts.running }}</span>
        <span class="stat-label">running</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.pending }}</span>
        <span class="stat-label">pending</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.done }}</span>
        <span class="stat-label">done</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.failed }}</span>
        <span class="stat-label">failed</span>
      </div>
    </div>

    <div v-if="loading && tasks.length === 0" class="loading">loading...</div>

    <ul class="task-list">
      <li v-for="task in sorted" :key="task.id" :class="['task-item', `status-${task.status}`]">
        <router-link :to="`/tasks/${task.id}`">
          <span class="task-icon">{{ statusIcon(task.status) }}</span>
          <div class="task-info">
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              {{ task.status }} · {{ task.created_by }}
              <template v-if="task.started_at"> · started {{ timeAgo(task.started_at) }}</template>
              <template v-if="task.finished_at"> · finished {{ timeAgo(task.finished_at) }}</template>
            </span>
          </div>
        </router-link>
      </li>
    </ul>

    <div v-if="!loading && tasks.length === 0" class="empty">
      no tasks yet — waiting for PM to generate...
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header {
  margin-bottom: 2rem;
}

h1 {
  font-size: 1.5rem;
  margin: 0;
  color: #f0f6fc;
}

.subtitle {
  color: #8b949e;
  font-size: 0.85rem;
}

.stats {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-size: 1.8rem;
  font-weight: bold;
  color: #f0f6fc;
}

.stat-label {
  font-size: 0.75rem;
  color: #8b949e;
  text-transform: uppercase;
}

.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.task-item {
  border: 1px solid #30363d;
  border-radius: 6px;
  margin-bottom: 0.5rem;
  transition: border-color 0.15s;
}

.task-item:hover {
  border-color: #58a6ff;
}

.task-item a {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: inherit;
  text-decoration: none;
}

.task-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.task-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.task-title {
  font-weight: 500;
  color: #f0f6fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  font-size: 0.75rem;
  color: #8b949e;
}

.status-running {
  border-color: #d29922;
}

.status-failed {
  border-color: #f85149;
}

.loading, .empty {
  text-align: center;
  color: #8b949e;
  padding: 3rem 0;
}
</style>
