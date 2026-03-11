<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { fetchImprovements, type Improvement } from '../composables/useApi'
import { useSocket } from '../composables/useSocket'

const { connected } = useSocket()
const improvements = ref<Improvement[]>([])
const loading = ref(false)
const statusFilter = ref<'all' | Improvement['status']>('all')

const statusFilters: ('all' | Improvement['status'])[] = ['all', 'active', 'permanent', 'reverted']

async function refresh() {
  loading.value = true
  try {
    improvements.value = await fetchImprovements()
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

const filtered = computed(() => {
  if (statusFilter.value === 'all') return improvements.value
  return improvements.value.filter(i => i.status === statusFilter.value)
})

const counts = computed(() => {
  const c = { active: 0, reverted: 0, permanent: 0 }
  for (const i of improvements.value) {
    if (i.status in c) c[i.status]++
  }
  return c
})

function statusColor(status: Improvement['status']): string {
  return { active: '#58a6ff', permanent: '#3fb950', reverted: '#f85149' }[status]
}

function verdictLabel(verdict: string | null): string {
  if (!verdict) return 'pending'
  return verdict
}

function verdictColor(verdict: string | null): string {
  if (!verdict) return '#8b949e'
  if (verdict === 'effective') return '#3fb950'
  if (verdict === 'ineffective') return '#d29922'
  return '#f85149'
}

type Metrics = { failure_rate?: number; [key: string]: unknown }

function parseMetrics(json: string | null): Metrics | null {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

function parseTriggerSummary(json: string): string {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed === 'string') return parsed
    if (parsed.top_failure) return parsed.top_failure
    if (parsed.summary) return parsed.summary
    return JSON.stringify(parsed)
  } catch {
    return json
  }
}

function failureRateBar(before: Metrics | null, after: Metrics | null): { before: number; after: number } | null {
  if (!before?.failure_rate && before?.failure_rate !== 0) return null
  if (!after?.failure_rate && after?.failure_rate !== 0) return null
  return { before: before.failure_rate * 100, after: after.failure_rate * 100 }
}
</script>

<template>
  <div class="improvements-page">
    <header>
      <div class="header-row">
        <div>
          <h1>Improvements</h1>
          <span class="subtitle">self-improvement history</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/improvements" class="active">Improvements</router-link>
        </nav>
        <div class="conn-status" :class="connected ? 'conn-ok' : 'conn-err'">
          <span class="conn-dot" />
          {{ connected ? 'connected' : 'disconnected' }}
        </div>
      </div>
    </header>

    <div class="stats">
      <div class="stat">
        <span class="stat-num">{{ counts.active }}</span>
        <span class="stat-label">active</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.permanent }}</span>
        <span class="stat-label">permanent</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ counts.reverted }}</span>
        <span class="stat-label">reverted</span>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">status</span>
        <div class="btn-group">
          <button
            v-for="s in statusFilters"
            :key="s"
            :class="['filter-btn', { active: statusFilter === s }]"
            @click="statusFilter = s"
          >{{ s }}{{ s !== 'all' ? ` (${counts[s]})` : '' }}</button>
        </div>
      </div>
      <span class="item-count">{{ filtered.length }} items</span>
    </div>

    <div v-if="loading && improvements.length === 0" class="loading">loading...</div>

    <div class="card-list">
      <div
        v-for="item in filtered"
        :key="item.id"
        class="card"
        :style="{ borderLeftColor: statusColor(item.status) }"
      >
        <div class="card-header">
          <span class="card-target">{{ item.target }}</span>
          <span class="card-status" :style="{ color: statusColor(item.status) }">{{ item.status }}</span>
        </div>
        <div class="card-action">{{ item.action }}</div>
        <div class="card-trigger">{{ parseTriggerSummary(item.trigger_analysis) }}</div>
        <div class="card-footer">
          <span class="card-verdict" :style="{ color: verdictColor(item.verdict) }">{{ verdictLabel(item.verdict) }}</span>
          <span class="card-date">{{ new Date(item.applied_at).toLocaleDateString() }}</span>
        </div>
        <div
          v-if="failureRateBar(parseMetrics(item.before_metrics), parseMetrics(item.after_metrics))"
          class="metrics-bar"
        >
          <div class="metrics-label">failure rate</div>
          <div class="bar-row">
            <span class="bar-label">before</span>
            <div class="bar-track">
              <div
                class="bar-fill bar-before"
                :style="{ width: failureRateBar(parseMetrics(item.before_metrics), parseMetrics(item.after_metrics))!.before + '%' }"
              />
            </div>
            <span class="bar-value">{{ failureRateBar(parseMetrics(item.before_metrics), parseMetrics(item.after_metrics))!.before.toFixed(0) }}%</span>
          </div>
          <div class="bar-row">
            <span class="bar-label">after</span>
            <div class="bar-track">
              <div
                class="bar-fill bar-after"
                :style="{ width: failureRateBar(parseMetrics(item.before_metrics), parseMetrics(item.after_metrics))!.after + '%' }"
              />
            </div>
            <span class="bar-value">{{ failureRateBar(parseMetrics(item.before_metrics), parseMetrics(item.after_metrics))!.after.toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!loading && improvements.length === 0" class="empty">no improvements yet</div>
  </div>
</template>

<style scoped>
.improvements-page {
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

.filter-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.filter-label {
  font-size: 0.7rem;
  color: #484f58;
  text-transform: uppercase;
}

.btn-group { display: flex; }

.filter-btn {
  background: #161b22;
  color: #8b949e;
  border: 1px solid #30363d;
  padding: 0.25rem 0.5rem;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.filter-btn:first-child { border-radius: 4px 0 0 4px; }
.filter-btn:last-child { border-radius: 0 4px 4px 0; }
.filter-btn:not(:first-child) { border-left: none; }
.filter-btn:hover { color: #c9d1d9; }
.filter-btn.active { background: #30363d; color: #58a6ff; border-color: #58a6ff; }
.filter-btn.active + .filter-btn { border-left: 1px solid #30363d; }

.item-count { font-size: 0.75rem; color: #8b949e; margin-left: auto; }

.card-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-left: 3px solid;
  border-radius: 6px;
  padding: 1rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.card-target {
  font-weight: 600;
  color: #f0f6fc;
  font-size: 0.9rem;
}

.card-status {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.card-action {
  font-size: 0.85rem;
  color: #c9d1d9;
  margin-bottom: 0.5rem;
}

.card-trigger {
  font-size: 0.75rem;
  color: #8b949e;
  margin-bottom: 0.75rem;
  line-height: 1.5;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-verdict {
  font-size: 0.75rem;
  font-weight: 600;
}

.card-date {
  font-size: 0.7rem;
  color: #484f58;
}

.metrics-bar {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #21262d;
}

.metrics-label {
  font-size: 0.65rem;
  color: #484f58;
  text-transform: uppercase;
  margin-bottom: 0.4rem;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.bar-label {
  font-size: 0.65rem;
  color: #8b949e;
  width: 40px;
  text-align: right;
}

.bar-track {
  flex: 1;
  height: 6px;
  background: #21262d;
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s;
}

.bar-before { background: #f85149; }
.bar-after { background: #3fb950; }

.bar-value {
  font-size: 0.65rem;
  color: #8b949e;
  width: 32px;
}

.loading, .empty { color: #8b949e; text-align: center; padding: 3rem 0; }
</style>
