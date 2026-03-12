import type { Task } from "@devpane/shared"
import type { Gate3Verdict, StructuredFailure, RootCauseType } from "@devpane/shared/schemas"
import type { TesterResult } from "./tester.js"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Gate 2: テスト基準とタスク仕様の照合（ルールベース）
// Testerが生成した基準がタスクの要求を満たしているか検証する

export type Gate2Result = {
  verdict: Gate3Verdict
  reasons: string[]
  failure?: StructuredFailure
}

const MIN_CRITERIA = 3

export function runGate2(task: Task, testerResult: TesterResult): Gate2Result {
  const reasons: string[] = []
  let verdict: Gate3Verdict = "go"

  // Rule 1: テスト基準が少なすぎる → recycle
  if (testerResult.criteria.length < MIN_CRITERIA) {
    verdict = "recycle"
    reasons.push(`too few criteria: ${testerResult.criteria.length} (min ${MIN_CRITERIA})`)
  }

  // Rule 2: 必須チェック（build_passes, tests_pass）が含まれているか
  const checks = new Set(testerResult.criteria.map(c => c.check))
  if (!checks.has("build_passes")) {
    verdict = "recycle"
    reasons.push("missing required check: build_passes")
  }
  if (!checks.has("tests_pass")) {
    verdict = "recycle"
    reasons.push("missing required check: tests_pass")
  }

  // Rule 3: タスクにファイル参照があるのにfile_exists基準がない → recycle
  const fileRefs = task.description.match(/[\w/.-]+\.(ts|js|vue|json|css|html)/g)
  if (fileRefs && fileRefs.length > 0 && !checks.has("file_exists")) {
    verdict = "recycle"
    reasons.push("task references files but no file_exists criterion generated")
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
      gates_passed: ["gate1"],
      severity: "process_gap",
    }
  }

  return result
}

function classifyRootCause(reasons: string[]): RootCauseType {
  const joined = reasons.join(" ")
  if (/missing/.test(joined)) return "test_gap"
  if (/few/.test(joined)) return "test_gap"
  return "unknown"
}
