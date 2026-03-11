import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, startTask } from "../db.js"
import { checkWipLimit, checkJidoka, getRunningCount, WIP_LIMIT, JIDOKA_THRESHOLD } from "../flow-control.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("flow-control", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  describe("checkWipLimit", () => {
    it("returns false when no running tasks", () => {
      expect(checkWipLimit()).toBe(false)
    })

    it("returns true when running tasks reach WIP_LIMIT", () => {
      for (let i = 0; i < WIP_LIMIT; i++) {
        const t = createTask(`task-${i}`, "desc", "pm")
        startTask(t.id, `worker-${i}`)
      }
      expect(checkWipLimit()).toBe(true)
    })

    it("returns true when running tasks exceed WIP_LIMIT", () => {
      for (let i = 0; i < WIP_LIMIT + 1; i++) {
        const t = createTask(`task-${i}`, "desc", "pm")
        startTask(t.id, `worker-${i}`)
      }
      expect(checkWipLimit()).toBe(true)
    })

    it("returns false when running tasks are below limit", () => {
      for (let i = 0; i < WIP_LIMIT - 1; i++) {
        const t = createTask(`task-${i}`, "desc", "pm")
        startTask(t.id, `worker-${i}`)
      }
      expect(checkWipLimit()).toBe(false)
    })
  })

  describe("checkJidoka", () => {
    it("returns false when consecutive failures below threshold", () => {
      expect(checkJidoka(0)).toBe(false)
      expect(checkJidoka(JIDOKA_THRESHOLD - 1)).toBe(false)
    })

    it("returns true when consecutive failures reach threshold", () => {
      expect(checkJidoka(JIDOKA_THRESHOLD)).toBe(true)
    })

    it("returns true when consecutive failures exceed threshold", () => {
      expect(checkJidoka(JIDOKA_THRESHOLD + 1)).toBe(true)
    })
  })

  describe("getRunningCount", () => {
    it("returns 0 when no running tasks", () => {
      expect(getRunningCount()).toBe(0)
    })

    it("returns correct count of running tasks", () => {
      const t1 = createTask("a", "desc", "pm")
      const t2 = createTask("b", "desc", "pm")
      createTask("c", "desc", "pm")
      startTask(t1.id, "w-0")
      startTask(t2.id, "w-1")
      expect(getRunningCount()).toBe(2)
    })
  })

  describe("constants", () => {
    it("WIP_LIMIT defaults to 5", () => {
      expect(WIP_LIMIT).toBe(5)
    })

    it("JIDOKA_THRESHOLD defaults to 3", () => {
      expect(JIDOKA_THRESHOLD).toBe(3)
    })
  })
})
