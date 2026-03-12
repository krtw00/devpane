import { Hono } from "hono"
import { getCostStats, getPipelineStats } from "../db.js"

export const statsApi = new Hono()

statsApi.get("/cost", (c) => {
  const stats = getCostStats()
  return c.json(stats)
})

statsApi.get("/pipeline", (c) => {
  const stats = getPipelineStats()
  return c.json(stats)
})
