import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initDb, closeDb, getDb } from "../db/core.js"
import { ulid } from "ulid"

// Override config before importing cost-guard
import { config } from "../config.js"

let originalRate: number
let originalDaily: number | null
let originalMonthly: number | null

beforeEach(() => {
  initDb(":memory:")
  originalRate = config.USD_JPY_RATE
  originalDaily = config.DAILY_COST_BUDGET_JPY
  originalMonthly = config.MONTHLY_COST_BUDGET_JPY
  config.USD_JPY_RATE = 150
  config.DAILY_COST_BUDGET_JPY = null
  config.MONTHLY_COST_BUDGET_JPY = null
})

afterEach(() => {
  config.USD_JPY_RATE = originalRate
  config.DAILY_COST_BUDGET_JPY = originalDaily
  config.MONTHLY_COST_BUDGET_JPY = originalMonthly
  closeDb()
})

function insertTask(costUsd: number, finishedAt: string): void {
  const db = getDb()
  const id = ulid()
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, created_by, created_at, finished_at, cost_usd, tokens_used, retry_count)
     VALUES (?, ?, ?, 'done', 1, 'pm', ?, ?, ?, 0, 0)`,
  ).run(id, `task-${id}`, "desc", finishedAt, finishedAt, costUsd)
}

describe("checkBudget", () => {
  it("returns zero costs when no tasks exist", async () => {
    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.daily_cost_jpy).toBe(0)
    expect(status.monthly_cost_jpy).toBe(0)
    expect(status.exceeded).toBe(false)
    expect(status.reason).toBeNull()
    expect(status.usd_jpy_rate).toBe(150)
  })

  it("aggregates costs and converts to JPY", async () => {
    const now = new Date().toISOString()
    insertTask(0.10, now)
    insertTask(0.20, now)

    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.daily_cost_jpy).toBeCloseTo(45, 0) // 0.30 * 150
    expect(status.monthly_cost_jpy).toBeCloseTo(45, 0)
    expect(status.exceeded).toBe(false)
  })

  it("detects daily budget exceeded", async () => {
    config.DAILY_COST_BUDGET_JPY = 30
    const now = new Date().toISOString()
    insertTask(0.25, now) // 0.25 * 150 = 37.5 > 30

    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.exceeded).toBe(true)
    expect(status.reason).toBe("daily")
  })

  it("detects monthly budget exceeded", async () => {
    config.MONTHLY_COST_BUDGET_JPY = 50
    const now = new Date().toISOString()
    insertTask(0.40, now) // 0.40 * 150 = 60 > 50

    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.exceeded).toBe(true)
    expect(status.reason).toBe("monthly")
  })

  it("daily takes priority over monthly when both exceeded", async () => {
    config.DAILY_COST_BUDGET_JPY = 10
    config.MONTHLY_COST_BUDGET_JPY = 10
    const now = new Date().toISOString()
    insertTask(0.10, now) // 15 JPY > both

    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.exceeded).toBe(true)
    expect(status.reason).toBe("daily")
  })

  it("skips daily check when budget is null", async () => {
    config.DAILY_COST_BUDGET_JPY = null
    config.MONTHLY_COST_BUDGET_JPY = 1000
    const now = new Date().toISOString()
    insertTask(1.0, now) // 150 JPY

    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.exceeded).toBe(false)
    expect(status.daily_budget_jpy).toBeNull()
  })

  it("skips monthly check when budget is null", async () => {
    config.DAILY_COST_BUDGET_JPY = 1000
    config.MONTHLY_COST_BUDGET_JPY = null
    const now = new Date().toISOString()
    insertTask(1.0, now) // 150 JPY

    const { checkBudget } = await import("../cost-guard.js")
    const status = checkBudget()
    expect(status.exceeded).toBe(false)
    expect(status.monthly_budget_jpy).toBeNull()
  })
})

describe("isBudgetExceeded", () => {
  it("returns false when no budgets set", async () => {
    const { isBudgetExceeded } = await import("../cost-guard.js")
    expect(isBudgetExceeded()).toBe(false)
  })

  it("returns true when daily budget exceeded", async () => {
    config.DAILY_COST_BUDGET_JPY = 10
    const now = new Date().toISOString()
    insertTask(0.10, now) // 15 JPY > 10

    const { isBudgetExceeded } = await import("../cost-guard.js")
    expect(isBudgetExceeded()).toBe(true)
  })
})
