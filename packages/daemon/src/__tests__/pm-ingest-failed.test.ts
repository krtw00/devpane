import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, createTask, startTask, finishTask } from "../db.js"
import { ingestPmTasks } from "../pm.js"
import type { PmOutput } from "@devpane/shared"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("ingestPmTasks — failed task deduplication", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("skips a task whose title matches a failed task", () => {
    // Arrange: create a task and mark it as failed
    const task = createTask("WebSocket再接続の実装", "desc", "pm", 5)
    startTask(task.id, "worker-1")
    finishTask(task.id, "failed", JSON.stringify({ exit_code: 1 }))

    const pmOutput: PmOutput = {
      tasks: [{ title: "WebSocket再接続の実装", description: "再実装", priority: 3 }],
      reasoning: "retry",
    }

    // Act
    const created = ingestPmTasks(pmOutput)

    // Assert: the duplicate should be skipped
    expect(created).toHaveLength(0)
  })

  it("skips a task whose normalized title matches a failed task", () => {
    const task = createTask("Gate 1 方針チェック", "desc", "pm", 5)
    startTask(task.id, "worker-1")
    finishTask(task.id, "failed", null)

    const pmOutput: PmOutput = {
      tasks: [{ title: "Gate1方針チェック", description: "retry", priority: 3 }],
      reasoning: "retry",
    }

    const created = ingestPmTasks(pmOutput)
    expect(created).toHaveLength(0)
  })

  it("allows a genuinely new task even when failed tasks exist", () => {
    const task = createTask("認証APIの実装", "desc", "pm", 5)
    startTask(task.id, "worker-1")
    finishTask(task.id, "failed", null)

    const pmOutput: PmOutput = {
      tasks: [{ title: "Discord Webhook通知の追加", description: "new feature", priority: 3 }],
      reasoning: "new work",
    }

    const created = ingestPmTasks(pmOutput)
    expect(created).toHaveLength(1)
    expect(created[0].title).toBe("Discord Webhook通知の追加")
  })

  it("deduplicates against done, pending, AND failed tasks simultaneously", () => {
    // done task
    const done = createTask("完了済みタスク", "desc", "pm", 5)
    startTask(done.id, "worker-1")
    finishTask(done.id, "done", null)

    // pending task (already in queue)
    createTask("保留中タスク", "desc", "pm", 3)

    // failed task
    const failed = createTask("失敗タスク", "desc", "pm", 1)
    startTask(failed.id, "worker-1")
    finishTask(failed.id, "failed", null)

    const pmOutput: PmOutput = {
      tasks: [
        { title: "完了済みタスク", description: "dup of done", priority: 5 },
        { title: "保留中タスク", description: "dup of pending", priority: 3 },
        { title: "失敗タスク", description: "dup of failed", priority: 1 },
        { title: "全く新しいタスク", description: "genuinely new", priority: 2 },
      ],
      reasoning: "mixed",
    }

    const created = ingestPmTasks(pmOutput)
    expect(created).toHaveLength(1)
    expect(created[0].title).toBe("全く新しいタスク")
  })

  it("skips task when failed task title is a substring match", () => {
    const task = createTask("スケジューラ制御APIとメモリ管理API", "desc", "pm", 5)
    startTask(task.id, "worker-1")
    finishTask(task.id, "failed", null)

    const pmOutput: PmOutput = {
      tasks: [{ title: "スケジューラ制御API", description: "partial match", priority: 3 }],
      reasoning: "retry subset",
    }

    const created = ingestPmTasks(pmOutput)
    expect(created).toHaveLength(0)
  })
})
