import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"
import { config } from "../config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const mockSpawnClaude = vi.fn()
vi.mock("../claude.js", () => ({
  spawnClaude: (...args: unknown[]) => mockSpawnClaude(...args),
}))

function createFailedTask() {
  const task = createTask("failing task", "description", "pm")
  startTask(task.id, "worker-0")
  const result = JSON.stringify({ exit_code: 1, files_changed: [], diff_stats: { additions: 0, deletions: 0 } })
  getDb()
    .prepare(`UPDATE tasks SET status = 'failed', finished_at = ?, result = ? WHERE id = ?`)
    .run(new Date().toISOString(), result, task.id)
  return task.id
}

const VALID_ANALYSIS = JSON.stringify({
  analysis: {
    top_failure: "test_gap",
    frequency: "3/10",
    why_chain: ["テストが不足"],
  },
  improvements: [
    { target: "gate2", action: "add_check", description: "制約条件のテストカバレッジを検証" },
  ],
})

describe("kaizen analyze() - cwd argument", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  it("passes config.PROJECT_ROOT as cwd, not relative path", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)
    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    await analyze()

    expect(mockSpawnClaude).toHaveBeenCalledOnce()
    const callArgs = mockSpawnClaude.mock.calls[0]
    // Second argument is cwd — should be config.PROJECT_ROOT, not "."
    const cwd = callArgs[1]
    expect(cwd).toBe(config.PROJECT_ROOT)
    expect(cwd).not.toBe(".")
  })

  it("uses absolute path as cwd", async () => {
    mockSpawnClaude.mockResolvedValue(VALID_ANALYSIS)
    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    await analyze()

    const callArgs = mockSpawnClaude.mock.calls[0]
    const cwd: string = callArgs[1]
    // cwd should be an absolute path, not a relative one
    expect(cwd.startsWith("/")).toBe(true)
  })
})
