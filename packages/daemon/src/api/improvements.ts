import { Hono } from "hono"
import { getDb } from "../db.js"
import type { Improvement } from "@devpane/shared"

export const improvementsApi = new Hono()

// GET /improvements — 全改善レコード一覧
improvementsApi.get("/", (c) => {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM improvements ORDER BY applied_at DESC").all() as Improvement[]
  return c.json(rows)
})
