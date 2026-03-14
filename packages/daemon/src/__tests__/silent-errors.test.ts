import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("@devpane/shared/schemas", () => ({
  AgentEventSchema: { safeParse: vi.fn() },
}))

vi.mock("../db.js", () => ({
  insertAgentEvent: vi.fn(),
  getDb: vi.fn(),
  getTask: vi.fn().mockReturnValue({ title: "テストタスク" }),
}))

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))

vi.mock("../config.js", () => ({
  config: {
    PROJECT_ROOT: "/tmp/test-project",
  },
}))

describe("silent error logging", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe("events.ts: notifier failure logging", () => {
    it("logs console.warn when notifier.notify rejects", async () => {
      const notifyError = new Error("webhook timeout")
      vi.doMock("../notifier-factory.js", () => ({
        getNotifier: () => ({
          notify: vi.fn().mockRejectedValue(notifyError),
        }),
      }))

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { emit } = await import("../events.js")

      emit({ type: "task.completed", taskId: "t-001", costUsd: 0.01 })

      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith("[notifier] failed:", notifyError)
      })
    })
  })

  describe("worktree.ts: countOpenPrs failure logging", () => {
    it("logs console.warn when gh CLI fails", async () => {
      const ghError = new Error("gh: command not found")
      vi.doMock("node:child_process", () => ({
        execFileSync: vi.fn().mockImplementation(() => {
          throw ghError
        }),
      }))

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { countOpenPrs } = await import("../worktree.js")

      const result = countOpenPrs()

      expect(result).toBe(null)
      expect(warnSpy).toHaveBeenCalledWith("[worktree] countOpenPrs failed:", ghError)
    })
  })
})
