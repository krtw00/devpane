import { ulid } from "ulid"
import type { Memory, MemoryCategory } from "@devpane/shared"
import { getDb } from "./db.js"

let stmts: ReturnType<typeof prepare> | null = null
let stmtsDb: ReturnType<typeof getDb> | null = null

function prepare() {
  const db = getDb()
  return {
    remember: db.prepare(`
      INSERT INTO memories (id, category, content, source_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    recall: db.prepare(`SELECT * FROM memories WHERE category != 'lesson_archived' ORDER BY updated_at DESC`),
    recallByCategory: db.prepare(`SELECT * FROM memories WHERE category = ? ORDER BY updated_at DESC`),
    archiveOldLessons: db.prepare(`
      UPDATE memories SET category = 'lesson_archived', updated_at = ?
      WHERE category = 'lesson' AND created_at <= ?
    `),
    forget: db.prepare(`DELETE FROM memories WHERE id = ?`),
    update: db.prepare(`UPDATE memories SET content = ?, updated_at = ? WHERE id = ?`),
    findByContent: db.prepare(`SELECT * FROM memories WHERE category = ? AND content LIKE ?`),
  }
}

function getStmts() {
  const db = getDb()
  if (!stmts || stmtsDb !== db) {
    stmts = prepare()
    stmtsDb = db
  }
  return stmts
}

export function remember(category: MemoryCategory, content: string, sourceTaskId?: string): Memory {
  const s = getStmts()
  const id = ulid()
  const now = new Date().toISOString()
  s.remember.run(id, category, content, sourceTaskId ?? null, now, now)
  return { id, category, content, source_task_id: sourceTaskId ?? null, created_at: now, updated_at: now }
}

export function recall(category?: MemoryCategory): Memory[] {
  const s = getStmts()
  if (category) {
    return s.recallByCategory.all(category) as Memory[]
  }
  return s.recall.all() as Memory[]
}

export function forget(id: string): void {
  getStmts().forget.run(id)
}

export function updateMemory(id: string, content: string): void {
  const now = new Date().toISOString()
  getStmts().update.run(content, now, id)
}

export function findSimilar(category: MemoryCategory, keyword: string): Memory[] {
  return getStmts().findByContent.all(category, `%${keyword}%`) as Memory[]
}

export function cleanupOldLessons(maxAgeDays: number = 30): number {
  const s = getStmts()
  const now = new Date()
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)
  const result = s.archiveOldLessons.run(now.toISOString(), cutoff.toISOString())
  return result.changes
}
