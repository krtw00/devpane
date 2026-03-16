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

describe("morning-report failure → event emission", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("sendMorningReport が失敗した場合エラーを再throwする", async () => {
    mockSendReport.mockRejectedValueOnce(new Error("Discord webhook down"))

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    await expect(sendMorningReport(since)).rejects.toThrow("Discord webhook down")
  })

  it("morning_report.failed イベントが AgentEventSchema に含まれる", async () => {
    // 実装で AgentEventSchema に morning_report.failed を追加する必要がある
    const { AgentEventSchema } = await import("@devpane/shared/schemas")

    const event = {
      type: "morning_report.failed",
      error: "Slack API timeout",
    }

    const result = AgentEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it("sendReport 失敗時に morning_report.failed イベントが emit される", async () => {
    mockSendReport.mockRejectedValueOnce(new Error("Network error"))

    const { sendMorningReport } = await import("../morning-report.js")
    const since = new Date(Date.now() - 3600000).toISOString()

    // sendMorningReport を呼び、失敗をcatchする（scheduler.tsのcatch節と同等）
    try {
      await sendMorningReport(since)
    } catch {
      // 失敗は期待通り
    }

    // 実装後: scheduler.ts の catch 節で emit({ type: 'morning_report.failed', ... }) が呼ばれる
    // ここでは emit が morning_report.failed で呼ばれたことを検証
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "morning_report.failed",
        error: expect.any(String),
      }),
    )
  })
})
