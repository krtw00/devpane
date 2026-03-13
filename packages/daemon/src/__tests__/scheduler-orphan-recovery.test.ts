import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { recoverOrphanedTasks } from "../db/tasks.js"
import { config } from "../config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

vi.mock("../worktree.js", () => ({
  removeWorktree: vi.fn(),
  createWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  pullMain: vi.fn(),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

describe("scheduler orphan recovery (db/tasks.ts unified)", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    vi.restoreAllMocks()
  })

  it("タイムアウト超過のrunningタスクが回復される", async () => {
    const task = createTask("orphan", "test recovery", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - config.WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, task.id)

    const recovered = recoverOrphanedTasks(config.WORKER_TIMEOUT_MS, config.MAX_RETRIES)

    // recoverOrphanedTasks が返すタスク数に基づき removeWorktree が呼ばれるべき
    // 実装変更後: scheduler が recoverOrphanedTasks の結果に対して removeWorktree を呼ぶ
    expect(recovered).toHaveLength(1)

    const updated = db.prepare(`SELECT status, retry_count FROM tasks WHERE id = ?`).get(task.id) as {
      status: string
      retry_count: number
    }
    expect(updated.status).toBe("pending")
    expect(updated.retry_count).toBe(1)
  })

  it("リトライ上限到達時はfailedになりworktree削除対象になる", async () => {
    const task = createTask("exhausted", "max retries", "pm")
    startTask(task.id, "worker-0")

    const db = getDb()
    const expiredAt = new Date(Date.now() - config.WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = ? WHERE id = ?`).run(
      expiredAt,
      config.MAX_RETRIES,
      task.id,
    )

    const recovered = recoverOrphanedTasks(config.WORKER_TIMEOUT_MS, config.MAX_RETRIES)

    expect(recovered).toHaveLength(1)
    const updated = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(task.id) as { status: string }
    expect(updated.status).toBe("failed")
  })

  it("タイムアウト未超過のタスクはrecovery対象外", () => {
    const task = createTask("recent", "still running", "pm")
    startTask(task.id, "worker-0")

    const recovered = recoverOrphanedTasks(config.WORKER_TIMEOUT_MS, config.MAX_RETRIES)

    expect(recovered).toHaveLength(0)
    const db = getDb()
    const updated = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(task.id) as { status: string }
    expect(updated.status).toBe("running")
  })

  it("config.WORKER_TIMEOUT_MSとconfig.MAX_RETRIESが正しい値を持つ", () => {
    expect(config.WORKER_TIMEOUT_MS).toBe(600_000)
    expect(config.MAX_RETRIES).toBe(2)
  })

  it("複数の孤立タスクが一括で回復される", () => {
    const db = getDb()
    const expiredAt = new Date(Date.now() - config.WORKER_TIMEOUT_MS - 1000).toISOString()

    const tasks = Array.from({ length: 3 }, (_, i) => {
      const t = createTask(`orphan-${i}`, `test ${i}`, "pm")
      startTask(t.id, "worker-0")
      db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, t.id)
      return t
    })

    const recovered = recoverOrphanedTasks(config.WORKER_TIMEOUT_MS, config.MAX_RETRIES)
    expect(recovered).toHaveLength(3)

    for (const t of tasks) {
      const updated = db.prepare(`SELECT status, retry_count FROM tasks WHERE id = ?`).get(t.id) as {
        status: string
        retry_count: number
      }
      expect(updated.status).toBe("pending")
      expect(updated.retry_count).toBe(1)
    }
  })

  it("リトライ上限と未到達が混在する場合、それぞれ正しく処理される", () => {
    const db = getDb()
    const expiredAt = new Date(Date.now() - config.WORKER_TIMEOUT_MS - 1000).toISOString()

    // リトライ余地ありタスク
    const retryable = createTask("retryable", "can retry", "pm")
    startTask(retryable.id, "worker-0")
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = 0 WHERE id = ?`).run(expiredAt, retryable.id)

    // リトライ上限到達タスク
    const exhausted = createTask("exhausted", "max retries", "pm")
    startTask(exhausted.id, "worker-0")
    db.prepare(`UPDATE tasks SET started_at = ?, retry_count = ? WHERE id = ?`).run(
      expiredAt,
      config.MAX_RETRIES,
      exhausted.id,
    )

    const recovered = recoverOrphanedTasks(config.WORKER_TIMEOUT_MS, config.MAX_RETRIES)
    expect(recovered).toHaveLength(2)

    const retryableRow = db.prepare(`SELECT status, retry_count FROM tasks WHERE id = ?`).get(retryable.id) as {
      status: string
      retry_count: number
    }
    expect(retryableRow.status).toBe("pending")
    expect(retryableRow.retry_count).toBe(1)

    const exhaustedRow = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(exhausted.id) as { status: string }
    expect(exhaustedRow.status).toBe("failed")
  })
})
