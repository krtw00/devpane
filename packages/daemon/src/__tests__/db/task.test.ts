import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, getTask, startTask, finishTask } from "../../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "..", "src", "migrations")

describe("db/task started_at and finished_at", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  describe("started_at recording", () => {
    it("should record started_at when task is started", () => {
      const task = createTask("Test task", "Test description", "human")
      expect(task.started_at).toBeNull()

      startTask(task.id, "worker-0")
      const updatedTask = getTask(task.id)!
      
      expect(updatedTask.started_at).toBeTruthy()
      expect(typeof updatedTask.started_at).toBe("string")
      expect(updatedTask.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it("should not have started_at for pending tasks", () => {
      const task = createTask("Pending task", "Test description", "human")
      expect(task.started_at).toBeNull()
    })
  })

  describe("finished_at recording", () => {
    it("should record finished_at when task is completed successfully", () => {
      const task = createTask("Test task", "Test description", "human")
      startTask(task.id, "worker-0")
      
      finishTask(task.id, "done", '{"exit_code": 0}')
      const completedTask = getTask(task.id)!
      
      expect(completedTask.finished_at).toBeTruthy()
      expect(typeof completedTask.finished_at).toBe("string")
      expect(completedTask.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it("should record finished_at when task fails", () => {
      const task = createTask("Test task", "Test description", "human")
      startTask(task.id, "worker-0")
      
      finishTask(task.id, "failed", '{"exit_code": 1, "error": "Something went wrong"}')
      const failedTask = getTask(task.id)!
      
      expect(failedTask.finished_at).toBeTruthy()
      expect(typeof failedTask.finished_at).toBe("string")
      expect(failedTask.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it("should not have finished_at for pending or running tasks", () => {
      const pendingTask = createTask("Pending task", "Test description", "human")
      expect(pendingTask.finished_at).toBeNull()

      startTask(pendingTask.id, "worker-0")
      const runningTask = getTask(pendingTask.id)!
      expect(runningTask.finished_at).toBeNull()
    })
  })
})