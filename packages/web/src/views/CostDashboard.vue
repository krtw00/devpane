<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchCostStats, fetchCostLimits, type CostStats, type CostLimits } from '../composables/useApi'

const data = ref<CostStats | null>(null)
const limits = ref<CostLimits | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const [stats, lim] = await Promise.all([fetchCostStats(), fetchCostLimits()])
    data.value = stats
    limits.value = lim
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

function usd(n: number): string {
  return `$${n.toFixed(4)}`
}

const maxDailyCost = computed(() => {
  if (!data.value?.daily.length) return 1
  return Math.max(...data.value.daily.map((d) => d.cost))
})
</script>

<template>
  <div class="dashboard">
    <header>
      <div class="header-row">
        <div>
          <h1>Cost</h1>
          <span class="subtitle">usage &amp; spend</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost" class="active">Cost</router-link>
        </nav>
      </div>
    </header>

    <div v-if="loading" class="loading">loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else-if="data">
      <div class="stats">
        <div class="stat">
          <span class="stat-num">{{ usd(data.total_cost) }}</span>
          <span class="stat-label">total</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ usd(data.cost_24h) }}</span>
          <span class="stat-label">24h</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ usd(data.cost_7d) }}</span>
          <span class="stat-label">7d</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ usd(data.avg_cost) }}</span>
          <span class="stat-label">avg/task</span>
        </div>
      </div>

      <section v-if="limits" class="limits-section">
        <h2>Budget</h2>
        <div v-if="limits.paused" class="paused-badge">PAUSED</div>
        <div class="limit-row">
          <span class="limit-label">Daily</span>
          <div class="limit-bar-track">
            <div
              class="limit-bar"
              :class="{ warning: limits.daily.ratio >= 0.8, exceeded: limits.daily.ratio >= 1 }"
              :style="{ width: Math.min(limits.daily.ratio * 100, 100) + '%' }"
            />
          </div>
          <span class="limit-value">{{ usd(limits.daily.used) }} / {{ usd(limits.daily.limit) }}</span>
          <span class="limit-remaining">{{ usd(limits.daily.remaining) }} left</span>
        </div>
        <div class="limit-row">
          <span class="limit-label">Monthly</span>
          <div class="limit-bar-track">
            <div
              class="limit-bar"
              :class="{ warning: limits.monthly.ratio >= 0.8, exceeded: limits.monthly.ratio >= 1 }"
              :style="{ width: Math.min(limits.monthly.ratio * 100, 100) + '%' }"
            />
          </div>
          <span class="limit-value">{{ usd(limits.monthly.used) }} / {{ usd(limits.monthly.limit) }}</span>
          <span class="limit-remaining">{{ usd(limits.monthly.remaining) }} left</span>
        </div>
      </section>

      <section class="chart-section">
        <h2>Daily Spend</h2>
        <div v-if="data.daily.length === 0" class="empty">no cost data yet</div>
        <div v-else class="chart">
          <div v-for="day in data.daily" :key="day.date" class="chart-row">
            <span class="chart-date">{{ day.date.slice(5) }}</span>
            <div class="chart-bar-track">
              <div
                class="chart-bar"
                :style="{ width: (day.cost / maxDailyCost * 100) + '%' }"
              />
            </div>
            <span class="chart-value">{{ usd(day.cost) }}</span>
            <span class="chart-tasks">{{ day.tasks }}t</span>
          </div>
        </div>
      </section>
    </template>
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

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-links a {
  color: #8b949e;
  text-decoration: none;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.nav-links a:hover {
  color: #c9d1d9;
}

.nav-links a.active,
.nav-links a.router-link-exact-active {
  color: #58a6ff;
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

.loading, .empty {
  text-align: center;
  color: #8b949e;
  padding: 3rem 0;
}

.error {
  text-align: center;
  color: #f85149;
  padding: 3rem 0;
}

.limits-section {
  border-top: 1px solid #30363d;
  padding-top: 1.5rem;
  margin-bottom: 1.5rem;
}

.limits-section h2 {
  font-size: 0.95rem;
  color: #f0f6fc;
  margin-bottom: 0.75rem;
}

.paused-badge {
  display: inline-block;
  background: #f8514966;
  color: #f85149;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.75rem;
}

.limit-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  margin-bottom: 0.4rem;
}

.limit-label {
  width: 4rem;
  color: #8b949e;
  flex-shrink: 0;
}

.limit-bar-track {
  flex: 1;
  height: 18px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  overflow: hidden;
}

.limit-bar {
  height: 100%;
  background: #3fb950;
  border-radius: 3px;
  min-width: 2px;
  transition: width 0.3s;
}

.limit-bar.warning {
  background: #d29922;
}

.limit-bar.exceeded {
  background: #f85149;
}

.limit-value {
  width: 8rem;
  text-align: right;
  color: #f0f6fc;
  flex-shrink: 0;
}

.limit-remaining {
  width: 5rem;
  text-align: right;
  color: #8b949e;
  flex-shrink: 0;
}

.chart-section {
  border-top: 1px solid #30363d;
  padding-top: 1.5rem;
}

.chart-section h2 {
  font-size: 0.95rem;
  color: #f0f6fc;
  margin-bottom: 0.75rem;
}

.chart {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.chart-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.chart-date {
  width: 3.5rem;
  text-align: right;
  color: #8b949e;
  flex-shrink: 0;
}

.chart-bar-track {
  flex: 1;
  height: 18px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  overflow: hidden;
}

.chart-bar {
  height: 100%;
  background: #58a6ff;
  border-radius: 3px;
  min-width: 2px;
  transition: width 0.3s;
}

.chart-value {
  width: 4.5rem;
  text-align: right;
  color: #f0f6fc;
  flex-shrink: 0;
}

.chart-tasks {
  width: 2.5rem;
  text-align: right;
  color: #8b949e;
  flex-shrink: 0;
}
</style>
