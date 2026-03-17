import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../config.js", () => ({
  config: { PROJECT_ROOT: "/fake/project", BASE_BRANCH: "main", BRANCH_PREFIX: "devpane" },
}))

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}))

const execFileSyncMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

const { createWorktree, resetBaseRefWarningForTests } = await import("../worktree.js")

describe("createWorktree base ref resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBaseRefWarningForTests()
  })

  it("creates a worktree from the local base branch when available", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== "git") return ""
      if (args[0] === "show-ref" && args[3] === "refs/heads/devpane/task-abc123") {
        throw new Error("missing branch")
      }
      if (args[0] === "show-ref" && args[3] === "refs/heads/main") return ""
      if (args[0] === "worktree") return ""
      return ""
    })

    createWorktree("abc123")

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "/fake/project/.worktrees/task-abc123", "-b", "devpane/task-abc123", "main"],
      expect.any(Object),
    )
  })

  it("falls back to the remote tracking branch when the local base branch is absent", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== "git") return ""
      if (args[0] === "show-ref" && args[3] === "refs/heads/devpane/task-abc123") {
        throw new Error("missing branch")
      }
      if (args[0] === "show-ref" && args[3] === "refs/heads/main") {
        throw new Error("missing local base")
      }
      if (args[0] === "show-ref" && args[3] === "refs/remotes/origin/main") return ""
      if (args[0] === "worktree") return ""
      return ""
    })

    createWorktree("abc123")

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "/fake/project/.worktrees/task-abc123", "-b", "devpane/task-abc123", "origin/main"],
      expect.any(Object),
    )
  })
})
