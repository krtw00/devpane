import type { Improvement, ObservableFacts } from "@devpane/shared"
import type { ImprovementVerdict } from "@devpane/shared/schemas"
import { getDb } from "./db.js"
import { emit } from "./events.js"

let stmt: ReturnType<typeof prepareStmt> | null = null
let stmtDb: ReturnType<typeof getDb> | null = null

function prepareStmt() {
  const db = getDb()
  return {
    getActiveImprovements: db.prepare(
      `SELECT * FROM improvements WHERE status = 'active'`,
    ),
    getImprovement: db.prepare(
      `SELECT * FROM improvements WHERE id = ?`,
    ),
    getTasksBefore: db.prepare(
      `SELECT * FROM tasks WHERE status IN ('done', 'failed') AND finished_at <= ? ORDER BY finished_at DESC LIMIT ?`,
    ),
    getTasksAfter: db.prepare(
      `SELECT * FROM tasks WHERE status IN ('done', 'failed') AND finished_at > ? ORDER BY finished_at ASC LIMIT ?`,
    ),
    updateVerdict: db.prepare(
      `UPDATE improvements SET status = ?, verdict = ?, after_metrics = ? WHERE id = ?`,
    ),
  }
}

function getStmt() {
  const db = getDb()
  if (!stmt || stmtDb !== db) {
    stmt = prepareStmt()
    stmtDb = db
  }
  return stmt
}

export type EffectMeasureResult = {
  improvementId: string
  beforeFailureRate: number
  afterFailureRate: number
  verdict: ImprovementVerdict
  action: string
}

type TaskRow = {
  id: string
  status: string
  result: string | null
  cost_usd: number
}

function computeMetrics(tasks: TaskRow[]): { failureRate: number; avgCost: number; avgDiffSize: number } {
  if (tasks.length === 0) {
    return { failureRate: 0, avgCost: 0, avgDiffSize: 0 }
  }

  const failedCount = tasks.filter(t => t.status === "failed").length
  const failureRate = failedCount / tasks.length

  const avgCost = tasks.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0) / tasks.length

  let totalDiffSize = 0
  let diffCount = 0
  for (const t of tasks) {
    if (t.result) {
      try {
        const facts = JSON.parse(t.result) as ObservableFacts
        totalDiffSize += facts.diff_stats.additions + facts.diff_stats.deletions
        diffCount++
      } catch {
        // skip malformed result
      }
    }
  }
  const avgDiffSize = diffCount > 0 ? totalDiffSize / diffCount : 0

  return { failureRate, avgCost, avgDiffSize }
}

function judgeVerdict(beforeRate: number, afterRate: number): ImprovementVerdict {
  if (afterRate < beforeRate) return "effective"
  if (afterRate > beforeRate) return "harmful"
  return "ineffective"
}

export function measureEffect(
  improvementId: string,
  beforeCount = 10,
  afterCount = 10,
): EffectMeasureResult | null {
  const s = getStmt()

  const improvement = s.getImprovement.get(improvementId) as Improvement | undefined
  if (!improvement || improvement.status !== "active") return null

  const tasksBefore = s.getTasksBefore.all(improvement.applied_at, beforeCount) as TaskRow[]
  const tasksAfter = s.getTasksAfter.all(improvement.applied_at, afterCount) as TaskRow[]

  if (tasksAfter.length === 0) return null

  const before = computeMetrics(tasksBefore)
  const after = computeMetrics(tasksAfter)

  const verdict = judgeVerdict(before.failureRate, after.failureRate)

  const afterMetrics = JSON.stringify({
    failureRate: after.failureRate,
    avgCost: after.avgCost,
    avgDiffSize: after.avgDiffSize,
    sampleSize: tasksAfter.length,
  })

  let newStatus: string = improvement.status
  if (verdict === "harmful") {
    newStatus = "reverted"
  } else if (verdict === "effective") {
    newStatus = improvement.status // keep active
  }

  s.updateVerdict.run(newStatus, verdict, afterMetrics, improvementId)

  if (verdict === "harmful") {
    emit({
      type: "improvement.reverted",
      improvementId,
      reason: `failure rate increased: ${(before.failureRate * 100).toFixed(1)}% → ${(after.failureRate * 100).toFixed(1)}%`,
    })
  }

  return {
    improvementId,
    beforeFailureRate: before.failureRate,
    afterFailureRate: after.failureRate,
    verdict,
    action: improvement.action,
  }
}

export function measureAllActive(beforeCount = 10, afterCount = 10): EffectMeasureResult[] {
  const s = getStmt()
  const actives = s.getActiveImprovements.all() as Improvement[]
  const results: EffectMeasureResult[] = []
  for (const imp of actives) {
    const result = measureEffect(imp.id, beforeCount, afterCount)
    if (result) results.push(result)
  }
  return results
}
