import type { WhyWhyAnalysis, RootCauseType, StructuredFailure } from "@devpane/shared/schemas"
import { getDb } from "./db.js"

/**
 * 直近の失敗タスクから構造化失敗情報を集計し、
 * 最頻の root_cause に対するなぜなぜ分析を返す。
 */
export function runWhyWhyAnalysis(windowSize = 10): WhyWhyAnalysis | null {
  const db = getDb()

  // 直近の失敗タスクから result JSON を取得
  const rows = db.prepare(
    `SELECT result FROM tasks WHERE status = 'failed' AND result IS NOT NULL ORDER BY finished_at DESC LIMIT ?`
  ).all(windowSize) as { result: string }[]

  if (rows.length === 0) return null

  // gate3 の failure 情報を抽出
  const failures: StructuredFailure[] = []
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.result)
      if (parsed.gate3?.failure) {
        failures.push(parsed.gate3.failure as StructuredFailure)
      }
    } catch {
      // skip malformed JSON
    }
  }

  if (failures.length === 0) return null

  // root_cause 頻度集計
  const freq = new Map<RootCauseType, number>()
  for (const f of failures) {
    freq.set(f.root_cause, (freq.get(f.root_cause) ?? 0) + 1)
  }

  let topCause: RootCauseType = "unknown"
  let topCount = 0
  for (const [cause, count] of freq) {
    if (count > topCount) {
      topCause = cause
      topCount = count
    }
  }

  // top cause の why_chain を集約（最新のものを使用）
  const topFailure = failures.find(f => f.root_cause === topCause)
  const whyChain = topFailure?.why_chain ?? [topCause]

  // root_cause に応じた改善アクションを生成
  const improvements = generateImprovements(topCause)

  return {
    analysis: {
      top_failure: topCause,
      frequency: `${topCount}/${failures.length}`,
      why_chain: whyChain,
    },
    improvements,
  }
}

function generateImprovements(cause: RootCauseType): WhyWhyAnalysis["improvements"] {
  switch (cause) {
    case "spec_ambiguity":
      return [{ target: "pm_template", action: "add_field", description: "PM出力に acceptance_criteria フィールドを追加して仕様の曖昧さを低減" }]
    case "test_gap":
      return [{ target: "gate3", action: "add_check", description: "Gate3にテストカバレッジ閾値チェックを追加" }]
    case "scope_creep":
      return [{ target: "worker_instruction", action: "add_constraint", description: "Workerプロンプトにスコープ制限を追加" }]
    case "api_misuse":
      return [{ target: "gate1", action: "add_check", description: "Gate1にAPI使用パターンの事前検証を追加" }]
    case "regression":
      return [{ target: "gate3", action: "add_check", description: "Gate3に回帰テスト必須チェックを追加" }]
    case "timeout":
      return [{ target: "spc_threshold", action: "adjust_threshold", description: "実行時間のSPC閾値を調整" }]
    case "env_issue":
      return [{ target: "gate1", action: "add_check", description: "Gate1に環境チェックを追加" }]
    default:
      return [{ target: "gate3", action: "add_check", description: "Gate3の検証ルールを強化" }]
  }
}
