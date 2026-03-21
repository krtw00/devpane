import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, ObservableFacts } from "@devpane/shared"
import type { Gate1Result } from "../gate1.js"
import type { Gate2Result } from "../gate2.js"
import type { Gate3Result } from "../gate.js"
import type { TesterResult } from "../tester.js"
import type { WorkerResult } from "../worker.js"
import type { AgentEvent } from "@devpane/shared/schemas"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// --- Mocks ---

const emittedEvents: AgentEvent[] = []

vi.mock("../events.js", () => ({
  emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event) }),
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
  runWorker: (...args: Parameters<typeof mockRunWorker>) => mockRunWorker(...args),
  killAllWorkers: vi.fn(),
}))

const mockCollectFacts = vi.fn<() => ObservableFacts>()
vi.mock("../facts.js", () => ({
  collectFacts: () => mockCollectFacts(),
}))

const mockCreateWorktree = vi.fn<() => string>()
const mockRemoveWorktree = vi.fn()
const mockCreatePullRequest = vi.fn<(a?: unknown, b?: unknown, c?: unknown) => string | null>()
const mockAutoMergePr = vi.fn<(a?: unknown) => boolean>()
const mockPullMain = vi.fn()
vi.mock("../worktree.js", () => ({
  createWorktree: () => mockCreateWorktree(),
  removeWorktree: (a: unknown, b?: unknown) => mockRemoveWorktree(a, b),
  createPullRequest: (a: unknown, b?: unknown, c?: unknown) => mockCreatePullRequest(a, b, c),
  autoMergePr: (a: unknown) => mockAutoMergePr(a),
  pullMain: () => mockPullMain(),
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

// DB: use real in-memory SQLite
import { initDb, closeDb, createTask, getTask } from "../db.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "test task with enough description",
    overrides.description ?? "a sufficiently long task description for gate1",
    "human",
    overrides.priority ?? 50,
  )
}

describe("testerタイムアウト時のWorkerスキップ", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    emittedEvents.length = 0
    vi.clearAllMocks()

    mockCreateWorktree.mockReturnValue("/tmp/worktree")
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    mockRunGate2.mockReturnValue({ verdict: "go", reasons: [] })
  })

  afterEach(() => {
    closeDb()
  })

  it("testerがtimedOut=trueを返した場合、Gate2とWorkerをスキップしてタスクをfailedにする", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunTester.mockResolvedValue({ testFiles: [], exit_code: 143, timedOut: true })
    const task = makeTask()

    await executeTask(task)

    // Gate2は呼ばれない
    expect(mockRunGate2).not.toHaveBeenCalled()
    // Workerは呼ばれない
    expect(mockRunWorker).not.toHaveBeenCalled()
    // Gate3も呼ばれない
    expect(mockRunGate3).not.toHaveBeenCalled()
    // PR作成も呼ばれない
    expect(mockCreatePullRequest).not.toHaveBeenCalled()

    // タスクがfailedになっている
    const updated = getTask(task.id)
    expect(updated?.status).toBe("failed")

    // task.failedイベントが発火されている
    const failed = emittedEvents.find(e => e.type === "task.failed")
    expect(failed).toBeTruthy()
  })

  it("testerがtimedOut=trueでも有効なテストファイルがある場合はWorkerへ進む", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 143, timedOut: true })
    mockRunWorker.mockResolvedValue({
      exit_code: 0,
      result_text: "done",
      cost_usd: 0.05,
      num_turns: 2,
      duration_ms: 1000,
    })
    mockCollectFacts.mockReturnValue({
      exit_code: 0,
      files_changed: ["src/foo.ts"],
      diff_stats: { additions: 5, deletions: 1 },
      test_result: { passed: 1, failed: 0, exit_code: 0 },
      lint_result: { errors: 0, exit_code: 0 },
      branch: "devpane/task-test",
      commit_hash: "abc123",
    })
    mockRunGate3.mockReturnValue({ verdict: "go", reasons: [] })
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/1")
    mockAutoMergePr.mockReturnValue(true)
    const task = makeTask()

    await executeTask(task)

    expect(mockRunGate2).toHaveBeenCalled()
    expect(mockRunWorker).toHaveBeenCalledWith(task, "/tmp/worktree", ["src/__tests__/foo.test.ts"])
    expect(mockRunGate3).toHaveBeenCalled()

    const updated = getTask(task.id)
    expect(updated?.status).toBe("done")
  })

  it("testerがtimedOut=falseを返した場合、通常通りGate2→Workerへ進む", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0, timedOut: false })
    mockRunWorker.mockResolvedValue({
      exit_code: 0,
      result_text: "done",
      cost_usd: 0.05,
      num_turns: 3,
      duration_ms: 10000,
    })
    mockCollectFacts.mockReturnValue({
      exit_code: 0,
      files_changed: ["src/foo.ts"],
      diff_stats: { additions: 10, deletions: 2 },
      test_result: { passed: 5, failed: 0, exit_code: 0 },
      lint_result: { errors: 0, exit_code: 0 },
      branch: "devpane/task-test",
      commit_hash: "abc123",
    })
    mockRunGate3.mockReturnValue({ verdict: "go", reasons: [] })
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/1")
    mockAutoMergePr.mockReturnValue(true)
    const task = makeTask()

    await executeTask(task)

    // Gate2, Worker, Gate3が呼ばれる
    expect(mockRunGate2).toHaveBeenCalled()
    expect(mockRunWorker).toHaveBeenCalled()
    expect(mockRunGate3).toHaveBeenCalled()
  })

  it("testerタイムアウト時にworktreeがクリーンアップされる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunTester.mockResolvedValue({ testFiles: [], exit_code: 143, timedOut: true })
    const task = makeTask()

    await executeTask(task)

    expect(mockRemoveWorktree).toHaveBeenCalled()
  })

  it("testerタイムアウト時のfailedイベントにrootCause 'timeout'が含まれる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunTester.mockResolvedValue({ testFiles: [], exit_code: 143, timedOut: true })
    const task = makeTask()

    await executeTask(task)

    const failed = emittedEvents.find(
      e => e.type === "task.failed" && "rootCause" in e && e.rootCause === "timeout",
    )
    expect(failed).toBeTruthy()
  })
})
