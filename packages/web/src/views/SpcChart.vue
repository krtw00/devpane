<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { fetchSpcMetrics, fetchSpcSummary, type SpcMetricPoint, type SpcSummary } from '../composables/useApi'

const metrics = ['cost_usd', 'execution_time', 'diff_size'] as const
const metricLabels: Record<string, string> = {
  cost_usd: 'Cost (USD)',
  execution_time: 'Execution Time (ms)',
  diff_size: 'Diff Size (lines)',
}

const selected = ref<string>('cost_usd')
const points = ref<SpcMetricPoint[]>([])
const summaries = ref<SpcSummary[]>([])
const loading = ref(true)
const error = ref('')

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [p, s] = await Promise.all([
      fetchSpcMetrics(selected.value, 50),
      fetchSpcSummary(),
    ])
    points.value = p.slice().reverse()
    summaries.value = s
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
watch(selected, refresh)

const currentSummary = computed(() =>
  summaries.value.find((s) => s.metric === selected.value),
)

// SVG chart dimensions
const W = 720
const H = 320
const PAD = { top: 20, right: 20, bottom: 40, left: 60 }
const chartW = W - PAD.left - PAD.right
const chartH = H - PAD.top - PAD.bottom

const yDomain = computed(() => {
  const vals = points.value.map((p) => p.value)
  const sum = currentSummary.value
  if (!vals.length) return { min: 0, max: 1 }
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (sum) {
    min = Math.min(min, sum.lcl)
    max = Math.max(max, sum.ucl)
  }
  const margin = (max - min) * 0.1 || 1
  return { min: Math.max(0, min - margin), max: max + margin }
})

function xPos(i: number): number {
  if (points.value.length <= 1) return PAD.left + chartW / 2
  return PAD.left + (i / (points.value.length - 1)) * chartW
}

function yPos(v: number): number {
  const { min, max } = yDomain.value
  const ratio = (v - min) / (max - min)
  return PAD.top + chartH * (1 - ratio)
}

const linePath = computed(() => {
  if (!points.value.length) return ''
  return points.value
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(p.value).toFixed(1)}`)
    .join(' ')
})

const yTicks = computed(() => {
  const { min, max } = yDomain.value
  const count = 5
  const step = (max - min) / count
  return Array.from({ length: count + 1 }, (_, i) => min + step * i)
})

const xLabels = computed(() => {
  const pts = points.value
  if (!pts.length) return []
  const count = Math.min(pts.length, 6)
  const step = Math.max(1, Math.floor((pts.length - 1) / (count - 1)))
  const labels: { x: number; text: string }[] = []
  for (let i = 0; i < pts.length; i += step) {
    const pt = pts[i]
    if (!pt) continue
    labels.push({ x: xPos(i), text: pt.recorded_at.slice(5, 16).replace('T', ' ') })
  }
  return labels
})

function formatValue(v: number): string {
  if (selected.value === 'cost_usd') return `$${v.toFixed(4)}`
  if (selected.value === 'execution_time') return `${(v / 1000).toFixed(1)}s`
  return String(Math.round(v))
}
</script>

<template>
  <div class="dashboard">
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
          <router-link to="/spc" class="active">SPC</router-link>
        </nav>
      </div>
    </header>

    <div class="controls">
      <select v-model="selected" class="metric-select">
        <option v-for="m in metrics" :key="m" :value="m">{{ metricLabels[m] }}</option>
      </select>
    </div>

    <div v-if="loading" class="loading">loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
      <div v-if="currentSummary" class="stats">
        <div class="stat">
          <span class="stat-num">{{ formatValue(currentSummary.mean) }}</span>
          <span class="stat-label">CL (mean)</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ formatValue(currentSummary.ucl) }}</span>
          <span class="stat-label">UCL</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ formatValue(currentSummary.lcl) }}</span>
          <span class="stat-label">LCL</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ currentSummary.count }}</span>
          <span class="stat-label">samples</span>
        </div>
      </div>

      <section class="chart-section">
        <div v-if="!points.length" class="empty">no data for {{ metricLabels[selected] }}</div>
        <svg v-else :viewBox="`0 0 ${W} ${H}`" class="spc-svg">
          <!-- Y axis ticks -->
          <g v-for="tick in yTicks" :key="tick">
            <line
              :x1="PAD.left" :y1="yPos(tick)"
              :x2="PAD.left + chartW" :y2="yPos(tick)"
              stroke="#30363d" stroke-width="1"
            />
            <text
              :x="PAD.left - 8" :y="yPos(tick) + 4"
              text-anchor="end" fill="#8b949e" font-size="10"
            >{{ formatValue(tick) }}</text>
          </g>

          <!-- X axis labels -->
          <text
            v-for="label in xLabels" :key="label.text"
            :x="label.x" :y="H - 8"
            text-anchor="middle" fill="#8b949e" font-size="9"
          >{{ label.text }}</text>

          <!-- UCL line (dashed) -->
          <line
            v-if="currentSummary"
            :x1="PAD.left" :y1="yPos(currentSummary.ucl)"
            :x2="PAD.left + chartW" :y2="yPos(currentSummary.ucl)"
            stroke="#f85149" stroke-width="1" stroke-dasharray="6,4"
          />
          <!-- LCL line (dashed) -->
          <line
            v-if="currentSummary"
            :x1="PAD.left" :y1="yPos(currentSummary.lcl)"
            :x2="PAD.left + chartW" :y2="yPos(currentSummary.lcl)"
            stroke="#f85149" stroke-width="1" stroke-dasharray="6,4"
          />
          <!-- CL line (solid) -->
          <line
            v-if="currentSummary"
            :x1="PAD.left" :y1="yPos(currentSummary.mean)"
            :x2="PAD.left + chartW" :y2="yPos(currentSummary.mean)"
            stroke="#3fb950" stroke-width="1.5"
          />

          <!-- UCL/LCL labels -->
          <text
            v-if="currentSummary"
            :x="PAD.left + chartW + 2" :y="yPos(currentSummary.ucl) + 3"
            fill="#f85149" font-size="9"
          >UCL</text>
          <text
            v-if="currentSummary"
            :x="PAD.left + chartW + 2" :y="yPos(currentSummary.lcl) + 3"
            fill="#f85149" font-size="9"
          >LCL</text>
          <text
            v-if="currentSummary"
            :x="PAD.left + chartW + 2" :y="yPos(currentSummary.mean) + 3"
            fill="#3fb950" font-size="9"
          >CL</text>

          <!-- Data line -->
          <path :d="linePath" fill="none" stroke="#58a6ff" stroke-width="1.5" />

          <!-- Data points -->
          <circle
            v-for="(p, i) in points" :key="p.id"
            :cx="xPos(i)" :cy="yPos(p.value)" r="3.5"
            :fill="currentSummary && (p.value > currentSummary.ucl || p.value < currentSummary.lcl) ? '#f85149' : '#58a6ff'"
            :stroke="currentSummary && (p.value > currentSummary.ucl || p.value < currentSummary.lcl) ? '#f85149' : '#58a6ff'"
            stroke-width="1"
          >
            <title>{{ formatValue(p.value) }} ({{ p.recorded_at.slice(0, 19) }})</title>
          </circle>
        </svg>
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

header { margin-bottom: 2rem; }

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

.nav-links { display: flex; gap: 1rem; }
.nav-links a {
  color: #8b949e;
  text-decoration: none;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
.nav-links a:hover { color: #c9d1d9; }
.nav-links a.active,
.nav-links a.router-link-exact-active { color: #58a6ff; }

.controls { margin-bottom: 1.5rem; }

.metric-select {
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.metric-select:focus { outline: 1px solid #58a6ff; }

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

.spc-svg {
  width: 100%;
  height: auto;
}
</style>
