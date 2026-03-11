import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, finishTask, startTask, getDb } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

import { execFileSync } from "child_process"
import { getOpenPrCount, getConsecutiveFailures, checkFlowControl } from "../flow-control.js"

describe("flow-control", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  describe("getOpenPrCount", () => {
    it("returns PR count from gh cli", () => {
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ number: 1 }, { number: 2 }]))
      expect(getOpenPrCount()).toBe(2)
    })

    it("returns 0 when gh cli fails", () => {
      vi.mocked(execFileSync).mockImplementation(() => { throw new Error("gh not found") })
      expect(getOpenPrCount()).toBe(0)
    })

    it("returns 0 for empty PR list", () => {
      vi.mocked(execFileSync).mockReturnValue("[]")
      expect(getOpenPrCount()).toBe(0)
    })
  })

  describe("getConsecutiveFailures", () => {
    it("returns 0 when no tasks", () => {
      expect(getConsecutiveFailures()).toBe(0)
    })

    it("counts consecutive failed tasks from most recent", () => {
      const db = getDb()

      const t1 = createTask("t1", "desc", "pm")
      startTask(t1.id, "w")
      finishTask(t1.id, "done", null)
      db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run("2025-01-01T00:00:00Z", t1.id)

      const t2 = createTask("t2", "desc", "pm")
      startTask(t2.id, "w")
      finishTask(t2.id, "failed", null)
      db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run("2025-01-01T00:01:00Z", t2.id)

      const t3 = createTask("t3", "desc", "pm")
      startTask(t3.id, "w")
      finishTask(t3.id, "failed", null)
      db.prepare("UPDATE tasks SET finished_at = ? WHERE id = ?").run("2025-01-01T00:02:00Z", t3.id)

      expect(getConsecutiveFailures()).toBe(2)
    })

    it("resets count after a successful task", () => {
      const t1 = createTask("t1", "desc", "pm")
      startTask(t1.id, "w")
      finishTask(t1.id, "failed", null)

      const t2 = createTask("t2", "desc", "pm")
      startTask(t2.id, "w")
      finishTask(t2.id, "done", null)

      expect(getConsecutiveFailures()).toBe(0)
    })
  })

  describe("checkFlowControl", () => {
    it("returns ok when under limits", async () => {
      vi.mocked(execFileSync).mockReturnValue("[]")
      const result = await checkFlowControl()
      expect(result).toEqual({ canProceed: true, reason: "ok" })
    })

    it("returns wip_limit when too many open PRs", async () => {
      const prs = Array.from({ length: 5 }, (_, i) => ({ number: i + 1 }))
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify(prs))
      const result = await checkFlowControl()
      expect(result).toEqual({ canProceed: false, reason: "wip_limit" })
    })

    it("returns jidoka when consecutive failures exceed limit", async () => {
      vi.mocked(execFileSync).mockReturnValue("[]")

      for (let i = 0; i < 3; i++) {
        const t = createTask(`t${i}`, "desc", "pm")
        startTask(t.id, "w")
        finishTask(t.id, "failed", null)
      }

      const result = await checkFlowControl()
      expect(result).toEqual({ canProceed: false, reason: "jidoka" })
    })

    it("wip_limit takes priority over jidoka", async () => {
      const prs = Array.from({ length: 5 }, (_, i) => ({ number: i + 1 }))
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify(prs))

      for (let i = 0; i < 3; i++) {
        const t = createTask(`t${i}`, "desc", "pm")
        startTask(t.id, "w")
        finishTask(t.id, "failed", null)
      }

      const result = await checkFlowControl()
      expect(result).toEqual({ canProceed: false, reason: "wip_limit" })
    })
  })
})
