import { describe, it, expect } from "vitest"
import { classifyRootCause } from "../gate.js"
import type { ObservableFacts } from "@devpane/shared"
import { config } from "../config.js"

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

describe("classifyRootCause — exhaustive branch coverage", () => {
  // --- timeout detection ---
  describe("timeout detection", () => {
    it("returns env_issue when test_result.timed_out is true", () => {
      const facts = makeFacts({
        test_result: { passed: 0, failed: 0, exit_code: 1, timed_out: true },
      })
      expect(classifyRootCause(facts, [])).toBe("env_issue")
    })

    it("returns env_issue when reasons contain 'timeout' (case-insensitive)", () => {
      const facts = makeFacts({ commit_hash: undefined, files_changed: [] })
      expect(classifyRootCause(facts, ["Worker timeout after 300s"])).toBe("env_issue")
    })

    it("returns env_issue when reasons contain 'TIMEOUT' uppercase", () => {
      const facts = makeFacts({ commit_hash: undefined, files_changed: [] })
      expect(classifyRootCause(facts, ["TIMEOUT exceeded"])).toBe("env_issue")
    })
  })

  // --- lint_error detection ---
  describe("lint_error detection", () => {
    it("returns scope_creep when lint_result has errors", () => {
      const facts = makeFacts({
        lint_result: { errors: 5, exit_code: 1 },
      })
      expect(classifyRootCause(facts, ["lint errors: 5"])).toBe("scope_creep")
    })

    it("does not trigger for lint_result with zero errors", () => {
      const facts = makeFacts({
        lint_result: { errors: 0, exit_code: 0 },
      })
      expect(classifyRootCause(facts, [])).not.toBe("scope_creep")
    })
  })

  // --- test_failure detection ---
  describe("test_failure detection", () => {
    it("returns test_gap when tests failed > 0", () => {
      const facts = makeFacts({
        test_result: { passed: 3, failed: 1, exit_code: 1 },
      })
      expect(classifyRootCause(facts, ["tests failed: 1"])).toBe("test_gap")
    })

    it("does not trigger for test_result with zero failures", () => {
      const facts = makeFacts({
        test_result: { passed: 10, failed: 0, exit_code: 0 },
      })
      expect(classifyRootCause(facts, [])).not.toBe("test_gap")
    })
  })

  // --- build_error detection (exit_code non-zero) ---
  describe("build_error / exit_code detection", () => {
    it("returns env_issue when exit_code is non-zero with valid commit", () => {
      const facts = makeFacts({ exit_code: 1 })
      expect(classifyRootCause(facts, ["exit_code=1"])).toBe("env_issue")
    })

    it("returns env_issue for exit_code 127 (command not found)", () => {
      const facts = makeFacts({ exit_code: 127 })
      expect(classifyRootCause(facts, ["exit_code=127"])).toBe("env_issue")
    })
  })

  // --- commit_hash missing ---
  describe("commit_hash missing", () => {
    it("returns unknown when commit_hash is undefined", () => {
      const facts = makeFacts({ commit_hash: undefined })
      expect(classifyRootCause(facts, ["no commit produced"])).toBe("unknown")
    })
  })

  // --- diff_size exceeded ---
  describe("diff_size exceeded", () => {
    it("returns scope_creep when diff exceeds MAX_DIFF_SIZE", () => {
      const over = config.MAX_DIFF_SIZE + 1
      const facts = makeFacts({
        diff_stats: { additions: over, deletions: 0 },
      })
      expect(classifyRootCause(facts, ["diff too large"])).toBe("scope_creep")
    })

    it("does not return scope_creep when diff is at MAX_DIFF_SIZE boundary", () => {
      const facts = makeFacts({
        diff_stats: { additions: config.MAX_DIFF_SIZE, deletions: 0 },
      })
      // exactly at boundary should NOT trigger
      expect(classifyRootCause(facts, [])).not.toBe("scope_creep")
    })
  })

  // --- no_file_changes ---
  describe("no file changes", () => {
    it("returns unknown when files_changed is empty", () => {
      const facts = makeFacts({ files_changed: [] })
      expect(classifyRootCause(facts, ["no files changed"])).toBe("unknown")
    })
  })

  // --- priority when multiple conditions match ---
  describe("priority when multiple conditions are true", () => {
    it("test_result.timed_out takes highest priority over test failures", () => {
      const facts = makeFacts({
        test_result: { passed: 0, failed: 3, exit_code: 1, timed_out: true },
        lint_result: { errors: 2, exit_code: 1 },
      })
      // timed_out is checked first → env_issue
      expect(classifyRootCause(facts, ["timeout"])).toBe("env_issue")
    })

    it("test failures take priority over lint errors", () => {
      const facts = makeFacts({
        test_result: { passed: 1, failed: 2, exit_code: 1 },
        lint_result: { errors: 5, exit_code: 1 },
      })
      // test_result.failed is checked before lint_result.errors
      expect(classifyRootCause(facts, [])).toBe("test_gap")
    })

    it("lint errors take priority over diff_size", () => {
      const facts = makeFacts({
        lint_result: { errors: 1, exit_code: 1 },
        diff_stats: { additions: config.MAX_DIFF_SIZE + 100, deletions: 0 },
      })
      expect(classifyRootCause(facts, [])).toBe("scope_creep")
    })

    it("diff_size takes priority over timeout in reasons (when no timed_out flag)", () => {
      const facts = makeFacts({
        diff_stats: { additions: config.MAX_DIFF_SIZE + 1, deletions: 0 },
      })
      // diff_size check comes before reasons timeout regex
      expect(classifyRootCause(facts, ["timeout"])).toBe("scope_creep")
    })

    it("timeout in reasons takes priority over missing commit_hash", () => {
      const facts = makeFacts({
        commit_hash: undefined,
        files_changed: [],
      })
      // reasons timeout check comes before commit_hash/files_changed check
      expect(classifyRootCause(facts, ["Worker timeout"])).toBe("env_issue")
    })
  })

  // --- normal pass (all checks pass) ---
  describe("normal case (all checks pass)", () => {
    it("returns unknown when all facts are normal and no failure reasons", () => {
      const facts = makeFacts()
      // No failure condition → falls through to final return "unknown"
      expect(classifyRootCause(facts, [])).toBe("unknown")
    })
  })
})
