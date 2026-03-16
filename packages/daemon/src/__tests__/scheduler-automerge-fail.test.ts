import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, ObservableFacts } from "@devpane/shared"
import type { Gate1Result } from "../gate1.js"
import type { Gate2Result } from "../gate2.js"
import type { Gate3Result } from "../gate.js"
import type { TesterResult } from "../tester.js"
import type { WorkerResult } from "../worker.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// --- Mocks ---

const mockEmit = vi.fn()
vi.mock("../events.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
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

const mockRunGate2 = vi.fn<() => Gate2Result>()
vi.mock("../gate2.js", () => ({
  runGate2: () => mockRunGate2(),
}))

const mockRunGate3 = vi.fn<(taskId: string, facts: ObservableFacts) => Gate3Result>()
vi.mock("../gate.js", () => ({
  runGate3: (...args: [string, ObservableFacts]) => mockRunGate3(...args),
}))

const mockRunTester = vi.fn<() => Promise<TesterResult>>()
vi.mock("../tester.js", () => ({
  runTester: () => mockRunTester(),
  buildTesterPrompt: vi.fn(() => "prompt"),
}))

const mockRunWorker = vi.fn<() => Promise<WorkerResult>>()
vi.mock("../worker.js", () => ({
  runWorker: () => mockRunWorker(),
  killAllWorkers: vi.fn(),
}))

const mockCollectFacts = vi.fn<() => ObservableFacts>()
vi.mock("../facts.js", () => ({
  collectFacts: () => mockCollectFacts(),
}))

const mockCreateWorktree = vi.fn<() => string>()
const mockCreatePullRequest = vi.fn<(a?: unknown, b?: unknown, c?: unknown) => string | null>()
const mockAutoMergePr = vi.fn<(a?: unknown) => boolean>()
const mockPullMain = vi.fn()
vi.mock("../worktree.js", () => ({
  createWorktree: () => mockCreateWorktree(),
  removeWorktree: vi.fn(),
  createPullRequest: (a: unknown, b?: unknown, c?: unknown) => mockCreatePullRequest(a, b, c),
  autoMergePr: (a: unknown) => mockAutoMergePr(a),
  pullMain: () => mockPullMain(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
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
  forget: vi.fn(),
  findSimilar: vi.fn(() => []),
  cleanupOldLessons: vi.fn(() => 0),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
  checkAllMetrics: vi.fn(() => []),
  recordMetric: vi.fn(),
  checkMetric: vi.fn(),
}))

vi.mock("../morning-report.js", () => ({
  sendMorningReport: vi.fn(),
}))

vi.mock("../kaizen.js", () => ({
  analyze: vi.fn(),
}))

vi.mock("../effect-measure.js", () => ({
  measureAllActive: vi.fn(() => []),
}))

// DB: use real in-memory SQLite
import { initDb, closeDb, createTask } from "../db.js"

const mockFinishTask = vi.fn()
const mockAppendLog = vi.fn()

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>()
  return {
    ...actual,
    finishTask: (...args: unknown[]) => mockFinishTask(...args),
    appendLog: (...args: unknown[]) => mockAppendLog(...args),
    updateTaskCost: vi.fn(),
  }
})

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "test task for automerge fail",
    overrides.description ?? "a sufficiently long task description for gate1",
    "human",
    overrides.priority ?? 50,
  )
}

function goodFacts(overrides: Partial<ObservableFacts> = {}): ObservableFacts {
  return {
    exit_code: 0,
    files_changed: ["src/foo.ts"],
    diff_stats: { additions: 10, deletions: 2 },
    test_result: { passed: 5, failed: 0, exit_code: 0 },
    lint_result: { errors: 0, exit_code: 0 },
    branch: "devpane/task-test",
    commit_hash: "abc123",
    ...overrides,
  }
}

function goodWorkerResult(): WorkerResult {
  return {
    exit_code: 0,
    result_text: "done",
    cost_usd: 0.05,
    num_turns: 3,
    duration_ms: 10000,
  }
}

describe("autoMergePr失敗時のタスク状態", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()

    mockCreateWorktree.mockReturnValue("/tmp/worktree")
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0, timedOut: false })
    mockRunGate2.mockReturnValue({ verdict: "go", reasons: [] })
    mockRunWorker.mockResolvedValue(goodWorkerResult())
    mockCollectFacts.mockReturnValue(goodFacts())
    mockRunGate3.mockReturnValue({ verdict: "go", reasons: [] })
  })

  afterEach(() => {
    closeDb()
  })

  it("autoMergePr失敗時にfinishTaskのresultにmerged:falseが含まれる", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/1")
    mockAutoMergePr.mockReturnValue(false)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    expect(mockFinishTask).toHaveBeenCalledTimes(1)
    const [id, status, resultStr] = mockFinishTask.mock.calls[0] as [string, string, string]
    expect(id).toBe(task.id)
    expect(status).toBe("done")
    const result = JSON.parse(resultStr)
    expect(result).toHaveProperty("merged", false)
  })

  it("autoMergePr失敗時にappendLogに警告が追記される", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/2")
    mockAutoMergePr.mockReturnValue(false)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    const warnCalls = mockAppendLog.mock.calls.filter(
      (call: unknown[]) => typeof call[2] === "string" && (call[2] as string).includes("auto-merge"),
    )
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
    const hasFailWarn = warnCalls.some(
      (call: unknown[]) => typeof call[2] === "string" && (call[2] as string).toLowerCase().includes("fail"),
    )
    expect(hasFailWarn).toBe(true)
  })

  it("autoMergePr失敗時にpr.merge_failedイベントがemitされる", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/3")
    mockAutoMergePr.mockReturnValue(false)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    const mergeFailedEvents = mockEmit.mock.calls.filter(
      (call: unknown[]) => {
        const event = call[0] as { type: string }
        return event.type === "pr.merge_failed"
      },
    )
    expect(mergeFailedEvents).toHaveLength(1)
    expect(mergeFailedEvents[0][0]).toMatchObject({
      type: "pr.merge_failed",
      taskId: task.id,
    })
  })

  it("autoMergePr成功時にはmerged:falseフラグが含まれない", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/4")
    mockAutoMergePr.mockReturnValue(true)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    expect(mockFinishTask).toHaveBeenCalledTimes(1)
    const [, status, resultStr] = mockFinishTask.mock.calls[0] as [string, string, string]
    expect(status).toBe("done")
    const result = JSON.parse(resultStr)
    expect(result).not.toHaveProperty("merged", false)
  })

  it("autoMergePr成功時にpr.merge_failedイベントがemitされない", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/5")
    mockAutoMergePr.mockReturnValue(true)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    const mergeFailedEvents = mockEmit.mock.calls.filter(
      (call: unknown[]) => {
        const event = call[0] as { type: string }
        return event.type === "pr.merge_failed"
      },
    )
    expect(mergeFailedEvents).toHaveLength(0)
  })
})
