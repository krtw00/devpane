import { Hono } from "hono"
import { getCostStats, getCostToday, getCostMonth } from "../db.js"
import { config } from "../config.js"
import { isSchedulerPaused } from "../scheduler.js"

export const statsApi = new Hono()

statsApi.get("/cost", (c) => {
  const stats = getCostStats()
  return c.json(stats)
})

statsApi.get("/cost/limits", (c) => {
  const dailyCost = getCostToday()
  const monthlyCost = getCostMonth()

  return c.json({
    daily: {
      limit: config.DAILY_COST_LIMIT_USD,
      used: dailyCost,
      remaining: Math.max(0, config.DAILY_COST_LIMIT_USD - dailyCost),
      ratio: config.DAILY_COST_LIMIT_USD > 0 ? dailyCost / config.DAILY_COST_LIMIT_USD : 0,
    },
    monthly: {
      limit: config.MONTHLY_COST_LIMIT_USD,
      used: monthlyCost,
      remaining: Math.max(0, config.MONTHLY_COST_LIMIT_USD - monthlyCost),
      ratio: config.MONTHLY_COST_LIMIT_USD > 0 ? monthlyCost / config.MONTHLY_COST_LIMIT_USD : 0,
    },
    paused: isSchedulerPaused(),
  })
})
