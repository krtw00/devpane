import { Hono } from "hono"
import { getDb } from "../db.js"
import type { Improvement, ImprovementStatus } from "@devpane/shared"

export const improvementsApi = new Hono()

// GET /improvements — 全件取得（statusフィルタ対応）
improvementsApi.get("/", (c) => {
  const status = c.req.query("status") as ImprovementStatus | undefined
  const d = getDb()
  const rows = status
    ? (d.prepare("SELECT * FROM improvements WHERE status = ? ORDER BY applied_at DESC").all(status) as Improvement[])
    : (d.prepare("SELECT * FROM improvements ORDER BY applied_at DESC").all() as Improvement[])
  return c.json(rows)
})

// POST /improvements/:id/revert — 手動撤回
improvementsApi.post("/:id/revert", (c) => {
  const { id } = c.req.param()
  const d = getDb()
  const row = d.prepare("SELECT * FROM improvements WHERE id = ?").get(id) as Improvement | undefined
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status === "reverted") return c.json({ error: "already reverted" }, 400)

  d.prepare("UPDATE improvements SET status = 'reverted', verdict = 'harmful' WHERE id = ?").run(id)
  const updated = d.prepare("SELECT * FROM improvements WHERE id = ?").get(id) as Improvement
  return c.json(updated)
})
