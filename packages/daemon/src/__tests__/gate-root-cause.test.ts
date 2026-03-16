import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { classifyRootCause, runGate3 } from "../gate.js"
import { initDb, closeDb } from "../db.js"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { ObservableFacts } from "@devpane/shared"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

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

describe("gates_passed in StructuredFailure", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("kill時のgates_passedはgate1とgate2を含む", () => {
    const result = runGate3("test-gp-1", makeFacts({ exit_code: 1 }))
    expect(result.verdict).toBe("kill")
    expect(result.failure).toBeDefined()
    expect(result.failure!.gates_passed).toEqual(["gate1", "gate2"])
  })

  it("recycle時のgates_passedはgate1とgate2を含む", () => {
    const result = runGate3("test-gp-2", makeFacts({
      test_result: { passed: 5, failed: 2, exit_code: 1 },
    }))
    expect(result.verdict).toBe("recycle")
    expect(result.failure).toBeDefined()
    expect(result.failure!.gates_passed).toEqual(["gate1", "gate2"])
  })

  it("gates_passedにgate3を含まない（gate3自体はfailしているため）", () => {
    const result = runGate3("test-gp-3", makeFacts({
      lint_result: { errors: 3, exit_code: 1 },
    }))
    expect(result.failure).toBeDefined()
    expect(result.failure!.gates_passed).not.toContain("gate3")
  })

  it("go時はfailureがundefined", () => {
    const result = runGate3("test-gp-4", makeFacts())
    expect(result.verdict).toBe("go")
    expect(result.failure).toBeUndefined()
  })
})

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

  it("returns code_quality when lint errors exist", () => {
    const facts = makeFacts({
      lint_result: { errors: 3, exit_code: 1 },
    })
    expect(classifyRootCause(facts, ["lint errors: 3"])).toBe("code_quality")
  })

  it("returns code_quality (not scope_creep) for lint-only failures", () => {
    const facts = makeFacts({
      lint_result: { errors: 1, exit_code: 1 },
    })
    expect(classifyRootCause(facts, ["lint errors: 1"])).not.toBe("scope_creep")
    expect(classifyRootCause(facts, ["lint errors: 1"])).toBe("code_quality")
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
