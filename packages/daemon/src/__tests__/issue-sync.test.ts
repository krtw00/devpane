import { describe, it, expect, vi, beforeEach } from "vitest"
import type { GhIssue } from "../issue-sync.js"

// Mock child_process before importing issue-sync
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

// Mock config
vi.mock("../config.js", () => ({
  config: {
    PROJECT_ROOT: "/tmp/test-project",
    ISSUE_SYNC_ENABLED: true,
    ISSUE_SYNC_LABELS: null,
    ISSUE_SYNC_INTERVAL_SEC: 3600,
  },
}))

// Mock db.js
vi.mock("../db.js", () => ({
  createTask: vi.fn((_title: string, _desc: string, _by: string, _priority: number) => ({
    id: "test-task-id",
    title: _title,
    description: _desc,
    created_by: _by,
    priority: _priority,
    status: "pending",
  })),
  getAllTasks: vi.fn(() => []),
}))

import { execFileSync } from "node:child_process"
import { fetchGhIssues, syncIssues, closeIssue } from "../issue-sync.js"
import { createTask, getAllTasks } from "../db.js"
import { config } from "../config.js"

const mockExecFileSync = vi.mocked(execFileSync)
const mockCreateTask = vi.mocked(createTask)
const mockGetAllTasks = vi.mocked(getAllTasks)

function makeIssue(overrides: Partial<GhIssue> = {}): GhIssue {
  return {
    number: 1,
    title: "Test issue",
    body: "Test body",
    labels: [],
    state: "open",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("fetchGhIssues", () => {
  it("gh issue listの結果をパースして返す", () => {
    const issues: GhIssue[] = [
      makeIssue({ number: 1, title: "Bug fix" }),
      makeIssue({ number: 2, title: "Feature request" }),
    ]
    mockExecFileSync.mockReturnValue(JSON.stringify(issues))

    const result = fetchGhIssues()
    expect(result).toHaveLength(2)
    expect(result[0].number).toBe(1)
    expect(result[1].title).toBe("Feature request")

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "list", "--json", "number,title,body,labels,state", "--state", "open", "--limit", "20"],
      { cwd: config.PROJECT_ROOT, encoding: "utf-8" },
    )
  })

  it("gh CLIエラー時は空配列を返す", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh not found")
    })

    const result = fetchGhIssues()
    expect(result).toEqual([])
  })
})

describe("syncIssues", () => {
  it("新規Issueをタスクとして取り込む", () => {
    const issues: GhIssue[] = [makeIssue({ number: 42, title: "Add dark mode", body: "Please add dark mode" })]
    mockExecFileSync.mockReturnValue(JSON.stringify(issues))
    mockGetAllTasks.mockReturnValue([])

    syncIssues()

    expect(mockCreateTask).toHaveBeenCalledOnce()
    expect(mockCreateTask).toHaveBeenCalledWith(
      "[#42] Add dark mode",
      "Please add dark mode\n\nCloses #42",
      "human",
      60,
    )
  })

  it("重複排除: 同じIssueを2回取り込まない", () => {
    const issues: GhIssue[] = [makeIssue({ number: 10, title: "Fix crash" })]
    mockExecFileSync.mockReturnValue(JSON.stringify(issues))
    mockGetAllTasks.mockReturnValue([
      {
        id: "existing",
        title: "[#10] Fix crash",
        description: "existing task",
        constraints: null,
        status: "pending",
        priority: 60,
        parent_id: null,
        created_by: "human",
        assigned_to: null,
        created_at: "2025-01-01",
        started_at: null,
        finished_at: null,
        result: null,
        cost_usd: 0,
        tokens_used: 0,
        retry_count: 0,
      },
    ])

    syncIssues()

    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it("重複排除: descriptionにCloses #Nが含まれる場合もスキップ", () => {
    const issues: GhIssue[] = [makeIssue({ number: 15, title: "Improve perf" })]
    mockExecFileSync.mockReturnValue(JSON.stringify(issues))
    mockGetAllTasks.mockReturnValue([
      {
        id: "existing",
        title: "Performance improvement",
        description: "Improve rendering performance\n\nCloses #15",
        constraints: null,
        status: "done",
        priority: 50,
        parent_id: null,
        created_by: "pm",
        assigned_to: null,
        created_at: "2025-01-01",
        started_at: null,
        finished_at: null,
        result: null,
        cost_usd: 0,
        tokens_used: 0,
        retry_count: 0,
      },
    ])

    syncIssues()

    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it("除外ラベル: good first issue, wontfix, duplicateをスキップ", () => {
    const issues: GhIssue[] = [
      makeIssue({ number: 1, title: "Easy task", labels: [{ name: "good first issue" }] }),
      makeIssue({ number: 2, title: "Won't do", labels: [{ name: "wontfix" }] }),
      makeIssue({ number: 3, title: "Same thing", labels: [{ name: "duplicate" }] }),
      makeIssue({ number: 4, title: "Real task", labels: [{ name: "enhancement" }] }),
    ]
    mockExecFileSync.mockReturnValue(JSON.stringify(issues))
    mockGetAllTasks.mockReturnValue([])

    syncIssues()

    expect(mockCreateTask).toHaveBeenCalledOnce()
    expect(mockCreateTask).toHaveBeenCalledWith(
      "[#4] Real task",
      expect.stringContaining("Closes #4"),
      "human",
      60,
    )
  })

  it("ISSUE_SYNC_LABELSでラベルフィルタ", () => {
    // configをmutateしてラベルフィルタをテスト
    const originalLabels = config.ISSUE_SYNC_LABELS
    ;(config as Record<string, unknown>).ISSUE_SYNC_LABELS = "bug,critical"

    const issues: GhIssue[] = [
      makeIssue({ number: 1, title: "Not a bug", labels: [{ name: "enhancement" }] }),
      makeIssue({ number: 2, title: "A bug", labels: [{ name: "bug" }] }),
      makeIssue({ number: 3, title: "Critical", labels: [{ name: "critical" }] }),
    ]
    mockExecFileSync.mockReturnValue(JSON.stringify(issues))
    mockGetAllTasks.mockReturnValue([])

    syncIssues()

    expect(mockCreateTask).toHaveBeenCalledTimes(2)
    expect(mockCreateTask).toHaveBeenCalledWith("[#2] A bug", expect.any(String), "human", 60)
    expect(mockCreateTask).toHaveBeenCalledWith("[#3] Critical", expect.any(String), "human", 60)

    // restore
    ;(config as Record<string, unknown>).ISSUE_SYNC_LABELS = originalLabels
  })
})

describe("closeIssue", () => {
  it("gh issue closeを実行する", () => {
    mockExecFileSync.mockReturnValue("")

    closeIssue(42)

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "close", "42"],
      { cwd: config.PROJECT_ROOT, encoding: "utf-8" },
    )
  })

  it("エラーでもクラッシュしない", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh failed")
    })

    expect(() => closeIssue(99)).not.toThrow()
  })
})
