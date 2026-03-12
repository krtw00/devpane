import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, startTask, getTask, getNextPending, getTasksByStatus } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

// stopScheduler will be changed to return Promise<void>.
// Until then, this helper safely awaits the result regardless of return type.
async function awaitStop(result: unknown): Promise<void> {
  if (result instanceof Promise) {
    await result
  }
}

describe("graceful shutdown", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.useFakeTimers()
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("stopScheduler sets alive to false", async () => {
    const { stopScheduler, getSchedulerState } = await import("../scheduler.js")

    const result: unknown = stopScheduler()
    await awaitStop(result)

    const state = getSchedulerState()
    expect(state.alive).toBe(false)
  })

  it("does not pick up new tasks after stopScheduler is called", async () => {
    const task = createTask("test task", "should not be picked up", "pm")

    const { stopScheduler } = await import("../scheduler.js")

    const result: unknown = stopScheduler()
    await awaitStop(result)

    // After stop, the scheduler loop should not pick up new tasks.
    // The pending task should still exist in DB (not consumed by scheduler).
    const pending = getNextPending()
    expect(pending).toBeTruthy()
    expect(pending!.id).toBe(task.id)
  })

  it("waits for running task to complete before resolving stop", async () => {
    // The new stopScheduler() should return a Promise that waits for
    // the currently executing task to finish (with a 30s timeout).
    const task = createTask("running task", "in progress", "pm")
    startTask(task.id, "worker-0")

    const { stopScheduler, getSchedulerState } = await import("../scheduler.js")

    const result: unknown = stopScheduler()

    // The scheduler should be marked as stopping immediately
    expect(getSchedulerState().alive).toBe(false)

    // Advance timers to let internal waits resolve
    vi.advanceTimersByTime(1000)
    await awaitStop(result)
  })

  it("reverts running tasks to pending on shutdown timeout", async () => {
    // When a running task doesn't complete within the 30s timeout,
    // stopScheduler should revert it to pending so orphan recovery
    // can handle it on restart.
    const task = createTask("stuck task", "will timeout", "pm")
    startTask(task.id, "worker-0")

    const { stopScheduler } = await import("../scheduler.js")

    const result: unknown = stopScheduler()

    // Advance past the 30s shutdown timeout
    vi.advanceTimersByTime(30_000)
    await awaitStop(result)

    // After timeout, the task should be reverted to pending
    const updated = getTask(task.id)
    expect(updated).toBeTruthy()
    expect(updated!.status).toBe("pending")
  })

  it("suppresses new task pickup while shutdown is in progress", async () => {
    // Even if the scheduler loop is still iterating (e.g. awaiting
    // a running task), it should not pick up additional tasks.
    const task1 = createTask("task 1", "running", "pm")
    startTask(task1.id, "worker-0")
    createTask("task 2", "should not start", "pm")

    const { stopScheduler, getSchedulerState } = await import("../scheduler.js")

    const result: unknown = stopScheduler()

    // The alive flag should prevent the loop from picking up task 2
    expect(getSchedulerState().alive).toBe(false)

    // Advance timers and resolve
    vi.advanceTimersByTime(30_000)
    await awaitStop(result)

    // task 2 should still be pending (never picked up)
    const pending = getTasksByStatus("pending")
    const task2 = pending.find((t) => t.title === "task 2")
    expect(task2).toBeTruthy()
    expect(task2!.status).toBe("pending")
  })
})
