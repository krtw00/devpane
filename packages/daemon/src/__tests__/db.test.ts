import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initDb, closeDb, createTask, getTask, getNextPending, getAllTasks, getTasksByStatus, getRecentDone, getFailedTasks, startTask, finishTask, revertToPending, appendLog, getTaskLogs } from "../db.js"

describe("db", () => {
  beforeEach(() => {
    initDb(":memory:")
  })

  afterEach(() => {
    closeDb()
  })

  describe("createTask / getTask", () => {
    it("creates a task and retrieves it by id", () => {
      const task = createTask("Test title", "Test description", "human", 5)
      expect(task.id).toBeTruthy()
      expect(task.title).toBe("Test title")
      expect(task.description).toBe("Test description")
      expect(task.status).toBe("pending")
      expect(task.priority).toBe(5)
      expect(task.created_by).toBe("human")
      expect(task.created_at).toBeTruthy()

      const fetched = getTask(task.id)
      expect(fetched).toEqual(task)
    })

    it("returns undefined for nonexistent id", () => {
      expect(getTask("nonexistent")).toBeUndefined()
    })

    it("supports parent_id", () => {
      const parent = createTask("Parent", "desc", "pm")
      const child = createTask("Child", "desc", "pm", 0, parent.id)
      expect(child.parent_id).toBe(parent.id)
    })
  })

  describe("getNextPending", () => {
    it("returns highest priority pending task", () => {
      createTask("Low", "desc", "pm", 1)
      createTask("High", "desc", "pm", 10)
      createTask("Mid", "desc", "pm", 5)

      const next = getNextPending()
      expect(next?.title).toBe("High")
    })

    it("returns undefined when no pending tasks", () => {
      expect(getNextPending()).toBeUndefined()
    })

    it("skips non-pending tasks", () => {
      const task = createTask("Running", "desc", "pm")
      startTask(task.id, "worker-0")

      expect(getNextPending()).toBeUndefined()
    })
  })

  describe("getAllTasks", () => {
    it("returns all tasks", () => {
      createTask("First", "desc", "pm")
      createTask("Second", "desc", "pm")
      const all = getAllTasks()
      expect(all).toHaveLength(2)
      const titles = all.map(t => t.title)
      expect(titles).toContain("First")
      expect(titles).toContain("Second")
    })
  })

  describe("getTasksByStatus", () => {
    it("filters by status", () => {
      const t1 = createTask("A", "desc", "pm")
      createTask("B", "desc", "pm")
      startTask(t1.id, "worker-0")

      expect(getTasksByStatus("running")).toHaveLength(1)
      expect(getTasksByStatus("pending")).toHaveLength(1)
      expect(getTasksByStatus("done")).toHaveLength(0)
    })
  })

  describe("startTask / finishTask", () => {
    it("transitions task through lifecycle", () => {
      const task = createTask("Lifecycle", "desc", "pm")
      expect(task.status).toBe("pending")

      startTask(task.id, "worker-0")
      const running = getTask(task.id)!
      expect(running.status).toBe("running")
      expect(running.assigned_to).toBe("worker-0")
      expect(running.started_at).toBeTruthy()

      finishTask(task.id, "done", '{"exit_code": 0}')
      const done = getTask(task.id)!
      expect(done.status).toBe("done")
      expect(done.finished_at).toBeTruthy()
      expect(done.result).toBe('{"exit_code": 0}')
    })

    it("can mark task as failed", () => {
      const task = createTask("Fail me", "desc", "pm")
      startTask(task.id, "worker-0")
      finishTask(task.id, "failed", '{"exit_code": 1}')

      const failed = getTask(task.id)!
      expect(failed.status).toBe("failed")
    })

    it("reverts running task to pending", () => {
      const task = createTask("Retry me", "desc", "pm")
      startTask(task.id, "worker-0")

      const running = getTask(task.id)!
      expect(running.status).toBe("running")
      expect(running.assigned_to).toBe("worker-0")

      revertToPending(task.id)

      const reverted = getTask(task.id)!
      expect(reverted.status).toBe("pending")
      expect(reverted.started_at).toBeNull()
      expect(reverted.assigned_to).toBeNull()
    })
  })

  describe("getRecentDone / getFailedTasks", () => {
    it("returns done tasks", () => {
      const t1 = createTask("A", "d", "pm")
      const t2 = createTask("B", "d", "pm")
      startTask(t1.id, "w")
      startTask(t2.id, "w")
      finishTask(t1.id, "done", null)
      finishTask(t2.id, "failed", null)

      expect(getRecentDone()).toHaveLength(1)
      expect(getRecentDone()[0].title).toBe("A")
      expect(getFailedTasks()).toHaveLength(1)
      expect(getFailedTasks()[0].title).toBe("B")
    })

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        const t = createTask(`T${i}`, "d", "pm")
        startTask(t.id, "w")
        finishTask(t.id, "done", null)
      }
      expect(getRecentDone(3)).toHaveLength(3)
    })
  })

  describe("appendLog / getTaskLogs", () => {
    it("stores and retrieves logs for a task", () => {
      const task = createTask("Task", "desc", "pm")
      appendLog(task.id, "worker-0", "Starting...")
      appendLog(task.id, "worker-0", "Done!")

      const logs = getTaskLogs(task.id)
      expect(logs).toHaveLength(2)
      expect(logs[0].message).toBe("Starting...")
      expect(logs[1].message).toBe("Done!")
      expect(logs[0].agent).toBe("worker-0")
      expect(logs[0].task_id).toBe(task.id)
    })

    it("returns empty array for unknown task", () => {
      expect(getTaskLogs("unknown")).toEqual([])
    })
  })
})
