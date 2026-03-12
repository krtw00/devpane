import { describe, it, expect, vi, beforeEach } from "vitest"

// Test the collectFacts logic by mocking external dependencies
vi.mock("../worktree.js", () => ({
  commitWorktree: vi.fn(() => "abc123def"),
  getWorktreeDiff: vi.fn(() => ({
    filesChanged: ["src/index.ts", "src/utils.ts"],
    additions: 42,
    deletions: 10,
  })),
}))

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === "pnpm" && args[0] === "test") {
      return "Tests: 5 passed, 0 failed"
    }
    if (cmd === "pnpm" && args[0] === "run" && args[1] === "lint") {
      return "Done. 0 errors found."
    }
    return ""
  }),
}))

// Import after mocks are set up
const { collectFacts } = await import("../facts.js")

describe("collectFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("collects all observable facts on success", () => {
    const facts = collectFacts("task-001", "Add feature", "/tmp/worktree", 0)

    expect(facts.exit_code).toBe(0)
    expect(facts.files_changed).toEqual(["src/index.ts", "src/utils.ts"])
    expect(facts.diff_stats).toEqual({ additions: 42, deletions: 10 })
    expect(facts.branch).toBe("devpane/task-task-001")
    expect(facts.commit_hash).toBe("abc123def")
  })

  it("parses test results from output", () => {
    const facts = collectFacts("task-002", "Fix bug", "/tmp/worktree", 0)
    expect(facts.test_result).toEqual({
      passed: 5,
      failed: 0,
      exit_code: 0,
    })
  })

  it("parses lint results from output", () => {
    const facts = collectFacts("task-003", "Lint check", "/tmp/worktree", 0)
    expect(facts.lint_result).toEqual({
      errors: 0,
      exit_code: 0,
    })
  })

  it("records non-zero exit code", () => {
    const facts = collectFacts("task-004", "Broken task", "/tmp/worktree", 1)
    expect(facts.exit_code).toBe(1)
  })

  it("returns default testResult when test throws unexpected error (no status)", async () => {
    const cp = await import("node:child_process")
    const mock = vi.mocked(cp.execFileSync)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mock.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "test") {
        // 予期しない例外（statusプロパティなし）— e.g. ENOMEM, signal kill
        throw new Error("unexpected crash")
      }
      return ""
    }) as any)

    const facts = collectFacts("task-005", "Crash test", "/tmp/worktree", 0)
    // catchブロックでstatusがundefinedの場合、現状testResultはundefined
    // 修正後はデフォルト値が設定されるべき
    expect(facts.test_result).toBeDefined()
    expect(facts.test_result!.failed).toBeGreaterThanOrEqual(1)
    expect(facts.test_result!.exit_code).toBe(1)
  })

  it("returns default lintResult when lint throws unexpected error (no status)", async () => {
    const cp = await import("node:child_process")
    const mock = vi.mocked(cp.execFileSync)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mock.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args.includes("lint")) {
        throw new Error("unexpected lint crash")
      }
      return ""
    }) as any)

    const facts = collectFacts("task-006", "Lint crash", "/tmp/worktree", 0)
    expect(facts.lint_result).toBeDefined()
    expect(facts.lint_result!.errors).toBeGreaterThanOrEqual(1)
    expect(facts.lint_result!.exit_code).toBe(1)
  })
})
