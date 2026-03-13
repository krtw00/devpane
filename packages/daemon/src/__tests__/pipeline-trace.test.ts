import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

describe("pipeline-trace", () => {
  beforeEach(async () => {
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("traces a fully successful task", async () => {
    const { createTask } = await import("../db.js")
    const { insertAgentEvent } = await import("../db/events.js")
    const { traceTask } = await import("../pipeline-trace.js")

    const task = createTask("成功タスク", "desc", "pm", 50)
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate1" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate2" })
    insertAgentEvent("task.started", { type: "task.started", taskId: task.id, workerId: "worker-0" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate3" })
    insertAgentEvent("task.completed", { type: "task.completed", taskId: task.id, costUsd: 0.05 })

    const trace = traceTask(task)

    expect(trace.gate1).toBe("pass")
    expect(trace.gate2).toBe("pass")
    expect(trace.worker).toBe("pass")
    expect(trace.gate3).toBe("pass")
    expect(trace.outcome).toBe("merged")
  })

  it("traces a gate1 kill", async () => {
    const { createTask } = await import("../db.js")
    const { insertAgentEvent } = await import("../db/events.js")
    const { traceTask } = await import("../pipeline-trace.js")

    const task = createTask("拒否タスク", "desc", "pm", 50)
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: task.id, gate: "gate1", verdict: "kill", reason: "scope_creep" })
    insertAgentEvent("task.failed", { type: "task.failed", taskId: task.id, rootCause: "scope_creep" })

    const trace = traceTask(task)

    expect(trace.gate1).toBe("kill")
    expect(trace.worker).toBe("skip")
    expect(trace.gate3).toBe("skip")
    expect(trace.outcome).toContain("kill")
  })

  it("traces a gate3 recycle", async () => {
    const { createTask } = await import("../db.js")
    const { insertAgentEvent } = await import("../db/events.js")
    const { traceTask } = await import("../pipeline-trace.js")

    const task = createTask("リサイクルタスク", "desc", "pm", 50)
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: task.id, gate: "gate1" })
    insertAgentEvent("task.started", { type: "task.started", taskId: task.id, workerId: "worker-0" })
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: task.id, gate: "gate3", verdict: "recycle", reason: "test_failed" })

    const trace = traceTask(task)

    expect(trace.gate1).toBe("pass")
    expect(trace.worker).toBe("pass")
    expect(trace.gate3).toBe("recycle")
    expect(trace.outcome).toContain("recycle")
  })

  it("formatPipelineTable renders table", async () => {
    const { formatPipelineTable } = await import("../pipeline-trace.js")

    const traces = [
      { taskId: "a", title: "タスクA", gate1: "pass" as const, tester: "pass" as const, gate2: "pass" as const, worker: "pass" as const, gate3: "pass" as const, outcome: "merged", costUsd: 0.02 },
      { taskId: "b", title: "タスクB", gate1: "kill" as const, tester: "skip" as const, gate2: "skip" as const, worker: "skip" as const, gate3: "skip" as const, outcome: "kill:scope", costUsd: 0 },
    ]

    const table = formatPipelineTable(traces)

    expect(table).toContain("| タスク")
    expect(table).toContain("タスクA")
    expect(table).toContain("タスクB")
    expect(table).toContain("merged")
    expect(table).toContain("kill:scope")
  })
})
