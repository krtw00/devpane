import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const mockEmit = vi.fn()
vi.mock("../events.js", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  safeEmit: vi.fn(() => true),
}))

const mockSendReport = vi.fn()
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

describe("morning_report.failed 二重発火防止", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("sendMorningReport失敗時に morning_report.failed が1回だけ発火される", async () => {
    mockSendReport.mockRejectedValueOnce(new Error("Discord webhook down"))

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    // sendMorningReport は内部で emit してから re-throw する。
    // scheduler.ts の catch 節でも emit すると二重発火になるため、
    // scheduler 側では emit しないのが正しい動作。
    // ここでは scheduler.ts の catch 節と同等のフローを再現する。
    try {
      await sendMorningReport(since)
    } catch {
      // scheduler.ts の catch 節: ログのみ、emit しない
    }

    const failedEvents = mockEmit.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "morning_report.failed",
    )
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0][0]).toEqual(
      expect.objectContaining({
        type: "morning_report.failed",
        error: "Discord webhook down",
      }),
    )
  })

  it("sendMorningReport成功時に morning_report.failed が発火されない", async () => {
    mockSendReport.mockResolvedValueOnce(undefined)

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await sendMorningReport(since)

    const failedEvents = mockEmit.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "morning_report.failed",
    )
    expect(failedEvents).toHaveLength(0)
  })
})
