import { Hono, type Context } from "hono"
import type { MemoryCategory } from "@devpane/shared"
import { createTask, insertChatMessage, getChatMessages } from "../db.js"
import { remember } from "../memory.js"
import { broadcast } from "../ws.js"

const validCategories: MemoryCategory[] = ["decision", "lesson"]

export const chatApi = new Hono()

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw ?? 50)
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return Math.min(Math.floor(parsed), 200)
}

async function handleSendMessage(c: Context) {
  const body = await c.req.json<{ message: string; category?: string }>()
  if (!body.message) {
    return c.json({ error: "message required" }, 400)
  }

  const category = validCategories.includes(body.category as MemoryCategory)
    ? (body.category as MemoryCategory)
    : null

  const task = createTask(
    `[human] ${body.message.slice(0, 80)}`,
    body.message,
    "human",
    100,
  )
  const chatMessage = insertChatMessage("human", body.message, task.id)

  if (category) {
    const memory = remember(category, body.message, task.id)
    broadcast("memory:created", memory)
    console.log(`[chat] saved memory (${category}) id=${memory.id}`)
  }

  broadcast("chat", {
    id: chatMessage.id,
    role: chatMessage.role,
    message: chatMessage.message,
    task_id: chatMessage.task_id,
    created_at: chatMessage.created_at,
    category,
  })

  broadcast("task:created", task)

  console.log(`[chat] human message → task ${task.id} (priority=100)`)
  return c.json(task, 201)
}

chatApi.get("/messages", (c) => {
  const limit = parseLimit(c.req.query("limit"))
  const before = c.req.query("before")
  return c.json(getChatMessages(limit, before))
})

chatApi.post("/messages", handleSendMessage)
chatApi.post("/", handleSendMessage)
