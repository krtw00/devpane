import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, ObservableFacts } from "@devpane/shared"
import type { Gate1Result } from "../gate1.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// --- Mocks ---

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../scheduler-plugins.js", () => ({
  EFFECT_MEASURE_THRESHOLD: 10,
  checkEffectMeasurement: vi.fn(),
  resetEffectMeasureCounter: vi.fn(),
  setEffectMeasureCounter: vi.fn(),
  getEffectMeasureCounter: vi.fn(() => 0),
  getKaizenCounter: vi.fn(() => 0),
  parseConstraints: (raw: string | null) => { if (!raw) return []; try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.filter((s: unknown): s is string => typeof s === "string"); } catch {} return [] },
  KAIZEN_THRESHOLD: 10,
  checkKaizenAnalysis: vi.fn(),
  resetKaizenCounter: vi.fn(),
  setKaizenCounter: vi.fn(),
}))

vi.mock("../scheduler-hooks.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../scheduler-hooks.js")>()
  return {
    ...original,
    runHooks: vi.fn(),
  }
})

const mockRunGate1 = vi.fn<(task: Task) => Promise<Gate1Result>>()
vi.mock("../gate1.js", () => ({
  runGate1: (...args: [Task]) => mockRunGate1(...args),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(() => ({ verdict: "go", reasons: [] })),
}))

vi.mock("../gate.js", () => ({
  runGate3: vi.fn(() => ({ verdict: "go", reasons: [] })),
}))

vi.mock("../tester.js", () => ({
  runTester: vi.fn(async () => ({ testFiles: [], exit_code: 0 })),
  buildTesterPrompt: vi.fn(() => "prompt"),
}))

vi.mock("../worker.js", () => ({
  runWorker: vi.fn(async () => ({ exit_code: 0, result_text: "done", cost_usd: 0.01, num_turns: 1, duration_ms: 1000 })),
  killAllWorkers: vi.fn(),
}))

vi.mock("../facts.js", () => ({
  collectFacts: vi.fn((): ObservableFacts => ({
    exit_code: 0,
    files_changed: [],
    diff_stats: { additions: 0, deletions: 0 },
    test_result: { passed: 0, failed: 0, exit_code: 0 },
    lint_result: { errors: 0, exit_code: 0 },
    branch: "devpane/task-test",
    commit_hash: undefined,
  })),
}))

const mockCreateWorktree = vi.fn<() => string>()
vi.mock("../worktree.js", () => ({
  createWorktree: () => mockCreateWorktree(),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(() => null),
  autoMergePr: vi.fn(() => false),
  pullMain: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
}))

vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    canProceed: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    getState: vi.fn(() => "closed"),
    getBackoffSec: vi.fn(() => 1),
  },
}))

vi.mock("../pr-agent.js", () => ({
  runPrAgent: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
}))

import { initDb, closeDb, createTask } from "../db.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "test task for worktree failure",
    overrides.description ?? "description long enough for gate1 validation",
    "human",
    overrides.priority ?? 50,
  )
}

describe("createWorktree失敗時のworkerStateリセット", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
  })

  afterEach(() => {
    closeDb()
  })

  it("createWorktreeが例外を投げた後、getSchedulerState().worker.statusがidleに戻る", async () => {
    const { executeTask, getSchedulerState } = await import("../scheduler.js")
    mockCreateWorktree.mockImplementation(() => { throw new Error("git worktree add failed") })
    const task = makeTask()

    await executeTask(task)

    const state = getSchedulerState()
    expect(state.worker.status).toBe("idle")
    expect(state.worker.taskId).toBeNull()
    expect(state.worker.taskTitle).toBeNull()
    expect(state.worker.stage).toBeNull()
    expect(state.worker.startedAt).toBeNull()
  })

  it("createWorktreeが例外を投げた後、タスクはfailedになる", async () => {
    const { executeTask } = await import("../scheduler.js")
    const { getTask } = await import("../db.js")
    mockCreateWorktree.mockImplementation(() => { throw new Error("disk full") })
    const task = makeTask()

    await executeTask(task)

    const updated = getTask(task.id)
    expect(updated?.status).toBe("failed")
    expect(updated?.result).toContain("disk full")
  })

  it("createWorktree成功時もexecuteTask完了後にworkerStatusがidleに戻る（正常系対照）", async () => {
    const { executeTask, getSchedulerState } = await import("../scheduler.js")
    mockCreateWorktree.mockReturnValue("/tmp/worktree")
    const task = makeTask()

    await executeTask(task)

    const state = getSchedulerState()
    expect(state.worker.status).toBe("idle")
  })
})
