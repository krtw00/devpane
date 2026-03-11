import type { Task } from "@devpane/shared"
import type { StructuredFailure, RootCauseType } from "@devpane/shared/schemas"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

// Tester: タスクのテスト可能性・受入基準を検証
// Workerに渡す前にdescriptionが検証可能な基準を含むかチェック

export type TesterResult = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
  failure?: StructuredFailure
}

// テスト可能性を示すキーワードパターン
const TESTABILITY_PATTERNS = [
  /テスト/,
  /test/i,
  /検証/,
  /確認/,
  /assert/i,
  /expect/i,
  /動作/,
  /返す/,
  /表示/,
  /エラー/,
  /error/i,
  /追加/,
  /削除/,
  /修正/,
  /実装/,
  /作成/,
  /build/i,
]

export function runTester(task: Task): TesterResult {
  const reasons: string[] = []
  let verdict: "go" | "kill" | "recycle" = "go"
  const desc = task.description

  // Rule 1: descriptionにアクション可能な動詞がない → recycle
  const hasActionable = TESTABILITY_PATTERNS.some(p => p.test(desc))
  if (!hasActionable) {
    verdict = "recycle"
    reasons.push("description lacks actionable/testable criteria")
  }

  // Rule 2: descriptionが具体的なファイルやコンポーネントに言及していない → 警告のみ
  const hasSpecificTarget = /\.(ts|js|vue|tsx|jsx|json|css|html)\b/.test(desc) ||
    /(?:関数|function|class|component|コンポーネント|ファイル|モジュール|API|エンドポイント)/i.test(desc)
  if (!hasSpecificTarget) {
    reasons.push("description does not reference specific files or components (warning)")
  }

  // Emit event
  if (verdict === "go") {
    emit({ type: "gate.passed", taskId: task.id, gate: "tester" })
    appendLog(task.id, "tester", `[pass] ${reasons.length === 0 ? "testability checks passed" : reasons.join(", ")}`)
  } else {
    emit({ type: "gate.rejected", taskId: task.id, gate: "tester", verdict, reason: reasons.join("; ") })
    appendLog(task.id, "tester", `[${verdict}] ${reasons.join("; ")}`)
  }

  const result: TesterResult = { verdict, reasons }

  if (verdict !== "go") {
    result.failure = {
      task_id: task.id,
      stage: "tester",
      root_cause: classifyRootCause(reasons),
      why_chain: reasons,
      gates_passed: ["gate1"],
      severity: "process_gap",
    }
  }

  return result
}

function classifyRootCause(reasons: string[]): RootCauseType {
  if (reasons.some(r => r.includes("actionable"))) return "spec_ambiguity"
  return "unknown"
}
