import { ulid } from "ulid"
import { getDb } from "./db.js"
import { emit } from "./events.js"

let stmt: ReturnType<typeof prepareStmt> | null = null
let stmtDb: ReturnType<typeof getDb> | null = null

function prepareStmt() {
  const db = getDb()
  return {
    insert: db.prepare(`INSERT INTO spc_metrics (id, task_id, metric, value, recorded_at) VALUES (?, ?, ?, ?, ?)`),
    recentByMetric: db.prepare(`SELECT value FROM spc_metrics WHERE metric = ? ORDER BY recorded_at DESC LIMIT ?`),
    metricsList: db.prepare(`SELECT id, task_id, metric, value, recorded_at FROM spc_metrics WHERE metric = ? ORDER BY recorded_at DESC LIMIT ?`),
    metricsAll: db.prepare(`SELECT id, task_id, metric, value, recorded_at FROM spc_metrics ORDER BY recorded_at DESC LIMIT ?`),
  }
}

function getStmt() {
  const db = getDb()
  if (!stmt || stmtDb !== db) {
    stmt = prepareStmt()
    stmtDb = db
  }
  return stmt
}

const WINDOW_SIZE = 20

export function recordMetric(taskId: string, metric: string, value: number): void {
  const s = getStmt()
  s.insert.run(ulid(), taskId, metric, value, new Date().toISOString())
}

export function recordTaskMetrics(taskId: string, costUsd: number, executionMs: number, diffSize: number): void {
  recordMetric(taskId, "cost_usd", costUsd)
  recordMetric(taskId, "execution_time", executionMs)
  recordMetric(taskId, "diff_size", diffSize)
}

function getRecentValues(metric: string): number[] {
  const rows = getStmt().recentByMetric.all(metric, WINDOW_SIZE) as { value: number }[]
  return rows.map(r => r.value)
}

function calcStats(values: number[]): { mean: number; stddev: number } | null {
  if (values.length < 5) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return { mean, stddev: Math.sqrt(variance) }
}

export type SpcCheck = {
  metric: string
  value: number
  mean: number
  ucl: number
  lcl: number
  alert: boolean
  reason?: string
}

export function checkMetric(metric: string, currentValue: number): SpcCheck | null {
  const values = getRecentValues(metric)
  const stats = calcStats(values)
  if (!stats) return null

  const ucl = stats.mean + 3 * stats.stddev
  const lcl = Math.max(0, stats.mean - 3 * stats.stddev)

  const check: SpcCheck = {
    metric,
    value: currentValue,
    mean: stats.mean,
    ucl,
    lcl,
    alert: false,
  }

  // Rule 1: 1点がUCL/LCL外
  if (currentValue > ucl) {
    check.alert = true
    check.reason = `value ${currentValue.toFixed(4)} exceeds UCL ${ucl.toFixed(4)}`
  } else if (currentValue < lcl) {
    check.alert = true
    check.reason = `value ${currentValue.toFixed(4)} below LCL ${lcl.toFixed(4)}`
  }

  // Rule 2: 連続7点が平均の同じ側
  if (!check.alert && values.length >= 7) {
    const recent7 = values.slice(0, 7)
    const allAbove = recent7.every(v => v > stats.mean)
    const allBelow = recent7.every(v => v < stats.mean)
    if (allAbove || allBelow) {
      check.alert = true
      check.reason = `7 consecutive points ${allAbove ? "above" : "below"} mean`
    }
  }

  if (check.alert) {
    emit({ type: "spc.alert", metric, value: currentValue, ucl })
  }

  return check
}

export type SpcMetricRow = {
  id: string
  task_id: string
  metric: string
  value: number
  recorded_at: string
}

export function getMetrics(metric: string | undefined, limit: number): SpcMetricRow[] {
  const s = getStmt()
  if (metric) {
    return s.metricsList.all(metric, limit) as SpcMetricRow[]
  }
  return s.metricsAll.all(limit) as SpcMetricRow[]
}

export type ControlChart = {
  metric: string
  values: number[]
  mean: number
  ucl: number
  lcl: number
}

export function getControlChart(metric: string): ControlChart | null {
  const values = getRecentValues(metric)
  const stats = calcStats(values)
  if (!stats) return null
  return {
    metric,
    values,
    mean: stats.mean,
    ucl: stats.mean + 3 * stats.stddev,
    lcl: Math.max(0, stats.mean - 3 * stats.stddev),
  }
}

export function checkAllMetrics(_taskId: string, costUsd: number, executionMs: number, diffSize: number): SpcCheck[] {
  const results: SpcCheck[] = []
  for (const [metric, value] of [["cost_usd", costUsd], ["execution_time", executionMs], ["diff_size", diffSize]] as const) {
    const check = checkMetric(metric, value)
    if (check) results.push(check)
  }
  return results
}
