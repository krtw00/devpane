import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import { runGate1 } from "../gate1.js"
import type { Memory } from "@devpane/shared"
import type { PmTask } from "@devpane/shared/schemas"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

function makeSpec(overrides: Partial<PmTask> = {}): PmTask {
  return {
    title: "Add user authentication",
    description: "Implement JWT-based authentication with login/logout endpoints",
    priority: 50,
    ...overrides,
  }
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    category: "feature",
    content: "src/auth.ts を追加（Add user authentication）",
    source_task_id: "task-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("Gate 1", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
  })

  afterEach(() => {
    closeDb()
    vi.restoreAllMocks()
  })

  it("passes a valid new task", () => {
    const result = runGate1(makeSpec(), [])
    expect(result.verdict).toBe("go")
    expect(result.reasons).toHaveLength(0)
  })

  it("kills duplicate task matching feature memory", () => {
    const memories = [makeMemory()]
    const spec = makeSpec({ title: "Add user authentication" })
    const result = runGate1(spec, memories)
    expect(result.verdict).toBe("kill")
    expect(result.reasons[0]).toContain("duplicate")
  })

  it("does not false-positive on unrelated feature memory", () => {
    const memories = [makeMemory({ content: "src/database.ts を追加（Setup SQLite connection）" })]
    const spec = makeSpec({ title: "Add user authentication", description: "JWT login endpoint" })
    const result = runGate1(spec, memories)
    expect(result.verdict).toBe("go")
  })

  it("ignores non-feature memories for duplicate check", () => {
    const memories = [makeMemory({ category: "lesson", content: "authentication は複雑なのでテストを追加する" })]
    const spec = makeSpec({ title: "Add user authentication" })
    const result = runGate1(spec, memories)
    expect(result.verdict).toBe("go")
  })

  it("recycles task with empty functions/endpoints", () => {
    const spec = makeSpec({
      description: "Implement API endpoints: []",
    })
    const result = runGate1(spec, [])
    expect(result.verdict).toBe("recycle")
    expect(result.reasons[0]).toContain("empty functions/endpoints")
  })

  it("recycles task with TBD endpoints", () => {
    const spec = makeSpec({
      description: "Add functions: TBD",
    })
    const result = runGate1(spec, [])
    expect(result.verdict).toBe("recycle")
  })

  it("passes task with concrete endpoint description", () => {
    const spec = makeSpec({
      description: "Add endpoint POST /api/login that accepts email and password",
    })
    const result = runGate1(spec, [])
    expect(result.verdict).toBe("go")
  })

  it("kill takes precedence over recycle", () => {
    const memories = [makeMemory()]
    const spec = makeSpec({
      title: "Add user authentication",
      description: "Implement endpoints: TBD",
    })
    const result = runGate1(spec, memories)
    expect(result.verdict).toBe("kill")
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })
})
