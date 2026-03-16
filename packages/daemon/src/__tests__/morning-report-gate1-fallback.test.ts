import { describe, it, expect, beforeEach, vi } from "vitest"

const mockSendReport = vi.fn().mockResolvedValue(undefined)
vi.mock("../notifier-factory.js", () => ({
  getNotifier: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendReport: mockSendReport,
    notify: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("../pr-agent.js", () => ({
  fetchOpenPrs: vi.fn().mockReturnValue([]),
  assessRisk: vi.fn(),
}))

vi.mock("../db/stats.js", () => ({
  getPipelineStats: vi.fn().mockReturnValue({
    gate3_pass_rate: 0,
    avg_execution_time: 0,
    consecutive_failures: 0,
    tasks_today: 0,
    tasks_today_done: 0,
    tasks_today_failed: 0,
    active_improvements: 0,
  }),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

const mockGetDb = vi.fn()
vi.mock("../db/core.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  initDb: vi.fn(),
  closeDb: vi.fn(),
}))

vi.mock("../db/tasks.js", () => ({
  getTasksSince: vi.fn().mockReturnValue([
    {
      id: "task-1",
      title: "完了タスク",
      description: "テスト用",
      status: "done",
      cost_usd: 0.05,
      priority: 50,
      created_by: "pm",
      created_at: new Date().toISOString(),
    },
    {
      id: "task-2",
      title: "失敗タスク",
      description: "テスト用",
      status: "failed",
      cost_usd: 0.02,
      priority: 50,
      created_by: "pm",
      created_at: new Date().toISOString(),
    },
  ]),
}))

vi.mock("../pipeline-trace.js", () => ({
  traceTask: vi.fn().mockReturnValue({
    taskId: "task-1",
    title: "完了タスク",
    gate1: "pass",
    tester: "pass",
    gate2: "pass",
    worker: "pass",
    gate3: "pass",
    outcome: "done",
    costUsd: 0.05,
  }),
}))

describe("collectShiftData gate1Stats DB例外フォールバック", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("getDb()が例外をスローしてもsendMorningReportが正常にレポートを送信する", async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error("SQLITE_CORRUPT: database disk image is malformed")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await expect(sendMorningReport(since)).resolves.toBeUndefined()
    expect(mockSendReport).toHaveBeenCalledTimes(1)
  })

  it("gate1Stats DB例外時にデフォルト値 { go: 0, kill: 0, recycle: 0 } が使用される", async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error("SQLITE_BUSY: database is locked")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    const report = mockSendReport.mock.calls[0][0]
    // gate1Statsがすべて0なのでGate1セクションは表示されない
    const gate1Section = report.sections.find(
      (s: { heading: string }) => s.heading === "Gate1",
    )
    expect(gate1Section).toBeUndefined()
  })

  it("gate1Stats DB例外時でもcompleted/failedタスクのサマリーは正常に含まれる", async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error("SQLITE_IOERR: disk I/O error")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    const report = mockSendReport.mock.calls[0][0]
    // completed: 1, failed: 1 が正しくレポートされている
    expect(report.summary).toContain("1 完了")
    expect(report.summary).toContain("1 失敗")
  })

  it("gate1Stats DB例外時でもパイプライン健全性セクションは正常に含まれる", async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open database file")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    const report = mockSendReport.mock.calls[0][0]
    const statsSection = report.sections.find(
      (s: { heading: string }) => s.heading === "パイプライン健全性",
    )
    expect(statsSection).toBeDefined()
  })

  it("gate1Stats DB例外時でもパイプラインセクション(traces)は正常に含まれる", async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error("SQLITE_ERROR: no such table")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    const report = mockSendReport.mock.calls[0][0]
    const pipelineSection = report.sections.find(
      (s: { heading: string }) => s.heading === "パイプライン",
    )
    expect(pipelineSection).toBeDefined()
  })

  it("gate1Stats DB例外時にconsole.warnでログが出力される", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    mockGetDb.mockImplementation(() => {
      throw new Error("SQLITE_CORRUPT")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[morning-report]"),
      expect.any(Error),
    )

    warnSpy.mockRestore()
  })
})
