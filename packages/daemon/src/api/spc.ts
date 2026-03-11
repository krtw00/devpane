import { Hono } from "hono"
import { getDb } from "../db.js"

export const spcApi = new Hono()

type MetricRow = {
  task_id: string
  value: number
  recorded_at: string
}

type SpcResponse = {
  metric: string
  points: { task_id: string; value: number; recorded_at: string }[]
  mean: number | null
  ucl: number | null
  lcl: number | null
}

spcApi.get("/", (c) => {
  const metric = c.req.query("metric") ?? "cost_usd"
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200)

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT task_id, value, recorded_at FROM spc_metrics WHERE metric = ? ORDER BY recorded_at DESC LIMIT ?`,
    )
    .all(metric, limit) as MetricRow[]

  // reverse to chronological order
  rows.reverse()

  let mean: number | null = null
  let ucl: number | null = null
  let lcl: number | null = null

  if (rows.length >= 5) {
    const values = rows.map((r) => r.value)
    mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance =
      values.reduce((a, b) => a + (b - mean!) ** 2, 0) / values.length
    const stddev = Math.sqrt(variance)
    ucl = mean + 3 * stddev
    lcl = Math.max(0, mean - 3 * stddev)
  }

  const resp: SpcResponse = {
    metric,
    points: rows.map((r) => ({
      task_id: r.task_id,
      value: r.value,
      recorded_at: r.recorded_at,
    })),
    mean,
    ucl,
    lcl,
  }

  return c.json(resp)
})
