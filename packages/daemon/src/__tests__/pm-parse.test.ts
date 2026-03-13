import { describe, it, expect } from "vitest"
import { parsePmOutput } from "../pm.js"

describe("parsePmOutput - JSON parse error handling", () => {
  it("parses valid JSON correctly", () => {
    const input = JSON.stringify({
      tasks: [{ title: "Test task", description: "desc", priority: 1 }],
      reasoning: "reason",
    })
    const result = parsePmOutput(input)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe("Test task")
    expect(result.reasoning).toBe("reason")
  })

  it("throws with descriptive message when text contains no JSON", () => {
    expect(() => parsePmOutput("plain text with no braces")).toThrow(
      "PM output does not contain valid JSON",
    )
  })

  it("throws with extracted snippet when regex matches invalid JSON", () => {
    const input = "Here is output: {tasks: invalid, not real json} done"
    expect(() => parsePmOutput(input)).toThrow("PM output contains invalid JSON")
    expect(() => parsePmOutput(input)).toThrow("{tasks: invalid, not real json}")
  })

  it("truncates long invalid JSON snippet to 200 chars in error message", () => {
    const longValue = "x".repeat(300)
    const input = `{tasks: ${longValue}}`
    try {
      parsePmOutput(input)
      expect.unreachable("should have thrown")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("PM output contains invalid JSON")
      expect(msg.length).toBeLessThan(300)
    }
  })
})
