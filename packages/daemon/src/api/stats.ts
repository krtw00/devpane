import { Hono } from "hono"
import { getCostStats } from "../db.js"

export const statsApi = new Hono()

statsApi.get("/cost", (c) => {
  const stats = getCostStats()
  return c.json(stats)
})
