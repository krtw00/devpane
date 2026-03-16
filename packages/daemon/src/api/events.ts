import { Hono } from "hono"
import { queryRecentEvents, queryEventsByType, queryEventsByTaskId } from "../events.js"
import type { AgentEvent } from "@devpane/shared/schemas"

export const eventsApi = new Hono()

// GET /events — 直近のイベント一覧
eventsApi.get("/", (c) => {
  const raw = Number(c.req.query("limit") ?? 100)
  const limit = Math.min(Number.isFinite(raw) ? raw : 100, 500)
  const type = c.req.query("type") as AgentEvent["type"] | undefined
  const taskId = c.req.query("taskId")

  if (taskId) {
    return c.json(queryEventsByTaskId(taskId, type, limit))
  }

  const events = type ? queryEventsByType(type, limit) : queryRecentEvents(limit)
  return c.json(events)
})
