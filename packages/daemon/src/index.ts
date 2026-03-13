import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { config } from "./config.js"
import { tasksApi } from "./api/tasks.js"
import { chatApi } from "./api/chat.js"
import { statsApi } from "./api/stats.js"
import { eventsApi } from "./api/events.js"
import { memoriesApi } from "./api/memories.js"
import { schedulerApi } from "./api/scheduler.js"
import { prAgentApi } from "./api/pr-agent.js"
import { attachWebSocket } from "./ws.js"
import { startScheduler, stopScheduler } from "./scheduler.js"
import { killAllWorkers } from "./worker.js"
import { killAllPm } from "./pm.js"
import { killAllTesters } from "./tester.js"

const app = new Hono()

app.use("*", cors())
app.get("/health", (c) => c.json({ status: "ok" }))
app.route("/tasks", tasksApi)
app.route("/chat", chatApi)
app.route("/stats", statsApi)
app.route("/events", eventsApi)
app.route("/memories", memoriesApi)
app.route("/scheduler", schedulerApi)
app.route("/pr-agent", prAgentApi)

console.log(`[devpane] starting daemon on port ${config.API_PORT}`)
console.log(`[devpane] project root: ${config.PROJECT_ROOT}`)

const server = serve({ fetch: app.fetch, port: config.API_PORT }, () => {
  console.log(`[devpane] daemon listening on http://localhost:${config.API_PORT}`)
  startScheduler().catch((err) => {
    console.error("[devpane] scheduler crashed:", err)
    process.exit(1)
  })
})

attachWebSocket(server)

// Graceful shutdown
async function shutdown() {
  console.log("[devpane] shutting down...")
  await stopScheduler()
  killAllWorkers()
  killAllPm()
  killAllTesters()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
