import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { existsSync } from "node:fs"
import { resolve, relative } from "node:path"
import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { cors } from "hono/cors"
import { config } from "./config.js"
import { tasksApi } from "./api/tasks.js"
import { chatApi } from "./api/chat.js"
import { statsApi } from "./api/stats.js"
import { eventsApi } from "./api/events.js"
import { memoriesApi } from "./api/memories.js"
import { schedulerApi } from "./api/scheduler.js"
import { prAgentApi } from "./api/pr-agent.js"
import { configApi } from "./api/config.js"
import { backupApi } from "./api/backup.js"
import { healthApi } from "./api/health.js"
import { attachWebSocket } from "./ws.js"
import { startScheduler, stopScheduler } from "./scheduler.js"
import { killAllWorkers } from "./worker.js"
import { killAllPm } from "./pm.js"
import { killAllTesters } from "./tester.js"

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

function corsOrigin(): string | string[] {
  return config.CORS_ORIGIN ?? "*"
}

function apiAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (!config.API_TOKEN) {
      await next()
      return
    }
    if (c.req.method === "OPTIONS") {
      await next()
      return
    }
    if (c.req.path === "/health") {
      await next()
      return
    }
    const token = parseBearerToken(c.req.header("Authorization"))
    if (token !== config.API_TOKEN) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  }
}

export function createApp(): Hono {
  const app = new Hono()

  app.use("*", cors({ origin: corsOrigin() }))
  app.use("/api/*", apiAuthMiddleware())
  app.get("/health", (c) => c.json({ status: "ok" }))
  app.route("/api/tasks", tasksApi)
  app.route("/api/chat", chatApi)
  app.route("/api/stats", statsApi)
  app.route("/api/events", eventsApi)
  app.route("/api/memories", memoriesApi)
  app.route("/api/scheduler", schedulerApi)
  app.route("/api/pr-agent", prAgentApi)
  app.route("/api/config", configApi)
  app.route("/api/backups", backupApi)
  app.route("/api/system", healthApi)

  // Static file serving for production
  const webDistPath = resolve(import.meta.dirname, "../../web/dist")
  if (existsSync(webDistPath)) {
    const root = relative(process.cwd(), webDistPath)
    app.use("/*", serveStatic({ root }))
    // SPA fallback: serve index.html for non-API routes
    app.get("*", serveStatic({ root, path: "index.html" }))
    console.log(`[${config.APP_NAME.toLowerCase()}] serving web UI from ${webDistPath}`)
  }
  return app
}

export function startDaemon() {
  const app = createApp()

  console.log(`[${config.APP_NAME.toLowerCase()}] starting daemon on port ${config.API_PORT}`)
  console.log(`[${config.APP_NAME.toLowerCase()}] project root: ${config.PROJECT_ROOT}`)

  const server = serve({ fetch: app.fetch, port: config.API_PORT }, () => {
    console.log(`[${config.APP_NAME.toLowerCase()}] daemon listening on http://localhost:${config.API_PORT}`)
    startScheduler().catch((err) => {
      console.error(`[${config.APP_NAME.toLowerCase()}] scheduler crashed:`, err)
      process.exit(1)
    })
  })

  attachWebSocket(server)

  // Graceful shutdown
  async function shutdown() {
    console.log(`[${config.APP_NAME.toLowerCase()}] shutting down...`)
    await stopScheduler()
    killAllWorkers()
    killAllPm()
    killAllTesters()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  return { app, server }
}

if (import.meta.main) {
  startDaemon()
}
