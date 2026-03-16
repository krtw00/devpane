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

// --- Mocks (memory.ts is NOT mocked — uses real DB) ---

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../discord.js", () => ({
  notify: vi.fn(() => Promise.resolve()),
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

vi.mock("../worktree.js", () => ({
  createWorktree: vi.fn(() => "/tmp/worktree"),
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

// Real DB + real memory.ts (no mock)
import { initDb, closeDb, createTask } from "../db.js"
import { recall } from "../memory.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "gate memory test task",
    overrides.description ?? "a sufficiently long task description for gate1 validation",
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

describe("Gate判定理由 → memoriesテーブルにlesson記録", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()

    // Default: all gates pass
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0 })
    mockRunGate2.mockReturnValue({ verdict: "go", reasons: [] })
    mockRunWorker.mockResolvedValue(goodWorkerResult())
    mockCollectFacts.mockReturnValue(goodFacts())
    mockRunGate3.mockReturnValue({ verdict: "go", reasons: [] })
  })

  afterEach(() => {
    closeDb()
  })

  it("Gate1 kill → memoriesにcategory='lesson'のレコードが挿入される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["duplicate of completed task"] })
    const task = makeTask()

    await executeTask(task)

    const lessons = recall("lesson")
    expect(lessons.length).toBeGreaterThanOrEqual(1)

    const relevant = lessons.find((m) => m.source_task_id === task.id)
    expect(relevant).toBeTruthy()
    expect(relevant!.category).toBe("lesson")
    expect(relevant!.content).toContain("duplicate of completed task")
  })

  it("Gate1 kill → lesson記憶にsource_task_idが紐づく", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["conflicts with feature memory"] })
    const task = makeTask()

    await executeTask(task)

    const lessons = recall("lesson")
    const relevant = lessons.find((m) => m.source_task_id === task.id)
    expect(relevant).toBeTruthy()
    expect(relevant!.source_task_id).toBe(task.id)
  })

  it("Gate3 kill → memoriesにcategory='lesson'のレコードが挿入される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate3.mockReturnValue({
      verdict: "kill",
      reasons: ["exit_code=1", "no commit produced"],
      failure: { task_id: "t", stage: "gate3", root_cause: "env_issue", why_chain: ["exit_code=1"], gates_passed: ["gate3"], severity: "critical" },
    })
    mockCollectFacts.mockReturnValue(goodFacts({ exit_code: 1, commit_hash: undefined }))
    const task = makeTask()

    await executeTask(task)

    const lessons = recall("lesson")
    const relevant = lessons.find((m) => m.source_task_id === task.id)
    expect(relevant).toBeTruthy()
    expect(relevant!.category).toBe("lesson")
    expect(relevant!.content).toContain("exit_code=1")
  })

  it("Gate3 recycle → memoriesにcategory='lesson'のレコードが挿入される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate3.mockReturnValue({
      verdict: "recycle",
      reasons: ["tests failed: 2"],
    })
    mockCollectFacts.mockReturnValue(goodFacts({ test_result: { passed: 3, failed: 2, exit_code: 1 } }))
    const task = makeTask()

    await executeTask(task)

    const lessons = recall("lesson")
    const relevant = lessons.find((m) => m.source_task_id === task.id)
    expect(relevant).toBeTruthy()
    expect(relevant!.category).toBe("lesson")
    expect(relevant!.content).toContain("tests failed")
  })

  it("全Gateがgo → lesson記憶が挿入されない", async () => {
    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    const lessons = recall("lesson")
    const relevant = lessons.filter((m) => m.source_task_id === task.id)
    expect(relevant).toHaveLength(0)
  })

  it("Gate1 kill理由が複数 → lesson記憶に全理由が含まれる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["description too short", "max retries exceeded"] })
    const task = makeTask()

    await executeTask(task)

    const lessons = recall("lesson")
    const relevant = lessons.find((m) => m.source_task_id === task.id)
    expect(relevant).toBeTruthy()
    expect(relevant!.content).toContain("description too short")
    expect(relevant!.content).toContain("max retries exceeded")
  })
})
