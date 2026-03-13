import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock appendLog to verify build error logging
const mockAppendLog = vi.fn()
vi.mock("../db.js", () => ({
  appendLog: (...args: unknown[]) => mockAppendLog(...args),
}))

vi.mock("../worktree.js", () => ({
  commitWorktree: vi.fn(() => "abc123def"),
  getWorktreeDiff: vi.fn(() => ({
    filesChanged: ["src/index.ts"],
    additions: 10,
    deletions: 2,
  })),
}))

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === "pnpm" && args[0] === "build") {
      const err = Object.assign(new Error("build failed: type error in src/foo.ts"), {
        status: 1,
        stderr: "error TS2304: Cannot find name 'foo'",
      })
      throw err
    }
    if (cmd === "pnpm" && args[0] === "test") {
      return "Tests: 3 passed, 0 failed"
    }
    return ""
  }),
}))

const { collectFacts } = await import("../facts.js")

describe("collectFacts: pnpm build失敗時のログ記録", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("pnpm buildが失敗した場合、appendLogでビルドエラーが記録される", () => {
    collectFacts("task-build-fail", "Fix types", "/tmp/worktree", 0)

    // appendLog がビルドエラーを記録するために呼ばれた
    expect(mockAppendLog).toHaveBeenCalledWith(
      "task-build-fail",
      expect.any(String),
      expect.stringContaining("build"),
    )
  })

  it("pnpm buildが失敗した場合、exit_codeが1に上書きされる", () => {
    const facts = collectFacts("task-build-fail-2", "Fix types", "/tmp/worktree", 0)

    // ビルド失敗時はexit_codeが0のままではなく1に反映されるべき
    expect(facts.exit_code).toBe(1)
  })

  it("pnpm buildが失敗した場合、exit_codeが元のexit_code以上になる", () => {
    // 元々exit_code=1の場合でも、ビルド失敗で上書きされても問題ない
    const facts = collectFacts("task-build-fail-3", "Fix types", "/tmp/worktree", 1)

    expect(facts.exit_code).toBeGreaterThanOrEqual(1)
  })
})
