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

const mockRunHooks = vi.fn()
vi.mock("../scheduler-hooks.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../scheduler-hooks.js")>()
  return {
    ...original,
    runHooks: (...args: unknown[]) => mockRunHooks(...args),
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

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>()
  return {
    ...actual,
    appendLog: vi.fn(),
    updateTaskCost: vi.fn(),
  }
})

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "test task for PR failure",
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

describe("PR作成失敗時にrunHooksがスキップされる", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()

    // Default: all gates pass, worker succeeds
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

  it("Gate3 pass → PR作成失敗(null) → runHooks('task.completed')が呼ばれない", async () => {
    mockCreatePullRequest.mockReturnValue(null)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    // PR作成は試みられた
    expect(mockCreatePullRequest).toHaveBeenCalled()

    // runHooksが"task.completed"で呼ばれていないことを検証
    const taskCompletedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.completed",
    )
    expect(taskCompletedCalls).toHaveLength(0)
  })

  it("Gate3 pass → PR作成成功 → runHooks('task.completed')が呼ばれる", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/1")
    mockAutoMergePr.mockReturnValue(true)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    // runHooksが"task.completed"で呼ばれたことを検証
    const taskCompletedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.completed",
    )
    expect(taskCompletedCalls).toHaveLength(1)
    expect(taskCompletedCalls[0][1]).toMatchObject({
      task: expect.objectContaining({ id: task.id }),
      prUrl: "https://github.com/test/pr/1",
    })
  })

  it("Gate3 pass → commit_hashなし → runHooks('task.completed')が呼ばれない", async () => {
    // commit_hashがない場合、PR作成自体がスキップされる
    mockCollectFacts.mockReturnValue(goodFacts({ commit_hash: undefined }))

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    // PR作成は試みられない
    expect(mockCreatePullRequest).not.toHaveBeenCalled()

    // runHooksが"task.completed"で呼ばれていないことを検証
    const taskCompletedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.completed",
    )
    expect(taskCompletedCalls).toHaveLength(0)
  })
})
