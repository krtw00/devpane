import { describe, it, expect, vi, beforeEach } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecFileSync = vi.fn<(...args: any[]) => string>(() => "")

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}))

const { createPullRequest, autoMergePr } = await import("../worktree.js")

describe("worktree.ts ネットワーク系コマンドのtimeout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFileSync.mockReturnValue("")
  })

  it("git push に timeout: 60_000 が設定されている", () => {
    mockExecFileSync.mockReturnValue("https://github.com/test/pr/1")

    createPullRequest("test-id", "test title", {
      files_changed: ["src/foo.ts"],
      diff_stats: { additions: 1, deletions: 0 },
    })

    const pushCall = mockExecFileSync.mock.calls.find(
      (call) => call[0] === "git" && (call[1] as string[]).includes("push"),
    )
    expect(pushCall).toBeDefined()
    expect((pushCall![2] as Record<string, unknown>).timeout).toBe(60_000)
  })

  it("gh pr create に timeout: 60_000 が設定されている", () => {
    mockExecFileSync.mockReturnValue("https://github.com/test/pr/1")

    createPullRequest("test-id", "test title", {
      files_changed: ["src/foo.ts"],
      diff_stats: { additions: 1, deletions: 0 },
    })

    const prCreateCall = mockExecFileSync.mock.calls.find(
      (call) => call[0] === "gh" && (call[1] as string[])[0] === "pr" && (call[1] as string[])[1] === "create",
    )
    expect(prCreateCall).toBeDefined()
    expect((prCreateCall![2] as Record<string, unknown>).timeout).toBe(60_000)
  })

  it("gh pr merge に timeout が設定されている", () => {
    autoMergePr("test-id")

    const mergeCall = mockExecFileSync.mock.calls.find(
      (call) => call[0] === "gh" && (call[1] as string[])[0] === "pr" && (call[1] as string[])[1] === "merge",
    )
    expect(mergeCall).toBeDefined()
    expect((mergeCall![2] as Record<string, unknown>).timeout).toBeGreaterThan(0)
  })
})
