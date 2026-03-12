import { Hono } from "hono"
import { getMetricTimeSeries, getMetricSummary } from "../spc.js"

const METRICS = ["cost_usd", "execution_time", "diff_size"] as const

export const spcApi = new Hono()

// GET /spc/metrics?metric=cost_usd&limit=50
spcApi.get("/metrics", (c) => {
  const metric = c.req.query("metric") ?? "cost_usd"
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200)
  const series = getMetricTimeSeries(metric, limit)
  return c.json(series)
})

// GET /spc/summary
spcApi.get("/summary", (c) => {
  const result: Record<string, ReturnType<typeof getMetricSummary>> = {}
  for (const m of METRICS) {
    result[m] = getMetricSummary(m)
  }
  return c.json(result)
})
