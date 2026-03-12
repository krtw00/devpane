import { describe, it, expect } from "vitest"
import { parsePmOutput, isDuplicate } from "../pm.js"

describe("parsePmOutput", () => {
  it("parses direct JSON output", () => {
    const input = JSON.stringify({
      tasks: [{ title: "Add tests", description: "Write unit tests", priority: 5 }],
      reasoning: "Tests are needed",
    })
    const result = parsePmOutput(input)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe("Add tests")
    expect(result.reasoning).toBe("Tests are needed")
  })

  it("parses claude CLI wrapped output (result field)", () => {
    const inner = JSON.stringify({
      tasks: [{ title: "Fix bug", description: "Fix the login bug", priority: 3 }],
      reasoning: "Bug reported",
    })
    const wrapped = JSON.stringify({ result: inner })
    const result = parsePmOutput(wrapped)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe("Fix bug")
  })

  it("extracts JSON from mixed text output", () => {
    const text = `Here is my analysis:\n{"tasks": [{"title": "Refactor", "description": "Clean up code", "priority": 1}], "reasoning": "Needs cleanup"}\nEnd of output.`
    const result = parsePmOutput(text)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe("Refactor")
  })

  it("handles multiple tasks", () => {
    const input = JSON.stringify({
      tasks: [
        { title: "Task A", description: "Do A", priority: 5 },
        { title: "Task B", description: "Do B", priority: 3 },
        { title: "Task C", description: "Do C", priority: 1 },
      ],
      reasoning: "Three things to do",
    })
    const result = parsePmOutput(input)
    expect(result.tasks).toHaveLength(3)
  })

  it("throws on output without JSON", () => {
    expect(() => parsePmOutput("No JSON here")).toThrow("does not contain valid JSON")
  })

  it("throws on output without tasks array", () => {
    expect(() => parsePmOutput('{"reasoning": "no tasks"}')).toThrow("PM output validation failed")
  })

  it("handles claude CLI json with nested result containing JSON", () => {
    const inner = '{"tasks": [{"title": "T1", "description": "D1", "priority": 1}], "reasoning": "R1"}'
    const cliOutput = JSON.stringify({
      type: "result",
      subtype: "success",
      result: `Here is the plan:\n${inner}`,
    })
    const result = parsePmOutput(cliOutput)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe("T1")
  })
})

describe("isDuplicate", () => {
  const existing = [
    "スケジューラ制御APIとメモリ管理API",
    "Gate 1 方針チェックの実装",
    "SPC管理図APIとメトリクスダッシュボードUI",
  ]

  it("detects exact match", () => {
    expect(isDuplicate("Gate 1 方針チェックの実装", existing)).toBe(true)
  })

  it("detects match ignoring whitespace and symbols", () => {
    expect(isDuplicate("Gate1方針チェックの実装", existing)).toBe(true)
  })

  it("detects substring match (new contains existing)", () => {
    expect(isDuplicate("SPC管理図APIとメトリクスダッシュボードUIの改善", existing)).toBe(true)
  })

  it("detects substring match (existing contains new)", () => {
    expect(isDuplicate("スケジューラ制御API", existing)).toBe(true)
  })

  it("allows genuinely new tasks", () => {
    expect(isDuplicate("Discord Webhook通知の実装", existing)).toBe(false)
  })

  it("handles empty existing list", () => {
    expect(isDuplicate("何でもいい", [])).toBe(false)
  })
})
