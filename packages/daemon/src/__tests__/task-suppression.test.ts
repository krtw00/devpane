import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, startTask, finishTask, getTask, suppressTerminalFailedTask, suppressTerminalFailedTasks } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("task suppression", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("suppresses duplicate/already implemented failed tasks", () => {
    const task = createTask("duplicate", "desc", "pm")
    startTask(task.id, "worker-0")
    finishTask(task.id, "failed", JSON.stringify({ error: "already implemented" }))

    const result = suppressTerminalFailedTask(task.id)

    expect(result?.reason).toBe("duplicate or already implemented")
    expect(getTask(task.id)?.status).toBe("suppressed")
  })

  it("suppresses max retries exceeded failed tasks", () => {
    const task = createTask("retries", "desc", "pm")
    startTask(task.id, "worker-0")
    finishTask(task.id, "failed", JSON.stringify({ error: "max retries exceeded (2/2)" }))

    const result = suppressTerminalFailedTask(task.id)

    expect(result?.reason).toBe("max retries exceeded")
    expect(getTask(task.id)?.status).toBe("suppressed")
  })

  it("does not suppress retryable failures", () => {
    const task = createTask("timeout", "desc", "pm")
    startTask(task.id, "worker-0")
    finishTask(task.id, "failed", JSON.stringify({ error: "tester_timeout" }))

    const result = suppressTerminalFailedTask(task.id)

    expect(result).toBeNull()
    expect(getTask(task.id)?.status).toBe("failed")
  })

  it("bulk suppresses only terminal failed tasks", () => {
    const duplicate = createTask("duplicate", "desc", "pm")
    startTask(duplicate.id, "worker-0")
    finishTask(duplicate.id, "failed", JSON.stringify({ error: "duplicate enhancement" }))

    const retryable = createTask("retryable", "desc", "pm")
    startTask(retryable.id, "worker-0")
    finishTask(retryable.id, "failed", JSON.stringify({ error: "tester_timeout" }))

    const suppressed = suppressTerminalFailedTasks()

    expect(suppressed).toHaveLength(1)
    expect(suppressed[0].taskId).toBe(duplicate.id)
    expect(getTask(duplicate.id)?.status).toBe("suppressed")
    expect(getTask(retryable.id)?.status).toBe("failed")
  })
})
