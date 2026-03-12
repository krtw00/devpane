import type { Task } from "@devpane/shared"
import type { Gate3Verdict, StructuredFailure, RootCauseType } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Gate 1: PMタスク品質チェック（ルールベース）
// PMが生成したタスクのtitle/descriptionが実行可能な品質か判定する

export type Gate1Result = {
  verdict: Gate3Verdict
  reasons: string[]
  failure?: StructuredFailure
}

const MIN_TITLE_LENGTH = 5
const MAX_TITLE_LENGTH = 200
const MIN_DESCRIPTION_LENGTH = 20

export function runGate1(task: Task): Gate1Result {
  const reasons: string[] = []
  let verdict: Gate3Verdict = "go"

  // Rule 1: タイトルが短すぎる → kill
  if (task.title.trim().length < MIN_TITLE_LENGTH) {
    verdict = "kill"
    reasons.push(`title too short: ${task.title.length} chars (min ${MIN_TITLE_LENGTH})`)
  }

  // Rule 2: タイトルが長すぎる → recycle
  if (task.title.trim().length > MAX_TITLE_LENGTH) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`title too long: ${task.title.length} chars (max ${MAX_TITLE_LENGTH})`)
  }

  // Rule 3: descriptionが短すぎる → recycle
  if (task.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`description too short: ${task.description.length} chars (min ${MIN_DESCRIPTION_LENGTH})`)
  }

  // Rule 4: descriptionにファイルパスや具体的指示が含まれていない → recycle
  const hasSpecificity = /\.(ts|js|vue|json|md|css|html)|\/|function |class |import |export |add |create |fix |update /i.test(task.description)
  if (!hasSpecificity) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push("description lacks specificity (no file paths, code references, or actionable verbs)")
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
      root_cause: classifyRootCause(reasons),
      why_chain: reasons,
      gates_passed: [],
      severity: verdict === "kill" ? "critical" : "process_gap",
    }
  }

  return result
}

function classifyRootCause(reasons: string[]): RootCauseType {
  const joined = reasons.join(" ")
  if (/short/.test(joined)) return "spec_ambiguity"
  if (/specificity/.test(joined)) return "spec_ambiguity"
  return "unknown"
}
