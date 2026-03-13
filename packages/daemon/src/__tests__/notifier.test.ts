import { describe, it, expect, vi } from "vitest"
import { NullNotifier, formatEventPlain } from "../notifier.js"

vi.mock("../db.js", () => ({
  getTask: vi.fn().mockReturnValue({ title: "テストタスク" }),
}))

describe("notifier", () => {
  describe("formatEventPlain", () => {
    it("formats task.completed", () => {
      const text = formatEventPlain({ type: "task.completed", taskId: "abc", costUsd: 0.0123 })
      expect(text).toBe("[完了] テストタスク (コスト: $0.0123)")
    })

    it("formats task.failed", () => {
      const text = formatEventPlain({ type: "task.failed", taskId: "abc", rootCause: "test_gap" })
      expect(text).toBe("[失敗] テストタスク (原因: test_gap)")
    })

    it("formats spc.alert", () => {
      const text = formatEventPlain({ type: "spc.alert", metric: "cost_usd", value: 1.5, ucl: 1.0 })
      expect(text).toBe("[SPC異常] cost_usd: 1.5000 / UCL: 1.0000")
    })

    it("returns null for non-notable events", () => {
      expect(formatEventPlain({ type: "task.started", taskId: "abc", workerId: "w-0" })).toBeNull()
      expect(formatEventPlain({ type: "pm.invoked", reason: "queue_empty" })).toBeNull()
    })

    it("returns null for gate.rejected with recycle verdict", () => {
      const text = formatEventPlain({ type: "gate.rejected", taskId: "abc", gate: "gate1", verdict: "recycle", reason: "test" })
      expect(text).toBeNull()
    })

    it("formats gate.rejected with kill verdict", () => {
      const text = formatEventPlain({ type: "gate.rejected", taskId: "abc", gate: "gate1", verdict: "kill", reason: "scope creep" })
      expect(text).toBe("[Gate Kill] テストタスク: scope creep")
    })
  })

  describe("NullNotifier", () => {
    it("sendMessage does nothing", async () => {
      const n = new NullNotifier()
      await expect(n.sendMessage("test")).resolves.toBeUndefined()
    })

    it("notify does nothing", async () => {
      const n = new NullNotifier()
      await expect(n.notify({ type: "task.completed", taskId: "abc", costUsd: 0 })).resolves.toBeUndefined()
    })
  })
})
