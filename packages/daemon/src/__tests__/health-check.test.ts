import { beforeEach, describe, expect, it, vi } from "vitest"

const execFileSyncMock = vi.fn()

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

vi.mock("../config.js", () => ({
  config: {
    PROJECT_ROOT: "/tmp/project-root",
  },
}))

import { runCredentialHealthChecks } from "../health-check.js"

describe("runCredentialHealthChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileSyncMock.mockReturnValue("ok")
  })

  it("returns all ok when every command succeeds", () => {
    const checks = runCredentialHealthChecks()

    expect(checks).toHaveLength(2)
    expect(checks.every((check) => check.ok)).toBe(true)
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      "gh",
      ["auth", "status"],
      expect.objectContaining({ timeout: 5000 }),
    )
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["ls-remote", "--exit-code", "origin", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/project-root", timeout: 5000 }),
    )
  })

  it("returns mixed results when one command fails", () => {
    execFileSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "git") {
        throw Object.assign(new Error("auth failed"), { status: 128 })
      }
      return "ok"
    })

    const checks = runCredentialHealthChecks()

    expect(checks.map((check) => check.ok)).toEqual([true, false])
    expect(checks[1].message).toContain("exit: 128")
  })

  it("returns all failed when every command fails", () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("command failed"), { status: 1 })
    })

    const checks = runCredentialHealthChecks()

    expect(checks).toHaveLength(2)
    expect(checks.every((check) => !check.ok)).toBe(true)
    expect(checks.map((check) => check.message)).toEqual([
      "failed (exit: 1)",
      "failed (exit: 1)",
    ])
  })
})
