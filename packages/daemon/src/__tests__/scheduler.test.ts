import { describe, it, expect, vi, beforeEach } from "vitest"
import { isRateLimitError } from "../scheduler.js"
import type { AgentEvent } from "@devpane/shared/schemas"

// Capture emitted events for verification
const emittedEvents: AgentEvent[] = []

vi.mock("../events.js", () => ({
  emit: vi.fn((event: AgentEvent) => { emittedEvents.push(event) }),
  safeEmit: vi.fn(() => true),
}))

describe("isRateLimitError", () => {
  it("detects rate limit messages", () => {
    expect(isRateLimitError("Error: rate limit exceeded")).toBe(true)
    expect(isRateLimitError("429 Too Many Requests")).toBe(true)
    expect(isRateLimitError("Rate-limit reached, please wait")).toBe(true)
    expect(isRateLimitError("API quota exceeded")).toBe(true)
    expect(isRateLimitError("Server overloaded, try again later")).toBe(true)
  })

  it("does not match normal errors", () => {
    expect(isRateLimitError("SyntaxError: unexpected token")).toBe(false)
    expect(isRateLimitError("command not found: claude")).toBe(false)
    expect(isRateLimitError("ENOENT: no such file")).toBe(false)
  })
})

describe("scheduler event emission", () => {
  beforeEach(() => {
    emittedEvents.length = 0
  })

  it("emit mock captures events correctly", async () => {
    const { emit } = await import("../events.js")
    emit({ type: "task.started", taskId: "t1", workerId: "w1" })
    emit({ type: "gate.passed", taskId: "t1", gate: "gate1" })
    emit({ type: "gate.rejected", taskId: "t2", gate: "gate3", verdict: "kill", reason: "no commit" })

    expect(emittedEvents).toHaveLength(3)
    expect(emittedEvents[0]).toEqual({ type: "task.started", taskId: "t1", workerId: "w1" })
    expect(emittedEvents[1]).toEqual({ type: "gate.passed", taskId: "t1", gate: "gate1" })
    expect(emittedEvents[2]).toEqual({
      type: "gate.rejected",
      taskId: "t2",
      gate: "gate3",
      verdict: "kill",
      reason: "no commit",
    })
  })

  it("emits all pipeline event types", async () => {
    const { emit } = await import("../events.js")

    const events: AgentEvent[] = [
      { type: "task.started", taskId: "t1", workerId: "w1" },
      { type: "gate.passed", taskId: "t1", gate: "gate1" },
      { type: "gate.passed", taskId: "t1", gate: "gate3" },
      { type: "task.completed", taskId: "t1", costUsd: 0.05 },
      { type: "pr.created", taskId: "t1", url: "https://github.com/test/pr/1" },
    ]

    for (const e of events) emit(e)

    expect(emittedEvents).toHaveLength(5)
    const types = emittedEvents.map(e => e.type)
    expect(types).toContain("task.started")
    expect(types).toContain("gate.passed")
    expect(types).toContain("task.completed")
    expect(types).toContain("pr.created")
  })
})
