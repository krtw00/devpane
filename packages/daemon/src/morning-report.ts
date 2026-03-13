import { getTasksSince } from "./db.js"
import { getPipelineStats } from "./db/stats.js"
import { fetchOpenPrs, assessRisk, type PrReport } from "./pr-agent.js"
import { getNotifier } from "./notifier-factory.js"
import { traceTask, formatPipelineTable, type PipelineTrace } from "./pipeline-trace.js"
import type { Task } from "@devpane/shared"

type ShiftSummary = {
  period: string
  completed: Task[]
  failed: Task[]
  totalCost: number
  prReports: PrReport[]
  pipelineStats: ReturnType<typeof getPipelineStats>
  traces: PipelineTrace[]
}

function collectShiftData(since: string): ShiftSummary {
  const tasks = getTasksSince(since)
  const completed = tasks.filter(t => t.status === "done")
  const failed = tasks.filter(t => t.status === "failed")

  const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0)

  const prs = fetchOpenPrs()
  const prReports = prs.map(assessRisk)

  const pipelineStats = getPipelineStats()
  const traces = tasks.map(traceTask)

  const now = new Date()
  const sinceDate = new Date(since)
  const hours = Math.round((now.getTime() - sinceDate.getTime()) / 3600000 * 10) / 10
  const period = `${hours}h`

  return { period, completed, failed, totalCost, prReports, pipelineStats, traces }
}


export function formatReport(summary: ShiftSummary): string {
  const { period, completed, failed, totalCost, prReports, pipelineStats, traces } = summary

  const lines: string[] = []

  // Header + overview
  const total = completed.length + failed.length
  const successRate = total > 0 ? Math.round(completed.length / total * 100) : 0
  lines.push(`[DevPane 朝レポート] (稼働 ${period})`)
  lines.push(`${completed.length} 完了 / ${failed.length} 失敗 (成功率 ${successRate}%) | コスト $${totalCost.toFixed(2)}`)
  lines.push("")

  // Pipeline table — main content
  if (traces.length > 0) {
    lines.push(formatPipelineTable(traces))
    lines.push("")
  }

  // Open PRs
  if (prReports.length > 0) {
    lines.push("未マージPR:")
    for (const r of prReports) {
      const icon = { recommended: "+", needs_review: "?", not_recommended: "x" }[r.risk]
      lines.push(`  ${icon} #${r.pr.number} ${r.pr.title} (+${r.pr.additions}/-${r.pr.deletions}) ${r.reason}`)
    }
    lines.push("")
  }

  // Pipeline health
  lines.push(`パイプライン: Gate通過率 ${Math.round(pipelineStats.gate3_pass_rate * 100)}% | 連続失敗 ${pipelineStats.consecutive_failures}`)

  // No activity
  if (total === 0) {
    lines.push("")
    lines.push("夜間の稼働タスクはありませんでした")
  }

  return lines.join("\n")
}

export async function sendMorningReport(shiftStartIso: string): Promise<void> {
  const summary = collectShiftData(shiftStartIso)
  const report = formatReport(summary)

  console.log(`[morning-report] sending: ${summary.completed.length} done, ${summary.failed.length} failed, $${summary.totalCost.toFixed(2)}`)
  await getNotifier().sendMessage(report)
}
