import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { isRateLimitError, checkEffectMeasurement, getSchedulerState, setEffectMeasureCounter, resetEffectMeasureCounter, EFFECT_MEASURE_THRESHOLD } from "../scheduler.js"
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
    // counter reset to 0 when no active improvements
    expect(getSchedulerState().taskCompletionsSinceLastMeasure).toBe(0)
  })

  it("does not trigger measurement below threshold", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    insertImprovement({ applied_at: appliedAt })

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD - 1)
    checkEffectMeasurement()
    // counter unchanged (not reset)
    expect(getSchedulerState().taskCompletionsSinceLastMeasure).toBe(EFFECT_MEASURE_THRESHOLD - 1)
  })

  it("triggers measurement at threshold and resets counter", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    insertImprovement({ applied_at: appliedAt })

    // Create tasks before and after
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD)
    checkEffectMeasurement()
    expect(getSchedulerState().taskCompletionsSinceLastMeasure).toBe(0)
  })

  it("updates improvement to permanent when effective", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const impId = insertImprovement({ applied_at: appliedAt })

    // Before: 50% failure
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 0% failure
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

    // Before: 10% failure
    for (let i = 0; i < 9; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 80% failure
    for (let i = 0; i < 2; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    for (let i = 0; i < 8; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    setEffectMeasureCounter(EFFECT_MEASURE_THRESHOLD)
    checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(impId) as { status: string; verdict: string }
    expect(imp.status).toBe("reverted")
    expect(imp.verdict).toBe("harmful")

    const event = db.prepare(
      `SELECT * FROM agent_events WHERE type = 'improvement.reverted' ORDER BY timestamp DESC LIMIT 1`,
    ).get() as { payload: string } | undefined
    expect(event).toBeTruthy()
    const payload = JSON.parse(event!.payload)
    expect(payload.improvementId).toBe(impId)
  })
})
