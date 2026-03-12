import type { WhyWhyAnalysis } from "@devpane/shared/schemas"
import { getFailedTasks } from "./db.js"

export function analyze(): WhyWhyAnalysis | null {
  const failures = getFailedTasks()
  if (failures.length === 0) return null

  // TODO: LLM呼び出しによるなぜなぜ分析（現在はスタブ）
  console.log(`[kaizen] analyzing ${failures.length} failed tasks`)
  return null
}
