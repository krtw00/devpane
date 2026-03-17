import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parsePmOutput } from "../pm.js"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Mock external dependencies for runPm tests
const mockCallLlm = vi.fn()
vi.mock("../llm-bridge.js", () => ({
  callLlm: (...args: unknown[]) => mockCallLlm(...args),
}))
vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}))
vi.mock("../memory.js", () => ({
  recall: vi.fn(() => []),
}))

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

describe("buildPmPrompt - failed task with invalid JSON result", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  function createFailedTaskWithResult(result: string | null) {
    const task = createTask("broken task", "description of broken task", "pm")
    startTask(task.id, "worker-0")
    getDb()
      .prepare(`UPDATE tasks SET status = 'failed', finished_at = ?, result = ? WHERE id = ?`)
      .run(new Date().toISOString(), result, task.id)
    return task
  }

  const VALID_PM_RESPONSE = JSON.stringify({
    tasks: [{ title: "Next task", description: "do something useful", priority: 1 }],
    reasoning: "test reasoning",
  })

  it("does not crash when failed task result is invalid JSON", async () => {
    createFailedTaskWithResult("THIS IS NOT VALID JSON")
    mockCallLlm.mockResolvedValue({ text: VALID_PM_RESPONSE, cost_usd: 0, tokens_used: 0 })

    const { runPm } = await import("../pm.js")
    const result = await runPm()

    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].title).toBe("Next task")
  })

  it("does not crash when failed task result is partially valid JSON", async () => {
    createFailedTaskWithResult("{invalid json with brace")
    mockCallLlm.mockResolvedValue({ text: VALID_PM_RESPONSE, cost_usd: 0, tokens_used: 0 })

    const { runPm } = await import("../pm.js")
    const result = await runPm()

    expect(result.tasks).toHaveLength(1)
  })

  it("includes failed task title in prompt even with invalid result", async () => {
    createFailedTaskWithResult("NOT JSON")
    mockCallLlm.mockResolvedValue({ text: VALID_PM_RESPONSE, cost_usd: 0, tokens_used: 0 })

    const { runPm } = await import("../pm.js")
    await runPm()

    // callLlm(prompt, cwd, timeoutMs)
    const [prompt] = mockCallLlm.mock.calls[0]
    expect(prompt).toContain("broken task")
    expect(prompt).toContain("[failed]")
  })
})
