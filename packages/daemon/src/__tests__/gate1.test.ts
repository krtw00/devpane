import { describe, it, expect, beforeEach } from "vitest"
import { runGate1Rules } from "../gate1.js"
import { initDb, closeDb, createTask, getDb } from "../db.js"
import { remember } from "../memory.js"
import type { Task } from "@devpane/shared"

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-gate1",
    title: "新しいテスト機能の追加",
    description: "テスト機能を実装する。具体的にはXXXを追加してYYYを修正する。",
    constraints: null,
    status: "pending",
    priority: 5,
    parent_id: null,
    assigned_to: null,
    created_by: "pm",
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    cost_usd: 0,
    tokens_used: 0,
    retry_count: 0,
    ...overrides,
  }
}

describe("Gate1 Rules", () => {
  beforeEach(() => {
    closeDb()
    initDb(":memory:")
  })

  it("passes a valid new task", () => {
    const result = runGate1Rules(makeTask())
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("kills task with too-short description", () => {
    const result = runGate1Rules(makeTask({ description: "short" }))
    expect(result.verdict).toBe("kill")
    expect(result.reasons[0]).toMatch(/description too short/)
  })

  it("kills task that duplicates a completed task", () => {
    const done = createTask("スケジューラ制御API", "実装する内容の詳細説明", "pm")
    const db = getDb()
    db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(done.id)

    const result = runGate1Rules(makeTask({ title: "スケジューラ制御API" }))
    expect(result.verdict).toBe("kill")
    expect(result.reasons.some((r: string) => r.includes("duplicate"))).toBe(true)
  })

  it("kills task that conflicts with feature memory", () => {
    remember("feature", "packages/daemon/src/api/scheduler.ts を追加（スケジューラ制御API）")

    const result = runGate1Rules(makeTask({ title: "スケジューラ制御API" }))
    expect(result.verdict).toBe("kill")
    expect(result.reasons.some((r: string) => r.includes("feature memory"))).toBe(true)
  })
})
