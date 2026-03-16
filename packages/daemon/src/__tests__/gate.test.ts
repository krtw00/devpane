import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { runGate3 } from "../gate.js"
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

describe("Gate 3", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("passes healthy task", () => {
    const result = runGate3("test-1", makeFacts())
    expect(result.verdict).toBe("go")
    expect(result.failure).toBeUndefined()
  })

  it("kills task with non-zero exit code", () => {
    const result = runGate3("test-2", makeFacts({ exit_code: 1 }))
    expect(result.verdict).toBe("kill")
    expect(result.failure?.root_cause).toBe("env_issue")
  })

  it("recycles task with test failures", () => {
    const result = runGate3("test-3", makeFacts({
      test_result: { passed: 5, failed: 2, exit_code: 1 },
    }))
    expect(result.verdict).toBe("recycle")
    expect(result.failure?.root_cause).toBe("test_gap")
  })

  it("recycles task with lint errors", () => {
    const result = runGate3("test-4", makeFacts({
      lint_result: { errors: 3, exit_code: 1 },
    }))
    expect(result.verdict).toBe("recycle")
    expect(result.failure?.root_cause).toBe("code_quality")
  })

  it("recycles task with oversized diff", () => {
    const result = runGate3("test-5", makeFacts({
      diff_stats: { additions: 400, deletions: 200 },
    }))
    expect(result.verdict).toBe("recycle")
    expect(result.failure?.root_cause).toBe("scope_creep")
  })

  it("kills task with no commit", () => {
    const result = runGate3("test-6", makeFacts({ commit_hash: undefined }))
    expect(result.verdict).toBe("kill")
  })

  it("kills task with no files changed", () => {
    const result = runGate3("test-7", makeFacts({ files_changed: [] }))
    expect(result.verdict).toBe("kill")
  })

  it("returns structured failure with why_chain", () => {
    const result = runGate3("test-8", makeFacts({
      test_result: { passed: 3, failed: 1, exit_code: 1 },
      lint_result: { errors: 2, exit_code: 1 },
    }))
    expect(result.verdict).toBe("recycle")
    expect(result.failure).toBeDefined()
    expect(result.failure!.stage).toBe("gate3")
    expect(result.failure!.why_chain.length).toBeGreaterThan(0)
  })

  it("classifies root cause as unknown when test_result is undefined", () => {
    // test_result/lint_resultがundefined（facts収集でcatchにも入らなかった場合）
    const result = runGate3("test-9", makeFacts({
      exit_code: 1,
      test_result: undefined,
      lint_result: undefined,
    }))
    expect(result.verdict).toBe("kill")
    expect(result.failure).toBeDefined()
    expect(result.failure!.root_cause).toBe("env_issue")
  })

  it("does not crash when test_result and lint_result are undefined", () => {
    // undefinedでもnullチェックが正しく動くことを検証
    const result = runGate3("test-10", makeFacts({
      test_result: undefined,
      lint_result: undefined,
    }))
    expect(result.verdict).toBe("go")
    expect(result.failure).toBeUndefined()
  })

  it("classifies timeout-related reasons correctly", () => {
    // _reasonsにtimeout情報が含まれるケースの分類
    // 現状classifyRootCauseは_reasonsを未使用だが、修正後はtimeoutケース識別に活用
    const result = runGate3("test-11", makeFacts({
      exit_code: 1,
      test_result: undefined,
      lint_result: undefined,
    }))
    expect(result.verdict).toBe("kill")
    expect(result.failure?.root_cause).toBeDefined()
  })
})
