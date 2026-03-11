import type { Task } from "@devpane/shared"
import type { StructuredFailure, RootCauseType } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Gate 1: PMタスク品質検証
// PMが生成したタスクの description / title が Worker に渡せる品質かルールベースで判定

export type Gate1Result = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
  failure?: StructuredFailure
}

const MIN_DESCRIPTION_LENGTH = 20
const MAX_TITLE_LENGTH = 200

export function runGate1(task: Task): Gate1Result {
  const reasons: string[] = []
  let verdict: "go" | "kill" | "recycle" = "go"

  // Rule 1: タイトルが空 → kill
  if (!task.title.trim()) {
    verdict = "kill"
    reasons.push("empty title")
  }

  // Rule 2: タイトルが長すぎる → recycle
  if (task.title.length > MAX_TITLE_LENGTH) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`title too long: ${task.title.length} chars (max ${MAX_TITLE_LENGTH})`)
  }

  // Rule 3: descriptionが短すぎる → recycle（Workerが実装できない）
  if (task.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`description too short: ${task.description.trim().length} chars (min ${MIN_DESCRIPTION_LENGTH})`)
  }

  // Rule 4: descriptionが空 → kill
  if (!task.description.trim()) {
    verdict = "kill"
    reasons.push("empty description")
  }

  // Emit event
  if (verdict === "go") {
    emit({ type: "gate.passed", taskId: task.id, gate: "gate1" })
    appendLog(task.id, "gate1", `[pass] ${reasons.length === 0 ? "all checks passed" : reasons.join(", ")}`)
  } else {
    emit({ type: "gate.rejected", taskId: task.id, gate: "gate1", verdict, reason: reasons.join("; ") })
    appendLog(task.id, "gate1", `[${verdict}] ${reasons.join("; ")}`)
  }

  const result: Gate1Result = { verdict, reasons }

  if (verdict !== "go") {
    result.failure = {
      task_id: task.id,
      stage: "gate1",
      root_cause: classifyRootCause(task),
      why_chain: reasons,
      gates_passed: [],
      severity: verdict === "kill" ? "critical" : "process_gap",
    }
  }

  return result
}

function classifyRootCause(task: Task): RootCauseType {
  if (!task.title.trim() || !task.description.trim()) return "spec_ambiguity"
  if (task.description.trim().length < MIN_DESCRIPTION_LENGTH) return "spec_ambiguity"
  return "unknown"
}
