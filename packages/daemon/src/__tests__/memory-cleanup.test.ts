import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb } from "../db.js"
import { remember, recall } from "../memory.js"
import { cleanupOldLessons } from "../memory.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function setMemoryCreatedAt(id: string, daysAgo: number): void {
  const db = getDb()
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  const iso = date.toISOString()
  db.prepare(`UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?`).run(iso, iso, id)
}

describe("cleanupOldLessons", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("archives lessons older than 30 days", () => {
    const old = remember("lesson", "古い教訓")
    setMemoryCreatedAt(old.id, 31)

    const archived = cleanupOldLessons()
    expect(archived).toBe(1)

    const db = getDb()
    const row = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(old.id) as { category: string }
    expect(row.category).toBe("lesson_archived")
  })

  it("does not archive lessons within 30 days", () => {
    const recent = remember("lesson", "最近の教訓")
    setMemoryCreatedAt(recent.id, 29)

    const archived = cleanupOldLessons()
    expect(archived).toBe(0)

    const db = getDb()
    const row = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(recent.id) as { category: string }
    expect(row.category).toBe("lesson")
  })

  it("does not affect feature memories regardless of age", () => {
    const feature = remember("feature", "重要な機能")
    setMemoryCreatedAt(feature.id, 60)

    const archived = cleanupOldLessons()
    expect(archived).toBe(0)

    const db = getDb()
    const row = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(feature.id) as { category: string }
    expect(row.category).toBe("feature")
  })

  it("does not affect decision memories regardless of age", () => {
    const decision = remember("decision", "アーキテクチャ判断")
    setMemoryCreatedAt(decision.id, 90)

    const archived = cleanupOldLessons()
    expect(archived).toBe(0)

    const db = getDb()
    const row = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(decision.id) as { category: string }
    expect(row.category).toBe("decision")
  })

  it("respects custom maxAgeDays parameter", () => {
    const m1 = remember("lesson", "教訓1")
    const m2 = remember("lesson", "教訓2")
    setMemoryCreatedAt(m1.id, 8)
    setMemoryCreatedAt(m2.id, 3)

    const archived = cleanupOldLessons(7)
    expect(archived).toBe(1)

    const db = getDb()
    const r1 = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(m1.id) as { category: string }
    const r2 = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(m2.id) as { category: string }
    expect(r1.category).toBe("lesson_archived")
    expect(r2.category).toBe("lesson")
  })

  it("archives multiple old lessons at once", () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const m = remember("lesson", `古い教訓${i}`)
      setMemoryCreatedAt(m.id, 40 + i)
      ids.push(m.id)
    }
    const recent = remember("lesson", "新しい教訓")
    setMemoryCreatedAt(recent.id, 5)

    const archived = cleanupOldLessons()
    expect(archived).toBe(5)

    const db = getDb()
    for (const id of ids) {
      const row = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(id) as { category: string }
      expect(row.category).toBe("lesson_archived")
    }
    const recentRow = db.prepare(`SELECT category FROM memories WHERE id = ?`).get(recent.id) as { category: string }
    expect(recentRow.category).toBe("lesson")
  })
})

describe("recall excludes lesson_archived for PM", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("recall() without category excludes lesson_archived", () => {
    remember("feature", "機能A")
    remember("decision", "判断B")
    const old = remember("lesson", "古い教訓")
    setMemoryCreatedAt(old.id, 31)
    cleanupOldLessons()

    const memories = recall()
    expect(memories.every(m => m.category !== "lesson_archived")).toBe(true)
    expect(memories).toHaveLength(2)
  })

  it("recall('lesson') does not return archived lessons", () => {
    remember("lesson", "新しい教訓")
    const old = remember("lesson", "古い教訓")
    setMemoryCreatedAt(old.id, 31)
    cleanupOldLessons()

    const lessons = recall("lesson")
    expect(lessons).toHaveLength(1)
    expect(lessons[0].content).toBe("新しい教訓")
  })
})
