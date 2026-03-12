<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'

type TimeSeriesPoint = { value: number; recorded_at: string }
type MetricSummary = { mean: number; ucl: number; lcl: number; lastAlert: number | null } | null
type SummaryMap = Record<string, MetricSummary>

const BASE = '/api'
const METRICS = ['cost_usd', 'execution_time', 'diff_size'] as const
const METRIC_LABELS: Record<string, string> = {
  cost_usd: 'Cost (USD)',
  execution_time: 'Execution Time (ms)',
  diff_size: 'Diff Size (lines)',
}
const METRIC_FORMAT: Record<string, (v: number) => string> = {
  cost_usd: (v) => `$${v.toFixed(4)}`,
  execution_time: (v) => `${(v / 1000).toFixed(1)}s`,
  diff_size: (v) => `${Math.round(v)}`,
}

const loading = ref(true)
const error = ref('')
const summary = ref<SummaryMap>({})
const series = ref<Record<string, TimeSeriesPoint[]>>({})

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

onMounted(async () => {
  try {
    const [summaryData, ...seriesData] = await Promise.all([
      fetchJson<SummaryMap>('/spc/summary'),
      ...METRICS.map((m) => fetchJson<TimeSeriesPoint[]>(`/spc/metrics?metric=${m}&limit=50`)),
    ])
    summary.value = summaryData
    METRICS.forEach((m, i) => {
      series.value[m] = seriesData[i] ?? []
    })
    await nextTick()
    METRICS.forEach(drawChart)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

function drawChart(metric: string) {
  const canvas = document.getElementById(`chart-${metric}`) as HTMLCanvasElement | null
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const points = series.value[metric]
  const sum = summary.value[metric]
  if (!points?.length) return

  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)

  const pad = { top: 20, right: 16, bottom: 24, left: 60 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

  const values = points.map((p) => p.value)
  let yMin = Math.min(...values)
  let yMax = Math.max(...values)
  if (sum) {
    yMin = Math.min(yMin, sum.lcl)
    yMax = Math.max(yMax, sum.ucl)
  }
  const yRange = yMax - yMin || 1
  yMin -= yRange * 0.1
  yMax += yRange * 0.1
  const yScale = plotH / (yMax - yMin)

  const xStep = points.length > 1 ? plotW / (points.length - 1) : plotW

  function toX(i: number) { return pad.left + i * xStep }
  function toY(v: number) { return pad.top + (yMax - v) * yScale }

  // grid
  ctx.strokeStyle = '#21262d'
  ctx.lineWidth = 1
  const gridLines = 4
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (plotH / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(w - pad.right, y)
    ctx.stroke()
    const val = yMax - ((yMax - yMin) / gridLines) * i
    ctx.fillStyle = '#8b949e'
    ctx.font = '10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(fmt(metric, val), pad.left - 6, y + 3)
  }

  // control lines
  if (sum) {
    drawHLine(ctx, toY(sum.ucl), pad.left, w - pad.right, '#f8514950', 'UCL')
    drawHLine(ctx, toY(sum.mean), pad.left, w - pad.right, '#58a6ff50', 'Mean')
    drawHLine(ctx, toY(sum.lcl), pad.left, w - pad.right, '#3fb95050', 'LCL')
  }

  // data line
  ctx.strokeStyle = '#c9d1d9'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  points.forEach((p, i) => {
    const x = toX(i)
    const y = toY(p.value)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // data points + alert highlight
  points.forEach((p, i) => {
    const x = toX(i)
    const y = toY(p.value)
    const isAlert = sum && (p.value > sum.ucl || p.value < sum.lcl)
    ctx.beginPath()
    ctx.arc(x, y, isAlert ? 4 : 2.5, 0, Math.PI * 2)
    ctx.fillStyle = isAlert ? '#f85149' : '#c9d1d9'
    ctx.fill()
    if (isAlert) {
      ctx.strokeStyle = '#f8514980'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.stroke()
    }
  })
}

function drawHLine(ctx: CanvasRenderingContext2D, y: number, x1: number, x2: number, color: string, label: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = color.slice(0, 7)
  ctx.font = '9px monospace'
  ctx.textAlign = 'left'
  ctx.fillText(label, x2 + 2, y + 3)
  ctx.restore()
}

function fmt(metric: string, v: number): string {
  return (METRIC_FORMAT[metric] ?? String)(v)
}
</script>

<template>
  <div class="dashboard">
    <header>
      <div class="header-row">
        <div>
          <h1>SPC Metrics</h1>
          <span class="subtitle">statistical process control</span>
        </div>
        <nav class="nav-links">
          <router-link to="/">Dashboard</router-link>
          <router-link to="/cost">Cost</router-link>
          <router-link to="/metrics" class="active">Metrics</router-link>
        </nav>
      </div>
    </header>

    <div v-if="loading" class="loading">loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else>
      <section v-for="metric in METRICS" :key="metric" class="metric-section">
        <h2>{{ METRIC_LABELS[metric] }}</h2>
        <div v-if="summary[metric]" class="summary-row">
          <span class="tag">Mean: {{ fmt(metric, summary[metric]!.mean) }}</span>
          <span class="tag ucl">UCL: {{ fmt(metric, summary[metric]!.ucl) }}</span>
          <span class="tag lcl">LCL: {{ fmt(metric, summary[metric]!.lcl) }}</span>
          <span v-if="summary[metric]!.lastAlert !== null" class="tag alert">
            Last Alert: {{ fmt(metric, summary[metric]!.lastAlert!) }}
          </span>
        </div>
        <div v-if="!series[metric]?.length" class="empty">no data yet</div>
        <canvas v-else :id="`chart-${metric}`" class="chart-canvas" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 900px;
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

.metric-section {
  border-top: 1px solid #30363d;
  padding-top: 1.5rem;
  margin-bottom: 2rem;
}

.metric-section h2 {
  font-size: 0.95rem;
  color: #f0f6fc;
  margin: 0 0 0.5rem;
}

.summary-row {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.tag {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  background: #161b22;
  border: 1px solid #30363d;
  color: #c9d1d9;
}

.tag.ucl { color: #f85149; border-color: #f8514940; }
.tag.lcl { color: #3fb950; border-color: #3fb95040; }
.tag.alert { color: #f0883e; border-color: #f0883e40; }

.chart-canvas {
  width: 100%;
  height: 200px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
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
</style>
