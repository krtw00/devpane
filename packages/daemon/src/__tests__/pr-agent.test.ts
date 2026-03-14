import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { parseGhPrList, assessRisk } from "../pr-agent.js"
import type { PrInfo } from "../pr-agent.js"
import { config } from "../config.js"

function makePr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 42,
    title: "task-abc123: テスト機能追加",
    headRefName: "devpane/task-abc123",
    additions: 50,
    deletions: 20,
    url: "https://github.com/krtw00/devpane/pull/42",
    testStatus: "unknown",
    ...overrides,
  }
}

describe("parseGhPrList", () => {
  it("parses PR list JSON and filters devpane/task-* branches", () => {
    const json = JSON.stringify([
      {
        number: 1,
        title: "task-001: foo",
        headRefName: "devpane/task-001",
        additions: 10,
        deletions: 5,
        url: "https://github.com/x/y/pull/1",
        statusCheckRollup: [{ conclusion: "SUCCESS" }],
      },
      {
        number: 2,
        title: "unrelated PR",
        headRefName: "feature/unrelated",
        additions: 100,
        deletions: 50,
        url: "https://github.com/x/y/pull/2",
        statusCheckRollup: [],
      },
    ])

    const result = parseGhPrList(json)
    expect(result).toHaveLength(1)
    expect(result[0].number).toBe(1)
    expect(result[0].testStatus).toBe("pass")
  })

  it("detects test failure from statusCheckRollup", () => {
    const json = JSON.stringify([
      {
        number: 3,
        title: "task-002: bar",
        headRefName: "devpane/task-002",
        additions: 20,
        deletions: 10,
        url: "https://github.com/x/y/pull/3",
        statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }],
      },
    ])

    const result = parseGhPrList(json)
    expect(result[0].testStatus).toBe("fail")
  })

  it("returns unknown when no statusCheckRollup", () => {
    const json = JSON.stringify([
      {
        number: 4,
        title: "task-003: baz",
        headRefName: "devpane/task-003",
        additions: 5,
        deletions: 2,
        url: "https://github.com/x/y/pull/4",
        statusCheckRollup: null,
      },
    ])

    const result = parseGhPrList(json)
    expect(result[0].testStatus).toBe("unknown")
  })

  it("returns empty array for empty input", () => {
    expect(parseGhPrList("[]")).toEqual([])
  })
})

describe("assessRisk", () => {
  it("returns recommended when tests pass and diff < 300", () => {
    const report = assessRisk(makePr({ testStatus: "pass", additions: 100, deletions: 50 }))
    expect(report.risk).toBe("recommended")
    expect(report.diffSize).toBe(150)
  })

  it("returns not_recommended when tests fail", () => {
    const report = assessRisk(makePr({ testStatus: "fail" }))
    expect(report.risk).toBe("not_recommended")
    expect(report.reason).toMatch(/tests failed/)
  })

  it("returns needs_review when tests pass but diff >= 300", () => {
    const report = assessRisk(makePr({ testStatus: "pass", additions: 200, deletions: 150 }))
    expect(report.risk).toBe("needs_review")
    expect(report.reason).toMatch(/large diff/)
  })

  it("returns needs_review when test status is unknown", () => {
    const report = assessRisk(makePr({ testStatus: "unknown", additions: 10, deletions: 5 }))
    expect(report.risk).toBe("needs_review")
    expect(report.reason).toMatch(/test status unknown/)
  })

  it("returns needs_review with both reasons when unknown + large diff", () => {
    const report = assessRisk(makePr({ testStatus: "unknown", additions: 200, deletions: 200 }))
    expect(report.risk).toBe("needs_review")
    expect(report.reason).toMatch(/test status unknown/)
    expect(report.reason).toMatch(/large diff/)
  })
})

describe("assessRisk with PR_RISK_DIFF_THRESHOLD", () => {
  let originalThreshold: number

  beforeEach(() => {
    originalThreshold = config.PR_RISK_DIFF_THRESHOLD
  })

  afterEach(() => {
    config.PR_RISK_DIFF_THRESHOLD = originalThreshold
  })

  it("uses PR_RISK_DIFF_THRESHOLD from config instead of hardcoded 300", () => {
    config.PR_RISK_DIFF_THRESHOLD = 100
    const report = assessRisk(makePr({ testStatus: "pass", additions: 60, deletions: 50 }))
    // diffSize=110 >= threshold=100 → needs_review
    expect(report.risk).toBe("needs_review")
    expect(report.reason).toMatch(/large diff/)
  })

  it("returns recommended when diff is below custom threshold", () => {
    config.PR_RISK_DIFF_THRESHOLD = 500
    const report = assessRisk(makePr({ testStatus: "pass", additions: 200, deletions: 100 }))
    // diffSize=300 < threshold=500 → recommended
    expect(report.risk).toBe("recommended")
  })

  it("returns needs_review at exact threshold boundary", () => {
    config.PR_RISK_DIFF_THRESHOLD = 200
    const report = assessRisk(makePr({ testStatus: "pass", additions: 100, deletions: 100 }))
    // diffSize=200 >= threshold=200 → needs_review
    expect(report.risk).toBe("needs_review")
  })

  it("returns recommended just below threshold boundary", () => {
    config.PR_RISK_DIFF_THRESHOLD = 200
    const report = assessRisk(makePr({ testStatus: "pass", additions: 100, deletions: 99 }))
    // diffSize=199 < threshold=200 → recommended
    expect(report.risk).toBe("recommended")
  })

  it("defaults to 300 when PR_RISK_DIFF_THRESHOLD is not explicitly set", () => {
    // デフォルト値が300であることを確認
    expect(originalThreshold).toBe(300)
  })
})
