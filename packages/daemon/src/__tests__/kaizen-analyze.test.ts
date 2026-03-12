import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Mock execFileSync to simulate claude CLI
const mockExecFileSync = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

function createFailedTask() {
  const task = createTask("failing task", "description", "pm")
  startTask(task.id, "worker-0")
  const db = getDb()
  const result = JSON.stringify({ exit_code: 1, files_changed: [], diff_stats: { additions: 0, deletions: 0 } })
  db.prepare(`UPDATE tasks SET status = 'failed', finished_at = ?, result = ? WHERE id = ?`)
    .run(new Date().toISOString(), result, task.id)
  return task.id
}

const VALID_ANALYSIS = JSON.stringify({
  analysis: {
    top_failure: "test_gap",
    frequency: "3/10",
    why_chain: ["テストが不足", "Gate2が甘い", "テスト生成プロンプトに制約が反映されていない"],
  },
  improvements: [
    { target: "gate2", action: "add_check", description: "制約条件のテストカバレッジを検証" },
  ],
})

const INVALID_ANALYSIS_BAD_ROOT_CAUSE = JSON.stringify({
  analysis: {
    top_failure: "nonexistent_cause",
    frequency: "2/10",
    why_chain: ["原因不明"],
  },
  improvements: [
    { target: "gate1", action: "add_check", description: "何か" },
  ],
})

const INVALID_ANALYSIS_EMPTY_IMPROVEMENTS = JSON.stringify({
  analysis: {
    top_failure: "test_gap",
    frequency: "1/10",
    why_chain: ["テスト不足"],
  },
  improvements: [],
})

const INVALID_ANALYSIS_NOT_JSON = "This is not JSON at all"

const INVALID_ANALYSIS_MISSING_FIELDS = JSON.stringify({
  analysis: {
    top_failure: "test_gap",
  },
})

describe("kaizen analyze() with LLM call", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  it("returns null when no failed tasks exist", async () => {
    const { analyze } = await import("../kaizen.js")
    const result = analyze()
    expect(result).toBeNull()
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it("calls claude CLI with failed task context and returns parsed analysis", async () => {
    mockExecFileSync.mockReturnValue(VALID_ANALYSIS)

    for (let i = 0; i < 3; i++) createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(mockExecFileSync).toHaveBeenCalledOnce()
    const [cmd, args] = mockExecFileSync.mock.calls[0]
    expect(cmd).toBe("claude")
    expect(args).toContain("-p")

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
    expect(result!.analysis.why_chain).toHaveLength(3)
    expect(result!.improvements).toHaveLength(1)
    expect(result!.improvements[0].target).toBe("gate2")
    expect(result!.improvements[0].action).toBe("add_check")
  })

  it("returns null when claude output fails Zod validation (bad root_cause)", async () => {
    mockExecFileSync.mockReturnValue(INVALID_ANALYSIS_BAD_ROOT_CAUSE)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(mockExecFileSync).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when improvements array is empty (min 1 required)", async () => {
    mockExecFileSync.mockReturnValue(INVALID_ANALYSIS_EMPTY_IMPROVEMENTS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(mockExecFileSync).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when claude returns non-JSON output", async () => {
    mockExecFileSync.mockReturnValue(INVALID_ANALYSIS_NOT_JSON)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(mockExecFileSync).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when claude output has missing required fields", async () => {
    mockExecFileSync.mockReturnValue(INVALID_ANALYSIS_MISSING_FIELDS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(mockExecFileSync).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when claude CLI throws (process error)", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("claude: command not found")
    })

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(mockExecFileSync).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("includes failed task info in the prompt sent to claude", async () => {
    mockExecFileSync.mockReturnValue(VALID_ANALYSIS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    analyze()

    const [, args] = mockExecFileSync.mock.calls[0]
    const promptFlagIndex = args.indexOf("-p")
    expect(promptFlagIndex).toBeGreaterThanOrEqual(0)
    const prompt = args[promptFlagIndex + 1]
    expect(prompt).toContain("fail")
  })

  it("why_chain exceeding max length (>5) is rejected", async () => {
    const tooLongChain = JSON.stringify({
      analysis: {
        top_failure: "test_gap",
        frequency: "5/10",
        why_chain: ["1", "2", "3", "4", "5", "6"],
      },
      improvements: [
        { target: "gate1", action: "add_check", description: "fix" },
      ],
    })
    mockExecFileSync.mockReturnValue(tooLongChain)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = analyze()

    expect(result).toBeNull()
  })

  it("passes timeout option to execFileSync", async () => {
    mockExecFileSync.mockReturnValue(VALID_ANALYSIS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    analyze()

    const callArgs = mockExecFileSync.mock.calls[0]
    const options = callArgs[callArgs.length - 1]
    expect(options).toHaveProperty("timeout")
    expect(options.timeout).toBeGreaterThan(0)
  })

  it("includes all failed tasks in prompt when multiple failures exist", async () => {
    mockExecFileSync.mockReturnValue(VALID_ANALYSIS)

    const ids = [createFailedTask(), createFailedTask(), createFailedTask()]

    const { analyze } = await import("../kaizen.js")
    analyze()

    const [, args] = mockExecFileSync.mock.calls[0]
    const promptFlagIndex = args.indexOf("-p")
    const prompt = args[promptFlagIndex + 1]
    // All 3 failed tasks should be referenced in the prompt
    for (const id of ids) {
      expect(prompt).toContain(id)
    }
  })

  it("passes encoding option as utf-8 to execFileSync", async () => {
    mockExecFileSync.mockReturnValue(VALID_ANALYSIS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    analyze()

    const callArgs = mockExecFileSync.mock.calls[0]
    const options = callArgs[callArgs.length - 1]
    expect(options).toHaveProperty("encoding", "utf-8")
  })
})
