import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { recoverOrphanedTasks } from "../db/tasks.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const WORKER_TIMEOUT_MS = 600_000

describe("recoverOrphanedTasks", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("recovers orphaned running tasks to pending when under retry limit", () => {
    const task = createTask("orphan task", "should be recovered", "pm")
    startTask(task.id, "worker-0")

    // Backdate started_at to exceed WORKER_TIMEOUT_MS
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    const db = getDb()
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, task.id)

    const recovered = recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const updated = db.prepare(`SELECT status, retry_count FROM tasks WHERE id = ?`).get(task.id) as { status: string; retry_count: number }
    expect(updated.status).toBe("pending")
    expect(updated.retry_count).toBe(1)
    expect(recovered).toBe(1)
  })

  it("marks orphaned tasks as failed when retry limit exceeded", () => {
    const task = createTask("exhausted task", "should fail", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = 2 WHERE id = ?`).run(expiredAt, task.id)

    const recovered = recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const updated = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(task.id) as { status: string }
    expect(updated.status).toBe("failed")
    expect(recovered).toBe(1)
  })

  it("does not recover tasks that have not timed out yet", () => {
    const task = createTask("recent task", "still running", "pm")
    startTask(task.id, "worker-0")

    const recovered = recoverOrphanedTasks(WORKER_TIMEOUT_MS, 2)

    const db = getDb()
    const updated = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(task.id) as { status: string }
    expect(updated.status).toBe("running")
    expect(recovered).toBe(0)
  })
})
