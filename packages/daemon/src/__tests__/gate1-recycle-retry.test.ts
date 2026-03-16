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

import { initDb, closeDb, createTask, getTask } from "../db.js"
import { getRetryCount } from "../db/tasks.js"
import { config } from "../config.js"

function makeTask(overrides: Partial<Task> = {}): Task {
  return createTask(
    overrides.title ?? "gate1 recycle retry test task",
    overrides.description ?? "a sufficiently long task description for gate1 validation",
    "human",
    overrides.priority ?? 50,
  )
}

describe("Gate1 recycle → retry_count消費", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()

    // Default: all gates pass
    mockRunGate1.mockResolvedValue({ verdict: "go", reasons: [] })
    mockRunTester.mockResolvedValue({ testFiles: ["src/__tests__/foo.test.ts"], exit_code: 0, timedOut: false })
    mockRunGate2.mockReturnValue({ verdict: "go", reasons: [] })
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
  })

  afterEach(() => {
    closeDb()
  })

  it("Gate1 recycle後にretry_countがインクリメントされる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "recycle", reasons: ["LLM output not parseable"] })
    const task = makeTask()

    expect(getRetryCount(task.id)).toBe(0)

    await executeTask(task)

    expect(getRetryCount(task.id)).toBe(1)
  })

  it("Gate1 recycleがMAX_RETRIES回繰り返されるとfailedになる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "recycle", reasons: ["LLM output not parseable"] })
    const task = makeTask()

    // MAX_RETRIES回recycleを繰り返す
    for (let i = 0; i < config.MAX_RETRIES; i++) {
      const current = getTask(task.id)!
      await executeTask(current)
    }

    // MAX_RETRIES到達後、次のexecuteTaskでkillされるべき
    const afterRetries = getTask(task.id)!
    expect(afterRetries.retry_count).toBe(config.MAX_RETRIES)

    // Gate1ルールベースチェックでmax retries exceededによりkillされる
    // mockRunGate1はLLM判定のモックだが、ルールベースチェックが先に走るため
    // retry_count >= MAX_RETRIESならrunGate1Rulesがkillを返し、LLMは呼ばれない
    // ただしrunGate1全体をモックしているので、ここではモック側でkillを返す
    mockRunGate1.mockResolvedValue({ verdict: "kill", reasons: [`max retries exceeded (${config.MAX_RETRIES}/${config.MAX_RETRIES})`] })
    await executeTask(afterRetries)

    const finalTask = getTask(task.id)!
    expect(finalTask.status).toBe("failed")
  })

  it("Gate1 recycleが連続してもretry_countが毎回インクリメントされる", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "recycle", reasons: ["LLM output not parseable"] })
    const task = makeTask()

    for (let i = 0; i < config.MAX_RETRIES; i++) {
      const current = getTask(task.id)!
      expect(getRetryCount(task.id)).toBe(i)
      await executeTask(current)
      expect(getRetryCount(task.id)).toBe(i + 1)
    }
  })

  it("Gate1 recycle後にstatusがpendingに戻る", async () => {
    const { executeTask } = await import("../scheduler.js")
    mockRunGate1.mockResolvedValue({ verdict: "recycle", reasons: ["LLM output not parseable"] })
    const task = makeTask()

    await executeTask(task)

    const updated = getTask(task.id)!
    expect(updated.status).toBe("pending")
  })
})
