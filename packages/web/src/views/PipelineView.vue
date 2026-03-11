<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { fetchEvents, type AgentEvent } from '../composables/useApi'
import { useSocket, onWsEvent } from '../composables/useSocket'

const { connected } = useSocket()

const STAGES = ['pm', 'gate1', 'tester', 'gate2', 'worker', 'gate3'] as const
type Stage = typeof STAGES[number]

const stageLabels: Record<Stage, string> = {
  pm: 'PM',
  gate1: 'Gate 1',
  tester: 'Tester',
  gate2: 'Gate 2',
  worker: 'Worker',
  gate3: 'Gate 3',
}

type TaskCard = {
  taskId: string
  stage: Stage
  status: 'active' | 'passed' | 'rejected'
  verdict?: 'go' | 'recycle' | 'kill'
  reason?: string
  startedAt: number
}

const tasks = ref<Map<string, TaskCard>>(new Map())
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval>

function processEvent(event: AgentEvent) {
  const taskId = 'taskId' in event ? (event as { taskId: string }).taskId : undefined
  if (!taskId) return

  const existing = tasks.value.get(taskId)

  switch (event.type) {
    case 'task.created':
      tasks.value.set(taskId, {
        taskId,
        stage: 'pm',
        status: 'active',
        startedAt: Date.now(),
      })
      break
    case 'task.started':
      tasks.value.set(taskId, {
        taskId,
        stage: 'worker',
        status: 'active',
        startedAt: existing?.startedAt ?? Date.now(),
      })
      break
    case 'gate.passed': {
      const gate = String(event.gate ?? '') as Stage
      if (gate) {
        const nextStage = STAGES[STAGES.indexOf(gate) + 1] ?? gate
        tasks.value.set(taskId, {
          taskId,
          stage: nextStage,
          status: 'active',
          startedAt: existing?.startedAt ?? Date.now(),
        })
      }
      break
    }
    case 'gate.rejected': {
      const rGate = String(event.gate ?? '') as Stage
      if (rGate) {
        tasks.value.set(taskId, {
          taskId,
          stage: rGate,
          status: 'rejected',
          verdict: String(event.verdict ?? '') as 'recycle' | 'kill',
          reason: String(event.reason ?? ''),
          startedAt: existing?.startedAt ?? Date.now(),
        })
      }
      break
    }
    case 'task.completed':
      tasks.value.set(taskId, {
        taskId,
        stage: 'gate3',
        status: 'passed',
        verdict: 'go',
        startedAt: existing?.startedAt ?? Date.now(),
      })
      break
    case 'task.failed':
      if (existing) {
        existing.status = 'rejected'
        existing.verdict = 'kill'
      }
      break
  }
}

async function loadEvents() {
  const events = await fetchEvents(500)
  tasks.value.clear()
  for (const ev of events.reverse()) {
    processEvent(ev)
  }
}

onMounted(() => {
  loadEvents()
  timer = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => clearInterval(timer))

onWsEvent('event', (payload) => {
  processEvent(payload as AgentEvent)
})

const columns = computed(() => {
  const result: Record<Stage, TaskCard[]> = {
    pm: [], gate1: [], tester: [], gate2: [], worker: [], gate3: [],
  }
  for (const card of tasks.value.values()) {
    result[card.stage].push(card)
  }
  return result
})

function elapsed(startedAt: number): string {
  const diff = Math.max(0, Math.floor((now.value - startedAt) / 1000))
  const m = Math.floor(diff / 60)
  const s = diff % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function verdictClass(verdict?: string): string {
  if (!verdict) return ''
  return `verdict-${verdict}`
}
</script>

<template>
  <div class="pipeline-page">
    <header>
      <div class="header-row">
        <div>
          <h1>Pipeline</h1>
          <span class="subtitle">task stage kanban</span>
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

    <div class="kanban">
      <div v-for="stage in STAGES" :key="stage" class="column">
        <div class="column-header">
          <span class="column-title">{{ stageLabels[stage] }}</span>
          <span class="column-count">{{ columns[stage].length }}</span>
        </div>
        <div class="column-body">
          <div
            v-for="card in columns[stage]"
            :key="card.taskId"
            class="task-card"
            :class="[`card-${card.status}`]"
          >
            <div class="card-title">{{ card.taskId.slice(-8) }}</div>
            <div class="card-meta">
              <span class="card-status">{{ card.status }}</span>
              <span class="card-elapsed">{{ elapsed(card.startedAt) }}</span>
            </div>
            <span
              v-if="card.verdict"
              class="verdict-badge"
              :class="verdictClass(card.verdict)"
            >{{ card.verdict }}</span>
            <div v-if="card.reason" class="card-reason">{{ card.reason }}</div>
          </div>
          <div v-if="columns[stage].length === 0" class="empty-col">-</div>
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

.kanban {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.75rem;
  min-height: 60vh;
}

.column {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
}

.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid #30363d;
}

.column-title { font-size: 0.8rem; font-weight: 600; color: #f0f6fc; }
.column-count {
  font-size: 0.7rem;
  color: #8b949e;
  background: #21262d;
  padding: 0.1rem 0.4rem;
  border-radius: 10px;
}

.column-body {
  padding: 0.5rem;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.task-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.5rem 0.6rem;
  font-size: 0.75rem;
}

.card-active { border-left: 3px solid #d29922; }
.card-passed { border-left: 3px solid #3fb950; }
.card-rejected { border-left: 3px solid #f85149; }

.card-title {
  font-weight: 600;
  color: #f0f6fc;
  margin-bottom: 0.3rem;
  font-family: inherit;
}

.card-meta {
  display: flex;
  justify-content: space-between;
  color: #8b949e;
  font-size: 0.7rem;
  margin-bottom: 0.3rem;
}

.card-elapsed { color: #484f58; }

.verdict-badge {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  text-transform: uppercase;
}

.verdict-go { background: #238636; color: #f0f6fc; }
.verdict-recycle { background: #d29922; color: #0d1117; }
.verdict-kill { background: #f85149; color: #f0f6fc; }

.card-reason {
  margin-top: 0.3rem;
  font-size: 0.65rem;
  color: #8b949e;
  word-break: break-word;
}

.empty-col { color: #484f58; text-align: center; padding: 1rem 0; font-size: 0.75rem; }
</style>
