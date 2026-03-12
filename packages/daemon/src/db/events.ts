import { ulid } from "ulid"
import type { AgentEvent } from "@devpane/shared/schemas"
import { getDb } from "./core.js"

type StoredAgentEvent = { id: string; type: string; payload: string; timestamp: string }

export function insertAgentEvent(type: AgentEvent["type"], payload: AgentEvent): void {
  const id = ulid()
  const now = new Date().toISOString()
  getDb().prepare(`INSERT INTO agent_events (id, type, payload, timestamp) VALUES (?, ?, ?, ?)`).run(id, type, JSON.stringify(payload), now)
}

export function getAgentEvents(opts: { type?: AgentEvent["type"]; limit?: number } = {}): AgentEvent[] {
  const limit = opts.limit ?? 100
  const db = getDb()
  const rows = opts.type
    ? db.prepare(`SELECT * FROM agent_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?`).all(opts.type, limit) as StoredAgentEvent[]
    : db.prepare(`SELECT * FROM agent_events ORDER BY timestamp DESC LIMIT ?`).all(limit) as StoredAgentEvent[]
  return rows.map(r => JSON.parse(r.payload) as AgentEvent)
}
