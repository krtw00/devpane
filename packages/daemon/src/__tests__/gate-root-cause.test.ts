import { describe, it, expect } from "vitest"
import { classifyRootCause } from "../gate.js"
import type { ObservableFacts } from "@devpane/shared"

function makeFacts(overrides: Partial<ObservableFacts> = {}): ObservableFacts {
  return {
    exit_code: 0,
    files_changed: ["src/foo.ts"],
    diff_stats: { additions: 10, deletions: 2 },
    branch: "devpane/task-test",
    commit_hash: "abc123",
    ...overrides,
  }
}

describe("classifyRootCause", () => {
  it("returns env_issue when reasons contain timeout and commit_hash is empty", () => {
    const facts = makeFacts({ commit_hash: undefined, files_changed: [] })
    const reasons = ["Worker timeout after 300s"]
    expect(classifyRootCause(facts, reasons)).toBe("env_issue")
  })

  it("returns unknown when no timeout and commit_hash is empty", () => {
    const facts = makeFacts({ commit_hash: undefined, files_changed: [] })
    const reasons = ["no commit produced", "no files changed"]
    expect(classifyRootCause(facts, reasons)).toBe("unknown")
  })

  it("returns test_gap when tests failed", () => {
    const facts = makeFacts({
      test_result: { passed: 5, failed: 2, exit_code: 1 },
    })
    expect(classifyRootCause(facts, ["tests failed: 2"])).toBe("test_gap")
  })

  it("returns scope_creep when lint errors exist", () => {
    const facts = makeFacts({
      lint_result: { errors: 3, exit_code: 1 },
    })
    expect(classifyRootCause(facts, ["lint errors: 3"])).toBe("scope_creep")
  })

  it("returns scope_creep when diff is oversized", () => {
    const facts = makeFacts({
      diff_stats: { additions: 400, deletions: 200 },
    })
    expect(classifyRootCause(facts, ["diff too large"])).toBe("scope_creep")
  })

  it("returns env_issue when exit_code is non-zero with commit", () => {
    const facts = makeFacts({ exit_code: 1 })
    expect(classifyRootCause(facts, ["exit_code=1"])).toBe("env_issue")
  })

  it("returns env_issue for case-insensitive timeout match", () => {
    const facts = makeFacts({ commit_hash: undefined })
    const reasons = ["TIMEOUT exceeded"]
    expect(classifyRootCause(facts, reasons)).toBe("env_issue")
  })
})
