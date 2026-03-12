import { registerHook, type TaskCompletedData } from "./scheduler-hooks.js"
import { recordTaskMetrics, checkAllMetrics } from "./spc.js"
import { safeEmit } from "./events.js"
import { remember, forget, findSimilar } from "./memory.js"
import { getWorktreeNewAndDeleted } from "./worktree.js"
import { getActiveImprovements } from "./db.js"
import { measureAllActive } from "./effect-measure.js"

let taskCompletionsSinceLastMeasure = 0
export const EFFECT_MEASURE_THRESHOLD = 10

export function resetEffectMeasureCounter(): void {
  taskCompletionsSinceLastMeasure = 0
}

export function setEffectMeasureCounter(n: number): void {
  taskCompletionsSinceLastMeasure = n
}

export function getEffectMeasureCounter(): number {
  return taskCompletionsSinceLastMeasure
}

export function checkEffectMeasurement(): void {
  const actives = getActiveImprovements()
  if (actives.length === 0) {
    taskCompletionsSinceLastMeasure = 0
    return
  }

  if (taskCompletionsSinceLastMeasure < EFFECT_MEASURE_THRESHOLD) return

  taskCompletionsSinceLastMeasure = 0
  console.log(`[scheduler] running effect measurement for ${actives.length} active improvements`)
  const results = measureAllActive()
  for (const r of results) {
    console.log(`[scheduler] improvement ${r.improvementId}: ${r.verdict} (${(r.beforeFailureRate * 100).toFixed(1)}% → ${(r.afterFailureRate * 100).toFixed(1)}%)`)
  }
}

// SPC hook
registerHook("task.completed", (data: TaskCompletedData) => {
  const diffSize = data.facts.diff_stats.additions + data.facts.diff_stats.deletions
  recordTaskMetrics(data.task.id, data.costUsd, data.executionMs, diffSize)
  const spcAlerts = checkAllMetrics(data.task.id, data.costUsd, data.executionMs, diffSize)
  for (const alert of spcAlerts) {
    if (alert.alert) {
      safeEmit({ type: "spc.alert", metric: alert.metric, value: alert.value, ucl: alert.ucl })
      console.warn(`[scheduler] SPC alert: ${alert.metric} = ${alert.value.toFixed(4)} (UCL: ${alert.ucl.toFixed(4)}) — ${alert.reason}`)
    }
  }
})

// Memory hook
registerHook("task.completed", (data: TaskCompletedData) => {
  if (!data.facts.commit_hash) return

  const { added, deleted } = getWorktreeNewAndDeleted(data.task.id)
  for (const file of added) {
    remember("feature", `${file} を追加（${data.task.title}）`, data.task.id)
  }
  for (const file of deleted) {
    const existing = findSimilar("feature", file)
    for (const m of existing) forget(m.id)
  }

  // constraints → decision記憶
  const constraints = parseConstraints(data.task.constraints)
  for (const c of constraints) {
    remember("decision", c, data.task.id)
  }

  const memoryCount = added.length + constraints.length
  if (memoryCount > 0 || deleted.length > 0) {
    console.log(`[scheduler] memory: +${added.length} features, +${constraints.length} decisions, -${deleted.length} forgotten`)
  }
})

// Effect measurement hook
registerHook("task.completed", () => {
  taskCompletionsSinceLastMeasure++
  checkEffectMeasurement()
})

function parseConstraints(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string")
  } catch { /* ignore malformed JSON */ }
  return []
}
