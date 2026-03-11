import { describe, it, expect } from "vitest"
import { parsePmOutput } from "../pm.js"

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
    expect(() => parsePmOutput('{"reasoning": "no tasks"}')).toThrow("missing tasks array")
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
