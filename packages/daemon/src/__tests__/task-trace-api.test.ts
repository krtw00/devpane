import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { initDb, closeDb, createTask, finishTask, startTask } from "../db.js"
import { insertAgentEvent } from "../db/events.js"
import { tasksApi } from "../api/tasks.js"

import type { PipelineTrace } from "../pipeline-trace.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function buildApp() {
  const app = new Hono()
  app.route("/tasks", tasksApi)
  return app
}

describe("GET /tasks/:id/trace", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
  })

  afterEach(() => {
    closeDb()
  })

  it("returns 404 when task does not exist", async () => {
    const res = await app.request("/tasks/nonexistent-id/trace")
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toHaveProperty("error")
  })

  it("returns trace for an existing task", async () => {
    const task = createTask("Test task", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    finishTask(task.id, "done", "ok")

    const res = await app.request(`/tasks/${task.id}/trace`)
    expect(res.status).toBe(200)
    const body: PipelineTrace = await res.json()
    expect(body.taskId).toBe(task.id)
    expect(body.title).toBe("Test task")
  })

  it("returns trace with all required fields", async () => {
    const task = createTask("Full fields", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    finishTask(task.id, "done", "ok")

    const res = await app.request(`/tasks/${task.id}/trace`)
    expect(res.status).toBe(200)
    const body: PipelineTrace = await res.json()

    expect(body).toHaveProperty("taskId")
    expect(body).toHaveProperty("title")
    expect(body).toHaveProperty("gate1")
    expect(body).toHaveProperty("tester")
    expect(body).toHaveProperty("gate2")
    expect(body).toHaveProperty("worker")
    expect(body).toHaveProperty("gate3")
    expect(body).toHaveProperty("outcome")
    expect(body).toHaveProperty("costUsd")
  })

  it("reflects gate events in trace stages", async () => {
    const task = createTask("Gated task", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate1" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate2" })
    insertAgentEvent("task.started", { type: "task.started", taskId: task.id, workerId: "worker-0" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate3" })
    insertAgentEvent("task.completed", { type: "task.completed", taskId: task.id, costUsd: 0.05 })
    finishTask(task.id, "done", "merged")

    const res = await app.request(`/tasks/${task.id}/trace`)
    expect(res.status).toBe(200)
    const body: PipelineTrace = await res.json()

    expect(body.gate1).toBe("pass")
    expect(body.gate2).toBe("pass")
    expect(body.gate3).toBe("pass")
    expect(body.worker).toBe("pass")
    expect(body.outcome).toBe("merged")
  })

  it("returns trace for pending task with no events", async () => {
    const task = createTask("Pending task", "desc", "human", 50)

    const res = await app.request(`/tasks/${task.id}/trace`)
    expect(res.status).toBe(200)
    const body: PipelineTrace = await res.json()

    expect(body.taskId).toBe(task.id)
    expect(body.gate1).toBe("skip")
    expect(body.tester).toBe("skip")
    expect(body.gate2).toBe("skip")
    expect(body.worker).toBe("skip")
    expect(body.gate3).toBe("skip")
    expect(body.outcome).toBe("pending")
  })

  it("returns trace for failed task", async () => {
    const task = createTask("Failed task", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate1" })
    insertAgentEvent("task.started", { type: "task.started", taskId: task.id, workerId: "worker-0" })
    insertAgentEvent("task.failed", { type: "task.failed", taskId: task.id, rootCause: "test_gap" })
    finishTask(task.id, "failed", "test_gap")

    const res = await app.request(`/tasks/${task.id}/trace`)
    expect(res.status).toBe(200)
    const body: PipelineTrace = await res.json()

    expect(body.taskId).toBe(task.id)
    expect(body.outcome).toContain("fail")
  })
})
