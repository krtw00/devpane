import { Hono } from "hono"
import { getMetrics, getControlChart } from "../spc.js"

const VALID_METRICS = ["cost_usd", "execution_time", "diff_size"]

export const spcApi = new Hono()

// GET /spc/metrics — メトリクス一覧
spcApi.get("/metrics", (c) => {
  const metric = c.req.query("metric")
  if (metric && !VALID_METRICS.includes(metric)) {
    return c.json({ error: `invalid metric: ${metric}` }, 400)
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500)
  const rows = getMetrics(metric, limit)
  return c.json(rows)
})

// GET /spc/chart/:metric — 管理図データ
spcApi.get("/chart/:metric", (c) => {
  const metric = c.req.param("metric")
  if (!VALID_METRICS.includes(metric)) {
    return c.json({ error: `invalid metric: ${metric}` }, 400)
  }
  const chart = getControlChart(metric)
  if (!chart) {
    return c.json({ error: "not enough data (need at least 5 points)" }, 404)
  }
  return c.json(chart)
})
