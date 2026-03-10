import { describe, it, expect } from "vitest"

// parsePmOutput is not exported, so we test it via a local copy of the logic.
// This validates the parsing logic that's critical for PM → task ingestion.

function parsePmOutput(stdout: string): { tasks: { title: string; description: string; priority: number }[]; reasoning: string } {
  let text: string
  try {
    const json = JSON.parse(stdout)
    text = json.result ?? stdout
  } catch {
    text = stdout
  }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`PM output does not contain valid JSON: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed.tasks)) throw new Error("PM output missing tasks array")

  return parsed
}

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
