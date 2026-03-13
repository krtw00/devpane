import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../config.js", () => ({
  config: { PROJECT_ROOT: "/fake/project" },
}))

vi.mock("node:fs", () => ({
  existsSync: () => true,
  readdirSync: () => ["task-abc123", "merge-xyz"],
}))

const execFileSyncMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

const { pruneWorktrees } = await import("../worktree.js")

describe("pruneWorktrees skips branches with open PRs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not delete a branch that has an open PR", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      // git worktree prune
      if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") return ""
      // git worktree remove (for stale worktrees)
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") return ""
      // git branch --list devpane/*
      if (cmd === "git" && args[0] === "branch" && args[1] === "--list") {
        return "  devpane/task-open-pr\n  devpane/task-no-pr\n"
      }
      // gh pr list --head=<branch> to check open PRs
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        const headIdx = args.findIndex((a: string) => typeof a === "string" && a.startsWith("--head"))
        let branchName = ""
        if (headIdx !== -1) {
          const headArg = args[headIdx] as string
          // Could be --head=branch or --head branch
          if (headArg.includes("=")) {
            branchName = headArg.split("=")[1]
          } else {
            branchName = args[headIdx + 1] as string
          }
        }
        if (branchName === "devpane/task-open-pr") {
          return JSON.stringify([{ number: 42 }])
        }
        return "[]"
      }
      // git branch -D
      if (cmd === "git" && args[0] === "branch" && args[1] === "-D") return ""
      return ""
    })

    pruneWorktrees()

    const branchDeleteCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "git" && (c[1] as string[])[0] === "branch" && (c[1] as string[])[1] === "-D",
    )

    // The branch with an open PR should NOT be deleted
    const deletedBranches = branchDeleteCalls.map((c: unknown[]) => (c[1] as string[])[2])
    expect(deletedBranches).not.toContain("devpane/task-open-pr")
  })

  it("deletes branches without open PRs", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") return ""
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") return ""
      if (cmd === "git" && args[0] === "branch" && args[1] === "--list") {
        return "  devpane/task-no-pr\n"
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        return "[]"
      }
      if (cmd === "git" && args[0] === "branch" && args[1] === "-D") return ""
      return ""
    })

    pruneWorktrees()

    const branchDeleteCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "git" && (c[1] as string[])[0] === "branch" && (c[1] as string[])[1] === "-D",
    )
    const deletedBranches = branchDeleteCalls.map((c: unknown[]) => (c[1] as string[])[2])
    expect(deletedBranches).toContain("devpane/task-no-pr")
  })

  it("still deletes branch when gh pr list fails (fallback to current behavior)", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") return ""
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") return ""
      if (cmd === "git" && args[0] === "branch" && args[1] === "--list") {
        return "  devpane/task-fallback\n"
      }
      if (cmd === "gh") {
        throw new Error("gh not available")
      }
      if (cmd === "git" && args[0] === "branch" && args[1] === "-D") return ""
      return ""
    })

    pruneWorktrees()

    const branchDeleteCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "git" && (c[1] as string[])[0] === "branch" && (c[1] as string[])[1] === "-D",
    )
    // When gh fails, branch should still be deleted (safe fallback to avoid accumulation)
    const deletedBranches = branchDeleteCalls.map((c: unknown[]) => (c[1] as string[])[2])
    expect(deletedBranches).toContain("devpane/task-fallback")
  })

  it("handles mix of open-PR and no-PR branches correctly", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") return ""
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") return ""
      if (cmd === "git" && args[0] === "branch" && args[1] === "--list") {
        return "  devpane/task-pr1\n  devpane/task-stale\n  devpane/task-pr2\n"
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        const headIdx = args.findIndex((a: string) => typeof a === "string" && a.startsWith("--head"))
        let branchName = ""
        if (headIdx !== -1) {
          const headArg = args[headIdx] as string
          if (headArg.includes("=")) {
            branchName = headArg.split("=")[1]
          } else {
            branchName = args[headIdx + 1] as string
          }
        }
        if (branchName === "devpane/task-pr1" || branchName === "devpane/task-pr2") {
          return JSON.stringify([{ number: 10 }])
        }
        return "[]"
      }
      if (cmd === "git" && args[0] === "branch" && args[1] === "-D") return ""
      return ""
    })

    pruneWorktrees()

    const branchDeleteCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "git" && (c[1] as string[])[0] === "branch" && (c[1] as string[])[1] === "-D",
    )
    const deletedBranches = branchDeleteCalls.map((c: unknown[]) => (c[1] as string[])[2])

    expect(deletedBranches).not.toContain("devpane/task-pr1")
    expect(deletedBranches).not.toContain("devpane/task-pr2")
    expect(deletedBranches).toContain("devpane/task-stale")
  })
})
