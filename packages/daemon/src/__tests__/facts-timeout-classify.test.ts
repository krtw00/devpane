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

describe("facts timeout → classifyRootCause", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
  })

  it("timed_out: true のテスト結果は env_issue に分類される", () => {
    const result = runGate3("timeout-1", makeFacts({
      test_result: { passed: 0, failed: 1, exit_code: 1, timed_out: true },
    }))
    expect(result.verdict).not.toBe("go")
    expect(result.failure).toBeDefined()
    expect(result.failure!.root_cause).toBe("env_issue")
  })

  it("timed_out: true は test_gap より優先される", () => {
    // failed > 0 でも timed_out があれば env_issue
    const result = runGate3("timeout-2", makeFacts({
      test_result: { passed: 3, failed: 2, exit_code: 1, timed_out: true },
    }))
    expect(result.failure).toBeDefined()
    expect(result.failure!.root_cause).toBe("env_issue")
  })

  it("timed_out: false は通常のテスト失敗として test_gap になる", () => {
    const result = runGate3("timeout-3", makeFacts({
      test_result: { passed: 3, failed: 2, exit_code: 1, timed_out: false },
    }))
    expect(result.failure).toBeDefined()
    expect(result.failure!.root_cause).toBe("test_gap")
  })

  it("timed_out が未設定の場合は従来通り test_gap になる", () => {
    const result = runGate3("timeout-4", makeFacts({
      test_result: { passed: 3, failed: 2, exit_code: 1 },
    }))
    expect(result.failure).toBeDefined()
    expect(result.failure!.root_cause).toBe("test_gap")
  })

  it("timed_out: true かつ lint エラーありでも env_issue が優先される", () => {
    const result = runGate3("timeout-5", makeFacts({
      test_result: { passed: 0, failed: 0, exit_code: 1, timed_out: true },
      lint_result: { errors: 3, exit_code: 1 },
    }))
    expect(result.failure).toBeDefined()
    expect(result.failure!.root_cause).toBe("env_issue")
  })
})
