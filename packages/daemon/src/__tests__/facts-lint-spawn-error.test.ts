import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../db.js", () => ({
  appendLog: vi.fn(),
}))

vi.mock("../worktree.js", () => ({
  commitWorktree: vi.fn(() => "abc123def"),
  getWorktreeDiff: vi.fn(() => ({
    filesChanged: ["src/index.ts"],
    additions: 5,
    deletions: 1,
  })),
}))

// execFileSyncがlintコマンド時にstatusプロパティなしのErrorをthrow
// → pnpmコマンド自体のspawn失敗（ENOENT等）を模擬
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === "pnpm" && args.includes("lint")) {
      // statusプロパティなし = JS例外（spawn失敗、ENOENT等）
      throw new Error("spawn ENOENT: pnpm not found")
    }
    if (cmd === "pnpm" && args[0] === "test") {
      return "Tests: 3 passed, 0 failed"
    }
    return ""
  }),
}))

const { collectFacts } = await import("../facts.js")

describe("collectFacts: lintコマンドのspawn失敗（JS例外）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("statusプロパティなしのErrorではlint_resultがundefinedになる", () => {
    const facts = collectFacts("task-lint-spawn", "Test task", "/tmp/worktree", 0)

    // spawn失敗はlintエラーではないため、lint_resultは設定されるべきでない
    expect(facts.lint_result).toBeUndefined()
  })

  it("spawn失敗時にlint errors: N としてgate3に渡らない", () => {
    const facts = collectFacts("task-lint-spawn-2", "Test task", "/tmp/worktree", 0)

    // lint_resultが存在する場合でもerrors: 0であるべき
    if (facts.lint_result) {
      expect(facts.lint_result.errors).toBe(0)
    }
  })

  it("spawn失敗してもテスト結果は正常に取得される", () => {
    const facts = collectFacts("task-lint-spawn-3", "Test task", "/tmp/worktree", 0)

    expect(facts.test_result).toEqual({
      passed: 3,
      failed: 0,
      exit_code: 0,
    })
  })
})
