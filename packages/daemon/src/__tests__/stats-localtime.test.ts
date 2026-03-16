import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { getPipelineStats, getCostStats } from "../db/stats.js"
import { getDb } from "../db/core.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

/**
 * Insert a task directly with a specific finished_at timestamp.
 * Uses raw SQL to bypass Date.now() in helper functions.
 */
function insertDoneTask(id: string, finishedAt: string, costUsd?: number): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, created_by, created_at, started_at, finished_at, cost_usd)
     VALUES (?, ?, ?, 'done', 0, 'test', ?, ?, ?, ?)`,
  ).run(id, `task-${id}`, "desc", finishedAt, finishedAt, finishedAt, costUsd ?? null)
}

describe("stats localtime: tasks_today uses local timezone", () => {
  const originalTZ = process.env.TZ

  beforeEach(() => {
    process.env.TZ = "Asia/Tokyo"
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
    if (originalTZ === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTZ
    }
  })

  it("counts tasks finished in JST today (UTC 0:00-8:59 range) as today", () => {
    // Simulate: JST 2026-03-17 10:00 = UTC 2026-03-17 01:00
    vi.useFakeTimers({ now: new Date("2026-03-17T01:00:00.000Z") })

    // Task finished at JST 2026-03-17 09:30 (= UTC 2026-03-17 00:30)
    // This is today in JST. Without fix, date('now') = '2026-03-17' in UTC
    // so this would be counted — but only by coincidence.
    insertDoneTask("t1", "2026-03-17T00:30:00.000Z")

    // Task finished at JST 2026-03-17 02:00 (= UTC 2026-03-16 17:00)
    // This IS today in JST but is "yesterday" in UTC.
    // BUG: date('now') = '2026-03-17' → '2026-03-16T17:00:00.000Z' < '2026-03-17' → NOT counted
    insertDoneTask("t2", "2026-03-16T17:00:00.000Z")

    const stats = getPipelineStats()
    // Both tasks should be counted as today in JST
    expect(stats.tasks_today).toBe(2)
  })

  it("excludes tasks finished yesterday JST even if same UTC date", () => {
    // Simulate: JST 2026-03-17 03:00 = UTC 2026-03-16 18:00
    vi.useFakeTimers({ now: new Date("2026-03-16T18:00:00.000Z") })

    // Task finished at JST 2026-03-16 23:00 (= UTC 2026-03-16 14:00)
    // This is YESTERDAY in JST.
    // BUG: date('now') = '2026-03-16' → '2026-03-16T14:00:00.000Z' >= '2026-03-16' → counted as today
    insertDoneTask("t-yesterday", "2026-03-16T14:00:00.000Z")

    // Task finished at JST 2026-03-17 01:00 (= UTC 2026-03-16 16:00)
    // This IS today in JST.
    insertDoneTask("t-today", "2026-03-16T16:00:00.000Z")

    const stats = getPipelineStats()
    // Only the JST-today task should be counted
    expect(stats.tasks_today).toBe(1)
  })

  it("handles midnight boundary correctly in JST", () => {
    // Simulate: JST 2026-03-17 00:05 = UTC 2026-03-16 15:05
    vi.useFakeTimers({ now: new Date("2026-03-16T15:05:00.000Z") })

    // Task finished at JST 2026-03-17 00:01 (= UTC 2026-03-16 15:01) → today
    insertDoneTask("t-just-after-midnight", "2026-03-16T15:01:00.000Z")

    // Task finished at JST 2026-03-16 23:59 (= UTC 2026-03-16 14:59) → yesterday
    insertDoneTask("t-just-before-midnight", "2026-03-16T14:59:00.000Z")

    const stats = getPipelineStats()
    expect(stats.tasks_today).toBe(1)
  })
})

describe("stats localtime: getCostStats uses local timezone", () => {
  const originalTZ = process.env.TZ

  beforeEach(() => {
    process.env.TZ = "Asia/Tokyo"
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    vi.useRealTimers()
    if (originalTZ === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTZ
    }
  })

  it("groups daily costs by local date, not UTC date", () => {
    // Simulate: JST 2026-03-17 03:00 = UTC 2026-03-16 18:00
    vi.useFakeTimers({ now: new Date("2026-03-16T18:00:00.000Z") })

    // Task at JST 2026-03-17 01:00 (= UTC 2026-03-16 16:00) → should be grouped as 2026-03-17
    insertDoneTask("c1", "2026-03-16T16:00:00.000Z", 1.5)

    // Task at JST 2026-03-16 23:00 (= UTC 2026-03-16 14:00) → should be grouped as 2026-03-16
    insertDoneTask("c2", "2026-03-16T14:00:00.000Z", 2.0)

    const costStats = getCostStats()

    // BUG: Without localtime fix, both tasks are grouped under UTC date 2026-03-16
    // EXPECTED: Two separate daily entries for 2026-03-16 and 2026-03-17
    expect(costStats.daily).toHaveLength(2)

    const dates = costStats.daily.map((d) => d.date)
    expect(dates).toContain("2026-03-16")
    expect(dates).toContain("2026-03-17")
  })
})
