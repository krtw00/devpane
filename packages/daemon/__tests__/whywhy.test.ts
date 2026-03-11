import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { initDb, closeDb, createTask, finishTask, getCompletedTaskCount, getRecentFailures, insertImprovement, getActiveImprovements } from "../src/db.js"
import { emit } from "../src/events.js"
import { aggregateRejections, aggregateRootCauses, findTopRootCause } from "../src/whywhy.js"

function setupTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "whywhy-test-"))
  const dbPath = join(dir, "test.db")
  initDb(dbPath)
  return { dir, dbPath }
}

describe("db: getCompletedTaskCount / getRecentFailures", () => {
  let tmpDir: string

  beforeEach(() => {
    const { dir } = setupTestDb()
    tmpDir = dir
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("returns 0 when no completed tasks", () => {
    expect(getCompletedTaskCount()).toBe(0)
  })

  it("counts done + failed tasks", () => {
    const t1 = createTask("t1", "desc", "pm", 50)
    const t2 = createTask("t2", "desc", "pm", 50)
    const t3 = createTask("t3", "desc", "pm", 50)
    createTask("t4", "desc", "pm", 50) // pending, not counted

    finishTask(t1.id, "done", null)
    finishTask(t2.id, "failed", null)
    finishTask(t3.id, "done", null)

    expect(getCompletedTaskCount()).toBe(3)
  })

  it("returns recent failures ordered by finished_at DESC", () => {
    const t1 = createTask("fail1", "desc", "pm", 50)
    const t2 = createTask("fail2", "desc", "pm", 50)
    const t3 = createTask("done1", "desc", "pm", 50)

    finishTask(t1.id, "failed", JSON.stringify({ failure: { root_cause: "test_gap" } }))
    finishTask(t2.id, "failed", JSON.stringify({ failure: { root_cause: "scope_creep" } }))
    finishTask(t3.id, "done", null)

    const failures = getRecentFailures(10)
    expect(failures).toHaveLength(2)
    expect(failures.every(t => t.status === "failed")).toBe(true)
  })

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      const t = createTask(`fail${i}`, "desc", "pm", 50)
      finishTask(t.id, "failed", null)
    }

    expect(getRecentFailures(3)).toHaveLength(3)
  })
})

describe("db: insertImprovement / getActiveImprovements", () => {
  let tmpDir: string

  beforeEach(() => {
    const { dir } = setupTestDb()
    tmpDir = dir
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("inserts and retrieves active improvements", () => {
    insertImprovement("imp-1", '{"top_failure":"test_gap"}', "gate3", '{"action":"add_check"}')
    insertImprovement("imp-2", '{"top_failure":"scope_creep"}', "pm_template", '{"action":"add_constraint"}')

    const active = getActiveImprovements()
    expect(active).toHaveLength(2)
    expect(active.every(i => i.status === "active")).toBe(true)
    const targets = active.map(i => i.target).sort()
    expect(targets).toEqual(["gate3", "pm_template"])
  })
})

describe("aggregateRootCauses", () => {
  it("counts root causes from task results with gate3 failure", () => {
    const tasks = [
      { result: JSON.stringify({ gate3: { failure: { root_cause: "test_gap" } } }) },
      { result: JSON.stringify({ gate3: { failure: { root_cause: "test_gap" } } }) },
      { result: JSON.stringify({ gate3: { failure: { root_cause: "scope_creep" } } }) },
      { result: null },
      { result: "invalid json{" },
    ] as Parameters<typeof aggregateRootCauses>[0]

    const counts = aggregateRootCauses(tasks)
    expect(counts.get("test_gap")).toBe(2)
    expect(counts.get("scope_creep")).toBe(1)
    expect(counts.size).toBe(2)
  })

  it("counts root causes from task results with top-level failure", () => {
    const tasks = [
      { result: JSON.stringify({ failure: { root_cause: "env_issue" } }) },
    ] as Parameters<typeof aggregateRootCauses>[0]

    const counts = aggregateRootCauses(tasks)
    expect(counts.get("env_issue")).toBe(1)
  })
})

describe("findTopRootCause", () => {
  it("returns the most frequent root cause", () => {
    const counts = new Map<Parameters<typeof findTopRootCause>[0] extends Map<infer K, number> ? K : never, number>()
    counts.set("test_gap", 5)
    counts.set("scope_creep", 3)
    counts.set("env_issue", 1)

    expect(findTopRootCause(counts)).toBe("test_gap")
  })

  it("returns unknown for empty map", () => {
    expect(findTopRootCause(new Map())).toBe("unknown")
  })
})

describe("aggregateRejections", () => {
  let tmpDir: string

  beforeEach(() => {
    const { dir } = setupTestDb()
    tmpDir = dir
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("counts gate.rejected events by gate:verdict", () => {
    emit({ type: "gate.rejected", taskId: "t1", gate: "gate3", verdict: "kill", reason: "exit_code=1" })
    emit({ type: "gate.rejected", taskId: "t2", gate: "gate3", verdict: "recycle", reason: "lint errors" })
    emit({ type: "gate.rejected", taskId: "t3", gate: "gate3", verdict: "kill", reason: "no commit" })

    const rejections = aggregateRejections()
    expect(rejections.get("gate3:kill")).toBe(2)
    expect(rejections.get("gate3:recycle")).toBe(1)
  })

  it("returns empty map when no rejections", () => {
    const rejections = aggregateRejections()
    expect(rejections.size).toBe(0)
  })
})
