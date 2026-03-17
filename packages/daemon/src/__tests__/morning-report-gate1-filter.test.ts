import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type Database from "better-sqlite3"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const mockNotifier = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendReport: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn().mockResolvedValue(undefined),
}

vi.mock("../notifier-factory.js", () => ({
  getNotifier: () => mockNotifier,
}))

vi.mock("../pr-agent.js", () => ({
  fetchOpenPrs: vi.fn().mockReturnValue([]),
  assessRisk: vi.fn(),
}))

/**
 * agent_eventsに直接timestampを指定してイベントを挿入するヘルパー。
 * insertAgentEventはtimestampを自動生成するため、過去の時刻を指定できない。
 */
function insertEventAt(
  db: Database.Database,
  type: string,
  payload: Record<string, unknown>,
  timestamp: string,
): void {
  db.prepare(
    `INSERT INTO agent_events (id, type, payload, timestamp) VALUES (?, ?, ?, ?)`,
  ).run(`evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, JSON.stringify(payload), timestamp)
}

describe("morning-report gate1Stats timestamp filter", () => {
  beforeEach(async () => {
    const { initDb } = await import("../db.js")
    initDb(":memory:", migrationsDir)
    mockNotifier.sendReport.mockClear()
  })

  afterEach(async () => {
    const { closeDb } = await import("../db.js")
    closeDb()
  })

  it("since以前のgate1イベントはカウントに含まれない", async () => {
    const { createTask } = await import("../db.js")
    const { getDb } = await import("../db/core.js")
    const { sendMorningReport } = await import("../morning-report.js")

    const db = getDb()

    // since境界: 2026-03-17T00:00:00.000Z
    const since = "2026-03-17T00:00:00.000Z"

    // since以前のイベント（カウントされるべきでない）
    const oldTask = createTask("古いタスク", "since以前", "pm", 50)
    insertEventAt(db, "gate.passed", {
      type: "gate.passed", taskId: oldTask.id, gate: "gate1",
    }, "2026-03-16T23:00:00.000Z")

    insertEventAt(db, "gate.rejected", {
      type: "gate.rejected", taskId: oldTask.id, gate: "gate1", verdict: "kill", reason: "old",
    }, "2026-03-16T22:00:00.000Z")

    insertEventAt(db, "gate.rejected", {
      type: "gate.rejected", taskId: oldTask.id, gate: "gate1", verdict: "recycle", reason: "old",
    }, "2026-03-16T21:00:00.000Z")

    // since以降のイベント（カウントされるべき）
    const newTask = createTask("新しいタスク", "since以降", "pm", 50)
    insertEventAt(db, "gate.passed", {
      type: "gate.passed", taskId: newTask.id, gate: "gate1",
    }, "2026-03-17T01:00:00.000Z")

    await sendMorningReport(since)

    expect(mockNotifier.sendReport).toHaveBeenCalledTimes(1)
    const report = mockNotifier.sendReport.mock.calls[0][0]

    const gate1Section = report.sections.find(
      (s: { heading: string }) => s.heading === "Gate1",
    )
    expect(gate1Section).toBeDefined()
    // since以降のgo: 1のみ。since以前のgo: 1, kill: 1, recycle: 1は除外される
    expect(gate1Section!.body).toMatch(/go\s*1/)
    expect(gate1Section!.body).toMatch(/kill\s*0/)
    expect(gate1Section!.body).toMatch(/recycle\s*0/)
  })

  it("since以降のイベントのみカウントされる", async () => {
    const { createTask } = await import("../db.js")
    const { getDb } = await import("../db/core.js")
    const { sendMorningReport } = await import("../morning-report.js")

    const db = getDb()

    const since = "2026-03-17T00:00:00.000Z"

    // since以降のイベントのみ
    const t1 = createTask("go対象", "テスト", "pm", 50)
    insertEventAt(db, "gate.passed", {
      type: "gate.passed", taskId: t1.id, gate: "gate1",
    }, "2026-03-17T02:00:00.000Z")

    const t2 = createTask("go対象2", "テスト", "pm", 50)
    insertEventAt(db, "gate.passed", {
      type: "gate.passed", taskId: t2.id, gate: "gate1",
    }, "2026-03-17T03:00:00.000Z")

    const t3 = createTask("kill対象", "テスト", "pm", 50)
    insertEventAt(db, "gate.rejected", {
      type: "gate.rejected", taskId: t3.id, gate: "gate1", verdict: "kill", reason: "bad",
    }, "2026-03-17T04:00:00.000Z")

    const t4 = createTask("recycle対象1", "テスト", "pm", 50)
    insertEventAt(db, "gate.rejected", {
      type: "gate.rejected", taskId: t4.id, gate: "gate1", verdict: "recycle", reason: "retry",
    }, "2026-03-17T05:00:00.000Z")

    const t5 = createTask("recycle対象2", "テスト", "pm", 50)
    insertEventAt(db, "gate.rejected", {
      type: "gate.rejected", taskId: t5.id, gate: "gate1", verdict: "recycle", reason: "retry2",
    }, "2026-03-17T06:00:00.000Z")

    await sendMorningReport(since)

    expect(mockNotifier.sendReport).toHaveBeenCalledTimes(1)
    const report = mockNotifier.sendReport.mock.calls[0][0]

    const gate1Section = report.sections.find(
      (s: { heading: string }) => s.heading === "Gate1",
    )
    expect(gate1Section).toBeDefined()
    // go: 2, kill: 1, recycle: 2
    expect(gate1Section!.body).toMatch(/go\s*2/)
    expect(gate1Section!.body).toMatch(/kill\s*1/)
    expect(gate1Section!.body).toMatch(/recycle\s*2/)
  })

  it("since境界ちょうどのイベントはカウントに含まれない", async () => {
    const { createTask } = await import("../db.js")
    const { getDb } = await import("../db/core.js")
    const { sendMorningReport } = await import("../morning-report.js")

    const db = getDb()

    const since = "2026-03-17T00:00:00.000Z"

    // ちょうどsince時刻のイベント（> なので含まれない）
    const t1 = createTask("境界タスク", "ちょうどsince", "pm", 50)
    insertEventAt(db, "gate.passed", {
      type: "gate.passed", taskId: t1.id, gate: "gate1",
    }, since)

    // since後のイベント
    const t2 = createTask("後のタスク", "since後", "pm", 50)
    insertEventAt(db, "gate.passed", {
      type: "gate.passed", taskId: t2.id, gate: "gate1",
    }, "2026-03-17T00:00:01.000Z")

    await sendMorningReport(since)

    expect(mockNotifier.sendReport).toHaveBeenCalledTimes(1)
    const report = mockNotifier.sendReport.mock.calls[0][0]

    const gate1Section = report.sections.find(
      (s: { heading: string }) => s.heading === "Gate1",
    )
    expect(gate1Section).toBeDefined()
    // 境界ちょうどは除外、1秒後のみカウント → go: 1
    expect(gate1Section!.body).toMatch(/go\s*1/)
  })
})
