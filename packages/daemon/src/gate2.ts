import type { Task } from "@devpane/shared"
import type { StructuredFailure, RootCauseType } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Gate 2: Worker実行前の最終品質ゲート
// Gate1・Testerを通過したタスクが Worker に渡せる状態かルールベースで最終判定

export type Gate2Result = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
  failure?: StructuredFailure
}

const MAX_DESCRIPTION_LENGTH = 10000

export function runGate2(task: Task): Gate2Result {
  const reasons: string[] = []
  let verdict: "go" | "kill" | "recycle" = "go"

  // Rule 1: descriptionが巨大すぎる → recycle（トークン爆発防止）
  if (task.description.length > MAX_DESCRIPTION_LENGTH) {
    verdict = "recycle"
    reasons.push(`description too long: ${task.description.length} chars (max ${MAX_DESCRIPTION_LENGTH})`)
  }

  // Rule 2: タスクステータスがpendingでない → kill（不正状態）
  if (task.status !== "pending") {
    verdict = "kill"
    reasons.push(`unexpected task status: ${task.status} (expected pending)`)
  }

  // Emit event
  if (verdict === "go") {
    emit({ type: "gate.passed", taskId: task.id, gate: "gate2" })
    appendLog(task.id, "gate2", `[pass] ${reasons.length === 0 ? "all checks passed" : reasons.join(", ")}`)
  } else {
    emit({ type: "gate.rejected", taskId: task.id, gate: "gate2", verdict, reason: reasons.join("; ") })
    appendLog(task.id, "gate2", `[${verdict}] ${reasons.join("; ")}`)
  }

  const result: Gate2Result = { verdict, reasons }

  if (verdict !== "go") {
    result.failure = {
      task_id: task.id,
      stage: "gate2",
      root_cause: classifyRootCause(reasons),
      why_chain: reasons,
      gates_passed: ["gate1", "tester"],
      severity: verdict === "kill" ? "critical" : "process_gap",
    }
  }

  return result
}

function classifyRootCause(reasons: string[]): RootCauseType {
  if (reasons.some(r => r.includes("status"))) return "env_issue"
  if (reasons.some(r => r.includes("too long"))) return "scope_creep"
  return "unknown"
}
