import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, claimNextPending } from "../db.js"
import { config } from "../config.js"
import * as scheduler from "../scheduler.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "migrations")

// Mock dependencies that we don't want to run in this test
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/mock-worktree"),
  removeWorktree: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  pruneWorktrees: vi.fn(),
  pullMain: vi.fn(),
}))

vi.mock("../worker.js", () => ({
  runWorker: vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 500))
    return { exit_code: 0, cost_usd: 0, num_turns: 0, result_text: "ok" }
  }),
}))

vi.mock("../pm.js", () => ({
  runPm: vi.fn(async () => ({ tasks: [], reasoning: "" })),
  ingestPmTasks: vi.fn(() => []),
}))

vi.mock("../facts.js", () => ({
  collectFacts: vi.fn(() => ({ diff_stats: { additions: 0, deletions: 0 }, files_changed: [] })),
}))

vi.mock("../gate1.js", () => ({
  runGate1: vi.fn(async () => ({ verdict: "go", reasons: [] })),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(() => ({ verdict: "go", reasons: [] })),
}))

vi.mock("../gate.js", () => ({
  runGate3: vi.fn(() => ({ verdict: "go", reasons: [] })),
}))

vi.mock("../tester.js", () => ({
  runTester: vi.fn(async () => ({ exit_code: 0, testFiles: [], timedOut: false })),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
}))

describe("Worker Concurrency", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    // Mock config
    config.WORKER_CONCURRENCY = 2
    config.MAX_OPEN_PRS = 10
    config.IDLE_INTERVAL_SEC = 1
  })

  afterEach(async () => {
    await scheduler.stopScheduler()
    closeDb()
    vi.restoreAllMocks()
  })

  describe("claimNextPending", () => {
    it("atomically claims the next pending task", () => {
      createTask("Task 1", "desc", "pm", 10)
      createTask("Task 2", "desc", "pm", 5)

      const claimed1 = claimNextPending("worker-0")
      expect(claimed1?.title).toBe("Task 1")
      expect(claimed1?.status).toBe("running")
      expect(claimed1?.assigned_to).toBe("worker-0")

      const claimed2 = claimNextPending("worker-1")
      expect(claimed2?.title).toBe("Task 2")
      expect(claimed2?.status).toBe("running")
      expect(claimed2?.assigned_to).toBe("worker-1")

      const claimed3 = claimNextPending("worker-2")
      expect(claimed3).toBeUndefined()
    })
  })

  describe("Scheduler Parallelism", () => {
    it("executes tasks in parallel up to CONCURRENCY", async () => {
      createTask("T1", "d", "pm")
      createTask("T2", "d", "pm")
      createTask("T3", "d", "pm")

      // Start scheduler
      const schedulerPromise = scheduler.startScheduler()
      
      // Wait for tasks to be picked up
      let running = 0
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const state = scheduler.getSchedulerState()
        running = state.workers.filter(w => w.status === "running").length
        if (running === 2) break
      }
      
      expect(running).toBe(2)
      
      // Stop scheduler
      await scheduler.stopScheduler()
      await schedulerPromise
    })
  })
})
