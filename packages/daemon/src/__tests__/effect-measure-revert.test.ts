import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentEvent } from "@devpane/shared/schemas"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { ulid } from "ulid"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const emittedEvents: AgentEvent[] = []

vi.mock("../events.js", () => ({
  emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event) }),
  safeEmit: vi.fn(() => true),
}))

vi.mock("../kaizen.js", () => ({
  analyze: vi.fn(() => Promise.resolve(null)),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
  forget: vi.fn(),
  findSimilar: vi.fn(() => []),
}))

vi.mock("../worktree.js", () => ({
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
  checkAllMetrics: vi.fn(() => []),
}))

type EffectMeasurePluginExports = {
  EFFECT_MEASURE_THRESHOLD: number
  resetEffectMeasureCounter: () => void
  setEffectMeasureCounter: (n: number) => void
  getEffectMeasureCounter: () => number
  checkEffectMeasurement: () => void
}

async function getExports(): Promise<EffectMeasurePluginExports> {
  return await import("../scheduler-plugins.js") as unknown as EffectMeasurePluginExports
}

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
  const db = getDb()
  const result = JSON.stringify({ exit_code: status === "done" ? 0 : 1, files_changed: [], diff_stats: { additions: 10, deletions: 5 } })
  db.prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ?, cost_usd = ? WHERE id = ?`).run(
    status, finishedAt, result, costUsd, task.id,
  )
  return task.id
}

describe("effect-measure revert integration", () => {
  beforeEach(async () => {
    initDb(":memory:", migrationsDir)
    emittedEvents.length = 0
    const mod = await getExports()
    mod.resetEffectMeasureCounter()
  })

  afterEach(() => {
    closeDb()
  })

  it("checkEffectMeasurement reverts harmful improvement and emits event", async () => {
    const mod = await getExports()
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    // Before: 1/10 failed = 10%
    for (let i = 0; i < 9; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 5/10 failed = 50%
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD)
    mod.checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(id) as { status: string; verdict: string }
    expect(imp.status).toBe("reverted")
    expect(imp.verdict).toBe("harmful")

    const revertEvents = emittedEvents.filter(e => e.type === "improvement.reverted")
    expect(revertEvents).toHaveLength(1)
    expect((revertEvents[0] as unknown as { improvementId: string }).improvementId).toBe(id)
  })

  it("checkEffectMeasurement promotes effective improvement to permanent", async () => {
    const mod = await getExports()
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    // Before: 5/10 failed = 50%
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 0/10 failed = 0%
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD)
    mod.checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(id) as { status: string; verdict: string }
    expect(imp.status).toBe("permanent")
    expect(imp.verdict).toBe("effective")

    const revertEvents = emittedEvents.filter(e => e.type === "improvement.reverted")
    expect(revertEvents).toHaveLength(0)
  })

  it("checkEffectMeasurement keeps ineffective improvement as active", async () => {
    const mod = await getExports()
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    // Before: 2/10 failed = 20%
    for (let i = 0; i < 8; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 2; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 2/10 failed = 20%
    for (let i = 0; i < 8; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")
    for (let i = 0; i < 2; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD)
    mod.checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(id) as { status: string; verdict: string }
    expect(imp.status).toBe("active")
    expect(imp.verdict).toBe("ineffective")
  })

  it("does not run measurement when no active improvements exist", async () => {
    const mod = await getExports()
    insertImprovement({ status: "reverted" })

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD)
    mod.checkEffectMeasurement()

    // Counter should be reset to 0 (early return path)
    expect(mod.getEffectMeasureCounter()).toBe(0)
  })

  it("does not run measurement below threshold", async () => {
    const mod = await getExports()
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const id = insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 10; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD - 1)
    mod.checkEffectMeasurement()

    const db = getDb()
    const imp = db.prepare(`SELECT status, verdict FROM improvements WHERE id = ?`).get(id) as { status: string; verdict: string | null }
    expect(imp.status).toBe("active")
    expect(imp.verdict).toBeNull()
  })

  it("resets counter after measurement runs", async () => {
    const mod = await getExports()
    const appliedAt = "2024-06-01T00:00:00.000Z"
    insertImprovement({ applied_at: appliedAt })

    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD)
    mod.checkEffectMeasurement()

    expect(mod.getEffectMeasureCounter()).toBe(0)
  })

  it("processes multiple improvements in a single measurement run", async () => {
    const mod = await getExports()
    const appliedAt = "2024-06-01T00:00:00.000Z"
    const harmfulId = insertImprovement({ applied_at: appliedAt })
    const effectiveId = insertImprovement({ applied_at: appliedAt })

    // Before: 5/10 = 50% (same for both)
    for (let i = 0; i < 5; i++) createFinishedTask("done", "2024-05-01T00:00:00.000Z")
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-05-01T00:00:00.000Z")

    // After: 0/10 = 0% → both will be "effective" (lower failure rate)
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    mod.setEffectMeasureCounter(mod.EFFECT_MEASURE_THRESHOLD)
    mod.checkEffectMeasurement()

    const db = getDb()
    const imp1 = db.prepare(`SELECT status FROM improvements WHERE id = ?`).get(harmfulId) as { status: string }
    const imp2 = db.prepare(`SELECT status FROM improvements WHERE id = ?`).get(effectiveId) as { status: string }
    expect(imp1.status).toBe("permanent")
    expect(imp2.status).toBe("permanent")
  })

  it("effect measure hook increments counter on task.completed", async () => {
    const mod = await getExports()
    const { runHooks } = await import("../scheduler-hooks.js")

    // Need an active improvement so checkEffectMeasurement() doesn't reset counter to 0
    insertImprovement({ applied_at: "2099-01-01T00:00:00.000Z" })
    mod.resetEffectMeasureCounter()

    const dummyData = {
      task: {
        id: "t1", title: "test", description: "d", constraints: null,
        status: "done" as const, priority: 50, parent_id: null,
        created_by: "pm" as const, assigned_to: "worker-0",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        result: null, cost_usd: 0.1, tokens_used: 0, retry_count: 0,
      },
      costUsd: 0.1,
      numTurns: 5,
      executionMs: 10000,
      facts: { files_changed: ["a.ts"], diff_stats: { additions: 10, deletions: 5 }, commit_hash: "abc123" },
      prUrl: null,
    }

    await runHooks("task.completed", dummyData)

    expect(mod.getEffectMeasureCounter()).toBeGreaterThanOrEqual(1)
  })
})
