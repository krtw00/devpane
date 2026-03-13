import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../config.js", () => ({
  config: { PROJECT_ROOT: "/fake/project" },
}))

const execFileSyncMock = vi.fn()
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

const { getWorktreeDiff, getWorktreeNewAndDeleted } = await import("../worktree.js")

function gitCallsWithArgs(): string[][] {
  return execFileSyncMock.mock.calls
    .filter((c: unknown[]) => c[0] === "git")
    .map((c: unknown[]) => c[1] as string[])
}

describe("getWorktreeDiff diff range", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: merge-base returns a hash, diff commands return plausible output
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "merge-base") return "aaa111\n"
      if (cmd === "git" && args[0] === "diff" && args.includes("--name-only")) return "file1.ts\nfile2.ts\n"
      if (cmd === "git" && args[0] === "diff" && args.includes("--stat")) return " 2 files changed, 20 insertions(+), 5 deletions(-)\n"
      return ""
    })
  })

  it("uses merge-base instead of HEAD~1 for --name-only", () => {
    getWorktreeDiff("test-001")
    const nameOnlyCall = gitCallsWithArgs().find(
      (a) => a.includes("--name-only"),
    )
    expect(nameOnlyCall).toBeDefined()
    // Must NOT contain HEAD~1
    expect(nameOnlyCall).not.toContain("HEAD~1")
    // Must reference merge-base result (aaa111) or use merge-base inline
    const joined = nameOnlyCall!.join(" ")
    expect(joined).toMatch(/aaa111|merge-base/)
  })

  it("uses merge-base instead of HEAD~1 for --stat", () => {
    getWorktreeDiff("test-001")
    const statCall = gitCallsWithArgs().find((a) => a.includes("--stat"))
    expect(statCall).toBeDefined()
    expect(statCall).not.toContain("HEAD~1")
    const joined = statCall!.join(" ")
    expect(joined).toMatch(/aaa111|merge-base/)
  })

  it("returns all files from merge-base range", () => {
    const result = getWorktreeDiff("test-001")
    expect(result.filesChanged).toEqual(["file1.ts", "file2.ts"])
    expect(result.additions).toBe(20)
    expect(result.deletions).toBe(5)
  })

  it("returns empty result when merge-base fails", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not a git repo")
    })
    const result = getWorktreeDiff("test-001")
    expect(result).toEqual({ filesChanged: [], additions: 0, deletions: 0 })
  })
})

describe("getWorktreeNewAndDeleted diff range", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "merge-base") return "bbb222\n"
      if (cmd === "git" && args.includes("--diff-filter=A")) return "new-file.ts\n"
      if (cmd === "git" && args.includes("--diff-filter=D")) return "old-file.ts\n"
      return ""
    })
  })

  it("uses merge-base instead of HEAD~1 for added files", () => {
    getWorktreeNewAndDeleted("test-002")
    const addedCall = gitCallsWithArgs().find((a) => a.includes("--diff-filter=A"))
    expect(addedCall).toBeDefined()
    expect(addedCall).not.toContain("HEAD~1")
    const joined = addedCall!.join(" ")
    expect(joined).toMatch(/bbb222|merge-base/)
  })

  it("uses merge-base instead of HEAD~1 for deleted files", () => {
    getWorktreeNewAndDeleted("test-002")
    const deletedCall = gitCallsWithArgs().find((a) => a.includes("--diff-filter=D"))
    expect(deletedCall).toBeDefined()
    expect(deletedCall).not.toContain("HEAD~1")
    const joined = deletedCall!.join(" ")
    expect(joined).toMatch(/bbb222|merge-base/)
  })

  it("returns correct added/deleted files from merge-base range", () => {
    const result = getWorktreeNewAndDeleted("test-002")
    expect(result.added).toEqual(["new-file.ts"])
    expect(result.deleted).toEqual(["old-file.ts"])
  })

  it("returns empty result when merge-base fails", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not a git repo")
    })
    const result = getWorktreeNewAndDeleted("test-002")
    expect(result).toEqual({ added: [], deleted: [] })
  })
})
