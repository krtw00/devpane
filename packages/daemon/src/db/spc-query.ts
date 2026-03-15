import { getDb } from "./core.js"

export type SpcDataPoint = {
  value: number
  label: string
  task_id: string
}

export type SpcMetricData = {
  metric: string
  data: SpcDataPoint[]
  mean: number
  ucl: number
  lcl: number
}

export function getSpcMetrics(metric: string, limit = 20): SpcMetricData {
  const d = getDb()

  const rows = d.prepare(`
    SELECT value, task_id, recorded_at
    FROM spc_metrics
    WHERE metric = ?
    ORDER BY recorded_at DESC
    LIMIT ?
  `).all(metric, limit) as { value: number; task_id: string; recorded_at: string }[]

  // reverse to chronological order
  rows.reverse()

  const data = rows.map((r, i) => ({
    value: r.value,
    label: `#${i + 1}`,
    task_id: r.task_id,
  }))

  const values = rows.map(r => r.value)
  let mean = 0
  let ucl = 0
  let lcl = 0

  if (values.length >= 2) {
    mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    const stddev = Math.sqrt(variance)
    ucl = mean + 3 * stddev
    lcl = Math.max(0, mean - 3 * stddev)
  }

  return { metric, data, mean, ucl, lcl }
}
