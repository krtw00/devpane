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

// pnpm test が非ゼロ終了し、出力にpass/failパターンが含まれないケース
// 例: テストファイルが存在しない場合 "No test files found" で exit 1
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === "pnpm" && args[0] === "test") {
      const err = Object.assign(new Error("No test files found"), {
        status: 1,
        stdout: "No test files found, exiting with code 1\n",
        stderr: "",
      })
      throw err
    }
    return ""
  }),
}))

const { collectFacts } = await import("../facts.js")

describe("collectFacts: テスト出力にpass/failが含まれない場合", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("テストファイル不在で非ゼロ終了した場合、failed: 0を返す", () => {
    const facts = collectFacts("task-no-tests", "Init project", "/tmp/worktree", 0)

    expect(facts.test_result).toEqual({
      passed: 0,
      failed: 0,
      exit_code: 1,
    })
  })

  it("テストファイル不在でもexit_codeは正しく記録される", () => {
    const facts = collectFacts("task-no-tests-2", "Init project", "/tmp/worktree", 0)

    expect(facts.test_result!.exit_code).toBe(1)
  })
})
