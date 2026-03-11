import { Hono } from "hono"
import { getDb } from "../db.js"
import { queryEventsByType } from "../events.js"
import type { SpcMetric } from "@devpane/shared"

export const spcApi = new Hono()

// GET / — メトリクス一覧（metric種別filterとlimitクエリパラメータ対応）
spcApi.get("/", (c) => {
  const metric = c.req.query("metric")
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500)
  const db = getDb()

  let rows: SpcMetric[]
  if (metric) {
    rows = db
      .prepare("SELECT * FROM spc_metrics WHERE metric = ? ORDER BY recorded_at DESC LIMIT ?")
      .all(metric, limit) as SpcMetric[]
  } else {
    rows = db
      .prepare("SELECT * FROM spc_metrics ORDER BY recorded_at DESC LIMIT ?")
      .all(limit) as SpcMetric[]
  }

  return c.json(rows)
})

// GET /alerts — 直近のSPCアラート一覧
spcApi.get("/alerts", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500)
  const alerts = queryEventsByType("spc.alert", limit)
  return c.json(alerts)
})
