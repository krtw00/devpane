import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Do NOT mock events.js — we want the real emit() to call insertAgentEvent
// Instead, mock emit's downstream dependencies (ws, notifier)
vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../notifier-factory.js", () => ({
  getNotifier: vi.fn(() => ({ notify: vi.fn(() => Promise.resolve()) })),
}))

vi.mock("../kaizen.js", () => ({
  analyze: vi.fn(() => Promise.resolve({
    analysis: {
      top_failure: "test_gap",
      frequency: "3/10",
      why_chain: ["テストが不足"],
    },
    improvements: [
      { target: "gate2", action: "add_check", description: "テストカバレッジ検証" },
    ],
  })),
}))

vi.mock("../memory.js", () => ({
  remember: vi.fn(),
  forget: vi.fn(),
  findSimilar: vi.fn(() => []),
  cleanupOldLessons: vi.fn(() => 0),
}))

vi.mock("../worktree.js", () => ({
  getWorktreeNewAndDeleted: vi.fn(() => ({ added: [], deleted: [] })),
}))

vi.mock("../spc.js", () => ({
  recordTaskMetrics: vi.fn(),
  checkAllMetrics: vi.fn(() => []),
}))

type KaizenPluginExports = {
  KAIZEN_THRESHOLD: number
  resetKaizenCounter: () => void
  setKaizenCounter: (n: number) => void
  getKaizenCounter: () => number
  checkKaizenAnalysis: () => Promise<void>
}

async function getKaizenExports(): Promise<KaizenPluginExports> {
  return await import("../scheduler-plugins.js") as unknown as KaizenPluginExports
}

function createFinishedTask(status: "done" | "failed", finishedAt: string) {
  const task = createTask("t", "d", "pm")
  startTask(task.id, "worker-0")
  const db = getDb()
  const result = JSON.stringify({ exit_code: status === "done" ? 0 : 1, files_changed: [], diff_stats: { additions: 10, deletions: 5 } })
  db.prepare(`UPDATE tasks SET status = ?, finished_at = ?, result = ?, cost_usd = ? WHERE id = ?`).run(
    status, finishedAt, result, 0.1, task.id,
  )
}

describe("kaizen: no double insert of improvement.applied", () => {
  beforeEach(async () => {
    initDb(":memory:", migrationsDir)
    const mod = await getKaizenExports()
    mod.resetKaizenCounter()
  })

  afterEach(() => {
    closeDb()
  })

  it("inserts exactly 1 agent_event record per improvement (not 2)", async () => {
    const mod = await getKaizenExports()

    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()

    const db = getDb()
    const events = db.prepare(
      `SELECT * FROM agent_events WHERE type = 'improvement.applied'`,
    ).all() as Array<{ type: string; payload: string }>

    // emit() internally calls insertAgentEvent once.
    // There must NOT be a second insertAgentEvent call in scheduler-plugins.ts.
    expect(events).toHaveLength(1)
  })

  it("inserts exactly N agent_event records for N improvements", async () => {
    const { analyze } = await import("../kaizen.js") as unknown as { analyze: ReturnType<typeof vi.fn> }
    analyze.mockResolvedValueOnce({
      analysis: { top_failure: "multi", frequency: "5/10", why_chain: ["a"] },
      improvements: [
        { target: "gate1", action: "fix_a", description: "a" },
        { target: "gate2", action: "fix_b", description: "b" },
        { target: "gate3", action: "fix_c", description: "c" },
      ],
    })

    const mod = await getKaizenExports()
    for (let i = 0; i < 5; i++) createFinishedTask("failed", "2024-07-01T00:00:00.000Z")

    mod.setKaizenCounter(mod.KAIZEN_THRESHOLD)
    await mod.checkKaizenAnalysis()

    const db = getDb()
    const events = db.prepare(
      `SELECT * FROM agent_events WHERE type = 'improvement.applied'`,
    ).all() as Array<{ type: string; payload: string }>

    // Exactly 3 events — one per improvement, no duplicates
    expect(events).toHaveLength(3)
  })
})
