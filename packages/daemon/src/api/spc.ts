import { Hono } from "hono"
import { getSpcMetrics, getSpcSummary } from "../db.js"

export const spcApi = new Hono()

spcApi.get("/metrics", (c) => {
  const metric = c.req.query("metric") ?? "cost_usd"
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 500)
  const rows = getSpcMetrics(metric, limit)
  return c.json(rows)
})

spcApi.get("/summary", (c) => {
  const summary = getSpcSummary()
  return c.json(summary)
})
