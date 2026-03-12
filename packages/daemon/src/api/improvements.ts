import { Hono } from "hono"
import { getDb } from "../db.js"
import type { Improvement, ImprovementStatus } from "@devpane/shared"

export const improvementsApi = new Hono()

const VALID_STATUSES = new Set<ImprovementStatus>(["active", "reverted", "permanent"])

improvementsApi.get("/", (c) => {
  const status = c.req.query("status") as ImprovementStatus | undefined
  const d = getDb()

  if (status) {
    if (!VALID_STATUSES.has(status)) {
      return c.json({ error: "invalid status" }, 400)
    }
    const rows = d
      .prepare("SELECT * FROM improvements WHERE status = ? ORDER BY applied_at DESC")
      .all(status) as Improvement[]
    return c.json(rows)
  }

  const rows = d
    .prepare("SELECT * FROM improvements ORDER BY applied_at DESC")
    .all() as Improvement[]
  return c.json(rows)
})

improvementsApi.get("/:id", (c) => {
  const d = getDb()
  const row = d
    .prepare("SELECT * FROM improvements WHERE id = ?")
    .get(c.req.param("id")) as Improvement | undefined
  if (!row) return c.json({ error: "not found" }, 404)
  return c.json(row)
})
