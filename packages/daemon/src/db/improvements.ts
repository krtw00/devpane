import type { Improvement } from "@devpane/shared"
import { getDb } from "./core.js"

export function getActiveImprovements(): Improvement[] {
  return getDb().prepare(`SELECT * FROM improvements WHERE status = 'active'`).all() as Improvement[]
}
