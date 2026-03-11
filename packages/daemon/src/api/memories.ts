import { Hono } from "hono"
import type { MemoryCategory } from "@devpane/shared"
import { recall, forget, updateMemory } from "../memory.js"

export const memoriesApi = new Hono()

memoriesApi.get("/", (c) => {
  const category = c.req.query("category") as MemoryCategory | undefined
  const memories = recall(category || undefined)
  return c.json(memories)
})

memoriesApi.put("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ content: string }>()
  if (!body.content) {
    return c.json({ error: "content required" }, 400)
  }
  updateMemory(id, body.content)
  return c.json({ ok: true })
})

memoriesApi.delete("/:id", (c) => {
  const id = c.req.param("id")
  forget(id)
  return c.json({ ok: true })
})
