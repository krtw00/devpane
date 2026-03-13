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
  KAIZEN_THRESHOLD: 10,
  checkKaizenAnalysis: vi.fn(),
  resetKaizenCounter: vi.fn(),
  setKaizenCounter: vi.fn(),
  getKaizenCounter: vi.fn(() => 0),
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

const mockRecordTaskMetrics = vi.fn()
vi.mock("../spc.js", () => ({
  recordTaskMetrics: (...args: unknown[]) => mockRecordTaskMetrics(...args),
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
    overrides.title ?? "test task for PR failure metrics",
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

describe("PR作成失敗時にrecordTaskMetricsが呼ばれる", () => {
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

  it("Gate3 pass → PR作成失敗(null) → recordTaskMetrics(taskId, 0, 0, 0)が呼ばれる", async () => {
    mockCreatePullRequest.mockReturnValue(null)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    // PR作成は試みられた
    expect(mockCreatePullRequest).toHaveBeenCalled()

    // recordTaskMetricsが呼ばれることを検証（他の失敗パスと同様にゼロ値）
    expect(mockRecordTaskMetrics).toHaveBeenCalledWith(task.id, 0, 0, 0)
  })

  it("Gate3 pass → PR作成成功 → recordTaskMetricsはPR失敗パスでは呼ばれない", async () => {
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/1")
    mockAutoMergePr.mockReturnValue(true)

    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    // PR成功時はこのパスのrecordTaskMetricsは呼ばれない
    // （成功時のメトリクス記録はscheduler-pluginsのhook経由）
    const calls = mockRecordTaskMetrics.mock.calls.filter(
      (call: unknown[]) => call[1] === 0 && call[2] === 0 && call[3] === 0,
    )
    expect(calls).toHaveLength(0)
  })
})
