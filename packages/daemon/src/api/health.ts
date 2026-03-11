import { Hono } from "hono"
import { statSync } from "node:fs"
import { config } from "../config.js"
import { getSchedulerState } from "../scheduler.js"
import { getTasksByStatus } from "../db.js"

const startedAt = Date.now()

export const healthApi = new Hono()

healthApi.get("/", (c) => {
  const scheduler = getSchedulerState()
  const running = getTasksByStatus("running")

  let dbSize: number | null = null
  try {
    dbSize = statSync(config.DB_PATH).size
  } catch {
    // DB file may not exist yet
  }

  return c.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    schedulerRunning: scheduler.alive,
    activeWorkers: running.length,
    dbSize,
    lastPmRun: scheduler.lastPmRunAt,
  })
})
