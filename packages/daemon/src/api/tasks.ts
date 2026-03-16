import { Hono } from "hono"
import { getAllTasks, getTask, getTaskLogs, createTask, revertToPending, getTasksByStatus } from "../db.js"
import { traceTask } from "../pipeline-trace.js"

export const tasksApi = new Hono()

tasksApi.get("/traces", (c) => {
  const limit = 50
  const doneTasks = getTasksByStatus("done")
  const failedTasks = getTasksByStatus("failed")
  const all = [...doneTasks, ...failedTasks]
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))
    .slice(0, limit)
  return c.json(all.map(traceTask))
})

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

tasksApi.post("/:id/retry", (c) => {
  const task = getTask(c.req.param("id"))
  if (!task) return c.json({ error: "not found" }, 404)
  if (task.status !== "failed") return c.json({ error: "only failed tasks can be retried" }, 400)
  revertToPending(task.id)
  return c.json({ ok: true })
})

tasksApi.post("/", async (c) => {
  const body = await c.req.json<{ title: string; description: string; priority?: number }>()
  if (!body.title || !body.description) {
    return c.json({ error: "title and description required" }, 400)
  }
  const task = createTask(body.title, body.description, "human", body.priority ?? 0)
  return c.json(task, 201)
})
