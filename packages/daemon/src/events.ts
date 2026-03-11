import { ulid } from "ulid"
import type { AgentEvent } from "@devpane/shared/schemas"
import { AgentEventSchema } from "@devpane/shared/schemas"
import { getDb } from "./db.js"
import { broadcast } from "./ws.js"

let stmt: ReturnType<typeof prepareStmt> | null = null
let stmtDb: ReturnType<typeof getDb> | null = null

function prepareStmt() {
  const db = getDb()
  return {
    insert: db.prepare(`INSERT INTO agent_events (id, type, payload, timestamp) VALUES (?, ?, ?, ?)`),
    queryByType: db.prepare(`SELECT * FROM agent_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?`),
    queryRecent: db.prepare(`SELECT * FROM agent_events ORDER BY timestamp DESC LIMIT ?`),
    querySince: db.prepare(`SELECT * FROM agent_events WHERE timestamp > ? ORDER BY timestamp ASC`),
  }
}

function getStmt() {
  const db = getDb()
  if (!stmt || stmtDb !== db) {
    stmt = prepareStmt()
    stmtDb = db
  }
  return stmt
}

export function emit(event: AgentEvent): void {
  const s = getStmt()
  const id = ulid()
  const now = new Date().toISOString()
  s.insert.run(id, event.type, JSON.stringify(event), now)
  broadcast("event", event)
}

export function safeEmit(raw: unknown): boolean {
  const result = AgentEventSchema.safeParse(raw)
  if (!result.success) return false
  emit(result.data)
  return true
}

type StoredEvent = { id: string; type: string; payload: string; timestamp: string }

function parseEvents(rows: StoredEvent[]): AgentEvent[] {
  return rows.map(r => JSON.parse(r.payload) as AgentEvent)
}

export function queryEventsByType(type: AgentEvent["type"], limit = 50): AgentEvent[] {
  return parseEvents(getStmt().queryByType.all(type, limit) as StoredEvent[])
}

export function queryRecentEvents(limit = 100): AgentEvent[] {
  return parseEvents(getStmt().queryRecent.all(limit) as StoredEvent[])
}

export function queryEventsSince(since: string): AgentEvent[] {
  return parseEvents(getStmt().querySince.all(since) as StoredEvent[])
}
