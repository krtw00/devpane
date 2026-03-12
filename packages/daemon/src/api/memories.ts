import { Hono } from "hono"
import type { MemoryCategory } from "@devpane/shared"
import { remember, recall, forget, updateMemory } from "../memory.js"

export const memoriesApi = new Hono()

memoriesApi.get("/", (c) => {
  const category = c.req.query("category") as MemoryCategory | undefined
  const memories = recall(category || undefined)
  return c.json(memories)
})

memoriesApi.get("/:id", (c) => {
  const id = c.req.param("id")
  const all = recall()
  const memory = all.find((m) => m.id === id)
  if (!memory) return c.json({ error: "not found" }, 404)
  return c.json(memory)
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
  const all = recall()
  const memory = all.find((m) => m.id === id)
  if (!memory) return c.json({ error: "not found" }, 404)
  return c.json(memory)
})

memoriesApi.delete("/:id", (c) => {
  forget(c.req.param("id"))
  return c.json({ ok: true })
})
