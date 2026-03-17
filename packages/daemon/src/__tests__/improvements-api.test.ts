import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { closeDb, getAgentEvents, getDb, initDb } from "../db.js"
import { statsApi } from "../api/stats.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function buildApp() {
  const app = new Hono()
  app.route("/stats", statsApi)
  return app
}

function insertImprovement(id: string, status: "active" | "reverted" | "permanent" = "active") {
  getDb().prepare(
    `INSERT INTO improvements (id, trigger_analysis, target, action, applied_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, "{}", "gate2", "add_check", new Date().toISOString(), status)
}

describe("POST /stats/improvements/:id/revert", () => {
  let app: Hono

  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    app = buildApp()
  })

  afterEach(() => {
    closeDb()
  })

  it("reverts an active improvement and emits an event", async () => {
    insertImprovement("imp-active")

    const res = await app.request("/stats/improvements/imp-active/revert", { method: "POST" })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("reverted")

    const updated = getDb().prepare(`SELECT status FROM improvements WHERE id = ?`).get("imp-active") as { status: string }
    expect(updated.status).toBe("reverted")

    const events = getAgentEvents({ type: "improvement.reverted", limit: 10 })
    expect(events).toContainEqual({
      type: "improvement.reverted",
      improvementId: "imp-active",
      reason: "manual revert",
    })
  })

  it("returns 400 for non-active improvements", async () => {
    insertImprovement("imp-permanent", "permanent")

    const res = await app.request("/stats/improvements/imp-permanent/revert", { method: "POST" })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "only active improvements can be reverted" })
  })

  it("returns 404 when the improvement does not exist", async () => {
    const res = await app.request("/stats/improvements/missing/revert", { method: "POST" })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "not found" })
  })
})
