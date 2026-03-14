import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../config.js", () => ({
  config: { PROJECT_ROOT: "/fake/project", BRANCH_PREFIX: "devpane" },
}))

vi.mock("node:fs", () => ({
  existsSync: () => true,
  readdirSync: () => [],
}))

const execFileSyncMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

const { pruneWorktrees } = await import("../worktree.js")

function setupMock(branchListOutput: string) {
  execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") return ""
    if (cmd === "git" && args[0] === "branch" && args[1] === "--list") {
      return branchListOutput
    }
    if (cmd === "gh" && args[0] === "pr" && args[1] === "list") return "[]"
    if (cmd === "git" && args[0] === "branch" && args[1] === "-D") return ""
    return ""
  })
}

function getDeletedBranches(): string[] {
  return execFileSyncMock.mock.calls
    .filter((c: unknown[]) => c[0] === "git" && (c[1] as string[])[0] === "branch" && (c[1] as string[])[1] === "-D")
    .map((c: unknown[]) => (c[1] as string[])[2])
}

describe("pruneWorktrees strips git branch prefix markers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("strips '* ' prefix from current branch", () => {
    setupMock("* devpane/task-current\n  devpane/task-normal\n")

    pruneWorktrees()

    const deleted = getDeletedBranches()
    expect(deleted).toContain("devpane/task-current")
    expect(deleted).toContain("devpane/task-normal")
    expect(deleted).not.toContain("* devpane/task-current")
  })

  it("strips '+ ' prefix from worktree-checked-out branch", () => {
    setupMock("+ devpane/task-wt\n  devpane/task-normal\n")

    pruneWorktrees()

    const deleted = getDeletedBranches()
    expect(deleted).toContain("devpane/task-wt")
    expect(deleted).not.toContain("+ devpane/task-wt")
  })

  it("handles mixed prefixes correctly", () => {
    setupMock("* devpane/task-current\n+ devpane/task-wt\n  devpane/task-plain\n")

    pruneWorktrees()

    const deleted = getDeletedBranches()
    expect(deleted).toContain("devpane/task-current")
    expect(deleted).toContain("devpane/task-wt")
    expect(deleted).toContain("devpane/task-plain")
  })

  it("does not pass prefix markers to git branch -D", () => {
    setupMock("* devpane/task-star\n+ devpane/task-plus\n")

    pruneWorktrees()

    const deleted = getDeletedBranches()
    for (const branch of deleted) {
      expect(branch).not.toMatch(/^[*+]/)
    }
  })
})
