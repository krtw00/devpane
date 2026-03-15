import type { Improvement } from "@devpane/shared"
import { getDb } from "./core.js"

export function getActiveImprovements(): Improvement[] {
  return getDb().prepare(`SELECT * FROM improvements WHERE status = 'active'`).all() as Improvement[]
}

export function getRecentImprovements(limit = 30): Improvement[] {
  return getDb().prepare(`SELECT * FROM improvements ORDER BY applied_at DESC LIMIT ?`).all(limit) as Improvement[]
}
