import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { config } from "./config.js"
import { tasksApi } from "./api/tasks.js"
import { startScheduler, stopScheduler } from "./scheduler.js"

const app = new Hono()

app.get("/health", (c) => c.json({ status: "ok" }))
app.route("/tasks", tasksApi)

console.log(`[devpane] starting daemon on port ${config.API_PORT}`)
console.log(`[devpane] project root: ${config.PROJECT_ROOT}`)

serve({ fetch: app.fetch, port: config.API_PORT }, () => {
  console.log(`[devpane] daemon listening on http://localhost:${config.API_PORT}`)
  // Start the autonomous loop after server is ready
  startScheduler().catch((err) => {
    console.error("[devpane] scheduler crashed:", err)
    process.exit(1)
  })
})

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[devpane] shutting down...")
  stopScheduler()
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("[devpane] shutting down...")
  stopScheduler()
  process.exit(0)
})
