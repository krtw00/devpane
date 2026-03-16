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
  runWorker: () => mockRunWorker(),
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
import { initDb, closeDb, createTask } from "../db.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  const t = createTask(
    overrides.title ?? "test task with enough description",
    overrides.description ?? "a sufficiently long task description for gate1",
    "human",
    overrides.priority ?? 50,
  )
  return t
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

function goodWorkerResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    exit_code: 0,
    result_text: "done",
    cost_usd: 0.05,
    num_turns: 3,
    duration_ms: 10000,
    ...overrides,
  }
}

describe("pipeline e2e: executeTask", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    emittedEvents.length = 0
    vi.clearAllMocks()

    // Default: all gates pass, worker succeeds
    mockCreateWorktree.mockReturnValue("/tmp/worktree")
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0 })
    mockRunGate2.mockReturnValue({ verdict: "go", reasons: [] })
    mockRunWorker.mockResolvedValue(goodWorkerResult())
    mockCollectFacts.mockReturnValue(goodFacts())
    mockRunGate3.mockReturnValue({ verdict: "go", reasons: [] })
    mockCreatePullRequest.mockReturnValue("https://github.com/test/pr/1")
    mockAutoMergePr.mockReturnValue(true)
  })

  afterEach(() => {
    closeDb()
  })

  it("ハッピーパス: pending→Gate1→Tester→Gate2→Worker→Gate3→PR作成", async () => {
    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    // Gate1が呼ばれた
    expect(mockRunGate1).toHaveBeenCalledWith(task)
    // Worktree作成
    expect(mockCreateWorktree).toHaveBeenCalled()
    // Tester→Gate2
    expect(mockRunTester).toHaveBeenCalled()
    expect(mockRunGate2).toHaveBeenCalled()
    // Worker→Facts→Gate3
    expect(mockRunWorker).toHaveBeenCalled()
    expect(mockCollectFacts).toHaveBeenCalled()
    expect(mockRunGate3).toHaveBeenCalled()
    // PR作成・自動マージ
    expect(mockCreatePullRequest).toHaveBeenCalled()
    expect(mockAutoMergePr).toHaveBeenCalled()
    expect(mockPullMain).toHaveBeenCalled()

    // イベント検証
    const types = emittedEvents.map(e => e.type)
    expect(types).toContain("gate.passed")
    expect(types).toContain("task.completed")
    expect(types).toContain("pr.created")
  })

  it("Gate1 kill → タスクがfailed、Workerは呼ばれない", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["duplicate task"] })
    const task = makeTask()

    await executeTask(task)

    expect(mockRunGate1).toHaveBeenCalledWith(task)
    expect(mockCreateWorktree).not.toHaveBeenCalled()
    expect(mockRunTester).not.toHaveBeenCalled()
    expect(mockRunWorker).not.toHaveBeenCalled()

    const rejected = emittedEvents.find(e => e.type === "gate.rejected")
    expect(rejected).toBeTruthy()
    const failed = emittedEvents.find(e => e.type === "task.failed")
    expect(failed).toBeTruthy()
  })

  it("Gate2 recycle → Testerリトライ後にWorker続行", async () => {
    const { executeTask } = await import("../scheduler.js")
    // 1回目: recycle, 2回目: go
    mockRunGate2
      .mockReturnValueOnce({ verdict: "recycle", reasons: ["no test blocks"] })
      .mockReturnValueOnce({ verdict: "go", reasons: [] })
    mockRunTester
      .mockResolvedValueOnce({ testFiles: [], exit_code: 0 })
      .mockResolvedValueOnce({ testFiles: ["src/__tests__/retry.test.ts"], exit_code: 0 })
    const task = makeTask()

    await executeTask(task)

    // Testerが2回呼ばれた
    expect(mockRunTester).toHaveBeenCalledTimes(2)
    expect(mockRunGate2).toHaveBeenCalledTimes(2)
    // Workerは実行された
    expect(mockRunWorker).toHaveBeenCalled()
  })

  it("Gate2 recycle上限超過 → テストなしでWorker続行", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate2.mockReturnValue({ verdict: "recycle", reasons: ["no test files found"] })
    mockRunTester.mockResolvedValue({ testFiles: [], exit_code: 0 })
    const task = makeTask()

    await executeTask(task)

    // GATE2_MAX_RETRIES=1 なのでTester2回
    expect(mockRunTester).toHaveBeenCalledTimes(2)
    // Workerは呼ばれる（テストなしで続行）
    expect(mockRunWorker).toHaveBeenCalled()
  })

  it("Gate3 kill → タスクがfailed", async () => {
    const { executeTask } = await import("../scheduler.js")
    const failFacts = goodFacts({ exit_code: 1, commit_hash: undefined })
    mockCollectFacts.mockReturnValue(failFacts)
    mockRunGate3.mockReturnValue({
      verdict: "kill",
      reasons: ["exit_code=1", "no commit produced"],
      failure: { task_id: "t", stage: "gate3", root_cause: "env_issue", why_chain: ["exit_code=1"], gates_passed: ["gate3"], severity: "critical" },
    })
    const task = makeTask()

    await executeTask(task)

    expect(mockCreatePullRequest).not.toHaveBeenCalled()
    const failed = emittedEvents.find(e => e.type === "task.failed")
    expect(failed).toBeTruthy()
  })

  it("Gate3 recycle（リトライ上限内）→ タスクがrequeue", async () => {
    const { executeTask } = await import("../scheduler.js")
    const recycleFacts = goodFacts({ test_result: { passed: 3, failed: 2, exit_code: 1 } })
    mockCollectFacts.mockReturnValue(recycleFacts)
    mockRunGate3.mockReturnValue({
      verdict: "recycle",
      reasons: ["tests failed: 2"],
    })
    const task = makeTask()

    await executeTask(task)

    expect(mockCreatePullRequest).not.toHaveBeenCalled()
    // requeueされたことをイベントで確認
    const recycleEvent = emittedEvents.find(
      e => e.type === "gate.rejected" && "gate" in e && e.gate === "gate3",
    )
    expect(recycleEvent).toBeTruthy()
  })

  it("Gate3 go → PR作成後にrunHooksが呼ばれる", async () => {
    const { executeTask } = await import("../scheduler.js")
    const { runHooks } = await import("../scheduler-hooks.js")
    const task = makeTask()

    await executeTask(task)

    expect(runHooks).toHaveBeenCalledWith("task.completed", expect.objectContaining({
      task: expect.objectContaining({ id: task.id }),
      costUsd: 0.05,
      prUrl: "https://github.com/test/pr/1",
    }))
  })

  it("PR作成失敗(null返却) → タスクがfailedになる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockCreatePullRequest.mockReturnValue(null)
    const task = makeTask()

    await executeTask(task)

    // PR作成は試みられた
    expect(mockCreatePullRequest).toHaveBeenCalled()
    // 自動マージは呼ばれない
    expect(mockAutoMergePr).not.toHaveBeenCalled()

    // タスクがfailedになっている
    const { getTask } = await import("../db.js")
    const updated = getTask(task.id)
    expect(updated?.status).toBe("failed")
    expect(updated?.result).toContain("pr_creation_failed")
  })

  it("PR作成失敗 → pr.failedイベントが記録される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockCreatePullRequest.mockReturnValue(null)
    const task = makeTask()

    await executeTask(task)

    const prFailed = emittedEvents.find(e => e.type === "pr.failed")
    expect(prFailed).toBeTruthy()
    if (prFailed && "taskId" in prFailed) {
      expect(prFailed.taskId).toBe(task.id)
    }
  })

  it("Worktree作成失敗 → タスクがfailed（Tester/Workerは呼ばれない）", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockCreateWorktree.mockImplementation(() => { throw new Error("disk full") })
    const task = makeTask()

    await executeTask(task)

    expect(mockRunTester).not.toHaveBeenCalled()
    expect(mockRunWorker).not.toHaveBeenCalled()
    const failed = emittedEvents.find(e => e.type === "task.failed")
    expect(failed).toBeTruthy()
    if (failed && "rootCause" in failed) {
      expect(failed.rootCause).toBe("env_issue")
    }
  })
})
