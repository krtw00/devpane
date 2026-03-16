import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb, createTask, startTask } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

const mockSpawnClaude = vi.fn()
vi.mock("../claude.js", () => ({
  spawnClaude: (...args: unknown[]) => mockSpawnClaude(...args),
}))

function createFailedTask() {
  const task = createTask("failing task", "description", "pm")
  startTask(task.id, "worker-0")
  const db = getDb()
  const result = JSON.stringify({ exit_code: 1, files_changed: [], diff_stats: { additions: 0, deletions: 0 } })
  db.prepare(`UPDATE tasks SET status = 'failed', finished_at = ?, result = ? WHERE id = ?`)
    .run(new Date().toISOString(), result, task.id)
  return task.id
}

const VALID_ANALYSIS = {
  analysis: {
    top_failure: "test_gap",
    frequency: "3/10",
    why_chain: ["テストが不足", "Gate2が甘い", "テスト生成プロンプトに制約が反映されていない"],
  },
  improvements: [
    { target: "gate2", action: "add_check", description: "制約条件のテストカバレッジを検証" },
  ],
}

describe("kaizen analyze() result field unwrap", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    vi.clearAllMocks()
  })

  afterEach(() => {
    closeDb()
  })

  it("unwraps { result: '...' } wrapper from --output-format json output", async () => {
    // claude CLI returns {"result": "<escaped json>", "total_cost_usd": ...}
    const wrapped = JSON.stringify({
      result: JSON.stringify(VALID_ANALYSIS),
      total_cost_usd: 0.05,
    })
    mockSpawnClaude.mockResolvedValue(wrapped)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
    expect(result!.analysis.why_chain).toHaveLength(3)
    expect(result!.improvements).toHaveLength(1)
  })

  it("unwraps result wrapper with markdown fences inside result field", async () => {
    const innerWithFences = "```json\n" + JSON.stringify(VALID_ANALYSIS) + "\n```"
    const wrapped = JSON.stringify({
      result: innerWithFences,
      total_cost_usd: 0.03,
    })
    mockSpawnClaude.mockResolvedValue(wrapped)

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
  })

  it("still works with direct JSON output (no result wrapper / fallback)", async () => {
    // If spawnClaude returns raw JSON without the wrapper
    mockSpawnClaude.mockResolvedValue(JSON.stringify(VALID_ANALYSIS))

    createFailedTask()

    const { analyze } = await import("../kaizen.js")
    const result = await analyze()

    expect(result).not.toBeNull()
    expect(result!.analysis.top_failure).toBe("test_gap")
  })
})
