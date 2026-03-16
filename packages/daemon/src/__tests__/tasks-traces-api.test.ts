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

describe("GET /tasks/traces", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
  })

  afterEach(() => {
    closeDb()
  })

  it("returns empty array when no done/failed tasks exist", async () => {
    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("returns empty array when only pending tasks exist", async () => {
    createTask("Pending task", "desc", "human", 50)
    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("returns traces for done tasks", async () => {
    const task = createTask("Done task", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate1" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate2" })
    insertAgentEvent("task.started", { type: "task.started", taskId: task.id, workerId: "worker-0" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate3" })
    insertAgentEvent("task.completed", { type: "task.completed", taskId: task.id, costUsd: 0.05 })
    finishTask(task.id, "done", "merged")

    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    const body: PipelineTrace[] = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].taskId).toBe(task.id)
    expect(body[0].title).toBe("Done task")
    expect(body[0].gate1).toBe("pass")
    expect(body[0].outcome).toBe("merged")
  })

  it("returns traces for failed tasks", async () => {
    const task = createTask("Failed task", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate1" })
    insertAgentEvent("task.started", { type: "task.started", taskId: task.id, workerId: "worker-0" })
    insertAgentEvent("task.failed", { type: "task.failed", taskId: task.id, rootCause: "test_gap" })
    finishTask(task.id, "failed", "test_gap")

    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    const body: PipelineTrace[] = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].taskId).toBe(task.id)
    expect(body[0].outcome).toContain("fail")
  })

  it("includes both done and failed tasks", async () => {
    const done = createTask("Done", "desc", "pm", 50)
    startTask(done.id, "worker-0")
    insertAgentEvent("task.completed", { type: "task.completed", taskId: done.id, costUsd: 0.01 })
    finishTask(done.id, "done", "ok")

    const failed = createTask("Failed", "desc", "pm", 50)
    startTask(failed.id, "worker-0")
    insertAgentEvent("task.failed", { type: "task.failed", taskId: failed.id, rootCause: "unknown" })
    finishTask(failed.id, "failed", "error")

    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    const body: PipelineTrace[] = await res.json()
    expect(body).toHaveLength(2)
    const ids = body.map((t: PipelineTrace) => t.taskId)
    expect(ids).toContain(done.id)
    expect(ids).toContain(failed.id)
  })

  it("respects default limit of 50", async () => {
    // Create 55 done tasks
    for (let i = 0; i < 55; i++) {
      const task = createTask(`Task ${i}`, "desc", "pm", 50)
      startTask(task.id, "worker-0")
      finishTask(task.id, "done", "ok")
    }

    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    const body: PipelineTrace[] = await res.json()
    expect(body.length).toBeLessThanOrEqual(50)
  })

  it("does not include running tasks", async () => {
    const running = createTask("Running task", "desc", "pm", 50)
    startTask(running.id, "worker-0")
    // Don't finish it — it stays running

    const done = createTask("Done task", "desc", "pm", 50)
    startTask(done.id, "worker-0")
    finishTask(done.id, "done", "ok")

    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    const body: PipelineTrace[] = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].taskId).toBe(done.id)
  })

  it("each trace has all required fields", async () => {
    const task = createTask("Full trace", "desc", "pm", 50)
    startTask(task.id, "worker-0")
    finishTask(task.id, "done", "ok")

    const res = await app.request("/tasks/traces")
    expect(res.status).toBe(200)
    const body: PipelineTrace[] = await res.json()
    expect(body).toHaveLength(1)

    const trace = body[0]
    expect(trace).toHaveProperty("taskId")
    expect(trace).toHaveProperty("title")
    expect(trace).toHaveProperty("gate1")
    expect(trace).toHaveProperty("tester")
    expect(trace).toHaveProperty("gate2")
    expect(trace).toHaveProperty("worker")
    expect(trace).toHaveProperty("gate3")
    expect(trace).toHaveProperty("outcome")
    expect(trace).toHaveProperty("costUsd")
  })
})
