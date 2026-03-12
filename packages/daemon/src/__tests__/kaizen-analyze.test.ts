import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Mock spawnClaude to simulate claude CLI
const mockSpawnClaude = vi.fn()
vi.mock("../claude.js", () => ({
  spawnClaude: (...args: unknown[]) => mockSpawnClaude(...args),
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

const VALID_ANALYSIS_WITH_FENCES = "```json\n" + VALID_ANALYSIS + "\n```"

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
    const result = await analyze()
    expect(result).toBeNull()
    expect(mockSpawnClaude).not.toHaveBeenCalled()
  })

  it("calls spawnClaude with failed task context and returns parsed analysis", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)

    for (let i = 0; i < 3; i++) createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    const [args] = mockSpawnClaude.mock.calls[0]
    expect(args).toContain("-p")

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
    expect(result!.analysis.why_chain).toHaveLength(3)
    expect(result!.improvements).toHaveLength(1)
    expect(result!.improvements[0].target).toBe("gate2")
    expect(result!.improvements[0].action).toBe("add_check")
  })

  it("returns null when claude output fails Zod validation (bad root_cause)", async () => {
    mockSpawnClaude.mockResolvedValue(INVALID_ANALYSIS_BAD_ROOT_CAUSE)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when improvements array is empty (min 1 required)", async () => {
    mockSpawnClaude.mockResolvedValue(INVALID_ANALYSIS_EMPTY_IMPROVEMENTS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when claude returns non-JSON output", async () => {
    mockSpawnClaude.mockResolvedValue(INVALID_ANALYSIS_NOT_JSON)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when claude output has missing required fields", async () => {
    mockSpawnClaude.mockResolvedValue(INVALID_ANALYSIS_MISSING_FIELDS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("returns null when spawnClaude rejects (process error)", async () => {
    mockSpawnClaude.mockRejectedValue(new Error("claude: command not found"))

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  it("includes failed task info in the prompt sent to claude", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    await analyze()

    const [args] = mockSpawnClaude.mock.calls[0]
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
    mockSpawnClaude.mockResolvedValue(tooLongChain)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).toBeNull()
  })

  it("passes timeout to spawnClaude", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    await analyze()

    const callArgs = mockSpawnClaude.mock.calls[0]
    // spawnClaude(args, cwd, timeoutMs) — third argument is timeout
    const timeoutMs = callArgs[2]
    expect(timeoutMs).toBeGreaterThan(0)
  })

  it("includes all failed tasks in prompt when multiple failures exist", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)

    const ids = [createFailedTask(), createFailedTask(), createFailedTask()]

    const { analyze } = await import("../kaizen.js")
    await analyze()

    const [args] = mockSpawnClaude.mock.calls[0]
    const promptFlagIndex = args.indexOf("-p")
    const prompt = args[promptFlagIndex + 1]
    // All 3 failed tasks should be referenced in the prompt
    for (const id of ids) {
      expect(prompt).toContain(id)
    }
  })

  it("strips markdown code fences from claude output before parsing", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS_WITH_FENCES)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
  })

  it("limits input tasks to a maximum of 20", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)

    // Create 25 failed tasks — only 20 should appear in the prompt
    for (let i = 0; i < 25; i++) createFailedTask()

    const { analyze } = await import("../kaizen.js")
    await analyze()

    const [args] = mockSpawnClaude.mock.calls[0]
    const promptFlagIndex = args.indexOf("-p")
    const prompt: string = args[promptFlagIndex + 1]
    // Count task entries in prompt (each line starts with "- [")
    const taskLines = prompt.split("\n").filter((l: string) => l.startsWith("- ["))
    expect(taskLines).toHaveLength(20)
  })
})

describe("kaizen analyze() edge cases", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  it("strips markdown fences without language tag", async () => {
    const withPlainFences = "```\n" + VALID_ANALYSIS + "\n```"
    mockSpawnClaude.mockResolvedValue(withPlainFences)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
  })

  it("returns null when spawnClaude returns empty string", async () => {
    mockSpawnClaude.mockResolvedValue("")

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).toBeNull()
  })

  it("accepts JSON with extra fields (Zod strips unknown keys)", async () => {
    const wrappedJson = JSON.stringify({
      analysis: {
        top_failure: "test_gap",
        frequency: "2/10",
        why_chain: ["理由1"],
        extra_field: "should be stripped or ignored",
      },
      improvements: [
        { target: "gate1", action: "add_check", description: "修正" },
      ],
    })
    mockSpawnClaude.mockResolvedValue(wrappedJson)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).not.toBeNull()
  })

  it("returns null for improvements with >5 items", async () => {
    const tooManyImprovements = JSON.stringify({
      analysis: {
        top_failure: "test_gap",
        frequency: "5/10",
        why_chain: ["理由1"],
      },
      improvements: Array.from({ length: 6 }, (_, i) => ({
        target: "gate1",
        action: "add_check",
        description: `改善${i}`,
      })),
    })
    mockSpawnClaude.mockResolvedValue(tooManyImprovements)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).toBeNull()
  })

  it("returns null for empty why_chain (min 1 required)", async () => {
    const emptyWhyChain = JSON.stringify({
      analysis: {
        top_failure: "test_gap",
        frequency: "1/10",
        why_chain: [],
      },
      improvements: [
        { target: "gate1", action: "add_check", description: "修正" },
      ],
    })
    mockSpawnClaude.mockResolvedValue(emptyWhyChain)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).toBeNull()
  })

  it("passes --output-format json flag to spawnClaude", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    await analyze()

    const [args] = mockSpawnClaude.mock.calls[0]
    expect(args).toContain("--output-format")
    expect(args).toContain("json")
  })

  it("accepts all valid top_failure enum values", async () => {
    const validValues = ["spec_ambiguity", "test_gap", "scope_creep", "api_misuse", "env_issue", "regression", "timeout", "unknown"]

    for (const topFailure of validValues) {
      initDb(":memory:", migrationsDir)
      vi.clearAllMocks()

      const analysis = JSON.stringify({
        analysis: {
          top_failure: topFailure,
          frequency: "1/10",
          why_chain: ["reason"],
        },
        improvements: [
          { target: "gate1", action: "add_check", description: "fix" },
        ],
      })
      mockSpawnClaude.mockResolvedValue(analysis)
      createFailedTask()

      const { analyze } = await import("../kaizen.js")
      const result = await analyze()

      expect(result, `top_failure=${topFailure} should be valid`).not.toBeNull()
      expect(result!.analysis.top_failure).toBe(topFailure)

      closeDb()
    }
  })
})
