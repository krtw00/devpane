import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const mockRemoveWorktree = vi.fn()

vi.mock("../worktree.js", () => ({
  removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
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

import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { config } from "../config.js"

describe("recoverOrphanTasks worktree削除範囲", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
    vi.restoreAllMocks()
  })

  it("timeout超過タスクのworktreeのみ削除し、実行中タスクのworktreeは削除しない", async () => {
    const db = getDb()

    // タイムアウト超過タスク（回復対象）
    const orphan = createTask("orphan-task", "timed out", "pm")
    startTask(orphan.id, "worker-0")
    const expiredAt = new Date(Date.now() - config.WORKER_TIMEOUT_MS - 1000).toISOString()
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, orphan.id)

    // タイムアウト未超過タスク（実行中、回復対象外）
    const active = createTask("active-task", "still running", "pm")
    startTask(active.id, "worker-1")
    // started_atはstartTaskで現在時刻が設定されるのでそのまま

    // schedulerのrecoverOrphanTasksを実行
    const { recoverOrphanTasks } = await import("../scheduler.js")
    recoverOrphanTasks()

    // orphanのworktreeのみ削除されること
    expect(mockRemoveWorktree).toHaveBeenCalledWith(orphan.id)
    // activeのworktreeは削除されないこと
    expect(mockRemoveWorktree).not.toHaveBeenCalledWith(active.id)
  })

  it("タイムアウト超過タスクが0件の場合、worktree削除は一切行われない", async () => {
    // タイムアウト未超過のrunningタスクのみ
    const active = createTask("active-only", "running normally", "pm")
    startTask(active.id, "worker-0")

    const { recoverOrphanTasks } = await import("../scheduler.js")
    recoverOrphanTasks()

    expect(mockRemoveWorktree).not.toHaveBeenCalled()
  })

  it("複数のタイムアウト超過タスクがあっても未超過タスクのworktreeは削除しない", async () => {
    const db = getDb()
    const expiredAt = new Date(Date.now() - config.WORKER_TIMEOUT_MS - 1000).toISOString()

    // タイムアウト超過タスク2つ
    const orphan1 = createTask("orphan-1", "timed out 1", "pm")
    startTask(orphan1.id, "worker-0")
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, orphan1.id)

    const orphan2 = createTask("orphan-2", "timed out 2", "pm")
    startTask(orphan2.id, "worker-1")
    db.prepare(`UPDATE tasks SET started_at = ? WHERE id = ?`).run(expiredAt, orphan2.id)

    // タイムアウト未超過タスク1つ
    const active = createTask("active-task", "still running", "pm")
    startTask(active.id, "worker-2")

    const { recoverOrphanTasks } = await import("../scheduler.js")
    recoverOrphanTasks()

    // orphanのworktreeのみ削除
    expect(mockRemoveWorktree).toHaveBeenCalledWith(orphan1.id)
    expect(mockRemoveWorktree).toHaveBeenCalledWith(orphan2.id)
    // activeのworktreeは削除されない
    expect(mockRemoveWorktree).not.toHaveBeenCalledWith(active.id)
    // 合計2回のみ呼ばれる
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(2)
  })
})
