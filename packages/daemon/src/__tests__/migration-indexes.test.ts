import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { getDb } from "../db/core.js"
import { insertAgentEvent, getEventsByTaskId } from "../db/events.js"
import { createTask, startTask, finishTask } from "../db/tasks.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("007 migration: indexes for agent_events.taskId and tasks.finished_at", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  describe("migration applies successfully", () => {
    it("idx_agent_events_task_id index exists", () => {
      const indexes = getDb()
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_events' AND name = 'idx_agent_events_task_id'`,
        )
        .all() as { name: string }[]
      expect(indexes).toHaveLength(1)
      expect(indexes[0].name).toBe("idx_agent_events_task_id")
    })

    it("idx_tasks_finished_at index exists", () => {
      const indexes = getDb()
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND name = 'idx_tasks_finished_at'`,
        )
        .all() as { name: string }[]
      expect(indexes).toHaveLength(1)
      expect(indexes[0].name).toBe("idx_tasks_finished_at")
    })

    it("migration is recorded in schema_versions", () => {
      const row = getDb()
        .prepare(`SELECT version, filename FROM schema_versions WHERE version = 7`)
        .get() as { version: number; filename: string } | undefined
      expect(row).toBeDefined()
      expect(row!.filename).toMatch(/^007_/)
    })
  })

  describe("getEventsByTaskId uses index", () => {
    it("EXPLAIN QUERY PLAN shows index usage for json_extract taskId filter", () => {
      const plan = getDb()
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM agent_events WHERE json_extract(payload, '$.taskId') = ? ORDER BY timestamp ASC`,
        )
        .all("test-task-id") as { detail: string }[]
      const details = plan.map(r => r.detail).join(" ")
      expect(details).toMatch(/idx_agent_events_task_id/)
    })
  })

  describe("tasks.finished_at queries use index", () => {
    it("EXPLAIN QUERY PLAN shows index usage for finished_at range filter", () => {
      const plan = getDb()
        .prepare(
          `EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE status IN ('done', 'failed') AND finished_at >= ?`,
        )
        .all("2026-01-01T00:00:00.000Z") as { detail: string }[]
      const details = plan.map(r => r.detail).join(" ")
      expect(details).toMatch(/idx_tasks_finished_at/)
    })
  })

  describe("functional correctness after index creation", () => {
    it("getEventsByTaskId still returns correct results", () => {
      insertAgentEvent("task.started", { type: "task.started", taskId: "t1", workerId: "w1" })
      insertAgentEvent("task.completed", { type: "task.completed", taskId: "t1", costUsd: 0.05 })
      insertAgentEvent("task.started", { type: "task.started", taskId: "t2", workerId: "w2" })

      const events = getEventsByTaskId("t1")
      expect(events).toHaveLength(2)
      expect(events.every(e => "taskId" in e && e.taskId === "t1")).toBe(true)
    })

    it("finished_at queries still return correct results", () => {
      const t1 = createTask("A", "desc", "pm")
      const t2 = createTask("B", "desc", "pm")
      startTask(t1.id, "w")
      startTask(t2.id, "w")
      finishTask(t1.id, "done", null)
      finishTask(t2.id, "done", null)

      const rows = getDb()
        .prepare(`SELECT id FROM tasks WHERE status = 'done' AND finished_at IS NOT NULL`)
        .all() as { id: string }[]
      expect(rows).toHaveLength(2)
    })
  })

  describe("idempotency", () => {
    it("re-running migrations does not fail", () => {
      expect(() => {
        closeDb()
        initDb(":memory:", migrationsDir)
      }).not.toThrow()
    })
  })
})
