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

describe("morning-report gate1 stats", () => {
  beforeEach(async () => {
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("formatReport includes gate1 stats when gate1 events exist", async () => {
    const { createTask, startTask, finishTask, getTask } = await import("../db.js")
    const { insertAgentEvent } = await import("../db/events.js")
    const { formatReport } = await import("../morning-report.js")
    const { getPipelineStats } = await import("../db/stats.js")
    const { traceTask } = await import("../pipeline-trace.js")

    // gate1 go → done タスク
    const goTask = createTask("機能追加A", "説明A", "pm", 50)
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: goTask.id, gate: "gate1" })
    insertAgentEvent("task.started", { type: "task.started", taskId: goTask.id, workerId: "worker-0" })
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: goTask.id, gate: "gate3" })
    insertAgentEvent("task.completed", { type: "task.completed", taskId: goTask.id, costUsd: 0.01 })
    startTask(goTask.id, "worker-0")
    finishTask(goTask.id, "done", JSON.stringify({ exit_code: 0, files_changed: [], diff_stats: { additions: 1, deletions: 0 } }))

    // gate1 kill されたタスク2つ（タスクテーブルにはfailedとして残るが、gate1で弾かれた）
    const killTask1 = createTask("不要タスク1", "短い", "pm", 50)
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: killTask1.id, gate: "gate1", verdict: "kill", reason: "description too short" })
    finishTask(killTask1.id, "failed", JSON.stringify({ gate1: { verdict: "kill" } }))

    const killTask2 = createTask("不要タスク2", "重複", "pm", 50)
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: killTask2.id, gate: "gate1", verdict: "kill", reason: "duplicate" })
    finishTask(killTask2.id, "failed", JSON.stringify({ gate1: { verdict: "kill" } }))

    // gate1 recycle されたタスク
    const recycleTask = createTask("再利用タスク", "再実行", "pm", 50)
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: recycleTask.id, gate: "gate1", verdict: "recycle", reason: "LLM check failed" })

    const done = getTask(goTask.id)!

    const summary = {
      period: "8h",
      completed: [done],
      failed: [],
      totalCost: 0.01,
      prReports: [],
      pipelineStats: getPipelineStats(),
      traces: [done].map(traceTask),
      gate1Stats: { go: 1, kill: 2, recycle: 1 },
    }

    const report = formatReport(summary)

    // Gate1セクションが存在し、go/kill/recycleカウントが含まれる
    const gate1Section = report.sections.find(s => s.heading.includes("Gate1") || s.body.includes("Gate1"))
    expect(gate1Section).toBeDefined()
    expect(gate1Section!.body).toContain("go")
    expect(gate1Section!.body).toContain("kill")
    expect(gate1Section!.body).toContain("recycle")
    // 具体的な数値
    expect(gate1Section!.body).toMatch(/go\s*1/)
    expect(gate1Section!.body).toMatch(/kill\s*2/)
    expect(gate1Section!.body).toMatch(/recycle\s*1/)
  })

  it("formatReport omits gate1 section when no gate1 events", async () => {
    const { formatReport } = await import("../morning-report.js")
    const { getPipelineStats } = await import("../db/stats.js")

    const summary = {
      period: "8h",
      completed: [],
      failed: [],
      totalCost: 0,
      prReports: [],
      pipelineStats: getPipelineStats(),
      traces: [],
      gate1Stats: { go: 0, kill: 0, recycle: 0 },
    }

    const report = formatReport(summary)

    // gate1イベントが0の場合、Gate1セクションは不要
    const gate1Section = report.sections.find(s => s.heading.includes("Gate1"))
    expect(gate1Section).toBeUndefined()
  })

  it("collectShiftData includes gate1Stats from agent_events", async () => {
    const { createTask, finishTask } = await import("../db.js")
    const { insertAgentEvent } = await import("../db/events.js")

    // gate1 go
    const t1 = createTask("タスクA", "説明A", "pm", 50)
    insertAgentEvent("gate.passed", { type: "gate.passed", taskId: t1.id, gate: "gate1" })
    finishTask(t1.id, "done", JSON.stringify({ exit_code: 0, files_changed: [], diff_stats: { additions: 1, deletions: 0 } }))

    // gate1 kill
    const t2 = createTask("タスクB", "説明B", "pm", 50)
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: t2.id, gate: "gate1", verdict: "kill", reason: "bad" })
    finishTask(t2.id, "failed", JSON.stringify({ gate1: { verdict: "kill" } }))

    // gate1 recycle
    const t3 = createTask("タスクC", "説明C", "pm", 50)
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: t3.id, gate: "gate1", verdict: "recycle", reason: "retry" })

    // gate3 のイベント（gate1にはカウントされない）
    insertAgentEvent("gate.rejected", { type: "gate.rejected", taskId: t1.id, gate: "gate3", verdict: "kill", reason: "test fail" })

    // collectShiftData は内部関数なので sendMorningReport 経由か、
    // もしくは export されていれば直接テスト。
    // 仕様では collectShiftData に gate1Stats が追加されるので、
    // formatReport に渡される ShiftSummary の gate1Stats を検証する。
    // ここでは sendMorningReport を呼んで notifier に渡されたレポートを検証する。
    const { sendMorningReport } = await import("../morning-report.js")
    const { getNotifier } = await import("../notifier-factory.js")

    const notifier = getNotifier()
    const since = new Date(Date.now() - 86400000).toISOString()

    await sendMorningReport(since)

    expect(notifier.sendReport).toHaveBeenCalledTimes(1)
    const report = vi.mocked(notifier.sendReport).mock.calls[0][0]

    // レポートにGate1統計が含まれる
    const gate1Section = report.sections.find(
      (s: { heading: string; body: string }) => s.heading.includes("Gate1") || s.body.includes("Gate1"),
    )
    expect(gate1Section).toBeDefined()
    // go: 1, kill: 1, recycle: 1 (gate3のイベントは含まない)
    expect(gate1Section!.body).toMatch(/go\s*1/)
    expect(gate1Section!.body).toMatch(/kill\s*1/)
    expect(gate1Section!.body).toMatch(/recycle\s*1/)
  })
})
