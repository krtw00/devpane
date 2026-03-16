import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecFileSync = vi.fn()
const mockAppendLog = vi.fn()

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

vi.mock("../db.js", () => ({
  appendLog: (...args: unknown[]) => mockAppendLog(...args),
}))

vi.mock("../worktree.js", () => ({
  commitWorktree: vi.fn(() => "abc123def"),
  getWorktreeDiff: vi.fn(() => ({
    filesChanged: ["src/index.ts"],
    additions: 5,
    deletions: 1,
  })),
}))

const { collectFacts } = await import("../facts.js")

describe("collectFacts: ビルド失敗時にテスト・lintをスキップ", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ビルド失敗時、テストコマンドが呼ばれない", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "build") {
        throw Object.assign(new Error("build failed"), { status: 1, stderr: "type error" })
      }
      return ""
    })

    collectFacts("task-skip-1", "Fail build", "/tmp/wt", 0)

    const calls = mockExecFileSync.mock.calls
    const testCalls = calls.filter(
      ([cmd, args]: [string, string[]]) => cmd === "pnpm" && args[0] === "test",
    )
    expect(testCalls).toHaveLength(0)
  })

  it("ビルド失敗時、lintコマンドが呼ばれない", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "build") {
        throw Object.assign(new Error("build failed"), { status: 1, stderr: "type error" })
      }
      return ""
    })

    collectFacts("task-skip-2", "Fail build", "/tmp/wt", 0)

    const calls = mockExecFileSync.mock.calls
    const lintCalls = calls.filter(
      ([cmd, args]: [string, string[]]) => cmd === "pnpm" && args.includes("lint"),
    )
    expect(lintCalls).toHaveLength(0)
  })

  it("ビルド失敗時、test_resultのデフォルト値が設定される", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "build") {
        throw Object.assign(new Error("build failed"), { status: 1, stderr: "type error" })
      }
      return ""
    })

    const facts = collectFacts("task-skip-3", "Fail build", "/tmp/wt", 0)

    expect(facts.test_result).toEqual({
      passed: 0,
      failed: 0,
      exit_code: 0,
    })
  })

  it("ビルド失敗時、lint_resultのデフォルト値が設定される", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "build") {
        throw Object.assign(new Error("build failed"), { status: 1, stderr: "type error" })
      }
      return ""
    })

    const facts = collectFacts("task-skip-4", "Fail build", "/tmp/wt", 0)

    expect(facts.lint_result).toEqual({
      errors: 0,
      exit_code: 0,
    })
  })

  it("ビルド失敗時、factsにbuild_failed: trueが含まれる", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "build") {
        throw Object.assign(new Error("build failed"), { status: 1, stderr: "type error" })
      }
      return ""
    })

    const facts = collectFacts("task-skip-5", "Fail build", "/tmp/wt", 0)

    expect(facts.build_failed).toBe(true)
  })

  it("ビルド成功時、テスト・lintが通常通り実行される", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "pnpm" && args[0] === "test") {
        return "Tests: 3 passed, 0 failed"
      }
      if (cmd === "pnpm" && args.includes("lint")) {
        return "Done. 0 errors found."
      }
      return ""
    })

    const facts = collectFacts("task-ok-1", "Success build", "/tmp/wt", 0)

    const calls = mockExecFileSync.mock.calls
    const testCalls = calls.filter(
      ([cmd, args]: [string, string[]]) => cmd === "pnpm" && args[0] === "test",
    )
    const lintCalls = calls.filter(
      ([cmd, args]: [string, string[]]) => cmd === "pnpm" && args.includes("lint"),
    )
    expect(testCalls).toHaveLength(1)
    expect(lintCalls).toHaveLength(1)
    expect(facts.test_result?.passed).toBe(3)
    expect(facts.lint_result?.errors).toBe(0)
  })

  it("ビルド成功時、build_failedがfalseまたは未設定", () => {
    mockExecFileSync.mockReturnValue("")

    const facts = collectFacts("task-ok-2", "Success build", "/tmp/wt", 0)

    expect(facts.build_failed).toBeFalsy()
  })
})
