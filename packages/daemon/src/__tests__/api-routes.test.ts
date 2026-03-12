import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { initDb, closeDb, createTask } from "../db.js"
import { tasksApi } from "../api/tasks.js"
import { memoriesApi } from "../api/memories.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Scheduler uses module-level state; mock it to avoid starting the real loop
vi.mock("../scheduler.js", () => {
  let paused = false
  return {
    getSchedulerState: () => ({
      alive: true,
      rateLimitHits: 0,
      pmConsecutiveFailures: 0,
      taskCompletionsSinceLastMeasure: 0,
      paused,
    }),
    pauseScheduler: () => { paused = true },
    resumeScheduler: () => { paused = false },
  }
})

// Import after mock is set up
const { schedulerApi } = await import("../api/scheduler.js")

function buildApp() {
  const app = new Hono()
  app.route("/tasks", tasksApi)
  app.route("/memories", memoriesApi)
  app.route("/scheduler", schedulerApi)
  return app
}

describe("API routes", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
  })

  afterEach(() => {
    closeDb()
  })

  // ------ Tasks API ------

  describe("GET /tasks", () => {
    it("returns empty array when no tasks exist", async () => {
      const res = await app.request("/tasks")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it("returns all tasks", async () => {
      createTask("Task A", "desc a", "human")
      createTask("Task B", "desc b", "pm")

      const res = await app.request("/tasks")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
      expect(body.map((t: { title: string }) => t.title)).toContain("Task A")
      expect(body.map((t: { title: string }) => t.title)).toContain("Task B")
    })
  })

  describe("GET /tasks/:id", () => {
    it("returns a task by id", async () => {
      const task = createTask("Find me", "desc", "human")
      const res = await app.request(`/tasks/${task.id}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe("Find me")
    })

    it("returns 404 for nonexistent task", async () => {
      const res = await app.request("/tasks/nonexistent")
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe("not found")
    })
  })

  describe("GET /tasks/:id/logs", () => {
    it("returns empty logs for task with no logs", async () => {
      const task = createTask("No logs", "desc", "human")
      const res = await app.request(`/tasks/${task.id}/logs`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  describe("POST /tasks", () => {
    it("creates a task with title and description", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New task", description: "Do something" }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.title).toBe("New task")
      expect(body.description).toBe("Do something")
      expect(body.status).toBe("pending")
      expect(body.created_by).toBe("human")
      expect(body.priority).toBe(0)
      expect(body.id).toBeTruthy()
    })

    it("creates a task with custom priority", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Urgent", description: "ASAP", priority: 99 }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.priority).toBe(99)
    })

    it("returns 400 when title is missing", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "No title" }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/title/)
    })

    it("returns 400 when description is missing", async () => {
      const res = await app.request("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "No desc" }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/description/)
    })
  })

  // ------ Scheduler API ------

  describe("GET /scheduler/status", () => {
    it("returns scheduler state", async () => {
      const res = await app.request("/scheduler/status")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty("alive")
      expect(body).toHaveProperty("rateLimitHits")
      expect(body).toHaveProperty("pmConsecutiveFailures")
    })
  })

  describe("POST /scheduler/pause and /scheduler/resume", () => {
    it("pauses and resumes the scheduler", async () => {
      const pauseRes = await app.request("/scheduler/pause", { method: "POST" })
      expect(pauseRes.status).toBe(200)
      expect(await pauseRes.json()).toEqual({ ok: true })

      const resumeRes = await app.request("/scheduler/resume", { method: "POST" })
      expect(resumeRes.status).toBe(200)
      expect(await resumeRes.json()).toEqual({ ok: true })
    })
  })

  // ------ Memories API ------

  describe("GET /memories", () => {
    it("returns empty array when no memories exist", async () => {
      const res = await app.request("/memories")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it("returns all memories", async () => {
      await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "decision", content: "Use SQLite" }),
      })
      await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "lesson", content: "Tests matter" }),
      })

      const res = await app.request("/memories")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
    })

    it("filters by category query param", async () => {
      await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "decision", content: "Use SQLite" }),
      })
      await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "lesson", content: "Tests matter" }),
      })

      const res = await app.request("/memories?category=decision")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].category).toBe("decision")
    })
  })

  describe("POST /memories", () => {
    it("creates a memory with category and content", async () => {
      const res = await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "feature", content: "Added auth module" }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.category).toBe("feature")
      expect(body.content).toBe("Added auth module")
      expect(body.id).toBeTruthy()
    })

    it("returns 400 when category is missing", async () => {
      const res = await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "No category" }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/category/)
    })

    it("returns 400 when content is missing", async () => {
      const res = await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "decision" }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/content/)
    })
  })

  describe("PUT /memories/:id", () => {
    it("updates memory content", async () => {
      const createRes = await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "decision", content: "Original" }),
      })
      const created = await createRes.json()

      const res = await app.request(`/memories/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Updated" }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })

      const getRes = await app.request("/memories")
      const memories = await getRes.json()
      expect(memories[0].content).toBe("Updated")
    })

    it("returns 400 when content is missing", async () => {
      const res = await app.request("/memories/some-id", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })

  describe("DELETE /memories/:id", () => {
    it("deletes a memory", async () => {
      const createRes = await app.request("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "lesson", content: "To be deleted" }),
      })
      const created = await createRes.json()

      const res = await app.request(`/memories/${created.id}`, { method: "DELETE" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })

      const getRes = await app.request("/memories")
      expect(await getRes.json()).toEqual([])
    })
  })
})
