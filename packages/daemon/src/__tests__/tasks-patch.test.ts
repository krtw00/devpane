import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { initDb, closeDb, createTask, getTask, startTask, finishTask } from "../db.js"
import { tasksApi } from "../api/tasks.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function buildApp() {
  const app = new Hono()
  app.route("/tasks", tasksApi)
  return app
}

describe("PATCH /tasks/:id", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
  })

  afterEach(() => {
    closeDb()
  })

  it("updates task priority", async () => {
    const task = createTask("priority target", "desc", "human", 1)

    const res = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: 42 }),
    })

    expect(res.status).toBe(200)
    const updated = getTask(task.id)
    expect(updated?.priority).toBe(42)
  })

  it("cancels pending task as failed", async () => {
    const task = createTask("cancel me", "desc", "human")

    const res = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    })

    expect(res.status).toBe(200)
    const updated = getTask(task.id)
    expect(updated?.status).toBe("failed")
    expect(updated?.finished_at).toBeTruthy()
  })

  it("returns 400 when cancelling non-pending task", async () => {
    const task = createTask("already running", "desc", "human")
    startTask(task.id, "worker-0")

    const res = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    })

    expect(res.status).toBe(400)
  })

  it("suppresses failed task", async () => {
    const task = createTask("suppress me", "desc", "human")
    startTask(task.id, "worker-0")
    finishTask(task.id, "failed", JSON.stringify({ error: "duplicate task" }))

    const res = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "suppressed" }),
    })

    expect(res.status).toBe(200)
    expect(getTask(task.id)?.status).toBe("suppressed")
  })

  it("requeues suppressed task back to pending", async () => {
    const task = createTask("restore me", "desc", "human")
    startTask(task.id, "worker-0")
    finishTask(task.id, "failed", JSON.stringify({ error: "duplicate task" }))
    await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "suppressed" }),
    })

    const res = await app.request(`/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pending" }),
    })

    expect(res.status).toBe(200)
    expect(getTask(task.id)?.status).toBe("pending")
  })
})
