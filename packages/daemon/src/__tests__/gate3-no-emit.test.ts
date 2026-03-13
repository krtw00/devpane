import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb } from "../db.js"
import type { ObservableFacts } from "@devpane/shared"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// emit をモックして呼び出しを監視
const mockEmit = vi.fn()
vi.mock("../events.js", () => ({
  emit: mockEmit,
  safeEmit: vi.fn(() => true),
}))

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

describe("gate3 does not emit events", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    mockEmit.mockClear()
  })

  afterEach(() => {
    closeDb()
  })

  it("does not call emit on verdict=go", async () => {
    const { runGate3 } = await import("../gate.js")
    const result = runGate3("test-no-emit-1", makeFacts())

    expect(result.verdict).toBe("go")
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it("does not call emit on verdict=kill", async () => {
    const { runGate3 } = await import("../gate.js")
    const result = runGate3("test-no-emit-2", makeFacts({ exit_code: 1 }))

    expect(result.verdict).toBe("kill")
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it("does not call emit on verdict=recycle", async () => {
    const { runGate3 } = await import("../gate.js")
    const result = runGate3("test-no-emit-3", makeFacts({
      test_result: { passed: 5, failed: 2, exit_code: 1 },
    }))

    expect(result.verdict).toBe("recycle")
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
