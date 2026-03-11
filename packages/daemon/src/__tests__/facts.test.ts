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
})
