import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

/**
 * マージコンフリクト解消の検証テスト
 *
 * db.ts が両ブランチの変更（Improvement系 + AgentEvent系）を
 * 正しく統合してexportしていることを確認する。
 */
describe("db.ts merge integration", () => {
  beforeEach(async () => {
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  describe("export completeness", () => {
    it("exports core db functions", async () => {
      const db = await import("../db.js")
      expect(typeof db.getDb).toBe("function")
      expect(typeof db.initDb).toBe("function")
      expect(typeof db.closeDb).toBe("function")
    })

    it("exports task functions including getTasksSince", async () => {
      const db = await import("../db.js")
      expect(typeof db.createTask).toBe("function")
      expect(typeof db.getNextPending).toBe("function")
      expect(typeof db.getTask).toBe("function")
      expect(typeof db.getAllTasks).toBe("function")
      expect(typeof db.getTasksByStatus).toBe("function")
      expect(typeof db.getRecentDone).toBe("function")
      expect(typeof db.getAllDoneTitles).toBe("function")
      expect(typeof db.getFailedTasks).toBe("function")
      expect(typeof db.startTask).toBe("function")
      expect(typeof db.finishTask).toBe("function")
      expect(typeof db.revertToPending).toBe("function")
      expect(typeof db.requeueTask).toBe("function")
      expect(typeof db.getRetryCount).toBe("function")
      expect(typeof db.updateTaskCost).toBe("function")
      expect(typeof db.appendLog).toBe("function")
      expect(typeof db.getTaskLogs).toBe("function")
      expect(typeof db.getTasksSince).toBe("function")
    })

    it("exports AgentEvent functions (insertAgentEvent, getAgentEvents)", async () => {
      const db = await import("../db.js")
      expect(typeof db.insertAgentEvent).toBe("function")
      expect(typeof db.getAgentEvents).toBe("function")
    })

    it("exports Improvement functions (getActiveImprovements)", async () => {
      const db = await import("../db.js")
      expect(typeof db.getActiveImprovements).toBe("function")
    })

    it("exports stats functions", async () => {
      const db = await import("../db.js")
      expect(typeof db.getPipelineStats).toBe("function")
      expect(typeof db.getCostStats).toBe("function")
    })
  })

  describe("getActiveImprovements works with live db", () => {
    it("returns empty array when no improvements exist", async () => {
      const { getActiveImprovements } = await import("../db.js")
      const result = getActiveImprovements()
      expect(result).toEqual([])
    })

    it("returns only active improvements", async () => {
      const { getActiveImprovements, getDb } = await import("../db.js")
      const db = getDb()
      db.prepare(
        `INSERT INTO improvements (id, trigger_analysis, target, action, applied_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("imp-1", "{}", "gate1", "add_check", new Date().toISOString(), "active")
      db.prepare(
        `INSERT INTO improvements (id, trigger_analysis, target, action, applied_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("imp-2", "{}", "gate1", "add_check", new Date().toISOString(), "reverted")

      const active = getActiveImprovements()
      expect(active).toHaveLength(1)
      expect(active[0].id).toBe("imp-1")
    })
  })

  describe("insertAgentEvent / getAgentEvents works with live db", () => {
    it("round-trips an agent event", async () => {
      const { insertAgentEvent, getAgentEvents } = await import("../db.js")
      insertAgentEvent("task.started", { type: "task.started", taskId: "t1", workerId: "w1" })

      const events = getAgentEvents()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe("task.started")
    })
  })

  describe("getTasksSince works with live db", () => {
    it("returns tasks finished after the given timestamp", async () => {
      const { createTask, startTask, getDb, getTasksSince } = await import("../db.js")
      const db = getDb()

      const t1 = createTask("old", "desc", "pm")
      startTask(t1.id, "w")
      db.prepare(`UPDATE tasks SET status = 'done', finished_at = ? WHERE id = ?`).run("2024-01-01T00:00:00.000Z", t1.id)

      const t2 = createTask("new", "desc", "pm")
      startTask(t2.id, "w")
      db.prepare(`UPDATE tasks SET status = 'done', finished_at = ? WHERE id = ?`).run("2024-06-01T00:00:00.000Z", t2.id)

      const since = getTasksSince("2024-03-01T00:00:00.000Z")
      expect(since).toHaveLength(1)
      expect(since[0].title).toBe("new")
    })
  })

  describe("both Improvement and AgentEvent types coexist", () => {
    it("can use both subsystems in the same db session", async () => {
      const { getActiveImprovements, insertAgentEvent, getAgentEvents, getDb } = await import("../db.js")

      const db = getDb()
      db.prepare(
        `INSERT INTO improvements (id, trigger_analysis, target, action, applied_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("imp-coexist", "{}", "gate1", "add_check", new Date().toISOString(), "active")

      insertAgentEvent("task.started", { type: "task.started", taskId: "t1", workerId: "w1" })

      expect(getActiveImprovements()).toHaveLength(1)
      expect(getAgentEvents()).toHaveLength(1)
    })
  })
})
