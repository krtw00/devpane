<script setup lang="ts">
import { ref, onMounted } from 'vue'

const BASE = '/api'

type SpcPoint = {
  timestamp: string
  metric: string
  value: number
  [key: string]: unknown
}

const points = ref<SpcPoint[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch(`${BASE}/spc`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    points.value = await res.json()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <header>
      <div class="header-row">
        <div>
          <h1>SPC</h1>
          <span class="subtitle">statistical process control</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/events">Events</router-link>
          <router-link to="/pipeline">Pipeline</router-link>
          <router-link to="/memories">Memories</router-link>
          <router-link to="/spc" class="active">SPC</router-link>
        </nav>
      </div>
    </header>

    <div v-if="loading" class="loading">loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="points.length === 0" class="empty">no SPC data yet</div>

    <div v-else class="chart">
      <div v-for="(pt, i) in points" :key="i" class="chart-row">
        <span class="chart-ts">{{ pt.timestamp }}</span>
        <span class="chart-metric">{{ pt.metric }}</span>
        <span class="chart-value">{{ pt.value.toFixed(4) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #c9d1d9;
}

header { margin-bottom: 2rem; }

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

.loading, .empty { text-align: center; color: #8b949e; padding: 3rem 0; }
.error { text-align: center; color: #f85149; padding: 3rem 0; }

.chart {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.8;
}

.chart-row {
  display: flex;
  gap: 1rem;
  border-bottom: 1px solid #21262d;
  padding: 0.2rem 0;
}

.chart-row:last-child { border-bottom: none; }

.chart-ts { color: #8b949e; flex-shrink: 0; min-width: 140px; }
.chart-metric { color: #58a6ff; flex-shrink: 0; min-width: 120px; font-weight: 600; }
.chart-value { color: #f0f6fc; }
</style>
