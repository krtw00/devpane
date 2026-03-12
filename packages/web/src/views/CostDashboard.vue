<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchCostStats, type CostStats } from '../composables/useApi'

const data = ref<CostStats | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    data.value = await fetchCostStats()
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
