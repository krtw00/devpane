import { getDb } from "./db.js"
import type { ImprovementVerdict } from "@devpane/shared/schemas"

export type EffectResult = {
  improvementId: string
  before: MetricSnapshot
  after: MetricSnapshot
  verdict: ImprovementVerdict
}

type MetricSnapshot = {
  failRate: number
  totalTasks: number
}

/**
 * 改善適用前後の失敗率を比較し、効果を判定する。
 * appliedAt 以前の windowSize 件と以後の windowSize 件を比較。
 */
export function measureEffect(
  improvementId: string,
  appliedAt: string,
  windowSize = 10,
): EffectResult | null {
  const db = getDb()

  const before = db
    .prepare(
      `SELECT status FROM tasks
       WHERE finished_at IS NOT NULL AND finished_at <= ?
       ORDER BY finished_at DESC LIMIT ?`,
    )
    .all(appliedAt, windowSize) as { status: string }[]

  const after = db
    .prepare(
      `SELECT status FROM tasks
       WHERE finished_at IS NOT NULL AND finished_at > ?
       ORDER BY finished_at ASC LIMIT ?`,
    )
    .all(appliedAt, windowSize) as { status: string }[]

  if (before.length < 3 || after.length < windowSize) return null

  const snap = (rows: { status: string }[]): MetricSnapshot => {
    const failed = rows.filter((r) => r.status === "failed").length
    return { failRate: failed / rows.length, totalTasks: rows.length }
  }

  const beforeSnap = snap(before)
  const afterSnap = snap(after)

  let verdict: ImprovementVerdict
  if (afterSnap.failRate < beforeSnap.failRate * 0.8) {
    verdict = "effective"
  } else if (afterSnap.failRate > beforeSnap.failRate * 1.2) {
    verdict = "harmful"
  } else {
    verdict = "ineffective"
  }

  return {
    improvementId,
    before: beforeSnap,
    after: afterSnap,
    verdict,
  }
}
