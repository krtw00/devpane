import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Task, ObservableFacts } from "@devpane/shared"
import type { AgentEvent } from "@devpane/shared/schemas"
import type { Gate1Result } from "../gate1.js"
import type { Gate2Result } from "../gate2.js"
import type { Gate3Result } from "../gate.js"
import type { TesterResult } from "../tester.js"
import type { WorkerResult } from "../worker.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// --- Mocks (emit is NOT mocked — uses real DB insertion) ---

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

// Real DB + real events.js (no mock)
import { initDb, closeDb, createTask } from "../db.js"
import { getAgentEvents } from "../db/events.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "gate rejected event test task",
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

describe("gate.rejected → agent_events DB記録", () => {
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

  it("Gate1 kill → agent_eventsにgate.rejectedレコードが挿入される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["duplicate task"] })
    const task = makeTask()

    await executeTask(task)

    const events = getAgentEvents({ type: "gate.rejected" })
    expect(events.length).toBeGreaterThanOrEqual(1)

    const rejected = events.find(
      (e) => e.type === "gate.rejected" && "gate" in e && e.gate === "gate1",
    ) as Extract<AgentEvent, { type: "gate.rejected" }> | undefined
    expect(rejected).toBeTruthy()
    expect(rejected!.taskId).toBe(task.id)
    expect(rejected!.verdict).toBe("kill")
    expect(rejected!.reason).toContain("duplicate task")
  })

  it("Gate3 kill → agent_eventsにgate.rejectedレコードが挿入される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate3.mockReturnValue({
      verdict: "kill",
      reasons: ["exit_code=1", "no commit produced"],
      failure: { task_id: "t", stage: "gate3", root_cause: "env_issue", why_chain: ["exit_code=1"], gates_passed: ["gate3"], severity: "critical" },
    })
    mockCollectFacts.mockReturnValue(goodFacts({ exit_code: 1, commit_hash: undefined }))
    const task = makeTask()

    await executeTask(task)

    const events = getAgentEvents({ type: "gate.rejected" })
    const rejected = events.find(
      (e) => e.type === "gate.rejected" && "gate" in e && e.gate === "gate3",
    ) as Extract<AgentEvent, { type: "gate.rejected" }> | undefined
    expect(rejected).toBeTruthy()
    expect(rejected!.taskId).toBe(task.id)
    expect(rejected!.verdict).toBe("kill")
    expect(rejected!.reason).toContain("exit_code=1")
  })

  it("Gate3 recycle → agent_eventsにgate.rejectedレコードが挿入される", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate3.mockReturnValue({
      verdict: "recycle",
      reasons: ["tests failed: 2"],
    })
    mockCollectFacts.mockReturnValue(goodFacts({ test_result: { passed: 3, failed: 2, exit_code: 1 } }))
    const task = makeTask()

    await executeTask(task)

    const events = getAgentEvents({ type: "gate.rejected" })
    const rejected = events.find(
      (e) => e.type === "gate.rejected" && "gate" in e && e.gate === "gate3",
    ) as Extract<AgentEvent, { type: "gate.rejected" }> | undefined
    expect(rejected).toBeTruthy()
    expect(rejected!.taskId).toBe(task.id)
    expect(rejected!.verdict).toBe("recycle")
    expect(rejected!.reason).toContain("tests failed")
  })

  it("Gate1 kill時にgate.rejectedが1回だけ記録される（二重発火しない）", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["duplicate task"] })
    const task = makeTask()

    await executeTask(task)

    const events = getAgentEvents({ type: "gate.rejected" })
    const gate1Rejected = events.filter(
      (e) => e.type === "gate.rejected" && "gate" in e && e.gate === "gate1",
    )
    // gate1.ts側で1回だけemitされ、scheduler.ts側では重複emitしないこと
    expect(gate1Rejected).toHaveLength(1)
    const first = gate1Rejected[0] as Extract<AgentEvent, { type: "gate.rejected" }>
    expect(first.taskId).toBe(task.id)
    expect(first.verdict).toBe("kill")
  })

  it("Gate1 go → agent_eventsにgate.rejectedが記録されない", async () => {
    const { executeTask } = await import("../scheduler.js")
    const task = makeTask()

    await executeTask(task)

    const events = getAgentEvents({ type: "gate.rejected" })
    const gate1Rejected = events.filter(
      (e) => e.type === "gate.rejected" && "gate" in e && e.gate === "gate1",
    )
    expect(gate1Rejected).toHaveLength(0)
  })

  it("gate.rejectedのpayloadがAgentEventスキーマに準拠する", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: ["description too short"] })
    const task = makeTask()

    await executeTask(task)

    const events = getAgentEvents({ type: "gate.rejected" })
    expect(events.length).toBeGreaterThanOrEqual(1)

    const rejected = events[0] as Extract<AgentEvent, { type: "gate.rejected" }>
    expect(rejected).toHaveProperty("type", "gate.rejected")
    expect(rejected).toHaveProperty("taskId")
    expect(rejected).toHaveProperty("gate")
    expect(rejected).toHaveProperty("verdict")
    expect(rejected).toHaveProperty("reason")
    expect(["kill", "recycle"]).toContain(rejected.verdict)
    expect(["gate1", "gate2", "gate3"]).toContain(rejected.gate)
  })
})
