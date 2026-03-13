import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { getDb, initDb, closeDb, insertAgentEvent } from "../db.js"
import { getPipelineStats } from "../db/stats.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("getPipelineStats gate3_pass_rate", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("calculates pass rate from recent 20 events only, not all events", () => {
    // Insert 30 old events: all "go" (pass)
    for (let i = 0; i < 30; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `old-${i}`,
        gate: "gate3",
        verdict: "go",
      } as never)
    }

    // Make old events have earlier timestamps
    const db = getDb()
    const allEvents = db.prepare(
      `SELECT id FROM agent_events ORDER BY timestamp ASC`,
    ).all() as { id: string }[]

    for (let i = 0; i < 30; i++) {
      db.prepare(`UPDATE agent_events SET timestamp = ? WHERE id = ?`).run(
        `2020-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        allEvents[i].id,
      )
    }

    // Insert 20 recent events: 10 pass, 10 reject
    for (let i = 0; i < 10; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `recent-pass-${i}`,
        gate: "gate3",
        verdict: "go",
      } as never)
    }
    for (let i = 0; i < 10; i++) {
      insertAgentEvent("gate.rejected", {
        type: "gate.rejected",
        taskId: `recent-fail-${i}`,
        gate: "gate3",
        verdict: "kill",
        reason: "test failure",
      } as never)
    }

    const stats = getPipelineStats()

    // If LIMIT 20 is correctly applied BEFORE aggregation,
    // the 20 most recent events are: 10 pass + 10 reject → rate = 0.5
    // If LIMIT is applied AFTER aggregation (bug), all 50 events count:
    // 40 pass + 10 reject → rate = 0.8
    expect(stats.gate3_pass_rate).toBeCloseTo(0.5)
  })

  it("works correctly with fewer than 20 events", () => {
    // 3 pass, 1 reject → rate = 0.75
    for (let i = 0; i < 3; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `p-${i}`,
        gate: "gate3",
        verdict: "go",
      } as never)
    }
    insertAgentEvent("gate.rejected", {
      type: "gate.rejected",
      taskId: "r-0",
      gate: "gate3",
      verdict: "kill",
      reason: "fail",
    } as never)

    const stats = getPipelineStats()
    expect(stats.gate3_pass_rate).toBeCloseTo(0.75)
  })

  it("returns 0 pass rate when no events exist", () => {
    const stats = getPipelineStats()
    expect(stats.gate3_pass_rate).toBe(0)
  })
})
