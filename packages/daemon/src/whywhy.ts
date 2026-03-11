import { getDb } from "./db.js"
import type { WhyWhyAnalysis, RootCauseType } from "@devpane/shared/schemas"

/**
 * 直近の失敗タスクを集計し、最頻の root_cause に対して why-why 分析を行う。
 * Gate3 が記録した StructuredFailure (task.result JSON 内) を情報源とする。
 */
export function analyzeFailures(windowSize = 20): WhyWhyAnalysis | null {
  const db = getDb()

  // 直近の失敗タスクから gate3.failure.root_cause を抽出
  const rows = db
    .prepare(
      `SELECT result FROM tasks
       WHERE status = 'failed' AND result IS NOT NULL
       ORDER BY finished_at DESC LIMIT ?`,
    )
    .all(windowSize) as { result: string }[]

  if (rows.length === 0) return null

  const causes: Record<string, { count: number; whyChains: string[][] }> = {}

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.result)
      const failure = parsed.gate3?.failure
      if (!failure) continue
      const rc: string = failure.root_cause ?? "unknown"
      if (!causes[rc]) causes[rc] = { count: 0, whyChains: [] }
      causes[rc].count++
      if (failure.why_chain) {
        causes[rc].whyChains.push(failure.why_chain)
      }
    } catch {
      // malformed result JSON — skip
    }
  }

  if (Object.keys(causes).length === 0) return null

  // 最頻の root_cause を特定
  const sorted = Object.entries(causes).sort((a, b) => b[1].count - a[1].count)
  const [topCause, topData] = sorted[0]
  const total = sorted.reduce((s, [, d]) => s + d.count, 0)

  // 代表的な why_chain を選択（最長のもの）
  const representativeChain =
    topData.whyChains.sort((a, b) => b.length - a.length)[0] ?? [topCause]

  const improvements = buildImprovements(topCause as RootCauseType)

  return {
    analysis: {
      top_failure: topCause as RootCauseType,
      frequency: `${topData.count}/${total}`,
      why_chain: representativeChain.slice(0, 5),
    },
    improvements,
  }
}

function buildImprovements(
  cause: RootCauseType,
): WhyWhyAnalysis["improvements"] {
  switch (cause) {
    case "test_gap":
      return [
        {
          target: "worker_instruction",
          action: "add_constraint",
          description: "テスト失敗が頻発: Worker にテスト実行を必須化する指示を強化",
        },
      ]
    case "scope_creep":
      return [
        {
          target: "gate3",
          action: "adjust_threshold",
          description: "diff サイズ超過が頻発: Gate3 の MAX_DIFF_SIZE を見直し",
        },
      ]
    case "env_issue":
      return [
        {
          target: "worker_instruction",
          action: "add_check",
          description: "環境起因エラーが頻発: worktree セットアップ手順の確認を追加",
        },
      ]
    case "spec_ambiguity":
      return [
        {
          target: "pm_template",
          action: "add_field",
          description: "仕様曖昧さが頻発: PM タスク生成時の description 詳細化を促進",
        },
      ]
    case "timeout":
      return [
        {
          target: "spc_threshold",
          action: "adjust_threshold",
          description: "タイムアウト頻発: Worker タイムアウト値の調整を検討",
        },
      ]
    default:
      return [
        {
          target: "worker_instruction",
          action: "add_check",
          description: `${cause} が頻発: Worker プロンプトに対策チェックを追加`,
        },
      ]
  }
}
