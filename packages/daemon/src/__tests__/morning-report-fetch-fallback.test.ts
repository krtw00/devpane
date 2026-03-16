import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const mockSendReport = vi.fn().mockResolvedValue(undefined)
vi.mock("../notifier-factory.js", () => ({
  getNotifier: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendReport: mockSendReport,
    notify: vi.fn().mockResolvedValue(undefined),
  }),
}))

const mockFetchOpenPrs = vi.fn()
vi.mock("../pr-agent.js", () => ({
  fetchOpenPrs: (...args: unknown[]) => mockFetchOpenPrs(...args),
  assessRisk: vi.fn(),
}))

const mockGetPipelineStats = vi.fn()
vi.mock("../db/stats.js", () => ({
  getPipelineStats: (...args: unknown[]) => mockGetPipelineStats(...args),
}))

vi.mock("../events.js", () => ({
  emit: vi.fn(),
  safeEmit: vi.fn(() => true),
}))

describe("collectShiftData fetch fallback", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)

    // デフォルトは正常動作
    mockFetchOpenPrs.mockReturnValue([])
    mockGetPipelineStats.mockReturnValue({
      gate3_pass_rate: 1,
      avg_execution_time: 0,
      consecutive_failures: 0,
      tasks_today: 0,
      active_improvements: 0,
    })
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("fetchOpenPrsが例外をスローしてもsendMorningReportが正常にレポートを送信する", async () => {
    mockFetchOpenPrs.mockImplementation(() => {
      throw new Error("gh: command not found")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await expect(sendMorningReport(since)).resolves.toBeUndefined()
    expect(mockSendReport).toHaveBeenCalledTimes(1)
  })

  it("fetchOpenPrs失敗時にprReportsセクションが空になる", async () => {
    mockFetchOpenPrs.mockImplementation(() => {
      throw new Error("network timeout")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    const report = mockSendReport.mock.calls[0][0]
    const prSection = report.sections.find(
      (s: { heading: string }) => s.heading === "未マージPR",
    )
    expect(prSection).toBeUndefined()
  })

  it("getPipelineStatsが例外をスローしてもsendMorningReportが正常にレポートを送信する", async () => {
    mockGetPipelineStats.mockImplementation(() => {
      throw new Error("SQLITE_CORRUPT: database disk image is malformed")
    })

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await expect(sendMorningReport(since)).resolves.toBeUndefined()
    expect(mockSendReport).toHaveBeenCalledTimes(1)
  })

  it("getPipelineStats失敗時にパイプライン健全性セクションが安全なデフォルト値を使用する", async () => {
    mockGetPipelineStats.mockImplementation(() => {
      throw new Error("DB locked")
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
})
