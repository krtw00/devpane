import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, ObservableFacts } from "@devpane/shared"
import type { Gate1Result } from "../gate1.js"
import type { AgentEvent } from "@devpane/shared/schemas"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// --- Mocks ---

const emittedEvents: AgentEvent[] = []

vi.mock("../events.js", () => ({
  emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event) }),
  safeEmit: vi.fn(() => true),
}))

const mockBroadcast = vi.fn()
vi.mock("../ws.js", () => ({
  broadcast: (...args: unknown[]) => mockBroadcast(...args),
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

vi.mock("../scheduler-hooks.js", () => ({
  runHooks: vi.fn(),
}))

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
  runTester: vi.fn(async () => ({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0 })),
  buildTesterPrompt: vi.fn(() => "prompt"),
}))

// Worker throws to trigger the outer catch block
const mockRunWorker = vi.fn<() => Promise<never>>()
vi.mock("../worker.js", () => ({
  runWorker: () => mockRunWorker(),
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
    commit_hash: "abc123",
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

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
}))

// DB: use real in-memory SQLite
import { initDb, closeDb, createTask, getTask } from "../db.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "test task for catch broadcast",
    overrides.description ?? "a sufficiently long task description for testing",
    "human",
    overrides.priority ?? 50,
  )
}

/**
 * mockBroadcast.mock.calls から "task:updated" 呼び出しを抽出し、
 * 指定statusのものだけ返す
 */
function findTaskUpdatedBroadcast(
  taskId: string,
  status: string,
): unknown[] | undefined {
  return mockBroadcast.mock.calls.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (call: any[]) =>
      call[0] === "task:updated" &&
      call[1]?.id === taskId &&
      call[1]?.status === status,
  )
}

describe("executeTask: 外側catchブロックのbroadcast", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    emittedEvents.length = 0
    vi.clearAllMocks()

    mockCreateWorktree.mockReturnValue("/tmp/worktree")
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
  })

  afterEach(() => {
    closeDb()
  })

  it("rate limitエラー → revertToPending後にbroadcast('task:updated', {status:'pending'})が呼ばれる", async () => {
    const { executeTask } = await import("../scheduler.js")

    // Worker が rate limit エラーを投げる
    mockRunWorker.mockRejectedValue(new Error("429 Too Many Requests"))

    const task = makeTask()
    await executeTask(task)

    // タスクがpendingに戻された
    const updated = getTask(task.id)
    expect(updated?.status).toBe("pending")

    // catch ブロック内で broadcast("task:updated", { ...status: "pending" }) が呼ばれた
    // ※ startTask 時の broadcast は status: "running" なので区別可能
    const pendingBroadcast = findTaskUpdatedBroadcast(task.id, "pending")
    expect(pendingBroadcast).toBeTruthy()
  })

  it("一般例外 → finishTask(failed)後にbroadcast('task:updated', {status:'failed'})が呼ばれる", async () => {
    const { executeTask } = await import("../scheduler.js")

    // Worker が一般的なエラーを投げる（rate limit以外）
    mockRunWorker.mockRejectedValue(new Error("unexpected internal error"))

    const task = makeTask()
    await executeTask(task)

    // タスクがfailedになった
    const updated = getTask(task.id)
    expect(updated?.status).toBe("failed")

    // catch ブロック内で broadcast("task:updated", { ...status: "failed" }) が呼ばれた
    // ※ startTask 時の broadcast は status: "running" なので区別可能
    const failedBroadcast = findTaskUpdatedBroadcast(task.id, "failed")
    expect(failedBroadcast).toBeTruthy()
  })
})
