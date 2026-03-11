<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { fetchSpcData, type SpcData } from '../composables/useApi'

const metrics = [
  { value: 'cost_usd', label: 'Cost (USD)' },
  { value: 'execution_time', label: 'Execution Time (ms)' },
  { value: 'diff_size', label: 'Diff Size (lines)' },
] as const

const selectedMetric = ref<string>('cost_usd')
const data = ref<SpcData | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchSpcData(selectedMetric.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(selectedMetric, load)

const SVG_W = 720
const SVG_H = 320
const PAD = { top: 20, right: 20, bottom: 40, left: 60 }
const chartW = SVG_W - PAD.left - PAD.right
const chartH = SVG_H - PAD.top - PAD.bottom

const yDomain = computed(() => {
  if (!data.value || data.value.points.length === 0) return { min: 0, max: 1 }
  const vals = data.value.points.map((p) => p.value)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (data.value.ucl != null) hi = Math.max(hi, data.value.ucl)
  if (data.value.lcl != null) lo = Math.min(lo, data.value.lcl)
  const margin = (hi - lo) * 0.1 || 1
  return { min: Math.max(0, lo - margin), max: hi + margin }
})

function xPos(i: number, total: number): number {
  if (total <= 1) return PAD.left + chartW / 2
  return PAD.left + (i / (total - 1)) * chartW
}

function yPos(v: number): number {
  const { min, max } = yDomain.value
  const ratio = (v - min) / (max - min)
  return PAD.top + chartH * (1 - ratio)
}

const linePath = computed(() => {
  if (!data.value) return ''
  const pts = data.value.points
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(i, pts.length).toFixed(1)},${yPos(p.value).toFixed(1)}`).join(' ')
})

const yTicks = computed(() => {
  const { min, max } = yDomain.value
  const step = (max - min) / 4
  return Array.from({ length: 5 }, (_, i) => min + step * i)
})

function formatVal(v: number): string {
  if (selectedMetric.value === 'cost_usd') return `$${v.toFixed(4)}`
  if (selectedMetric.value === 'execution_time') return `${(v / 1000).toFixed(1)}s`
  return String(Math.round(v))
}

function formatDate(iso: string): string {
  return iso.slice(5, 10)
}

const xLabels = computed(() => {
  if (!data.value) return []
  const pts = data.value.points
  if (pts.length <= 10) return pts.map((p, i) => ({ i, label: formatDate(p.recorded_at) }))
  const step = Math.ceil(pts.length / 8)
  return pts
    .map((p, i) => ({ i, label: formatDate(p.recorded_at) }))
    .filter((_, idx) => idx % step === 0 || idx === pts.length - 1)
})

const metricLabel = computed(() => metrics.find((m) => m.value === selectedMetric.value)?.label ?? selectedMetric.value)
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
          <router-link to="/spc" class="active">SPC</router-link>
        </nav>
      </div>
    </header>

    <div class="controls">
      <label>
        <span class="control-label">Metric</span>
        <select v-model="selectedMetric">
          <option v-for="m in metrics" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </label>
    </div>

    <div v-if="loading" class="loading">loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else-if="data">
      <div v-if="data.points.length === 0" class="loading">no data yet</div>
      <template v-else>
        <div class="stats">
          <div class="stat">
            <span class="stat-num">{{ data.points.length }}</span>
            <span class="stat-label">points</span>
          </div>
          <div v-if="data.mean != null" class="stat">
            <span class="stat-num">{{ formatVal(data.mean) }}</span>
            <span class="stat-label">mean</span>
          </div>
          <div v-if="data.ucl != null" class="stat">
            <span class="stat-num">{{ formatVal(data.ucl) }}</span>
            <span class="stat-label">UCL</span>
          </div>
          <div v-if="data.lcl != null" class="stat">
            <span class="stat-num">{{ formatVal(data.lcl) }}</span>
            <span class="stat-label">LCL</span>
          </div>
        </div>

        <section class="chart-section">
          <h2>{{ metricLabel }}</h2>
          <svg :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="chart-svg">
            <!-- grid -->
            <line
              v-for="t in yTicks" :key="t"
              :x1="PAD.left" :x2="SVG_W - PAD.right"
              :y1="yPos(t)" :y2="yPos(t)"
              class="grid-line"
            />

            <!-- UCL/LCL/Mean -->
            <template v-if="data.ucl != null && data.lcl != null && data.mean != null">
              <line
                :x1="PAD.left" :x2="SVG_W - PAD.right"
                :y1="yPos(data.ucl)" :y2="yPos(data.ucl)"
                class="limit-line ucl-line"
              />
              <text :x="SVG_W - PAD.right + 4" :y="yPos(data.ucl) + 4" class="limit-text ucl-text">UCL</text>

              <line
                :x1="PAD.left" :x2="SVG_W - PAD.right"
                :y1="yPos(data.lcl)" :y2="yPos(data.lcl)"
                class="limit-line lcl-line"
              />
              <text :x="SVG_W - PAD.right + 4" :y="yPos(data.lcl) + 4" class="limit-text lcl-text">LCL</text>

              <line
                :x1="PAD.left" :x2="SVG_W - PAD.right"
                :y1="yPos(data.mean)" :y2="yPos(data.mean)"
                class="mean-line"
              />
              <text :x="SVG_W - PAD.right + 4" :y="yPos(data.mean) + 4" class="limit-text mean-text">Mean</text>
            </template>

            <!-- data line -->
            <path :d="linePath" class="data-line" />

            <!-- data points -->
            <circle
              v-for="(p, i) in data.points" :key="p.recorded_at"
              :cx="xPos(i, data.points.length)"
              :cy="yPos(p.value)"
              r="3"
              :class="['data-point', { alert: data.ucl != null && data.lcl != null && (p.value > data.ucl || p.value < data.lcl) }]"
            >
              <title>{{ formatVal(p.value) }} ({{ p.recorded_at.slice(0, 16) }})</title>
            </circle>

            <!-- Y axis labels -->
            <text
              v-for="t in yTicks" :key="'yl' + t"
              :x="PAD.left - 6" :y="yPos(t) + 4"
              class="axis-text y-label"
            >{{ formatVal(t) }}</text>

            <!-- X axis labels -->
            <text
              v-for="lbl in xLabels" :key="'xl' + lbl.i"
              :x="xPos(lbl.i, data.points.length)" :y="SVG_H - PAD.bottom + 18"
              class="axis-text x-label"
            >{{ lbl.label }}</text>
          </svg>
        </section>
      </template>
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

header { margin-bottom: 1.5rem; }

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

.nav-links a:hover { color: #c9d1d9; }

.nav-links a.active,
.nav-links a.router-link-exact-active {
  color: #58a6ff;
}

.controls {
  margin-bottom: 1.5rem;
}

.control-label {
  font-size: 0.75rem;
  color: #8b949e;
  text-transform: uppercase;
  display: block;
  margin-bottom: 0.25rem;
}

select {
  background: #161b22;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.85rem;
}

.stats {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-size: 1.4rem;
  font-weight: bold;
  color: #f0f6fc;
}

.stat-label {
  font-size: 0.75rem;
  color: #8b949e;
  text-transform: uppercase;
}

.loading {
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
  margin: 0 0 0.75rem;
}

.chart-svg {
  width: 100%;
  height: auto;
}

.grid-line {
  stroke: #21262d;
  stroke-width: 1;
}

.data-line {
  fill: none;
  stroke: #58a6ff;
  stroke-width: 2;
}

.data-point {
  fill: #58a6ff;
}

.data-point.alert {
  fill: #f85149;
}

.limit-line {
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}

.ucl-line { stroke: #f85149; }
.lcl-line { stroke: #3fb950; }
.mean-line {
  stroke: #d29922;
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.limit-text {
  font-size: 10px;
  font-family: inherit;
}

.ucl-text { fill: #f85149; }
.lcl-text { fill: #3fb950; }
.mean-text { fill: #d29922; }

.axis-text {
  fill: #8b949e;
  font-size: 10px;
  font-family: inherit;
}

.y-label { text-anchor: end; }
.x-label { text-anchor: middle; }
</style>
