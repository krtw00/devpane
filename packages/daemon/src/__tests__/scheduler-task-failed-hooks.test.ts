import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, ObservableFacts } from "@devpane/shared"
import type { Gate1Result } from "../gate1.js"
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

const mockRecordTaskMetrics = vi.fn()
vi.mock("../spc.js", () => ({
  recordTaskMetrics: (...args: unknown[]) => mockRecordTaskMetrics(...args),
  checkAllMetrics: vi.fn(() => []),
  recordMetric: vi.fn(),
  checkMetric: vi.fn(),
}))

const mockRunGate1 = vi.fn<(task: Task) => Promise<Gate1Result>>()
vi.mock("../gate1.js", () => ({
  runGate1: (...args: [Task]) => mockRunGate1(...args),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(() => ({ verdict: "go", reasons: [] })),
}))

const mockRunGate3 = vi.fn()
vi.mock("../gate.js", () => ({
  runGate3: (...args: unknown[]) => mockRunGate3(...args),
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

vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/mock-worktree"),
  removeWorktree: vi.fn(),
  createPullRequest: vi.fn(),
  autoMergePr: vi.fn(),
  pruneWorktrees: vi.fn(),
  countOpenPrs: vi.fn(() => 0),
  pullMain: vi.fn(),
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

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
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
import { initDb, closeDb, createTask, getDb } from "../db.js"

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
    overrides.title ?? "test task for failed hooks",
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

describe("失敗パスでrunHooks('task.failed')が呼ばれる", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()

    // Default: all gates pass, worker succeeds
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0, timedOut: false })
    mockRunWorker.mockResolvedValue(goodWorkerResult())
    mockCollectFacts.mockReturnValue(goodFacts())
    mockRunGate3.mockReturnValue({ verdict: "go", reasons: [] })
  })

  afterEach(() => {
    closeDb()
  })

  it("gate3 kill時にrunHooks('task.failed')が呼ばれる", async () => {
    mockRunGate3.mockReturnValue({
      verdict: "kill",
      reasons: ["no commit hash"],
      failure: { root_cause: "regression" },
    })

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()
    await executeTask(task)

    const taskFailedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.failed",
    )
    expect(taskFailedCalls).toHaveLength(1)
    expect(taskFailedCalls[0][1]).toMatchObject({
      task: expect.objectContaining({ id: task.id }),
      rootCause: "regression",
    })
  })

  it("gate3 recycle→kill（リトライ上限超過）時にrunHooks('task.failed')が呼ばれる", async () => {
    mockRunGate3.mockReturnValue({
      verdict: "recycle",
      reasons: ["tests failing"],
      failure: { root_cause: "test_gap" },
    })

    const task = makeTask()
    const db = getDb()
    // retry_countをMAX_RETRIES以上に設定してrecycle→killを発動
    db.prepare(`UPDATE tasks SET retry_count = 99 WHERE id = ?`).run(task.id)

    const { executeTask } = await import("../scheduler.js")
    await executeTask(task)

    const taskFailedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.failed",
    )
    expect(taskFailedCalls).toHaveLength(1)
    expect(taskFailedCalls[0][1]).toMatchObject({
      task: expect.objectContaining({ id: task.id }),
      rootCause: "test_gap",
    })
  })

  it("worker例外（catchブロック）時にrunHooks('task.failed')が呼ばれる", async () => {
    mockRunWorker.mockRejectedValue(new Error("worker crashed"))

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()
    await executeTask(task)

    const taskFailedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.failed",
    )
    expect(taskFailedCalls).toHaveLength(1)
    expect(taskFailedCalls[0][1]).toMatchObject({
      task: expect.objectContaining({ id: task.id }),
      rootCause: "env_issue",
    })
  })

  it("worker例外（rate limit）時にはrunHooks('task.failed')が呼ばれない", async () => {
    mockRunWorker.mockRejectedValue(new Error("429 Too Many Requests"))

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()
    await executeTask(task)

    const taskFailedCalls = mockRunHooks.mock.calls.filter(
      (call: unknown[]) => call[0] === "task.failed",
    )
    expect(taskFailedCalls).toHaveLength(0)
  })
})

describe("gate1 kill時にrecordTaskMetricsが呼ばれる", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  it("gate1 kill時にrecordTaskMetrics(taskId, 0, executionMs, 0)が呼ばれる", async () => {
    mockRunGate1.mockResolvedValue({
      verdict: "kill",
      reasons: ["scope creep detected"],
    })

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()
    await executeTask(task)

    expect(mockRecordTaskMetrics).toHaveBeenCalledWith(
      task.id,
      0, // cost_usd = 0 (worker未実行)
      expect.any(Number), // executionMs
      0, // diffSize = 0 (worker未実行)
    )
  })
})
