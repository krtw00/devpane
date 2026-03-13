import type { ObservableFacts } from "@devpane/shared"
import type { Gate3Verdict, StructuredFailure, RootCauseType } from "@devpane/shared/schemas"
import { appendLog } from "./db.js"
import { config } from "./config.js"

// Gate 3: Observable Factsに基づく成果物判定
// 原理1: 判定はコード（ルールベース）。LLMには委託しない。

export type Gate3Result = {
  verdict: Gate3Verdict
  reasons: string[]
  failure?: StructuredFailure
}


export function runGate3(taskId: string, facts: ObservableFacts): Gate3Result {
  const reasons: string[] = []
  let verdict: Gate3Verdict = "go"

  // Rule 1: exit code が非ゼロ → kill
  if (facts.exit_code !== 0) {
    verdict = "kill"
    reasons.push(`exit_code=${facts.exit_code}`)
  }

  // Rule 2: テスト失敗 → recycle
  if (facts.test_result && facts.test_result.failed > 0) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`tests failed: ${facts.test_result.failed}`)
  }

  // Rule 3: lint error → recycle
  if (facts.lint_result && facts.lint_result.errors > 0) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`lint errors: ${facts.lint_result.errors}`)
  }

  // Rule 4: diff size ポカヨケ → recycle
  const diffSize = facts.diff_stats.additions + facts.diff_stats.deletions
  if (diffSize > config.MAX_DIFF_SIZE) {
    verdict = verdict === "kill" ? "kill" : "recycle"
    reasons.push(`diff too large: +${facts.diff_stats.additions}/-${facts.diff_stats.deletions} (max ${config.MAX_DIFF_SIZE})`)
  }

  // Rule 5: コミットなし → kill
  if (!facts.commit_hash) {
    verdict = "kill"
    reasons.push("no commit produced")
  }

  // Rule 6: ファイル変更なし → kill
  if (facts.files_changed.length === 0) {
    verdict = "kill"
    reasons.push("no files changed")
  }

  if (verdict === "go") {
    appendLog(taskId, "gate3", `[pass] ${reasons.length === 0 ? "all checks passed" : reasons.join(", ")}`)
  } else {
    appendLog(taskId, "gate3", `[${verdict}] ${reasons.join("; ")}`)
  }

  const result: Gate3Result = { verdict, reasons }

  // 構造化失敗記録（kill/recycleの場合）
  if (verdict !== "go") {
    result.failure = {
      task_id: taskId,
      stage: "gate3",
      root_cause: classifyRootCause(facts, reasons),
      why_chain: reasons,
      gates_passed: ["gate3"],
      severity: verdict === "kill" ? "critical" : "process_gap",
    }
  }

  return result
}

function classifyRootCause(facts: ObservableFacts, reasons: string[]): RootCauseType {
  if (facts.test_result?.failed && facts.test_result.failed > 0) return "test_gap"
  if (facts.lint_result?.errors && facts.lint_result.errors > 0) return "scope_creep"
  const diffSize = facts.diff_stats.additions + facts.diff_stats.deletions
  if (diffSize > config.MAX_DIFF_SIZE) return "scope_creep"
  if (!facts.commit_hash || facts.files_changed.length === 0) return "unknown"
  if (reasons.some(r => /timeout/i.test(r))) return "env_issue"
  if (facts.exit_code !== 0) return "env_issue"
  return "unknown"
}
