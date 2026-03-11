import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, startTask, finishTask, getRecentFailed, insertImprovement } from "../db.js"
import { collectRootCauses } from "../whywhy.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function makeGate3Result(rootCause: string) {
  return JSON.stringify({
    exit_code: 1,
    files_changed: [],
    diff_stats: { additions: 0, deletions: 0 },
    branch: "test",
    gate3: {
      verdict: "kill",
      reasons: ["test failure"],
      failure: {
        task_id: "test",
        stage: "gate3",
        root_cause: rootCause,
        why_chain: ["reason"],
        gates_passed: ["gate3"],
        severity: "critical",
      },
    },
  })
}

describe("whywhy", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  describe("collectRootCauses", () => {
    it("counts root causes from failed tasks", () => {
      const t1 = createTask("A", "d", "pm")
      const t2 = createTask("B", "d", "pm")
      const t3 = createTask("C", "d", "pm")
      startTask(t1.id, "w")
      startTask(t2.id, "w")
      startTask(t3.id, "w")
      finishTask(t1.id, "failed", makeGate3Result("test_gap"))
      finishTask(t2.id, "failed", makeGate3Result("test_gap"))
      finishTask(t3.id, "failed", makeGate3Result("scope_creep"))

      const failed = getRecentFailed(10)
      const causes = collectRootCauses(failed)

      expect(causes).toHaveLength(2)
      expect(causes[0]).toEqual({ cause: "test_gap", count: 2 })
      expect(causes[1]).toEqual({ cause: "scope_creep", count: 1 })
    })

    it("returns empty for tasks without gate3 results", () => {
      const t1 = createTask("A", "d", "pm")
      startTask(t1.id, "w")
      finishTask(t1.id, "failed", JSON.stringify({ exit_code: 1, error: "timeout" }))

      const causes = collectRootCauses(getRecentFailed(10))
      expect(causes).toHaveLength(0)
    })

    it("skips tasks with null result", () => {
      const t1 = createTask("A", "d", "pm")
      startTask(t1.id, "w")
      finishTask(t1.id, "failed", null)

      const causes = collectRootCauses(getRecentFailed(10))
      expect(causes).toHaveLength(0)
    })
  })

  describe("getRecentFailed", () => {
    it("respects limit", () => {
      for (let i = 0; i < 15; i++) {
        const t = createTask(`T${i}`, "d", "pm")
        startTask(t.id, "w")
        finishTask(t.id, "failed", makeGate3Result("test_gap"))
      }
      expect(getRecentFailed(5)).toHaveLength(5)
      expect(getRecentFailed(10)).toHaveLength(10)
      expect(getRecentFailed(20)).toHaveLength(15)
    })
  })

  describe("insertImprovement", () => {
    it("inserts and returns improvement record", () => {
      const record = insertImprovement(
        '{"top_failure":"test_gap"}',
        "gate3",
        "add_check",
      )
      expect(record.id).toBeTruthy()
      expect(record.trigger_analysis).toBe('{"top_failure":"test_gap"}')
      expect(record.target).toBe("gate3")
      expect(record.action).toBe("add_check")
      expect(record.status).toBe("active")
      expect(record.applied_at).toBeTruthy()
    })
  })
})
