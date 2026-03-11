import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { runGate2, type StructuredSpec } from "../gate2.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")
const tmpDir = join(tmpdir(), "devpane-gate2-test")

function makeSpec(overrides: Partial<StructuredSpec> = {}): StructuredSpec {
  return {
    invariants: ["user must be authenticated", "input must be validated"],
    endpoints: [
      { method: "GET", path: "/api/tasks" },
      { method: "POST", path: "/api/tasks" },
    ],
    constraints: ["max 100 items per page", "title required"],
    ...overrides,
  }
}

function writeTestFile(name: string, content: string): string {
  const path = join(tmpDir, name)
  writeFileSync(path, content, "utf-8")
  return path
}

describe("Gate 2", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("passes when all spec items are covered", () => {
    const testFile = writeTestFile(
      "full.test.ts",
      `
      // user must be authenticated
      // input must be validated
      describe("GET /api/tasks", () => { /* ... */ })
      describe("POST /api/tasks", () => { /* ... */ })
      // max 100 items per page
      // title required
    `,
    )
    const result = runGate2("test-1", makeSpec(), [testFile])
    expect(result.verdict).toBe("go")
    expect(result.coverage.invariants).toBe(100)
    expect(result.coverage.endpoints).toBe(100)
    expect(result.coverage.constraints).toBe(100)
  })

  it("recycles when invariants are missing", () => {
    const testFile = writeTestFile(
      "partial.test.ts",
      `
      // input must be validated
      describe("GET /api/tasks", () => {})
      describe("POST /api/tasks", () => {})
      // max 100 items per page
      // title required
    `,
    )
    const result = runGate2("test-2", makeSpec(), [testFile])
    expect(result.verdict).toBe("recycle")
    expect(result.coverage.invariants).toBe(50)
    expect(result.coverage.endpoints).toBe(100)
    expect(result.coverage.constraints).toBe(100)
    expect(result.reason).toContain("invariants")
  })

  it("recycles when endpoints are missing", () => {
    const testFile = writeTestFile(
      "no-endpoints.test.ts",
      `
      // user must be authenticated
      // input must be validated
      // max 100 items per page
      // title required
    `,
    )
    const result = runGate2("test-3", makeSpec(), [testFile])
    expect(result.verdict).toBe("recycle")
    expect(result.coverage.endpoints).toBe(0)
    expect(result.reason).toContain("endpoints")
  })

  it("recycles when constraints are missing", () => {
    const testFile = writeTestFile(
      "no-constraints.test.ts",
      `
      // user must be authenticated
      // input must be validated
      describe("GET /api/tasks", () => {})
      describe("POST /api/tasks", () => {})
    `,
    )
    const result = runGate2("test-4", makeSpec(), [testFile])
    expect(result.verdict).toBe("recycle")
    expect(result.coverage.constraints).toBe(0)
    expect(result.reason).toContain("constraints")
  })

  it("handles multiple test files", () => {
    const file1 = writeTestFile(
      "a.test.ts",
      `
      // user must be authenticated
      describe("GET /api/tasks", () => {})
      // max 100 items per page
    `,
    )
    const file2 = writeTestFile(
      "b.test.ts",
      `
      // input must be validated
      describe("POST /api/tasks", () => {})
      // title required
    `,
    )
    const result = runGate2("test-5", makeSpec(), [file1, file2])
    expect(result.verdict).toBe("go")
    expect(result.coverage.invariants).toBe(100)
  })

  it("treats empty spec as 100% covered", () => {
    const testFile = writeTestFile("empty.test.ts", "// nothing")
    const result = runGate2(
      "test-6",
      makeSpec({ invariants: [], endpoints: [], constraints: [] }),
      [testFile],
    )
    expect(result.verdict).toBe("go")
    expect(result.coverage.invariants).toBe(100)
    expect(result.coverage.endpoints).toBe(100)
    expect(result.coverage.constraints).toBe(100)
  })

  it("matches case-insensitively", () => {
    const testFile = writeTestFile(
      "case.test.ts",
      `
      // USER MUST BE AUTHENTICATED
      // INPUT MUST BE VALIDATED
      describe("get /API/TASKS", () => {})
      describe("post /API/TASKS", () => {})
      // MAX 100 ITEMS PER PAGE
      // TITLE REQUIRED
    `,
    )
    const result = runGate2("test-7", makeSpec(), [testFile])
    expect(result.verdict).toBe("go")
  })

  it("reports all missing categories in reason", () => {
    const testFile = writeTestFile("none.test.ts", "// empty test file")
    const result = runGate2("test-8", makeSpec(), [testFile])
    expect(result.verdict).toBe("recycle")
    expect(result.reason).toContain("invariants")
    expect(result.reason).toContain("endpoints")
    expect(result.reason).toContain("constraints")
  })
})
