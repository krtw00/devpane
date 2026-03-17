import { Hono } from "hono"
import { getCostStats, getPipelineStats, getRecentImprovements, getSpcMetrics } from "../db.js"
import { checkBudget } from "../cost-guard.js"

export const statsApi = new Hono()

statsApi.get("/cost", (c) => {
  const stats = getCostStats()
  return c.json(stats)
})

statsApi.get("/pipeline", (c) => {
  const stats = getPipelineStats()
  return c.json(stats)
})

statsApi.get("/spc/:metric", (c) => {
  const metric = c.req.param("metric")
  const raw = Number(c.req.query("limit") ?? 20)
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 20
  const data = getSpcMetrics(metric, limit)
  return c.json(data)
})

statsApi.get("/budget", (c) => {
  return c.json(checkBudget())
})

statsApi.get("/improvements", (c) => {
  const raw = Number(c.req.query("limit") ?? 30)
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 30
  const improvements = getRecentImprovements(limit)
  return c.json(improvements)
})
