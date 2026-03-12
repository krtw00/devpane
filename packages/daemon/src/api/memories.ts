import { Hono } from "hono"
import type { MemoryCategory } from "@devpane/shared"
import { remember, recall, forget } from "../memory.js"

export const memoriesApi = new Hono()

memoriesApi.get("/", (c) => {
  const category = c.req.query("category") as MemoryCategory | undefined
  const memories = recall(category)
  return c.json(memories)
})

memoriesApi.post("/", async (c) => {
  const body = await c.req.json<{ category: MemoryCategory; content: string }>()
  if (!body.category || !body.content) {
    return c.json({ error: "category and content required" }, 400)
  }
  const memory = remember(body.category, body.content)
  return c.json(memory, 201)
})

memoriesApi.delete("/:id", (c) => {
  forget(c.req.param("id"))
  return c.json({ ok: true })
})
