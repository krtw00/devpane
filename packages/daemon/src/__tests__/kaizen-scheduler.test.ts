import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentEvent } from "@devpane/shared/schemas"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Capture emitted events for verification
const emittedEvents: AgentEvent[] = []

vi.mock("../events.js", () => ({
  emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event) }),
  safeEmit: vi.fn(() => true),
}))

// Mock kaizen.analyze() — returns a Promise (async)
vi.mock("../kaizen.js", () => ({
  analyze: vi.fn(() => Promise.resolve({
    analysis: {
      top_failure: "test_gap",
      frequency: "3/10",
      why_chain: ["テストが不足", "Gate2が甘い", "テスト生成プロンプトに制約が反映されていない"],
    },
    improvements: [
      { target: "gate2", action: "add_check", description: "制約条件のテストカバレッジを検証" },
    ],
  })),
}))

type KaizenPluginExports = {
  KAIZEN_THRESHOLD: number
  resetKaizenCounter: () => void
  setKaizenCounter: (n: number) => void
  getKaizenCounter: () => number
  checkKaizenAnalysis: () => Promise<void>
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

async function getKaizenExports(): Promise<KaizenPluginExports> {
  return await import("../scheduler-plugins.js") as unknown as KaizenPluginExports
}

describe("kaizen scheduler integration", () => {
  beforeEach(async () => {
    initDb(":memory:", migrationsDir)
    emittedEvents.length = 0
    const mod = await getKaizenExports()
    mod.resetKaizenCounter()
  })

  afterEach(() => {
    closeDb()
  })

  it("exports KAIZEN_THRESHOLD = 10", async () => {
    const mod = await getKaizenExports()
    expect(mod.KAIZEN_THRESHOLD).toBe(10)
  })

  it("exports kaizen counter utilities", async () => {
    const mod = await getKaizenExports()
    expect(typeof mod.resetKaizenCounter).toBe("function")
    expect(typeof mod.setKaizenCounter).toBe("function")
    expect(typeof mod.getKaizenCounter).toBe("function")
    expect(typeof mod.checkKaizenAnalysis).toBe("function")
  })

  it("does not trigger kaizen below threshold", async () => {
    const { analyze } = await import("../kaizen.js") as unknown as { analyze: ReturnType<typeof vi.fn> }
    const mod = await getKaizenExports()

    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD - 1)
    await mod.checkKaizenAnalysis()
    expect(analyze).not.toHaveBeenCalled()
  })

  it("triggers kaizen analyze() at threshold and resets counter", async () => {
    const { analyze } = await import("../kaizen.js") as unknown as { analyze: ReturnType<typeof vi.fn> }
    const mod = await getKaizenExports()

    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()
    expect(analyze).toHaveBeenCalled()
    expect(mod.getKaizenCounter()).toBe(0)
  })

  it("does not trigger kaizen when no failed tasks exist", async () => {
    const { analyze } = await import("../kaizen.js") as unknown as { analyze: ReturnType<typeof vi.fn> }
    const mod = await getKaizenExports()

    // Only successful tasks — no failures to analyze
    for (let i = 0; i < 10; i++) createFinishedTask("done", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()
    expect(analyze).not.toHaveBeenCalled()
    expect(mod.getKaizenCounter()).toBe(0)
  })

  it("inserts improvements into the improvements table", async () => {
    const mod = await getKaizenExports()

    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()

    const db = getDb()
    const improvements = db.prepare(`SELECT * FROM improvements WHERE status = 'active'`).all() as Array<{
      id: string; trigger_analysis: string; target: string; action: string; status: string
    }>

    expect(improvements.length).toBeGreaterThanOrEqual(1)
    const imp = improvements[0]
    expect(imp.target).toBe("gate2")
    expect(imp.action).toBe("add_check")
    expect(imp.status).toBe("active")

    const analysis = JSON.parse(imp.trigger_analysis)
    expect(analysis.top_failure).toBe("test_gap")
    expect(analysis.why_chain).toHaveLength(3)
  })

  it("emits improvement.applied event for each improvement", async () => {
    const mod = await getKaizenExports()

    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()

    const appliedEvents = emittedEvents.filter(e => e.type === "improvement.applied")
    expect(appliedEvents.length).toBeGreaterThanOrEqual(1)
    expect(appliedEvents[0]).toMatchObject({
      type: "improvement.applied",
      target: "gate2",
    })
    expect((appliedEvents[0] as unknown as { improvementId: string }).improvementId).toBeTruthy()
  })

  it("records improvement.applied events in agent_events table", async () => {
    const mod = await getKaizenExports()

    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()

    const db = getDb()
    const events = db.prepare(
      `SELECT * FROM agent_events WHERE type = 'improvement.applied' ORDER BY timestamp DESC`,
    ).all() as Array<{ type: string; payload: string }>

    expect(events.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(events[0].payload)
    expect(payload.type).toBe("improvement.applied")
    expect(payload.target).toBe("gate2")
  })

  it("kaizen hook increments counter on task.completed", async () => {
    const mod = await getKaizenExports()
    const { runHooks } = await import("../scheduler-hooks.js")

    mod.resetKaizenCounter()

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

    expect(mod.getKaizenCounter()).toBeGreaterThanOrEqual(1)
  })
})
