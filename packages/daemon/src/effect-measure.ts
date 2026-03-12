import type { ImprovementVerdict } from "@devpane/shared/schemas"
import { getDb } from "./db.js"

type MetricSnapshot = { cost_avg: number; fail_rate: number }

function collectMetrics(windowSize: number): MetricSnapshot {
  const db = getDb()

  const row = db.prepare(`
    SELECT
      COALESCE(AVG(cost_usd), 0) AS cost_avg,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1.0 ELSE 0 END) / MAX(COUNT(*), 1), 0) AS fail_rate
    FROM (SELECT cost_usd, status FROM tasks WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ?)
  `).get(windowSize) as MetricSnapshot

  return row
}

export function snapshotBeforeMetrics(windowSize = 10): string {
  return JSON.stringify(collectMetrics(windowSize))
}

/**
 * 改善適用後にメトリクスを比較し、verdict を返す。
 */
export function measureEffect(improvementId: string, windowSize = 10): { verdict: ImprovementVerdict; afterMetrics: string } {
  const db = getDb()

  const imp = db.prepare(`SELECT before_metrics FROM improvements WHERE id = ?`).get(improvementId) as { before_metrics: string | null } | undefined
  if (!imp?.before_metrics) {
    return { verdict: "ineffective", afterMetrics: JSON.stringify(collectMetrics(windowSize)) }
  }

  const before: MetricSnapshot = JSON.parse(imp.before_metrics)
  const after = collectMetrics(windowSize)
  const afterMetrics = JSON.stringify(after)

  // fail_rate が悪化 → harmful
  if (after.fail_rate > before.fail_rate + 0.1) {
    return { verdict: "harmful", afterMetrics }
  }

  // fail_rate or cost_avg が改善 → effective
  if (after.fail_rate < before.fail_rate - 0.05 || after.cost_avg < before.cost_avg * 0.9) {
    return { verdict: "effective", afterMetrics }
  }

  return { verdict: "ineffective", afterMetrics }
}
