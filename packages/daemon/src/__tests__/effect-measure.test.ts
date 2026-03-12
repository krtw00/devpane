import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { measureEffect, measureAllActive } from "../effect-measure.js"
import { ulid } from "ulid"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function insertImprovement(overrides: { id?: string; applied_at?: string; status?: string } = {}) {
  const db = getDb()
  const id = overrides.id ?? ulid()
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
  // Directly update finished_at for controlled timing
  const db = getDb()
  const result = JSON.stringify({ exit_code: status === "done" ? 0 : 1, files_changed: [], diff_stats: { additions: 10, deletions: 5 } })
  db.prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ?, cost_usd = ? WHERE id = ?`).run(
    status, finishedAt, result, costUsd, task.id,
  )
  return task.id
}

describe("effect-measure", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("returns null for nonexistent improvement", () => {
    expect(measureEffect("nonexistent")).toBeNull()
  })

  it("returns null for non-active improvement", () => {
    const id = insertImprovement({ status: "reverted" })
    expect(measureEffect(id)).toBeNull()
  })

  it("returns null when no tasks after applied_at", () => {
    const id = insertImprovement({ applied_at: "2099-01-01T00:00:00.000Z" })
    createFinishedTask("done", "2024-01-01T00:00:00.000Z")
    expect(measureEffect(id)).toBeNull()
  })

  it("judges 'effective' when failure rate decreases", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    // Before: 5 failed out of 10 = 50%
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 1 failed out of 10 = 10%
    for (let i = 0; i < 9; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    const result = measureEffect(id)!
    expect(result).not.toBeNull()
    expect(result.verdict).toBe("effective")
    expect(result.beforeFailureRate).toBe(0.5)
    expect(result.afterFailureRate).toBe(0.1)
  })

  it("judges 'ineffective' when failure rate stays the same", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 8; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 2; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    for (let i = 0; i < 8; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    for (let i = 0; i < 2; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    const result = measureEffect(id)!
    expect(result.verdict).toBe("ineffective")
    expect(result.beforeFailureRate).toBe(0.2)
    expect(result.afterFailureRate).toBe(0.2)
  })

  it("judges 'harmful' and reverts when failure rate increases", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    // Before: 1 failed out of 10 = 10%
    for (let i = 0; i < 9; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 5 failed out of 10 = 50%
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    const result = measureEffect(id)!
    expect(result.verdict).toBe("harmful")
    expect(result.beforeFailureRate).toBe(0.1)
    expect(result.afterFailureRate).toBe(0.5)

    // improvement status should be reverted
    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(id) as { status: string; verdict: string }
    expect(imp.status).toBe("reverted")
    expect(imp.verdict).toBe("harmful")
  })

  it("stores after_metrics as JSON", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z", 0.2)
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z", 0.3)

    measureEffect(id, 5, 5)

    const db = getDb()
    const imp = db.prepare(`SELECT after_metrics FROM improvements WHERE id = ?`).get(id) as { after_metrics: string }
    const metrics = JSON.parse(imp.after_metrics)
    expect(metrics.failureRate).toBe(0)
    expect(metrics.avgCost).toBeCloseTo(0.3)
    expect(metrics.avgDiffSize).toBe(15) // 10 additions + 5 deletions
    expect(metrics.sampleSize).toBe(5)
  })

  it("measureAllActive processes all active improvements", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id1 = insertImprovement({ applied_at: appliedAt })
    const id2 = insertImprovement({ applied_at: appliedAt })
    insertImprovement({ applied_at: appliedAt, status: "reverted" }) // should be skipped

    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    const results = measureAllActive(5, 5)
    expect(results).toHaveLength(2)
    const ids = results.map(r => r.improvementId)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
  })

  it("sets status to 'permanent' when verdict is effective", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    // Before: 5 failed out of 10 = 50%
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 0 failed out of 10 = 0%
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    const result = measureEffect(id)!
    expect(result.verdict).toBe("effective")

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(id) as { status: string; verdict: string }
    expect(imp.status).toBe("permanent")
    expect(imp.verdict).toBe("effective")
  })

  it("emits improvement.reverted event for harmful verdict", () => {
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 10; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    measureEffect(id)

    const db = getDb()
    const event = db.prepare(
      `SELECT * FROM agent_events WHERE type = 'improvement.reverted' ORDER BY timestamp DESC LIMIT 1`,
    ).get() as { payload: string } | undefined
    expect(event).toBeTruthy()
    const payload = JSON.parse(event!.payload)
    expect(payload.improvementId).toBe(id)
    expect(payload.reason).toContain("failure rate increased")
  })
})
