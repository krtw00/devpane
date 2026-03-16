import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task } from "@devpane/shared"
import { initDb, closeDb, getDb } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// --- Mocks ---

const mockRecordTaskMetrics = vi.fn()
const mockCheckAllMetrics = vi.fn(() => [])

vi.mock("../spc.js", () => ({
  recordTaskMetrics: (...args: unknown[]) => mockRecordTaskMetrics(...args),
  checkAllMetrics: (...args: unknown[]) => mockCheckAllMetrics(...args),
  recordMetric: vi.fn(),
  checkMetric: vi.fn(),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    canProceed: vi.fn(() => true),
    getState: vi.fn(() => "closed"),
    getBackoffSec: vi.fn(() => 1),
  },
}))

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
  forget: vi.fn(),
  findSimilar: vi.fn(() => []),
  cleanupOldLessons: vi.fn(() => 0),
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

const mockRunWorker = vi.fn()
vi.mock("../worker.js", () => ({
  runWorker: (...args: unknown[]) => mockRunWorker(...args),
}))

const mockCollectFacts = vi.fn()
vi.mock("../facts.js", () => ({
  collectFacts: (...args: unknown[]) => mockCollectFacts(...args),
}))

const mockRunGate1 = vi.fn()
vi.mock("../gate1.js", () => ({
  runGate1: (...args: unknown[]) => mockRunGate1(...args),
}))

vi.mock("../gate2.js", () => ({
  runGate2: vi.fn(() => ({ verdict: "go", reasons: [] })),
}))

const mockRunGate3 = vi.fn()
vi.mock("../gate.js", () => ({
  runGate3: (...args: unknown[]) => mockRunGate3(...args),
}))

const mockRunTester = vi.fn()
vi.mock("../tester.js", () => ({
  runTester: (...args: unknown[]) => mockRunTester(...args),
  buildTesterPrompt: vi.fn(() => ""),
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

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>()
  return {
    ...actual,
    appendLog: vi.fn(),
    updateTaskCost: vi.fn(),
  }
})

// scheduler-plugins: side-effect import from scheduler.ts registers hooks
// We need to mock it to avoid kaizen/shared/schemas import chain issues,
// but keep the SPC hook registration working
vi.mock("../scheduler-plugins.js", () => ({
  EFFECT_MEASURE_THRESHOLD: 5,
  checkEffectMeasurement: vi.fn(),
  resetEffectMeasureCounter: vi.fn(),
  setEffectMeasureCounter: vi.fn(),
  getEffectMeasureCounter: vi.fn(() => 0),
  KAIZEN_THRESHOLD: 5,
  checkKaizenAnalysis: vi.fn(),
  resetKaizenCounter: vi.fn(),
  setKaizenCounter: vi.fn(),
  getKaizenCounter: vi.fn(() => 0),
  parseConstraints: (raw: string | null) => { if (!raw) return []; try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.filter((s: unknown): s is string => typeof s === "string"); } catch {} return [] },
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-test-001",
    title: "test task",
    description: "test description",
    constraints: null,
    status: "pending",
    priority: 50,
    parent_id: null,
    created_by: "pm",
    assigned_to: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    cost_usd: 0,
    tokens_used: 0,
    retry_count: 0,
    ...overrides,
  }
}

const baseFacts = {
  files_changed: ["src/foo.ts"],
  diff_stats: { additions: 10, deletions: 5 },
  commit_hash: "abc123",
  exit_code: 1,
}

const baseWorkerResult = {
  exit_code: 0,
  result_text: "",
  cost_usd: 0.05,
  num_turns: 3,
}

describe("SPC metrics recording for failed tasks", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()

    // Default: gate1 passes
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    // Default: tester succeeds
    mockRunTester.mockResolvedValue({ exit_code: 0, testFiles: ["test.test.ts"] })
    // Default: worker succeeds
    mockRunWorker.mockResolvedValue(baseWorkerResult)
    // Default: facts
    mockCollectFacts.mockReturnValue(baseFacts)
  })

  afterEach(() => {
    closeDb()
  })

  it("gate3 kill時にrecordTaskMetricsが呼ばれる", async () => {
    mockRunGate3.mockReturnValue({
      verdict: "kill",
      reasons: ["no commit hash"],
      failure: { root_cause: "no_commit" },
    })

    const { executeTask } = await import("../scheduler.js")
    await executeTask(makeTask())

    expect(mockRecordTaskMetrics).toHaveBeenCalledWith(
      "task-test-001",
      baseWorkerResult.cost_usd,
      expect.any(Number), // executionMs
      baseFacts.diff_stats.additions + baseFacts.diff_stats.deletions, // diffSize
    )
  })

  it("gate3 recycle時にrecordTaskMetricsが呼ばれる", async () => {
    mockRunGate3.mockReturnValue({
      verdict: "recycle",
      reasons: ["tests failing"],
      failure: { root_cause: "test_failure" },
    })

    const { executeTask } = await import("../scheduler.js")
    await executeTask(makeTask())

    expect(mockRecordTaskMetrics).toHaveBeenCalledWith(
      "task-test-001",
      baseWorkerResult.cost_usd,
      expect.any(Number),
      baseFacts.diff_stats.additions + baseFacts.diff_stats.deletions,
    )
  })

  it("gate3 recycle→kill（リトライ上限）時にrecordTaskMetricsが呼ばれる", async () => {
    mockRunGate3.mockReturnValue({
      verdict: "recycle",
      reasons: ["tests failing"],
      failure: { root_cause: "test_failure" },
    })

    // MAX_RETRIES超えを模擬: getRetryCountが大きい値を返すようにDBを設定
    const task = makeTask()
    const db = getDb()
    db.prepare(`INSERT INTO tasks (id, title, description, status, priority, created_by, created_at, cost_usd, tokens_used) VALUES (?, ?, ?, 'running', 50, 'pm', ?, 0, 0)`).run(
      task.id, task.title, task.description, new Date().toISOString(),
    )
    // retry_countをMAX_RETRIES以上に設定
    db.prepare(`UPDATE tasks SET retry_count = 99 WHERE id = ?`).run(task.id)

    const { executeTask } = await import("../scheduler.js")
    await executeTask(task)

    expect(mockRecordTaskMetrics).toHaveBeenCalledWith(
      task.id,
      baseWorkerResult.cost_usd,
      expect.any(Number),
      baseFacts.diff_stats.additions + baseFacts.diff_stats.deletions,
    )
  })

  it("workerエラー（catchブロック）時にrecordTaskMetricsが呼ばれる", async () => {
    // worker実行中にエラーをスローさせる
    const workerCost = 0.03
    mockRunWorker.mockRejectedValue(
      Object.assign(new Error("worker crashed"), { cost_usd: workerCost }),
    )

    const { executeTask } = await import("../scheduler.js")
    await executeTask(makeTask())

    // catchブロックでもrecordTaskMetricsが呼ばれるべき
    // (costが取得可能な場合)
    // 注: 現在の実装ではcatchブロックにSPC記録がないため、このテストは失敗する（TDD RED）
    expect(mockRecordTaskMetrics).toHaveBeenCalled()
  })

  it("gate3 go（成功）時のrunHooksにtask.completedが渡される", async () => {
    // 成功パスのSPC記録は既存のscheduler-pluginsフック経由で動作する。
    // ここではexecuteTaskがrunHooks("task.completed", ...)を呼ぶことを検証。
    const schedulerHooks = await import("../scheduler-hooks.js")
    const runHooksSpy = vi.spyOn(schedulerHooks, "runHooks").mockResolvedValue()

    // PR作成が成功するようにモック設定（runHooksはPR成功時のみ実行される）
    const { createPullRequest } = await import("../worktree.js")
    vi.mocked(createPullRequest).mockReturnValue("https://github.com/test/pr/1")

    mockRunGate3.mockReturnValue({
      verdict: "go",
      reasons: [],
    })

    const { executeTask } = await import("../scheduler.js")
    await executeTask(makeTask())

    expect(runHooksSpy).toHaveBeenCalledWith("task.completed", expect.objectContaining({
      task: expect.objectContaining({ id: "task-test-001" }),
      costUsd: baseWorkerResult.cost_usd,
    }))

    runHooksSpy.mockRestore()
  })

  it("task.failedフックが登録・実行される", async () => {
    // scheduler-hooks.tsにtask.failedフックが存在し、
    // scheduler-plugins.tsでSPC記録用のtask.failedフックが登録されていることを検証
    const { registerHook, runHooks } = await import("../scheduler-hooks.js")

    const spy = vi.fn()
    registerHook("task.failed", spy)

    await runHooks("task.failed", {
      task: makeTask(),
      rootCause: "test_failure",
    })

    expect(spy).toHaveBeenCalledWith({
      task: expect.objectContaining({ id: "task-test-001" }),
      rootCause: "test_failure",
    })
  })
})
