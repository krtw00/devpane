import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { createTask } from "../db.js"
import { runGate1, emitGate1Events, filterApproved } from "../gate1.js"
import type { PmTask } from "@devpane/shared/schemas"
import type { Memory } from "@devpane/shared"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function makeTask(overrides: Partial<PmTask> = {}): PmTask {
  return {
    title: "Add user authentication",
    description: "Implement JWT-based authentication with login/logout endpoints and middleware for route protection",
    priority: 50,
    ...overrides,
  }
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    category: "lesson",
    content: "GUI実装は不要",
    source_task_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("Gate 1", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("passes valid task", () => {
    const results = runGate1([makeTask()], [], "")
    expect(results).toHaveLength(1)
    expect(results[0].verdict).toBe("go")
    expect(results[0].reasons).toHaveLength(0)
  })

  it("kills duplicate title (pending)", () => {
    createTask("Add user authentication", "existing task description for testing", "pm", 50)
    const results = runGate1([makeTask()], [], "")
    expect(results[0].verdict).toBe("kill")
    expect(results[0].reasons[0]).toContain("duplicate title")
  })

  it("kills duplicate title case-insensitive", () => {
    createTask("add user authentication", "existing task description for testing", "pm", 50)
    const results = runGate1([makeTask({ title: "Add User Authentication" })], [], "")
    expect(results[0].verdict).toBe("kill")
  })

  it("kills task matching blocked lesson", () => {
    const memories = [makeMemory({ content: "GUI実装は不要" })]
    const results = runGate1([makeTask({ title: "GUI実装は不要" })], memories, "")
    expect(results[0].verdict).toBe("kill")
    expect(results[0].reasons[0]).toContain("policy violation")
  })

  it("ignores non-lesson memories", () => {
    const memories = [makeMemory({ category: "decision", content: "GUI実装は不要" })]
    const results = runGate1([makeTask({ title: "GUI実装は不要" })], memories, "")
    expect(results[0].verdict).toBe("go")
  })

  it("ignores lessons without 不要/禁止", () => {
    const memories = [makeMemory({ content: "SQLiteのWALモードを使う" })]
    const results = runGate1([makeTask({ title: "SQLiteのWALモードを使う" })], memories, "")
    expect(results[0].verdict).toBe("go")
  })

  it("recycles task with short description", () => {
    const results = runGate1([makeTask({ description: "too short" })], [], "")
    expect(results[0].verdict).toBe("recycle")
    expect(results[0].reasons[0]).toContain("description too short")
  })

  it("recycles task with empty description", () => {
    const results = runGate1([makeTask({ description: "" })], [], "")
    expect(results[0].verdict).toBe("recycle")
  })

  it("recycles task with priority 0", () => {
    const results = runGate1([makeTask({ priority: 0 })], [], "")
    expect(results[0].verdict).toBe("recycle")
    expect(results[0].reasons[0]).toContain("priority out of range")
  })

  it("recycles task with priority > 100", () => {
    const results = runGate1([makeTask({ priority: 101 })], [], "")
    expect(results[0].verdict).toBe("recycle")
  })

  it("accepts priority 1 and 100", () => {
    const r1 = runGate1([makeTask({ priority: 1 })], [], "")
    const r100 = runGate1([makeTask({ priority: 100 })], [], "")
    expect(r1[0].verdict).toBe("go")
    expect(r100[0].verdict).toBe("go")
  })

  it("kill takes precedence over recycle", () => {
    createTask("Add user authentication", "existing task description for testing", "pm", 50)
    const results = runGate1([makeTask({ description: "short" })], [], "")
    expect(results[0].verdict).toBe("kill")
    expect(results[0].reasons).toHaveLength(2)
  })

  it("handles multiple tasks", () => {
    const tasks = [
      makeTask({ title: "Task A" }),
      makeTask({ title: "Task B", description: "short" }),
      makeTask({ title: "Task C", priority: 0 }),
    ]
    const results = runGate1(tasks, [], "")
    expect(results[0].verdict).toBe("go")
    expect(results[1].verdict).toBe("recycle")
    expect(results[2].verdict).toBe("recycle")
  })

  it("filterApproved returns only go tasks", () => {
    createTask("Task B", "existing task description for filtering test", "pm", 50)
    const tasks = [
      makeTask({ title: "Task A" }),
      makeTask({ title: "Task B" }),
    ]
    const results = runGate1(tasks, [], "")
    const approved = filterApproved(results)
    expect(approved).toHaveLength(1)
    expect(approved[0].title).toBe("Task A")
  })

  it("emitGate1Events does not throw", () => {
    const results = runGate1([makeTask(), makeTask({ description: "x" })], [], "")
    expect(() => emitGate1Events(results)).not.toThrow()
  })
})
