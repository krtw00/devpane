import type { AgentEvent } from "@devpane/shared/schemas"
import { AgentEventSchema } from "@devpane/shared/schemas"
import { insertAgentEvent, getAgentEvents, getEventsByTaskId } from "./db.js"
import { broadcast } from "./ws.js"
import { getNotifier } from "./notifier-factory.js"

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
