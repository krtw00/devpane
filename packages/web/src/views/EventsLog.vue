<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { fetchEvents, type AgentEvent } from '../composables/useApi'
import { useSocket, onWsEvent } from '../composables/useSocket'

const { connected } = useSocket()
const events = ref<AgentEvent[]>([])
const loading = ref(false)
const typeFilter = ref('all')

const eventTypes = [
  'all',
  'task.created', 'task.started', 'task.completed', 'task.failed',
  'gate.passed', 'gate.rejected',
  'pm.invoked', 'pm.failed',
  'pr.created',
  'spc.alert',
  'worker.rate_limited',
]

async function refresh() {
  loading.value = true
  try {
    const type = typeFilter.value === 'all' ? undefined : typeFilter.value
    events.value = await fetchEvents(200, type)
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval>

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 5000)
})

onUnmounted(() => clearInterval(timer))

onWsEvent('event', () => refresh())

const filtered = computed(() => events.value)

function eventColor(type: string): string {
  if (type.includes('failed') || type.includes('rejected') || type === 'spc.alert') return '#f85149'
  if (type.includes('completed') || type.includes('passed') || type === 'pr.created') return '#3fb950'
  if (type.includes('started') || type === 'pm.invoked') return '#d29922'
  if (type.includes('rate_limited')) return '#d29922'
  return '#8b949e'
}

function formatPayload(event: AgentEvent): string {
  const parts: string[] = []
  if (event.taskId) parts.push(`task:${(event.taskId as string).slice(-6)}`)
  if (event.by) parts.push(`by:${event.by}`)
  if (event.gate) parts.push(`gate:${event.gate}`)
  if (event.verdict) parts.push(`verdict:${event.verdict}`)
  if (event.reason) parts.push(`reason:${event.reason}`)
  if (event.rootCause) parts.push(`cause:${event.rootCause}`)
  if (event.costUsd) parts.push(`cost:$${(event.costUsd as number).toFixed(4)}`)
  if (event.metric) parts.push(`${event.metric}=${(event.value as number)?.toFixed(4)}`)
  if (event.url) parts.push(`${event.url}`)
  if (event.error) parts.push(`${(event.error as string).slice(0, 80)}`)
  if (event.backoffSec) parts.push(`backoff:${event.backoffSec}s`)
  return parts.join(' ')
}
</script>

<template>
  <div class="events-page">
    <header>
      <div class="header-row">
        <div>
          <h1>Events</h1>
          <span class="subtitle">agent event log</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/metrics">Metrics</router-link>
          <router-link to="/improvements">Improvements</router-link>
          <router-link to="/events" class="active">Events</router-link>
          <router-link to="/memories">Memories</router-link>
        </nav>
        <div class="conn-status" :class="connected ? 'conn-ok' : 'conn-err'">
          <span class="conn-dot" />
          {{ connected ? 'connected' : 'disconnected' }}
        </div>
      </div>
    </header>

    <div class="filter-bar">
      <span class="filter-label">type</span>
      <select v-model="typeFilter" class="type-select" @change="refresh">
        <option v-for="t in eventTypes" :key="t" :value="t">{{ t }}</option>
      </select>
      <span class="event-count">{{ filtered.length }} events</span>
    </div>

    <div v-if="loading && events.length === 0" class="loading">loading...</div>

    <div class="event-stream">
      <div v-for="(event, i) in filtered" :key="i" class="event-entry">
        <span class="event-type" :style="{ color: eventColor(event.type) }">{{ event.type }}</span>
        <span class="event-payload">{{ formatPayload(event) }}</span>
      </div>
      <div v-if="!loading && events.length === 0" class="empty">no events yet</div>
    </div>
  </div>
</template>

<style scoped>
.events-page {
  max-width: 900px;
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

.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.filter-label { font-size: 0.7rem; color: #484f58; text-transform: uppercase; }

.type-select {
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
}

.event-count { font-size: 0.75rem; color: #8b949e; margin-left: auto; }

.event-stream {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.75rem;
  max-height: 70vh;
  overflow-y: auto;
  font-size: 0.75rem;
  line-height: 1.8;
}

.event-entry {
  display: flex;
  gap: 0.75rem;
  border-bottom: 1px solid #21262d;
  padding: 0.2rem 0;
}

.event-entry:last-child { border-bottom: none; }

.event-type {
  flex-shrink: 0;
  min-width: 160px;
  font-weight: 600;
}

.event-payload { color: #8b949e; word-break: break-all; }

.loading, .empty { color: #8b949e; text-align: center; padding: 3rem 0; }
</style>
