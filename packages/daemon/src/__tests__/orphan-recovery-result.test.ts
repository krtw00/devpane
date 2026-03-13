import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { recoverOrphanedTasks } from "../db/tasks.js"
import { getEventsByTaskId } from "../db/events.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const WORKER_TIMEOUT_MS = 600_000

describe("recoverOrphanedTasks result field", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("sets result field when marking orphaned task as failed", () => {
    const task = createTask("orphan task", "should have result", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = 2 WHERE id = ?`).run(expiredAt, task.id)

    recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const updated = db.prepare(`SELECT result FROM tasks WHERE id = ?`).get(task.id) as { result: string | null }
    expect(updated.result).toBe("Recovered as failed: daemon restart or timeout exceeded")
  })

  it("does not set result field when retrying (pending recovery)", () => {
    const task = createTask("retryable task", "should not have result", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, task.id)

    recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const updated = db.prepare(`SELECT result FROM tasks WHERE id = ?`).get(task.id) as { result: string | null }
    expect(updated.result).toBeNull()
  })

  it("inserts task.failed agent event for orphan-recovered tasks", () => {
    const task = createTask("event task", "should emit event", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = 2 WHERE id = ?`).run(expiredAt, task.id)

    recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const events = getEventsByTaskId(task.id)
    const failedEvent = events.find(e => e.type === "task.failed")
    expect(failedEvent).toBeDefined()
    expect(failedEvent!.taskId).toBe(task.id)
    expect(failedEvent!.rootCause).toBe("timeout")
  })

  it("does not insert task.failed event when retrying", () => {
    const task = createTask("retry task", "no event expected", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, task.id)

    recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const events = getEventsByTaskId(task.id)
    const failedEvent = events.find(e => e.type === "task.failed")
    expect(failedEvent).toBeUndefined()
  })

  it("handles multiple orphaned tasks with mixed retry states", () => {
    const exhausted = createTask("exhausted", "max retries", "pm")
    const retryable = createTask("retryable", "can retry", "pm")
    startTask(exhausted.id, "worker-0")
    startTask(retryable.id, "worker-1")

    const db = getDb()
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = 2 WHERE id = ?`).run(expiredAt, exhausted.id)
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, retryable.id)

    recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const exhaustedRow = db.prepare(`SELECT status, result FROM tasks WHERE id = ?`).get(exhausted.id) as { status: string; result: string | null }
    const retryableRow = db.prepare(`SELECT status, result FROM tasks WHERE id = ?`).get(retryable.id) as { status: string; result: string | null }

    expect(exhaustedRow.status).toBe("failed")
    expect(exhaustedRow.result).toBe("Recovered as failed: daemon restart or timeout exceeded")
    expect(retryableRow.status).toBe("pending")
    expect(retryableRow.result).toBeNull()

    const exhaustedEvents = getEventsByTaskId(exhausted.id)
    expect(exhaustedEvents.some(e => e.type === "task.failed")).toBe(true)

    const retryableEvents = getEventsByTaskId(retryable.id)
    expect(retryableEvents.some(e => e.type === "task.failed")).toBe(false)
  })
})
