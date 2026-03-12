import { Hono } from "hono"
import type { MemoryCategory } from "@devpane/shared"
import { remember, recall, updateMemory, forget, findSimilar } from "../memory.js"

export const memoriesApi = new Hono()

const CATEGORIES: MemoryCategory[] = ["feature", "decision", "lesson"]

memoriesApi.get("/search", (c) => {
  const q = c.req.query("q")
  if (!q) return c.json({ error: "q parameter required" }, 400)
  const results = CATEGORIES.flatMap((cat) => findSimilar(cat, q))
  return c.json(results)
})

memoriesApi.get("/", (c) => {
  const category = c.req.query("category") as MemoryCategory | undefined
  return c.json(recall(category))
})

memoriesApi.post("/", async (c) => {
  const body = await c.req.json<{ category: MemoryCategory; content: string; source_task_id?: string }>()
  if (!body.category || !body.content) {
    return c.json({ error: "category and content required" }, 400)
  }
  const memory = remember(body.category, body.content, body.source_task_id)
  return c.json(memory, 201)
})

memoriesApi.put("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ content: string }>()
  if (!body.content) {
    return c.json({ error: "content required" }, 400)
  }
  updateMemory(id, body.content)
  return c.json({ id, content: body.content })
})

memoriesApi.delete("/:id", (c) => {
  const id = c.req.param("id")
  forget(id)
  return c.json({ id })
})
