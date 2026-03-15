<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: Array<{ value: number; label: string }>
  ucl: number
  lcl: number
  mean: number
  title: string
}>()

const PAD = { top: 24, right: 16, bottom: 28, left: 56 }
const W = 600
const H = 200
const chartW = W - PAD.left - PAD.right
const chartH = H - PAD.top - PAD.bottom

const yRange = computed(() => {
  if (props.data.length === 0) return { min: 0, max: 1 }
  const vals = [...props.data.map(d => d.value), props.ucl, props.lcl, props.mean].filter(v => v != null && isFinite(v))
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const margin = (max - min) * 0.15 || 0.1
  return { min: Math.max(0, min - margin), max: max + margin }
})

function yPos(v: number): number {
  const { min, max } = yRange.value
  const ratio = max === min ? 0.5 : (v - min) / (max - min)
  return PAD.top + chartH * (1 - ratio)
}

function xPos(i: number): number {
  const n = props.data.length
  if (n <= 1) return PAD.left + chartW / 2
  return PAD.left + (i / (n - 1)) * chartW
}

const linePath = computed(() => {
  if (props.data.length === 0) return ''
  return props.data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(d.value).toFixed(1)}`).join(' ')
})

const yTicks = computed(() => {
  const { min, max } = yRange.value
  const step = (max - min) / 4
  return [0, 1, 2, 3, 4].map(i => {
    const v = min + step * i
    return { value: v, y: yPos(v), label: v < 1 ? v.toFixed(3) : v < 100 ? v.toFixed(1) : Math.round(v).toString() }
  })
})

const xLabels = computed(() => {
  const n = props.data.length
  if (n === 0) return []
  const step = n <= 10 ? 1 : Math.ceil(n / 10)
  return props.data
    .map((d, i) => ({ label: d.label, x: xPos(i) }))
    .filter((_, i) => i % step === 0 || i === n - 1)
})

function formatLabel(v: number): string {
  return v < 1 ? v.toFixed(3) : v < 100 ? v.toFixed(1) : Math.round(v).toString()
}
</script>

<template>
  <div class="spc-chart">
    <div class="chart-title">{{ title }}</div>
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
      <!-- Background -->
      <rect :x="PAD.left" :y="PAD.top" :width="chartW" :height="chartH" fill="#161b22" rx="2" />

      <!-- Y-axis grid lines -->
      <line v-for="t in yTicks" :key="t.value"
        :x1="PAD.left" :y1="t.y" :x2="PAD.left + chartW" :y2="t.y"
        stroke="#21262d" stroke-width="0.5" />

      <!-- Y-axis labels -->
      <text v-for="t in yTicks" :key="'yl-' + t.value"
        :x="PAD.left - 4" :y="t.y + 3"
        fill="#8b949e" font-size="8" text-anchor="end" font-family="monospace">{{ t.label }}</text>

      <!-- X-axis labels -->
      <text v-for="xl in xLabels" :key="'xl-' + xl.label"
        :x="xl.x" :y="H - 4"
        fill="#8b949e" font-size="7" text-anchor="middle" font-family="monospace">{{ xl.label }}</text>

      <!-- UCL line -->
      <line v-if="ucl > 0"
        :x1="PAD.left" :y1="yPos(ucl)" :x2="PAD.left + chartW" :y2="yPos(ucl)"
        stroke="#f85149" stroke-width="1" stroke-dasharray="4,3" />
      <text v-if="ucl > 0"
        :x="PAD.left + chartW + 2" :y="yPos(ucl) + 3"
        fill="#f85149" font-size="7" font-family="monospace">UCL</text>

      <!-- LCL line -->
      <line v-if="lcl >= 0"
        :x1="PAD.left" :y1="yPos(lcl)" :x2="PAD.left + chartW" :y2="yPos(lcl)"
        stroke="#f85149" stroke-width="1" stroke-dasharray="4,3" />
      <text v-if="lcl >= 0"
        :x="PAD.left + chartW + 2" :y="yPos(lcl) + 3"
        fill="#f85149" font-size="7" font-family="monospace">LCL</text>

      <!-- Mean line -->
      <line v-if="mean > 0"
        :x1="PAD.left" :y1="yPos(mean)" :x2="PAD.left + chartW" :y2="yPos(mean)"
        stroke="#8b949e" stroke-width="1" />
      <text v-if="mean > 0"
        :x="PAD.left + chartW + 2" :y="yPos(mean) + 3"
        fill="#8b949e" font-size="7" font-family="monospace">{{ formatLabel(mean) }}</text>

      <!-- Data line -->
      <path v-if="data.length > 1"
        :d="linePath" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linejoin="round" />

      <!-- Data points -->
      <circle v-for="(d, i) in data" :key="i"
        :cx="xPos(i)" :cy="yPos(d.value)" r="2.5"
        :fill="d.value > ucl || d.value < lcl ? '#f85149' : '#58a6ff'" />

      <!-- No data message -->
      <text v-if="data.length === 0"
        :x="W / 2" :y="H / 2" fill="#484f58" font-size="11"
        text-anchor="middle" font-family="monospace">データなし</text>
    </svg>
  </div>
</template>

<style scoped>
.spc-chart {
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
  overflow: hidden;
}

.chart-title {
  padding: 0.3rem 0.5rem;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  font-size: 0.7rem;
  font-weight: 700;
  color: #f0f6fc;
}

svg {
  display: block;
  width: 100%;
  height: auto;
}
</style>
