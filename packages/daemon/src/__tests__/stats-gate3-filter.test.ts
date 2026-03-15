import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, insertAgentEvent } from "../db.js"
import { getPipelineStats } from "../db/stats.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("getPipelineStats gate3_pass_rate filters by gate3 only", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("excludes gate1/gate2 events from gate3 pass rate calculation", () => {
    // gate1 passed events (should NOT be counted)
    for (let i = 0; i < 5; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `g1-${i}`,
        gate: "gate1",
      } as never)
    }

    // gate2 rejected events (should NOT be counted)
    for (let i = 0; i < 5; i++) {
      insertAgentEvent("gate.rejected", {
        type: "gate.rejected",
        taskId: `g2-${i}`,
        gate: "gate2",
        verdict: "kill",
        reason: "lint failure",
      } as never)
    }

    // gate3: 3 passed, 1 rejected → rate should be 0.75
    for (let i = 0; i < 3; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `g3-pass-${i}`,
        gate: "gate3",
        verdict: "go",
      } as never)
    }
    insertAgentEvent("gate.rejected", {
      type: "gate.rejected",
      taskId: "g3-fail-0",
      gate: "gate3",
      verdict: "kill",
      reason: "test failure",
    } as never)

    const stats = getPipelineStats()

    // BUG: Without gate3 filter, total = 14 (5 gate1 + 5 gate2 + 4 gate3),
    // pass_count = 3 (only gate3 passed with verdict='go'), rate ≈ 0.214
    // EXPECTED: total = 4 (gate3 only), pass_count = 3, rate = 0.75
    expect(stats.gate3_pass_rate).toBeCloseTo(0.75)
  })

  it("counts gate.passed events correctly using type instead of verdict", () => {
    // gate3 passed events — gate.passed may not always have verdict='go'
    // The fix should count type='gate.passed' as a pass for gate3
    for (let i = 0; i < 2; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `g3-pass-${i}`,
        gate: "gate3",
      } as never)
    }

    // gate3 rejected event
    insertAgentEvent("gate.rejected", {
      type: "gate.rejected",
      taskId: "g3-fail-0",
      gate: "gate3",
      verdict: "kill",
      reason: "test failure",
    } as never)

    const stats = getPipelineStats()

    // 2 passed, 1 rejected → rate = 2/3 ≈ 0.667
    expect(stats.gate3_pass_rate).toBeCloseTo(2 / 3)
  })

  it("returns correct rate with only gate3 events among mixed gate data", () => {
    // Interleave gate1, gate2, gate3 events to simulate realistic data
    const events = [
      { type: "gate.passed", gate: "gate1", taskId: "t1" },
      { type: "gate.passed", gate: "gate3", taskId: "t2", verdict: "go" },
      { type: "gate.rejected", gate: "gate2", taskId: "t3", verdict: "kill", reason: "lint" },
      { type: "gate.passed", gate: "gate3", taskId: "t4", verdict: "go" },
      { type: "gate.rejected", gate: "gate3", taskId: "t5", verdict: "kill", reason: "test" },
      { type: "gate.passed", gate: "gate1", taskId: "t6" },
      { type: "gate.passed", gate: "gate2", taskId: "t7" },
      { type: "gate.rejected", gate: "gate3", taskId: "t8", verdict: "kill", reason: "test" },
      { type: "gate.passed", gate: "gate3", taskId: "t9", verdict: "go" },
      { type: "gate.rejected", gate: "gate1", taskId: "t10", verdict: "kill", reason: "lint" },
    ]

    for (const ev of events) {
      insertAgentEvent(ev.type, ev as never)
    }

    const stats = getPipelineStats()

    // gate3 events only: 3 passed (t2, t4, t9), 2 rejected (t5, t8) → rate = 3/5 = 0.6
    expect(stats.gate3_pass_rate).toBeCloseTo(0.6)
  })

  it("handles case where only non-gate3 events exist", () => {
    // Only gate1/gate2 events — gate3 pass rate should be 0 (no gate3 data)
    for (let i = 0; i < 5; i++) {
      insertAgentEvent("gate.passed", {
        type: "gate.passed",
        taskId: `g1-${i}`,
        gate: "gate1",
      } as never)
    }
    for (let i = 0; i < 3; i++) {
      insertAgentEvent("gate.rejected", {
        type: "gate.rejected",
        taskId: `g2-${i}`,
        gate: "gate2",
        verdict: "kill",
        reason: "lint",
      } as never)
    }

    const stats = getPipelineStats()

    // No gate3 events → pass rate should be 0
    expect(stats.gate3_pass_rate).toBe(0)
  })
})
