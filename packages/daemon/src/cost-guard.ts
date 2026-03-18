import { getDb } from "./db/core.js"
import { config } from "./config.js"

export type BudgetStatus = {
  daily_cost_jpy: number
  monthly_cost_jpy: number
  daily_budget_jpy: number | null
  monthly_budget_jpy: number | null
  usd_jpy_rate: number
  exceeded: boolean
  reason: string | null // "daily" | "monthly" | null
}

export function checkBudget(): BudgetStatus {
  const db = getDb()
  const rate = config.USD_JPY_RATE

  const dailyRow = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM tasks WHERE finished_at IS NOT NULL AND date(finished_at, 'localtime') = date('now', 'localtime')",
  ).get() as { total: number }

  const monthlyRow = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM tasks WHERE finished_at IS NOT NULL AND strftime('%Y-%m', finished_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')",
  ).get() as { total: number }

  const dailyCostJpy = dailyRow.total * rate
  const monthlyCostJpy = monthlyRow.total * rate

  const dailyBudget = config.DAILY_COST_BUDGET_JPY
  const monthlyBudget = config.MONTHLY_COST_BUDGET_JPY

  let exceeded = false
  let reason: string | null = null

  if (dailyBudget !== null && dailyCostJpy >= dailyBudget) {
    exceeded = true
    reason = "daily"
  } else if (monthlyBudget !== null && monthlyCostJpy >= monthlyBudget) {
    exceeded = true
    reason = "monthly"
  }

  return {
    daily_cost_jpy: dailyCostJpy,
    monthly_cost_jpy: monthlyCostJpy,
    daily_budget_jpy: dailyBudget,
    monthly_budget_jpy: monthlyBudget,
    usd_jpy_rate: rate,
    exceeded,
    reason,
  }
}

export function isBudgetExceeded(): boolean {
  return checkBudget().exceeded
}
