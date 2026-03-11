import { Hono } from "hono"
import { createTask } from "../db.js"
import { broadcast } from "../ws.js"

export const chatApi = new Hono()

chatApi.post("/", async (c) => {
  const body = await c.req.json<{ message: string }>()
  if (!body.message) {
    return c.json({ error: "message required" }, 400)
  }

  const task = createTask(
    `[human] ${body.message.slice(0, 80)}`,
    body.message,
    "human",
    100,
  )

  broadcast("chat", {
    message: body.message,
    task_id: task.id,
    created_at: task.created_at,
  })

  broadcast("task:created", task)

  console.log(`[chat] human message → task ${task.id} (priority=100)`)
  return c.json(task, 201)
})
