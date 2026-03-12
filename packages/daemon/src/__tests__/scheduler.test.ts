import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { isRateLimitError, checkEffectMeasurement, getSchedulerState, setEffectMeasureCounter, resetEffectMeasureCounter, EFFECT_MEASURE_THRESHOLD, calculatePmBackoff, _callPm, resetPmConsecutiveFailures } from "../scheduler.js"
import { runGate2 } from "../gate2.js"
import { buildTesterPrompt } from "../tester.js"
import type { PmOutput } from "@devpane/shared"
import type { AgentEvent } from "@devpane/shared/schemas"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function insertImprovement(overrides: { id?: string; applied_at?: string; status?: string } = {}) {
  const db = getDb()
  const id = overrides.id ?? `imp-${Date.now()}-${Math.random()}`
  const applied_at = overrides.applied_at ?? new Date().toISOString()
  const status = overrides.status ?? "active"
  db.prepare(
    `INSERT INTO improvements (id, trigger_analysis, target, action, applied_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, '{"analysis":{}}', "gate1", "add_check", applied_at, status)
  return id
}

function createFinishedTask(status: "done" | "failed", finishedAt: string, costUsd = 0.1) {
  const task = createTask("t", "d", "pm")
  startTask(task.id, "worker-0")
  const db = getDb()
  const result = JSON.stringify({ exit_code: status === "done" ? 0 : 1, files_changed: [], diff_stats: { additions: 10, deletions: 5 } })
  db.prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ?, cost_usd = ? WHERE id = ?`).run(
    status, finishedAt, result, costUsd, task.id,
  )
  return task.id
}

// Capture emitted events for verification
const emittedEvents: AgentEvent[] = []

vi.mock("../events.js", () => ({
  emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event) }),
  safeEmit: vi.fn(() => true),
}))

describe("isRateLimitError", () => {
  it("detects rate limit messages", () => {
    expect(isRateLimitError("Error: rate limit exceeded")).toBe(true)
    expect(isRateLimitError("429 Too Many Requests")).toBe(true)
    expect(isRateLimitError("Rate-limit reached, please wait")).toBe(true)
    expect(isRateLimitError("API quota exceeded")).toBe(true)
    expect(isRateLimitError("Server overloaded, try again later")).toBe(true)
  })

  it("does not match normal errors", () => {
    expect(isRateLimitError("SyntaxError: unexpected token")).toBe(false)
    expect(isRateLimitError("command not found: claude")).toBe(false)
    expect(isRateLimitError("ENOENT: no such file")).toBe(false)
  })
})

describe("Tester → Gate 2 pipeline", () => {
  let workdir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "scheduler-tester-"))
  })

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  const spec: PmOutput = {
    tasks: [{ title: "add auth", description: "implement JWT auth", priority: 50, constraints: ["use HS256", "token expires in 1h"] }],
    reasoning: "security requirement",
  }

  describe("buildTesterPrompt with constraints", () => {
    it("includes constraints in the prompt", () => {
      const prompt = buildTesterPrompt(spec)
      expect(prompt).toContain("制約条件")
      expect(prompt).toContain("use HS256")
      expect(prompt).toContain("token expires in 1h")
    })

    it("omits constraints section when none provided", () => {
      const noConstraints: PmOutput = {
        tasks: [{ title: "add feature", description: "do something", priority: 50 }],
        reasoning: "test",
      }
      const prompt = buildTesterPrompt(noConstraints)
      expect(prompt).not.toContain("制約条件")
    })

    it("includes task title and description", () => {
      const prompt = buildTesterPrompt(spec)
      expect(prompt).toContain("add auth")
      expect(prompt).toContain("implement JWT auth")
    })

    it("includes design reasoning", () => {
      const prompt = buildTesterPrompt(spec)
      expect(prompt).toContain("security requirement")
    })
  })

  describe("Gate 2 validates tester output", () => {
    it("passes when valid test files exist", () => {
      const content = `import { describe, it, expect } from "vitest"\ndescribe("auth", () => { it("works", () => { expect(true).toBe(true) }) })\n`
      writeFileSync(join(workdir, "auth.test.ts"), content)
      const result = runGate2(spec, ["auth.test.ts"], workdir)
      expect(result.verdict).toBe("go")
    })

    it("recycles when tester produces no files", () => {
      const result = runGate2(spec, [], workdir)
      expect(result.verdict).toBe("recycle")
      expect(result.reasons).toContain("no test files found")
    })

    it("recycles when test file has no test blocks", () => {
      writeFileSync(join(workdir, "empty.test.ts"), "export const x = 1\n")
      const result = runGate2(spec, ["empty.test.ts"], workdir)
      expect(result.verdict).toBe("recycle")
      expect(result.reasons[0]).toContain("no test blocks")
    })

    it("recycles on structural issues (unbalanced braces)", () => {
      const content = `describe("x", () => { it("y", () => {})\n`
      writeFileSync(join(workdir, "bad.test.ts"), content)
      const result = runGate2(spec, ["bad.test.ts"], workdir)
      expect(result.verdict).toBe("recycle")
      expect(result.reasons.some(r => r.includes("unbalanced braces"))).toBe(true)
    })
  })
})

describe("checkEffectMeasurement", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    resetEffectMeasureCounter()
  })

  afterEach(() => {
    closeDb()
  })

  it("does nothing when no active improvements exist", () => {
    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD)
    checkEffectMeasurement()
    expect(getSchedulerState().taskCompletionsSinceLastMeasure).toBe(0)
  })

  it("does not trigger measurement below threshold", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    insertImprovement({ applied_at: appliedAt })

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD - 1)
    checkEffectMeasurement()
    expect(getSchedulerState().taskCompletionsSinceLastMeasure).toBe(EFFECT_MEASURE_THRESHOLD - 1)
  })

  it("triggers measurement at threshold and resets counter", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD)
    checkEffectMeasurement()
    expect(getSchedulerState().taskCompletionsSinceLastMeasure).toBe(0)
  })

  it("updates improvement to permanent when effective", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const impId = insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD)
    checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(impId) as { status: string; verdict: string }
    expect(imp.status).toBe("permanent")
    expect(imp.verdict).toBe("effective")
  })

  it("reverts improvement and emits event when harmful", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const impId = insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 9; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    createFinishedTask("failed", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 2; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    for (let i = 0; i < 8; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD)
    checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(impId) as { status: string; verdict: string }
    expect(imp.status).toBe("reverted")
    expect(imp.verdict).toBe("harmful")

    const revertEvent = emittedEvents.find(e => e.type === "improvement.reverted")
    expect(revertEvent).toBeTruthy()
  })
})

describe("scheduler event emission", () => {
  beforeEach(() => {
    emittedEvents.length = 0
  })

  it("emit mock captures events correctly", async () => {
    const { emit } = await import("../events.js")
    emit({ type: "task.started", taskId: "t1", workerId: "w1" })
    emit({ type: "gate.passed", taskId: "t1", gate: "gate1" })
    emit({ type: "gate.rejected", taskId: "t2", gate: "gate3", verdict: "kill", reason: "no commit" })

    expect(emittedEvents).toHaveLength(3)
    expect(emittedEvents[0]).toEqual({ type: "task.started", taskId: "t1", workerId: "w1" })
    expect(emittedEvents[1]).toEqual({ type: "gate.passed", taskId: "t1", gate: "gate1" })
    expect(emittedEvents[2]).toEqual({
      type: "gate.rejected",
      taskId: "t2",
      gate: "gate3",
      verdict: "kill",
      reason: "no commit",
    })
  })

  it("emits all pipeline event types", async () => {
    const { emit } = await import("../events.js")

    const events: AgentEvent[] = [
      { type: "task.started", taskId: "t1", workerId: "w1" },
      { type: "gate.passed", taskId: "t1", gate: "gate1" },
      { type: "gate.passed", taskId: "t1", gate: "gate3" },
      { type: "task.completed", taskId: "t1", costUsd: 0.05 },
      { type: "pr.created", taskId: "t1", url: "https://github.com/test/pr/1" },
    ]

    for (const e of events) emit(e)

    expect(emittedEvents).toHaveLength(5)
    const types = emittedEvents.map(e => e.type)
    expect(types).toContain("task.started")
    expect(types).toContain("gate.passed")
    expect(types).toContain("task.completed")
    expect(types).toContain("pr.created")
  })
})

describe("calculatePmBackoff", () => {
  it("returns 30s for first cooldown (3 consecutive failures)", () => {
    expect(calculatePmBackoff(3)).toBe(30)
  })

  it("returns 60s for second cooldown (6 consecutive failures)", () => {
    expect(calculatePmBackoff(6)).toBe(60)
  })

  it("returns 120s for third cooldown (9 consecutive failures)", () => {
    expect(calculatePmBackoff(9)).toBe(120)
  })

  it("caps at 300s", () => {
    expect(calculatePmBackoff(12)).toBe(240)
    expect(calculatePmBackoff(15)).toBe(300)
    expect(calculatePmBackoff(18)).toBe(300)
  })

  it("increases exponentially based on cooldown count", () => {
    const b1 = calculatePmBackoff(3)
    const b2 = calculatePmBackoff(6)
    const b3 = calculatePmBackoff(9)
    expect(b2).toBe(b1 * 2)
    expect(b3).toBe(b1 * 4)
  })
})

vi.mock("../pm.js", () => ({
  runPm: vi.fn(),
  ingestPmTasks: vi.fn(() => []),
}))

vi.mock("../circuit-breaker.js", () => ({
  circuitBreaker: { recordSuccess: vi.fn(), recordFailure: vi.fn(), canProceed: vi.fn(() => true), getState: vi.fn(() => "closed"), getBackoffSec: vi.fn(() => 1) },
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>()
  return {
    ...actual,
    appendLog: vi.fn(),
  }
})

describe("PM consecutive failure counter behavior", () => {
  beforeEach(() => {
    resetPmConsecutiveFailures()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("クールダウン後に再失敗した場合、カウンタが継続する", async () => {
    const { runPm } = await import("../pm.js")
    const mockRunPm = vi.mocked(runPm)
    mockRunPm.mockRejectedValue(new Error("PM error"))

    // 3回失敗 → クールダウン発火、カウンタは3のまま
    for (let i = 0; i < 3; i++) {
      const p = _callPm()
      await vi.runAllTimersAsync()
      await p
    }
    expect(getSchedulerState().pmConsecutiveFailures).toBe(3)

    // さらに3回失敗 → カウンタは6に継続（0にリセットされない）
    for (let i = 0; i < 3; i++) {
      const p = _callPm()
      await vi.runAllTimersAsync()
      await p
    }
    expect(getSchedulerState().pmConsecutiveFailures).toBe(6)
  })

  it("バックオフ時間が指数的に増加する", () => {
    // 3回目のクールダウン: 30s
    expect(calculatePmBackoff(3)).toBe(30)
    // 6回目のクールダウン: 60s
    expect(calculatePmBackoff(6)).toBe(60)
    // 9回目のクールダウン: 120s
    expect(calculatePmBackoff(9)).toBe(120)
    // 上限300sでキャップ
    expect(calculatePmBackoff(15)).toBe(300)
    expect(calculatePmBackoff(18)).toBe(300)
  })

  it("PM成功時にカウンタがリセットされる", async () => {
    const { runPm } = await import("../pm.js")
    const mockRunPm = vi.mocked(runPm)

    // まず3回失敗させる
    mockRunPm.mockRejectedValue(new Error("PM error"))
    for (let i = 0; i < 3; i++) {
      const p = _callPm()
      await vi.runAllTimersAsync()
      await p
    }
    expect(getSchedulerState().pmConsecutiveFailures).toBe(3)

    // 成功 → カウンタが0にリセット
    mockRunPm.mockResolvedValue({ tasks: [], reasoning: "ok" })
    await _callPm()
    expect(getSchedulerState().pmConsecutiveFailures).toBe(0)
  })
})
