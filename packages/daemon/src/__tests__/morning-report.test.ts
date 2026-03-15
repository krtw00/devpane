import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

vi.mock("../notifier-factory.js", () => ({
  getNotifier: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendReport: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("../pr-agent.js", () => ({
  fetchOpenPrs: vi.fn().mockReturnValue([]),
  assessRisk: vi.fn(),
}))

describe("morning-report", () => {
  beforeEach(async () => {
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("formatReport generates structured report with pipeline traces", async () => {
    const { createTask, startTask, finishTask, getTask } = await import("../db.js")
    const { insertAgentEvent } = await import("../db/events.js")
    const { formatReport } = await import("../morning-report.js")
    const { getPipelineStats } = await import("../db/stats.js")
    const { traceTask } = await import("../pipeline-trace.js")

    // Create and complete a task with events
    const doneTask = createTask("テスト改善", "テストカバレッジ向上", "pm", 50)
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: doneTask.id, gate: "gate1" })
    insertAgentEvent("task.started", { type: "task.started", taskId: doneTask.id, workerId: "worker-0" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: doneTask.id, gate: "gate3" })
    insertAgentEvent("task.completed", { type: "task.completed", taskId: doneTask.id, costUsd: 0.02 })
    startTask(doneTask.id, "worker-0")
    finishTask(doneTask.id, "done", JSON.stringify({ exit_code: 0, files_changed: ["a.ts"], diff_stats: { additions: 10, deletions: 2 } }))

    // Create and fail a task
    const failedTask = createTask("バグ修正", "修正内容", "pm", 50)
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: failedTask.id, gate: "gate1" })
    insertAgentEvent("task.started", { type: "task.started", taskId: failedTask.id, workerId: "worker-0" })
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: failedTask.id, gate: "gate3", verdict: "kill", reason: "test_gap" })
    insertAgentEvent("task.failed", { type: "task.failed", taskId: failedTask.id, rootCause: "test_gap" })
    startTask(failedTask.id, "worker-0")
    finishTask(failedTask.id, "failed", JSON.stringify({ exit_code: 1 }))

    const done = getTask(doneTask.id)!
    const failed = getTask(failedTask.id)!

    const summary = {
      period: "6.5h",
      completed: [done],
      failed: [failed],
      totalCost: 0.05,
      prReports: [],
      pipelineStats: getPipelineStats(),
      traces: [done, failed].map(traceTask),
    }

    const report = formatReport(summary)

    // Structured report
    expect(report.title).toContain("朝レポート")
    expect(report.summary).toContain("1 完了 / 1 失敗")
    expect(report.summary).toContain("$0.05")

    // Pipeline section with task names
    const pipelineSection = report.sections.find(s => s.heading === "パイプライン")
    expect(pipelineSection).toBeDefined()
    expect(pipelineSection!.body).toContain("テスト改善")
    expect(pipelineSection!.body).toContain("バグ修正")
  })

  it("formatReport handles empty shift", async () => {
    const { formatReport } = await import("../morning-report.js")
    const { getPipelineStats } = await import("../db/stats.js")

    const summary = {
      period: "6.5h",
      completed: [],
      failed: [],
      totalCost: 0,
      prReports: [],
      pipelineStats: getPipelineStats(),
      traces: [],
    }

    const report = formatReport(summary)

    expect(report.summary).toContain("0 完了 / 0 失敗")
    const noteSection = report.sections.find(s => s.heading === "備考")
    expect(noteSection).toBeDefined()
    expect(noteSection!.body).toContain("稼働タスクはありませんでした")
  })
})
