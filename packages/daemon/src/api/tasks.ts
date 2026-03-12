import { Hono } from "hono"
import { getAllTasks, getTask, getTaskLogs, createTask, finishTask, requeueTask, appendLog } from "../db.js"
import { killWorkerByTaskId } from "../worker.js"
import { broadcast } from "../ws.js"
import type { CancelResponse, RetryResponse } from "@devpane/shared"

export const tasksApi = new Hono()

tasksApi.get("/", (c) => {
  const tasks = getAllTasks()
  return c.json(tasks)
})

tasksApi.get("/:id", (c) => {
  const task = getTask(c.req.param("id"))
  if (!task) return c.json({ error: "not found" }, 404)
  return c.json(task)
})

tasksApi.get("/:id/logs", (c) => {
  const logs = getTaskLogs(c.req.param("id"))
  return c.json(logs)
})

tasksApi.post("/", async (c) => {
  const body = await c.req.json<{ title: string; description: string; priority?: number }>()
  if (!body.title || !body.description) {
    return c.json({ error: "title and description required" }, 400)
  }
  const task = createTask(body.title, body.description, "human", body.priority ?? 0)
  return c.json(task, 201)
})

tasksApi.post("/:id/cancel", (c) => {
  const id = c.req.param("id")
  const task = getTask(id)
  if (!task) return c.json({ error: "not found" }, 404)
  if (task.status !== "running") {
    return c.json({ error: "task is not running" }, 409)
  }

  killWorkerByTaskId(id)
  finishTask(id, "failed", JSON.stringify({ exit_code: 1, cancelled: true }))
  appendLog(id, "system", "[cancel] cancelled by user")
  broadcast("task:updated", { id, status: "failed" })

  return c.json({ id, status: "failed", message: "task cancelled" } satisfies CancelResponse)
})

tasksApi.post("/:id/retry", (c) => {
  const id = c.req.param("id")
  const task = getTask(id)
  if (!task) return c.json({ error: "not found" }, 404)
  if (task.status !== "failed") {
    return c.json({ error: "task is not failed" }, 409)
  }

  requeueTask(id)
  appendLog(id, "system", "[retry] retried by user")
  broadcast("task:updated", { id, status: "pending" })

  return c.json({ id, status: "pending", message: "task requeued" } satisfies RetryResponse)
})
