import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { initDb, closeDb, getDb } from "../db.js"
import { chatApi } from "../api/chat.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function buildApp() {
  const app = new Hono()
  app.route("/chat", chatApi)
  return app
}

type CreatedTask = { id: string }
type StoredChatMessage = {
  id: string
  role: "human" | "system"
  message: string
  task_id: string | null
  created_at: string
}

describe("chat messages API", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
  })

  afterEach(() => {
    closeDb()
  })

  it("POST /chat/messages persists message and GET /chat/messages returns it", async () => {
    const postRes = await app.request("/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello chat persistence" }),
    })
    expect(postRes.status).toBe(201)
    const task = await postRes.json() as CreatedTask

    const stored = getDb()
      .prepare(`SELECT * FROM chat_messages WHERE task_id = ?`)
      .get(task.id) as StoredChatMessage | undefined
    expect(stored).toBeDefined()
    expect(stored?.role).toBe("human")
    expect(stored?.message).toBe("hello chat persistence")
    expect(stored?.task_id).toBe(task.id)

    const getRes = await app.request("/chat/messages?limit=10")
    expect(getRes.status).toBe(200)
    const messages = await getRes.json() as StoredChatMessage[]
    expect(messages.some((m) => m.id === stored?.id)).toBe(true)
  })

  it("supports limit and before query params", async () => {
    const post = async (message: string) => {
      const res = await app.request("/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
      expect(res.status).toBe(201)
    }

    await post("m1")
    await post("m2")
    await post("m3")

    const db = getDb()
    db.prepare(`UPDATE chat_messages SET created_at = ? WHERE message = ?`).run("2026-01-01T00:00:01.000Z", "m1")
    db.prepare(`UPDATE chat_messages SET created_at = ? WHERE message = ?`).run("2026-01-01T00:00:02.000Z", "m2")
    db.prepare(`UPDATE chat_messages SET created_at = ? WHERE message = ?`).run("2026-01-01T00:00:03.000Z", "m3")

    const limited = await app.request("/chat/messages?limit=2")
    expect(limited.status).toBe(200)
    const limitedMessages = await limited.json() as StoredChatMessage[]
    expect(limitedMessages).toHaveLength(2)
    expect(limitedMessages.map((m) => m.message)).toEqual(["m3", "m2"])

    const before = await app.request("/chat/messages?before=2026-01-01T00:00:03.000Z&limit=5")
    expect(before.status).toBe(200)
    const beforeMessages = await before.json() as StoredChatMessage[]
    expect(beforeMessages.map((m) => m.message)).toEqual(["m2", "m1"])
  })
})
