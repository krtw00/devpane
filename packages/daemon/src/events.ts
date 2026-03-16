import type { AgentEvent } from "@devpane/shared/schemas"
import { AgentEventSchema } from "@devpane/shared/schemas"
import { insertAgentEvent, getAgentEvents, getEventsByTaskId, getDb } from "./db.js"
import { broadcast } from "./ws.js"
import { getNotifier } from "./notifier-factory.js"

let querySinceStmt: ReturnType<ReturnType<typeof getDb>["prepare"]> | null = null
let querySinceDb: ReturnType<typeof getDb> | null = null

function getQuerySinceStmt() {
  const db = getDb()
  if (!querySinceStmt || querySinceDb !== db) {
    querySinceStmt = db.prepare(`SELECT * FROM agent_events WHERE timestamp > ? ORDER BY timestamp ASC`)
    querySinceDb = db
  }
  return querySinceStmt
}

export function emit(event: AgentEvent): void {
  insertAgentEvent(event.type, event)
  broadcast("event", event)
  getNotifier().notify(event).catch((err) => { console.warn('[notifier] failed:', err) })
}

export function safeEmit(raw: unknown): boolean {
  const result = AgentEventSchema.safeParse(raw)
  if (!result.success) return false
  emit(result.data)
  return true
}

export function queryEventsByType(type: AgentEvent["type"], limit = 50): AgentEvent[] {
  return getAgentEvents({ type, limit })
}

export function queryRecentEvents(limit = 100): AgentEvent[] {
  return getAgentEvents({ limit })
}

export function queryEventsByTaskId(taskId: string, type?: AgentEvent["type"], limit = 100): AgentEvent[] {
  let events = getEventsByTaskId(taskId)
  if (type) events = events.filter(e => e.type === type)
  return events.slice(0, limit)
}

type StoredEvent = { id: string; type: string; payload: string; timestamp: string }

export function queryEventsSince(since: string): AgentEvent[] {
  const rows = getQuerySinceStmt().all(since) as StoredEvent[]
  return rows.map(r => JSON.parse(r.payload) as AgentEvent)
}
