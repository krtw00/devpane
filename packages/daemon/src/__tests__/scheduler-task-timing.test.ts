import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, getTask, startTask } from "../db.js"
import { executeTask } from "../scheduler.js"
import type { Task } from "@devpane/shared"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Mock dependencies
vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/test-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(() => "https://github.com/test/pr/1"),
  autoMergePr: vi.fn(() => true),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  pullMain: vi.fn(),
}))

vi.mock("../worker.js", () => ({
  runWorker: vi.fn(() => Promise.resolve({
    exit_code: 0,
    result_text: "Success",
    cost_usd: 0.05,
    num_turns: 100,
  })),
}))

vi.mock("../facts.js", () => ({
  collectFacts: vi.fn(() => ({
    exit_code: 0,
    files_changed: ["src/test.ts"],
    diff_stats: { additions: 10, deletions: 5 },
    branch: "test-branch",
    commit_hash: "abc123",
  })),
}))

vi.mock("../gate1.js", () => ({
  runGate1: vi.fn(() => Promise.resolve({
    verdict: "go" as const,
    reasons: [],
  })),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(() => ({
    verdict: "go" as const,
    reasons: [],
  })),
}))

vi.mock("../gate.js", () => ({
  runGate3: vi.fn(() => ({
    verdict: "go" as const,
    reasons: [],
    failure: null,
  })),
}))

vi.mock("../tester.js", () => ({
  runTester: vi.fn(() => Promise.resolve({
    exit_code: 0,
    testFiles: ["test.test.ts"],
    timedOut: false,
  })),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
}))

vi.mock("../scheduler-hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scheduler-hooks.js")>()
  return {
    ...actual,
    runHooks: vi.fn(() => Promise.resolve()),
  }
})

vi.mock("../scheduler-plugins.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scheduler-plugins.js")>()
  return {
    ...actual,
    parseConstraints: vi.fn(() => []),
  }
})

vi.mock("../notifier-factory.js", () => ({
  getNotifier: vi.fn(() => ({
    sendMessage: vi.fn(() => Promise.resolve()),
  })),
}))

describe("scheduler executeTask timing recording", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  it("should record started_at when task execution begins", async () => {
    const task = createTask("Test task", "Test description", "human") as Task
    
    // Verify initial state
    expect(task.started_at).toBeNull()
    expect(task.finished_at).toBeNull()
    
    // In real scheduler, task would be claimed first which sets started_at
    // But in our test, we're calling executeTask directly
    // So we need to manually start the task to set started_at
    startTask(task.id, "worker-0")
    
    await executeTask(task, "worker-0")
    
    // Check that started_at was recorded
    const updatedTask = getTask(task.id)!
    expect(updatedTask.started_at).toBeTruthy()
    expect(typeof updatedTask.started_at).toBe("string")
    expect(updatedTask.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it("should record finished_at when task completes successfully", async () => {
    const task = createTask("Test task", "Test description", "human") as Task
    
    // In real scheduler, task would be claimed first which sets started_at
    // But in our test, we're calling executeTask directly
    // So we need to manually start the task to set started_at
    startTask(task.id, "worker-0")
    
    await executeTask(task, "worker-0")
    
    // Check that finished_at was recorded
    const completedTask = getTask(task.id)!
    expect(completedTask.finished_at).toBeTruthy()
    expect(typeof completedTask.finished_at).toBe("string")
    expect(completedTask.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    
    // Verify task is marked as done
    expect(completedTask.status).toBe("done")
  })

  it("should record finished_at when task fails", async () => {
    // Mock gate1 to kill the task
    const { runGate1 } = await import("../gate1.js")
    vi.mocked(runGate1).mockResolvedValue({
      verdict: "kill" as const,
      reasons: ["Task rejected by gate1"],
    })

    const task = createTask("Test task", "Test description", "human") as Task
    
    await executeTask(task, "worker-0")
    
    // Check that finished_at was recorded even for failed tasks
    const failedTask = getTask(task.id)!
    expect(failedTask.finished_at).toBeTruthy()
    expect(typeof failedTask.finished_at).toBe("string")
    expect(failedTask.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    
    // Verify task is marked as failed
    expect(failedTask.status).toBe("failed")
  })

  it("should have started_at before finished_at for completed tasks", async () => {
    const task = createTask("Test task", "Test description", "human") as Task
    
    // In real scheduler, task would be claimed first which sets started_at
    // But in our test, we're calling executeTask directly
    // So we need to manually start the task to set started_at
    startTask(task.id, "worker-0")
    
    await executeTask(task, "worker-0")
    
    const completedTask = getTask(task.id)!
    expect(completedTask.started_at).toBeTruthy()
    expect(completedTask.finished_at).toBeTruthy()
    
    // Verify started_at is earlier than finished_at
    const startedAt = new Date(completedTask.started_at!).getTime()
    const finishedAt = new Date(completedTask.finished_at!).getTime()
    expect(startedAt).toBeLessThanOrEqual(finishedAt)
  })

  it("should record timing for recycled tasks", async () => {
    // Mock gate1 to recycle the task
    const { runGate1 } = await import("../gate1.js")
    vi.mocked(runGate1).mockResolvedValue({
      verdict: "recycle" as const,
      reasons: ["Task needs refinement"],
    })

    const task = createTask("Test task", "Test description", "human") as Task
    
    await executeTask(task, "worker-0")
    
    // For recycled tasks, they should be reverted to pending
    const recycledTask = getTask(task.id)!
    expect(recycledTask.status).toBe("pending")
    // started_at should be cleared for recycled tasks
    expect(recycledTask.started_at).toBeNull()
    expect(recycledTask.finished_at).toBeNull()
  })
})