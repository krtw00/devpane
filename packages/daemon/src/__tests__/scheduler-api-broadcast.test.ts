import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { initDb, closeDb } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Mock scheduler module
vi.mock("../scheduler.js", () => {
  let paused = false
  return {
    getSchedulerState: () => ({
      alive: true,
      paused,
      rateLimitHits: 0,
      pmConsecutiveFailures: 0,
      taskCompletionsSinceLastMeasure: 0,
    }),
    pauseScheduler: () => { paused = true },
    resumeScheduler: () => { paused = false },
  }
})

// Mock ws module to spy on broadcast calls
const broadcastMock = vi.fn()
vi.mock("../ws.js", () => ({
  broadcast: broadcastMock,
}))

// Import after mocks are set up
const { schedulerApi } = await import("../api/scheduler.js")

function buildApp() {
  const app = new Hono()
  app.route("/scheduler", schedulerApi)
  return app
}

describe("Scheduler API broadcasts WebSocket events", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
    broadcastMock.mockClear()
  })

  afterEach(() => {
    closeDb()
  })

  it("POST /scheduler/pause broadcasts scheduler:state with paused status", async () => {
    const res = await app.request("/scheduler/pause", { method: "POST" })
    expect(res.status).toBe(200)

    expect(broadcastMock).toHaveBeenCalledWith(
      "scheduler:state",
      expect.objectContaining({ paused: true }),
    )
  })

  it("POST /scheduler/resume broadcasts scheduler:state with resumed status", async () => {
    // First pause
    await app.request("/scheduler/pause", { method: "POST" })
    broadcastMock.mockClear()

    // Then resume
    const res = await app.request("/scheduler/resume", { method: "POST" })
    expect(res.status).toBe(200)

    expect(broadcastMock).toHaveBeenCalledWith(
      "scheduler:state",
      expect.objectContaining({ paused: false }),
    )
  })

  it("GET /scheduler/status does NOT broadcast", async () => {
    await app.request("/scheduler/status")
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it("broadcast is called exactly once per pause/resume", async () => {
    await app.request("/scheduler/pause", { method: "POST" })
    expect(broadcastMock).toHaveBeenCalledTimes(1)

    broadcastMock.mockClear()

    await app.request("/scheduler/resume", { method: "POST" })
    expect(broadcastMock).toHaveBeenCalledTimes(1)
  })
})
