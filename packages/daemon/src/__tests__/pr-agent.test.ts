import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { initDb, closeDb, getDb } from "../db.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "..", "src", "migrations")

// Mock discord.ts before importing pr-agent
vi.mock("../discord.js", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}))

// Mock child_process for gh command
vi.mock("node:child_process", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:child_process")>()
  return {
    ...orig,
    execFileSync: vi.fn((cmd: string, args?: string[]) => {
      if (cmd === "gh" && args?.[0] === "pr") {
        return JSON.stringify(mockPrs)
      }
      return orig.execFileSync(cmd, args as string[], { encoding: "utf-8" })
    }),
  }
})

let mockPrs: unknown[] = []

// Import after mocks
const { runPrAgent } = await import("../pr-agent.js")
const { notify } = await import("../discord.js")

function insertTaskWithFacts(
  id: string,
  status: "done" | "failed",
  facts: Record<string, unknown>,
) {
  const db = getDb()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, created_by, created_at, result)
     VALUES (?, ?, ?, ?, 0, 'pm', datetime('now'), ?)`,
  ).run(id, "test task", "desc", status, JSON.stringify(facts))
}

function insertGateEvent(taskId: string, verdict: "kill" | "recycle") {
  const db = getDb()
  const payload = JSON.stringify({
    type: "gate.rejected",
    taskId,
    gate: "gate3",
    verdict,
    reason: "test",
  })
  db.prepare(
    `INSERT INTO agent_events (id, type, payload, timestamp) VALUES (?, 'gate.rejected', ?, datetime('now'))`,
  ).run(`evt-${taskId}`, payload)
}

describe("PR Agent", () => {
  beforeEach(() => {
    initDb(":memory:", migrationsDir)
    mockPrs = []
    vi.mocked(notify).mockClear()
  })

  afterEach(() => {
    closeDb()
  })

  it("reports no PRs when list is empty", async () => {
    mockPrs = []
    const result = await runPrAgent()
    expect(result).toContain("オープンPRなし")
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("オープンPRなし"))
  })

  it("recommends small diff with passing tests", async () => {
    mockPrs = [
      {
        number: 1,
        title: "small fix",
        headRefName: "fix/small",
        url: "https://github.com/test/repo/pull/1",
        additions: 10,
        deletions: 5,
        author: { login: "bot" },
      },
    ]
    insertTaskWithFacts("task-1", "done", {
      exit_code: 0,
      files_changed: ["a.ts"],
      diff_stats: { additions: 10, deletions: 5 },
      test_result: { passed: 10, failed: 0, exit_code: 0 },
      branch: "fix/small",
      commit_hash: "abc",
    })

    const result = await runPrAgent()
    expect(result).toContain("✅推奨")
    expect(result).toContain("テスト全通過")
  })

  it("flags caution for large diff", async () => {
    mockPrs = [
      {
        number: 2,
        title: "big refactor",
        headRefName: "refactor/big",
        url: "https://github.com/test/repo/pull/2",
        additions: 400,
        deletions: 50,
        author: { login: "bot" },
      },
    ]

    const result = await runPrAgent()
    expect(result).toContain("⚠️要確認")
    expect(result).toContain("大規模diff")
  })

  it("flags caution for test failures", async () => {
    mockPrs = [
      {
        number: 3,
        title: "broken test",
        headRefName: "feat/broken",
        url: "https://github.com/test/repo/pull/3",
        additions: 20,
        deletions: 5,
        author: { login: "bot" },
      },
    ]
    insertTaskWithFacts("task-3", "failed", {
      exit_code: 0,
      files_changed: ["b.ts"],
      diff_stats: { additions: 20, deletions: 5 },
      test_result: { passed: 8, failed: 2, exit_code: 1 },
      branch: "feat/broken",
      commit_hash: "def",
    })

    const result = await runPrAgent()
    expect(result).toContain("⚠️要確認")
    expect(result).toContain("テスト失敗")
  })

  it("rejects PR with gate3 kill", async () => {
    mockPrs = [
      {
        number: 4,
        title: "killed task",
        headRefName: "feat/killed",
        url: "https://github.com/test/repo/pull/4",
        additions: 50,
        deletions: 10,
        author: { login: "bot" },
      },
    ]
    insertTaskWithFacts("task-4", "failed", {
      exit_code: 1,
      files_changed: [],
      diff_stats: { additions: 50, deletions: 10 },
      branch: "feat/killed",
    })
    insertGateEvent("task-4", "kill")

    const result = await runPrAgent()
    expect(result).toContain("❌非推奨")
    expect(result).toContain("Gate3 kill")
  })

  it("shows facts不足 when no matching task", async () => {
    mockPrs = [
      {
        number: 5,
        title: "unknown",
        headRefName: "feat/unknown",
        url: "https://github.com/test/repo/pull/5",
        additions: 150,
        deletions: 10,
        author: { login: "human" },
      },
    ]

    const result = await runPrAgent()
    expect(result).toContain("facts不足")
  })
})
