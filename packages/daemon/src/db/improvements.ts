import type { Improvement, ImprovementStatus } from "@devpane/shared"
import { getDb } from "./core.js"

export function getImprovement(id: string): Improvement | null {
  return getDb().prepare(`SELECT * FROM improvements WHERE id = ?`).get(id) as Improvement | null
}

export function getActiveImprovements(): Improvement[] {
  return getDb().prepare(`SELECT * FROM improvements WHERE status = 'active'`).all() as Improvement[]
}

export function getRecentImprovements(limit = 30): Improvement[] {
  return getDb().prepare(`SELECT * FROM improvements ORDER BY applied_at DESC LIMIT ?`).all(limit) as Improvement[]
}

export function updateImprovementStatus(id: string, status: ImprovementStatus): Improvement | null {
  const db = getDb()
  db.prepare(`UPDATE improvements SET status = ? WHERE id = ?`).run(status, id)
  return getImprovement(id)
}
