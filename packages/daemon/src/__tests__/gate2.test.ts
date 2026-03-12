import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { initDb, closeDb } from "../db.js"
import { extractSpecItems, runGate2 } from "../gate2.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

let currentTmpDir: string

function setupWorktree(files: Record<string, string>): string {
  currentTmpDir = mkdtempSync(join(tmpdir(), "gate2-test-"))
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(currentTmpDir, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content)
  }
  return currentTmpDir
}

describe("extractSpecItems", () => {
  it("extracts endpoints", () => {
    const items = extractSpecItems("GET /api/tasks と POST /api/tasks を実装する")
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ type: "endpoint", spec_item: "GET /api/tasks", covered: false })
    expect(items[1]).toEqual({ type: "endpoint", spec_item: "POST /api/tasks", covered: false })
  })

  it("extracts invariants", () => {
    const items = extractSpecItems("invariant: タスクIDはULID形式であること")
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("invariant")
    expect(items[0].spec_item).toContain("タスクID")
  })

  it("extracts constraints", () => {
    const items = extractSpecItems("constraint: priorityは0-100の整数")
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("constraint")
  })

  it("deduplicates items", () => {
    const items = extractSpecItems("GET /api/tasks を実装。GET /api/tasks のテストも書く")
    const endpoints = items.filter((i) => i.type === "endpoint")
    expect(endpoints).toHaveLength(1)
  })

  it("returns empty for spec with no extractable items", () => {
    const items = extractSpecItems("リファクタリングする")
    expect(items).toHaveLength(0)
  })
})

describe("Gate 2", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    if (currentTmpDir) rmSync(currentTmpDir, { recursive: true, force: true })
  })

  it("passes when all endpoints are covered by tests", () => {
    const worktree = setupWorktree({
      "src/__tests__/api.test.ts": `
        describe("tasks API", () => {
          it("GET /api/tasks returns list", () => {})
          it("POST /api/tasks creates task", () => {})
        })
      `,
    })

    const result = runGate2("test-g2-1", "GET /api/tasks と POST /api/tasks を実装する", worktree)
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("recycles when endpoint has no test", () => {
    const worktree = setupWorktree({
      "src/__tests__/api.test.ts": `
        describe("tasks API", () => {
          it("GET /api/tasks returns list", () => {})
        })
      `,
    })

    const result = runGate2("test-g2-2", "GET /api/tasks と DELETE /api/tasks/:id を実装する", worktree)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons.some((r) => r.includes("DELETE"))).toBe(true)
  })

  it("recycles when no test files exist", () => {
    const worktree = setupWorktree({
      "src/foo.ts": "export const foo = 1",
    })

    const result = runGate2("test-g2-3", "GET /api/tasks を実装する", worktree)
    expect(result.verdict).toBe("recycle")
    expect(result.reasons[0]).toContain("no test files")
  })

  it("passes when spec has no extractable items", () => {
    const worktree = setupWorktree({
      "src/foo.ts": "export const foo = 1",
    })

    const result = runGate2("test-g2-4", "コードをリファクタリングする", worktree)
    expect(result.verdict).toBe("go")
  })

  it("checks invariant coverage", () => {
    const worktree = setupWorktree({
      "src/__tests__/validate.test.ts": `
        describe("validation", () => {
          it("タスクIDはULID形式であること", () => {})
        })
      `,
    })

    const result = runGate2("test-g2-5", "invariant: タスクIDはULID形式であること", worktree)
    expect(result.verdict).toBe("go")
  })

  it("recycles when invariant is not covered", () => {
    const worktree = setupWorktree({
      "src/__tests__/other.test.ts": `
        describe("other", () => {
          it("does something else", () => {})
        })
      `,
    })

    const result = runGate2("test-g2-6", "invariant: priorityは0から100の範囲に制限される", worktree)
    expect(result.verdict).toBe("recycle")
    expect(result.checks[0].covered).toBe(false)
  })

  it("checks constraint coverage", () => {
    const worktree = setupWorktree({
      "src/__tests__/schema.test.ts": `
        describe("schema validation", () => {
          it("priority must be integer between 0 and 100", () => {})
        })
      `,
    })

    const result = runGate2("test-g2-7", "constraint: priority は 0-100 の integer であること", worktree)
    expect(result.verdict).toBe("go")
  })

  it("never returns kill verdict", () => {
    const worktree = setupWorktree({
      "src/foo.ts": "export const foo = 1",
    })

    const result = runGate2("test-g2-8", "GET /a, POST /b, DELETE /c, PUT /d, invariant: everything must work", worktree)
    expect(result.verdict).not.toBe("kill")
    expect(["go", "recycle"]).toContain(result.verdict)
  })
})
