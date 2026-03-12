<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { fetchImprovements, revertImprovement, type Improvement } from '../composables/useApi'

const improvements = ref<Improvement[]>([])
const loading = ref(false)
const statusFilter = ref<string>('all')
const reverting = ref<string | null>(null)

const statuses = ['all', 'active', 'reverted', 'permanent']

async function refresh() {
  loading.value = true
  try {
    const status = statusFilter.value === 'all' ? undefined : statusFilter.value
    improvements.value = await fetchImprovements(status)
  } finally {
    loading.value = false
  }
}

async function handleRevert(id: string) {
  reverting.value = id
  try {
    await revertImprovement(id)
    await refresh()
  } finally {
    reverting.value = null
  }
}

onMounted(refresh)

const filtered = computed(() => improvements.value)

function verdictColor(verdict: string | null): string {
  if (verdict === 'effective') return '#3fb950'
  if (verdict === 'ineffective') return '#d29922'
  if (verdict === 'harmful') return '#f85149'
  return '#8b949e'
}

function statusColor(status: string): string {
  if (status === 'active') return '#58a6ff'
  if (status === 'reverted') return '#f85149'
  if (status === 'permanent') return '#3fb950'
  return '#8b949e'
}

function parseMetrics(json: string | null): Record<string, number> | null {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function formatDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19)
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
      </div>
    </header>

    <div class="filter-bar">
      <span class="filter-label">status</span>
      <select v-model="statusFilter" class="status-select" @change="refresh">
        <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
      </select>
      <span class="item-count">{{ filtered.length }} items</span>
    </div>

    <div v-if="loading && improvements.length === 0" class="loading">loading...</div>

    <div class="table-wrap">
      <table v-if="filtered.length > 0">
        <thead>
          <tr>
            <th>applied</th>
            <th>target</th>
            <th>action</th>
            <th>status</th>
            <th>verdict</th>
            <th>metrics</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="imp in filtered" :key="imp.id">
            <td class="date-cell">{{ formatDate(imp.applied_at) }}</td>
            <td>{{ imp.target }}</td>
            <td class="action-cell">{{ imp.action }}</td>
            <td>
              <span class="status-badge" :style="{ color: statusColor(imp.status) }">{{ imp.status }}</span>
            </td>
            <td>
              <span v-if="imp.verdict" :style="{ color: verdictColor(imp.verdict) }">{{ imp.verdict }}</span>
              <span v-else class="muted">-</span>
            </td>
            <td class="metrics-cell">
              <template v-if="parseMetrics(imp.before_metrics) && parseMetrics(imp.after_metrics)">
                <div v-for="(val, key) in parseMetrics(imp.after_metrics)!" :key="key" class="metric-row">
                  <span class="metric-key">{{ key }}</span>
                  <span class="metric-before">{{ parseMetrics(imp.before_metrics)![key]?.toFixed(3) ?? '-' }}</span>
                  <span class="metric-arrow">&rarr;</span>
                  <span class="metric-after">{{ val.toFixed(3) }}</span>
                </div>
              </template>
              <span v-else class="muted">-</span>
            </td>
            <td>
              <button
                v-if="imp.status === 'active'"
                class="revert-btn"
                :disabled="reverting === imp.id"
                @click="handleRevert(imp.id)"
              >
                {{ reverting === imp.id ? '...' : 'revert' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && improvements.length === 0" class="empty">no improvements yet</div>
    </div>
  </div>
</template>

<style scoped>
.improvements-page {
  max-width: 1000px;
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

.filter-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.filter-label { font-size: 0.7rem; color: #484f58; text-transform: uppercase; }

.status-select {
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
}

.item-count { font-size: 0.75rem; color: #8b949e; margin-left: auto; }

.table-wrap {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  color: #8b949e;
  font-weight: 600;
  border-bottom: 1px solid #30363d;
  white-space: nowrap;
}

td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #21262d;
  vertical-align: top;
}

tr:last-child td { border-bottom: none; }

.date-cell { white-space: nowrap; color: #8b949e; }
.action-cell { max-width: 250px; word-break: break-word; }

.status-badge { font-weight: 600; }
.muted { color: #484f58; }

.metrics-cell { font-size: 0.7rem; }

.metric-row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.metric-key { color: #8b949e; min-width: 80px; }
.metric-before { color: #f85149; }
.metric-arrow { color: #484f58; }
.metric-after { color: #3fb950; }

.revert-btn {
  background: transparent;
  color: #f85149;
  border: 1px solid #f85149;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-family: inherit;
  font-size: 0.7rem;
  cursor: pointer;
}

.revert-btn:hover { background: rgba(248, 81, 73, 0.1); }
.revert-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.loading, .empty { color: #8b949e; text-align: center; padding: 3rem 0; }
</style>
