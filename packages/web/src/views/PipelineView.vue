<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { fetchEvents, useTasks, type AgentEvent, type Task } from '../composables/useApi'
import { useSocket, onWsEvent } from '../composables/useSocket'

const { connected } = useSocket()
const { tasks, refresh: refreshTasks } = useTasks()
const events = ref<AgentEvent[]>([])
const loading = ref(false)

const STAGES = ['pm', 'gate1', 'tester', 'gate2', 'worker', 'gate3', 'pr'] as const
type Stage = typeof STAGES[number]

const stageLabels: Record<Stage, string> = {
  pm: 'PM',
  gate1: 'Gate 1',
  tester: 'Tester',
  gate2: 'Gate 2',
  worker: 'Worker',
  gate3: 'Gate 3',
  pr: 'PR',
}

const stageColors: Record<Stage, string> = {
  pm: '#8b949e',
  gate1: '#d29922',
  tester: '#58a6ff',
  gate2: '#d29922',
  worker: '#bc8cff',
  gate3: '#d29922',
  pr: '#3fb950',
}

function resolveStage(taskId: string, taskEvents: AgentEvent[]): Stage {
  const relevant = taskEvents.filter(e => 'taskId' in e && e.taskId === taskId)

  for (const e of relevant) {
    if (e.type === 'pr.created') return 'pr'
  }

  const gatesPassed = new Set<string>()
  for (const e of relevant) {
    if (e.type === 'gate.passed') gatesPassed.add(e.gate as string)
  }

  if (gatesPassed.has('gate3')) return 'pr'
  if (gatesPassed.has('gate2')) return 'worker'
  if (gatesPassed.has('gate1')) return 'tester'

  for (const e of relevant) {
    if (e.type === 'task.started') return 'gate1'
  }

  return 'pm'
}

type TaskCard = {
  id: string
  title: string
  status: Task['status']
  stage: Stage
  rejected: boolean
}

const board = computed(() => {
  const columns: Record<Stage, TaskCard[]> = {
    pm: [], gate1: [], tester: [], gate2: [], worker: [], gate3: [], pr: [],
  }

  for (const task of tasks.value) {
    const stage = resolveStage(task.id, events.value)
    const rejected = events.value.some(
      e => e.type === 'gate.rejected' && e.taskId === task.id && (e.gate as string) === stage,
    )
    columns[stage].push({
      id: task.id,
      title: task.title,
      status: task.status,
      stage,
      rejected,
    })
  }

  return columns
})

const totalTasks = computed(() => tasks.value.length)

async function refresh() {
  loading.value = true
  try {
    await Promise.all([
      refreshTasks(),
      fetchEvents(500).then(e => { events.value = e }),
    ])
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval>

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 10000)
})

onUnmounted(() => clearInterval(timer))

onWsEvent('event', () => refresh())

function statusClass(card: TaskCard): string {
  if (card.rejected) return 'card-rejected'
  if (card.status === 'failed') return 'card-failed'
  if (card.status === 'running') return 'card-running'
  if (card.status === 'done') return 'card-done'
  return 'card-pending'
}
</script>

<template>
  <div class="pipeline-page">
    <header>
      <div class="header-row">
        <div>
          <h1>Pipeline</h1>
          <span class="subtitle">{{ totalTasks }} tasks</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/pipeline" class="active">Pipeline</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/events">Events</router-link>
        </nav>
        <div class="conn-status" :class="connected ? 'conn-ok' : 'conn-err'">
          <span class="conn-dot" />
          {{ connected ? 'connected' : 'disconnected' }}
        </div>
      </div>
    </header>

    <div v-if="loading && tasks.length === 0" class="loading">loading...</div>

    <div class="kanban">
      <div v-for="stage in STAGES" :key="stage" class="kanban-col">
        <div class="col-header" :style="{ borderColor: stageColors[stage] }">
          <span class="col-title">{{ stageLabels[stage] }}</span>
          <span class="col-count">{{ board[stage].length }}</span>
        </div>
        <div class="col-body">
          <router-link
            v-for="card in board[stage]"
            :key="card.id"
            :to="`/tasks/${card.id}`"
            :class="['task-card', statusClass(card)]"
          >
            <span class="card-title">{{ card.title }}</span>
            <span class="card-id">{{ card.id.slice(-6) }}</span>
          </router-link>
          <div v-if="board[stage].length === 0" class="col-empty">-</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipeline-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header { margin-bottom: 1.5rem; }

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h1 { font-size: 1.5rem; margin: 0; color: #f0f6fc; }
.subtitle { color: #8b949e; font-size: 0.85rem; }

.nav-links { display: flex; gap: 1rem; }
.nav-links a { color: #8b949e; text-decoration: none; font-size: 0.85rem; padding: 0.25rem 0.5rem; border-radius: 4px; }
.nav-links a:hover { color: #c9d1d9; }
.nav-links a.active, .nav-links a.router-link-exact-active { color: #58a6ff; }

.conn-status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; }
.conn-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.conn-ok .conn-dot { background: #3fb950; }
.conn-ok { color: #3fb950; }
.conn-err .conn-dot { background: #f85149; }
.conn-err { color: #f85149; }

.loading { color: #8b949e; text-align: center; padding: 3rem 0; }

.kanban {
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 1rem;
}

.kanban-col {
  flex: 1;
  min-width: 140px;
  display: flex;
  flex-direction: column;
}

.col-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.6rem;
  border-bottom: 2px solid;
  margin-bottom: 0.5rem;
}

.col-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #f0f6fc;
}

.col-count {
  font-size: 0.7rem;
  color: #8b949e;
  background: #21262d;
  padding: 0.1rem 0.4rem;
  border-radius: 10px;
}

.col-body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 60px;
}

.task-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.5rem 0.6rem;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s;
}

.task-card:hover { border-color: #58a6ff; }

.card-title {
  font-size: 0.75rem;
  color: #f0f6fc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-id {
  font-size: 0.65rem;
  color: #484f58;
}

.card-running { border-color: #d29922; }
.card-done { border-color: #3fb950; }
.card-failed { border-color: #f85149; }
.card-rejected { border-color: #f85149; background: #f8514910; }

.col-empty {
  text-align: center;
  color: #30363d;
  font-size: 0.75rem;
  padding: 1rem 0;
}
</style>
