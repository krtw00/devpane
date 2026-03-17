import { ulid } from "ulid"
import type { ChatMessage } from "@devpane/shared"
import { getDb } from "./core.js"

export function insertChatMessage(role: ChatMessage["role"], message: string, taskId?: string): ChatMessage {
  const id = ulid()
  const now = new Date().toISOString()
  const db = getDb()
  db.prepare(
    `INSERT INTO chat_messages (id, role, message, task_id, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, role, message, taskId ?? null, now)
  return db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as ChatMessage
}

export function getChatMessages(limit = 50, before?: string): ChatMessage[] {
  const db = getDb()
  if (before) {
    return db.prepare(
      `SELECT * FROM chat_messages WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`,
    ).all(before, limit) as ChatMessage[]
  }
  return db.prepare(`SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?`).all(limit) as ChatMessage[]
}
