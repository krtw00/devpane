import type { AgentEvent } from "@devpane/shared/schemas"
import type { Task } from "@devpane/shared"
import { getEventsByTaskId } from "./db.js"

export type StageResult = "pass" | "kill" | "recycle" | "skip" | "pending"

export type PipelineTrace = {
  taskId: string
  title: string
  gate1: StageResult
  tester: StageResult
  gate2: StageResult
  worker: StageResult
  gate3: StageResult
  outcome: string // "merged", "kill:reason", "recycle", "running", "pending"
  costUsd: number
}

function deriveStageResults(events: AgentEvent[]): Pick<PipelineTrace, "gate1" | "tester" | "gate2" | "worker" | "gate3" | "outcome"> {
  const result: Pick<PipelineTrace, "gate1" | "tester" | "gate2" | "worker" | "gate3" | "outcome"> = {
    gate1: "skip",
    tester: "skip",
    gate2: "skip",
    worker: "skip",
    gate3: "skip",
    outcome: "pending",
  }

  for (const e of events) {
    switch (e.type) {
      case "gate.passed":
        if (e.gate === "gate1") result.gate1 = "pass"
        else if (e.gate === "gate2") result.gate2 = "pass"
        else if (e.gate === "gate3") result.gate3 = "pass"
        break
      case "gate.rejected":
        if (e.gate === "gate1") {
          result.gate1 = e.verdict as StageResult
          result.outcome = `${e.verdict}:${e.reason.slice(0, 30)}`
        } else if (e.gate === "gate2") {
          result.gate2 = e.verdict as StageResult
        } else if (e.gate === "gate3") {
          result.gate3 = e.verdict as StageResult
          result.outcome = `${e.verdict}:${e.reason.slice(0, 30)}`
        }
        break
      case "task.started":
        if (e.workerId !== "requeued") {
          result.worker = "pass"
          // If worker started, tester must have run (or been skipped)
          if (result.tester === "skip") result.tester = "pass"
        }
        break
      case "task.completed":
        result.outcome = "merged"
        break
      case "task.failed":
        if (result.outcome === "pending") {
          result.outcome = `fail:${e.rootCause}`
        }
        break
      case "pr.created":
        if (result.outcome === "pending") result.outcome = "pr_open"
        break
    }
  }

  return result
}

export function traceTask(task: Task): PipelineTrace {
  const events = getEventsByTaskId(task.id)
  const stages = deriveStageResults(events)

  return {
    taskId: task.id,
    title: task.title,
    ...stages,
    costUsd: task.cost_usd ?? 0,
  }
}

const STAGE_ICONS: Record<StageResult, string> = {
  pass: "+",
  kill: "x",
  recycle: "?",
  skip: "-",
  pending: ".",
}

export function formatPipelineTable(traces: PipelineTrace[]): string {
  if (traces.length === 0) return "(タスクなし)"

  const lines: string[] = []

  // Header
  lines.push("| タスク | G1 | T | G2 | W | G3 | 結果 | コスト |")
  lines.push("|--------|----|----|----|----|----|----|--------|")

  for (const t of traces) {
    const title = t.title.length > 20 ? t.title.slice(0, 18) + ".." : t.title
    const g1 = STAGE_ICONS[t.gate1]
    const te = STAGE_ICONS[t.tester]
    const g2 = STAGE_ICONS[t.gate2]
    const w = STAGE_ICONS[t.worker]
    const g3 = STAGE_ICONS[t.gate3]
    const outcome = t.outcome.length > 20 ? t.outcome.slice(0, 18) + ".." : t.outcome
    const cost = t.costUsd > 0 ? `$${t.costUsd.toFixed(3)}` : "-"
    lines.push(`| ${title} | ${g1} | ${te} | ${g2} | ${w} | ${g3} | ${outcome} | ${cost} |`)
  }

  return lines.join("\n")
}
