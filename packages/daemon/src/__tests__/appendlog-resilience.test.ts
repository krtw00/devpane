import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db/core.js"
import { appendLog, getTaskLogs, createTask } from "../db/tasks.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("appendLog resilience", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    vi.restoreAllMocks()
  })

  it("does not throw when getDb().prepare() throws", async () => {
    const { getDb } = await import("../db/core.js")
    const origPrepare = getDb().prepare.bind(getDb())
    vi.spyOn(getDb(), "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO task_logs")) {
        throw new Error("SQLITE_BUSY: database is locked")
      }
      return origPrepare(sql)
    })

    expect(() => appendLog("task-1", "worker-0", "test message")).not.toThrow()
  })

  it("emits console.warn when DB insert fails", async () => {
    const { getDb } = await import("../db/core.js")
    const origPrepare = getDb().prepare.bind(getDb())
    vi.spyOn(getDb(), "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO task_logs")) {
        throw new Error("SQLITE_FULL: disk full")
      }
      return origPrepare(sql)
    })

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    appendLog("task-1", "worker-0", "test message")

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain("[appendLog]")
    expect(warnSpy.mock.calls[0][0]).toContain("task-1")
  })

  it("inserts log normally when DB is healthy", () => {
    const task = createTask("Test", "desc", "pm")
    appendLog(task.id, "worker-0", "hello")
    appendLog(task.id, "worker-0", "world")

    const logs = getTaskLogs(task.id)
    expect(logs).toHaveLength(2)
    expect(logs[0].message).toBe("hello")
    expect(logs[1].message).toBe("world")
  })
})
