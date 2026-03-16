import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { getPipelineStats } from "../db/stats.js"
import { getDb } from "../db/core.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function insertTask(id: string, status: string, finishedAt: string): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, created_by, created_at, started_at, finished_at)
     VALUES (?, ?, ?, ?, 0, 'test', ?, ?, ?)`,
  ).run(id, `task-${id}`, "desc", status, finishedAt, finishedAt, finishedAt)
}

describe("stats: tasks_today counts both done and failed", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-17T06:00:00.000Z") })
    process.env.TZ = "UTC"
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
    delete process.env.TZ
  })

  it("counts done tasks in tasks_today", () => {
    insertTask("d1", "done", "2026-03-17T03:00:00.000Z")
    insertTask("d2", "done", "2026-03-17T04:00:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(2)
  })

  it("counts failed tasks in tasks_today", () => {
    insertTask("f1", "failed", "2026-03-17T03:00:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(1)
  })

  it("counts mixed done and failed tasks in tasks_today", () => {
    insertTask("d1", "done", "2026-03-17T02:00:00.000Z")
    insertTask("f1", "failed", "2026-03-17T03:00:00.000Z")
    insertTask("d2", "done", "2026-03-17T04:00:00.000Z")
    insertTask("f2", "failed", "2026-03-17T05:00:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(4)
  })

  it("returns tasks_today_done and tasks_today_failed separately", () => {
    insertTask("d1", "done", "2026-03-17T02:00:00.000Z")
    insertTask("d2", "done", "2026-03-17T03:00:00.000Z")
    insertTask("f1", "failed", "2026-03-17T04:00:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today_done).toBe(2)
    expect(stats.tasks_today_failed).toBe(1)
    expect(stats.tasks_today).toBe(3)
  })

  it("excludes running/queued tasks from tasks_today", () => {
    insertTask("d1", "done", "2026-03-17T02:00:00.000Z")
    insertTask("r1", "running", "2026-03-17T03:00:00.000Z")
    insertTask("q1", "queued", "2026-03-17T04:00:00.000Z")
    insertTask("f1", "failed", "2026-03-17T05:00:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(2)
  })

  it("excludes yesterday's tasks", () => {
    insertTask("old", "done", "2026-03-16T23:00:00.000Z")
    insertTask("old-f", "failed", "2026-03-16T22:00:00.000Z")
    insertTask("today", "done", "2026-03-17T01:00:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(1)
  })

  it("returns zero counts when no tasks exist", () => {
    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(0)
    expect(stats.tasks_today_done).toBe(0)
    expect(stats.tasks_today_failed).toBe(0)
  })
})
