import { Hono } from "hono"
import type { MemoryCategory } from "@devpane/shared"
import { createTask } from "../db.js"
import { remember } from "../memory.js"
import { broadcast } from "../ws.js"

const validCategories: MemoryCategory[] = ["decision", "lesson"]

export const chatApi = new Hono()

chatApi.post("/", async (c) => {
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

  if (category) {
    const memory = remember(category, body.message, task.id)
    broadcast("memory:created", memory)
    console.log(`[chat] saved memory (${category}) id=${memory.id}`)
  }

  broadcast("chat", {
    message: body.message,
    task_id: task.id,
    created_at: task.created_at,
    category,
  })

  broadcast("task:created", task)

  console.log(`[chat] human message → task ${task.id} (priority=100)`)
  return c.json(task, 201)
})
