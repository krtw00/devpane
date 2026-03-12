import { describe, it, expect } from "vitest"
import { runGate1 } from "../gate1.js"
import type { PmOutput, Memory } from "@devpane/shared"

function makeSpec(overrides: Partial<PmOutput> = {}): PmOutput {
  return {
    tasks: [
      {
        title: "Add user authentication",
        description: "Implement JWT-based authentication with login/logout endpoints and middleware for route protection",
        priority: 3,
      },
    ],
    reasoning: "Security is a priority",
    ...overrides,
  }
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "01TEST",
    category: "feature",
    content: "Implemented user authentication with JWT",
    source_task_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("Gate 1", () => {
  it("passes valid spec", () => {
    const result = runGate1(makeSpec(), [])
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("kills spec with empty title", () => {
    const result = runGate1(makeSpec({
      tasks: [{ title: "", description: "x".repeat(50), priority: 3 }],
    }), [])
    expect(result.verdict).toBe("kill")
    expect(result.reasons).toContainEqual(expect.stringContaining("title is empty"))
  })

  it("kills spec with empty description", () => {
    const result = runGate1(makeSpec({
      tasks: [{ title: "Some task", description: "", priority: 3 }],
    }), [])
    expect(result.verdict).toBe("kill")
    expect(result.reasons).toContainEqual(expect.stringContaining("description is empty"))
  })

  it("kills spec with whitespace-only title", () => {
    const result = runGate1(makeSpec({
      tasks: [{ title: "   ", description: "x".repeat(50), priority: 3 }],
    }), [])
    expect(result.verdict).toBe("kill")
    expect(result.reasons).toContainEqual(expect.stringContaining("title is empty"))
  })

  it("recycles spec with priority out of range (too low)", () => {
    const result = runGate1(makeSpec({
      tasks: [{ title: "Task", description: "x".repeat(50), priority: 0 }],
    }), [])
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toContainEqual(expect.stringContaining("priority=0"))
  })

  it("recycles spec with priority out of range (too high)", () => {
    const result = runGate1(makeSpec({
      tasks: [{ title: "Task", description: "x".repeat(50), priority: 10 }],
    }), [])
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toContainEqual(expect.stringContaining("priority=10"))
  })

  it("recycles spec with similar feature in memories", () => {
    const memories = [makeMemory({ content: "Implemented add user authentication module" })]
    const result = runGate1(makeSpec({
      tasks: [{ title: "Add user authentication", description: "x".repeat(50), priority: 3 }],
    }), memories)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toContainEqual(expect.stringContaining("similar feature"))
  })

  it("ignores non-feature memories", () => {
    const memories = [makeMemory({ category: "decision", content: "Add user authentication" })]
    const result = runGate1(makeSpec(), memories)
    expect(result.verdict).toBe("go")
  })

  it("recycles spec with short description", () => {
    const result = runGate1(makeSpec({
      tasks: [{ title: "Task", description: "Too short", priority: 3 }],
    }), [])
    expect(result.verdict).toBe("recycle")
    expect(result.reasons).toContainEqual(expect.stringContaining("description too short"))
  })

  it("checks all tasks in the spec", () => {
    const result = runGate1(makeSpec({
      tasks: [
        { title: "Good task", description: "x".repeat(50), priority: 3 },
        { title: "", description: "x".repeat(50), priority: 3 },
      ],
    }), [])
    expect(result.verdict).toBe("kill")
    expect(result.reasons).toContainEqual(expect.stringContaining("task[1]"))
  })

  it("kill takes precedence over recycle", () => {
    const result = runGate1(makeSpec({
      tasks: [
        { title: "", description: "short", priority: 0 },
      ],
    }), [])
    expect(result.verdict).toBe("kill")
    expect(result.reasons.length).toBeGreaterThan(1)
  })

  it("case-insensitive similarity check", () => {
    const memories = [makeMemory({ content: "ADD USER AUTHENTICATION module" })]
    const result = runGate1(makeSpec({
      tasks: [{ title: "add user authentication", description: "x".repeat(50), priority: 3 }],
    }), memories)
    expect(result.verdict).toBe("recycle")
  })
})
