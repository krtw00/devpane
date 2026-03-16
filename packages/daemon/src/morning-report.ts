import { getTasksSince } from "./db.js"
import { getDb } from "./db/core.js"
import { getPipelineStats } from "./db/stats.js"
import { fetchOpenPrs, assessRisk, type PrReport } from "./pr-agent.js"
import { getNotifier } from "./notifier-factory.js"
import { traceTask, type PipelineTrace } from "./pipeline-trace.js"
import { emit } from "./events.js"
import type { ReportPayload, ReportSection } from "./notifier.js"
import type { Task } from "@devpane/shared"

type Gate1Stats = { go: number; kill: number; recycle: number }

type ShiftSummary = {
  period: string
  completed: Task[]
  failed: Task[]
  totalCost: number
  prReports: PrReport[]
  pipelineStats: ReturnType<typeof getPipelineStats>
  traces: PipelineTrace[]
  gate1Stats?: Gate1Stats
}

function collectShiftData(since: string): ShiftSummary {
  const tasks = getTasksSince(since)
  const completed = tasks.filter(t => t.status === "done")
  const failed = tasks.filter(t => t.status === "failed")

  const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0)

  let prReports: PrReport[] = []
  try {
    const prs = fetchOpenPrs()
    prReports = prs.map(assessRisk)
  } catch (err) {
    console.warn("[morning-report] fetchOpenPrs failed, using empty fallback:", err)
  }

  let pipelineStats: ReturnType<typeof getPipelineStats> = {
    gate3_pass_rate: 0,
    avg_execution_time: 0,
    consecutive_failures: 0,
    tasks_today: 0,
    tasks_today_done: 0,
    tasks_today_failed: 0,
    active_improvements: 0,
  }
  try {
    pipelineStats = getPipelineStats()
  } catch (err) {
    console.warn("[morning-report] getPipelineStats failed, using defaults:", err)
  }
  const traces = tasks.map(traceTask)

  let gate1Stats: Gate1Stats = { go: 0, kill: 0, recycle: 0 }
  try {
    const d = getDb()
    const goCount = d.prepare(`
      SELECT COUNT(*) AS cnt FROM agent_events
      WHERE type = 'gate.passed' AND json_extract(payload, '$.gate') = 'gate1'
    `).get() as { cnt: number }
    const killCount = d.prepare(`
      SELECT COUNT(*) AS cnt FROM agent_events
      WHERE type = 'gate.rejected' AND json_extract(payload, '$.gate') = 'gate1'
        AND json_extract(payload, '$.verdict') = 'kill'
    `).get() as { cnt: number }
    const recycleCount = d.prepare(`
      SELECT COUNT(*) AS cnt FROM agent_events
      WHERE type = 'gate.rejected' AND json_extract(payload, '$.gate') = 'gate1'
        AND json_extract(payload, '$.verdict') = 'recycle'
    `).get() as { cnt: number }
    gate1Stats = { go: goCount.cnt, kill: killCount.cnt, recycle: recycleCount.cnt }
  } catch (err) {
    console.warn("[morning-report] gate1Stats query failed, using defaults:", err)
  }

  const now = new Date()
  const sinceDate = new Date(since)
  const hours = Math.round((now.getTime() - sinceDate.getTime()) / 3600000 * 10) / 10
  const period = `${hours}h`

  return { period, completed, failed, totalCost, prReports, pipelineStats, traces, gate1Stats }
}


const STAGE_ICONS: Record<string, string> = {
  pass: "✅", kill: "❌", recycle: "🔄", skip: "➖", pending: "⏳",
}

function formatTracesSection(traces: PipelineTrace[]): string {
  if (traces.length === 0) return "タスクなし"

  return traces.map(t => {
    const title = t.title.length > 40 ? t.title.slice(0, 38) + ".." : t.title
    const stages = [
      `G1${STAGE_ICONS[t.gate1]}`,
      `T${STAGE_ICONS[t.tester]}`,
      `G2${STAGE_ICONS[t.gate2]}`,
      `W${STAGE_ICONS[t.worker]}`,
      `G3${STAGE_ICONS[t.gate3]}`,
    ].join(" ")
    const cost = t.costUsd > 0 ? `$${t.costUsd.toFixed(2)}` : ""
    return `${title}\n  ${stages}  → ${t.outcome} ${cost}`
  }).join("\n\n")
}

export function formatReport(summary: ShiftSummary): ReportPayload {
  const { period, completed, failed, totalCost, prReports, pipelineStats, traces, gate1Stats } = summary

  const total = completed.length + failed.length
  const successRate = total > 0 ? Math.round(completed.length / total * 100) : 0

  const title = `DevPane 朝レポート (${period})`
  const summaryText = `${completed.length} 完了 / ${failed.length} 失敗 (${successRate}%) | $${totalCost.toFixed(2)}`

  const sections: ReportSection[] = []

  if (traces.length > 0) {
    sections.push({
      heading: "パイプライン",
      body: formatTracesSection(traces),
    })
  }

  if (prReports.length > 0) {
    const prLines = prReports.map(r => {
      const icon = { recommended: "✅", needs_review: "⚠️", not_recommended: "❌" }[r.risk] ?? "?"
      return `${icon} #${r.pr.number} ${r.pr.title} (+${r.pr.additions}/-${r.pr.deletions})`
    })
    sections.push({ heading: "未マージPR", body: prLines.join("\n") })
  }

  const g1 = gate1Stats ?? { go: 0, kill: 0, recycle: 0 }
  const gate1Total = g1.go + g1.kill + g1.recycle
  if (gate1Total > 0) {
    sections.push({
      heading: "Gate1",
      body: `go ${g1.go} / kill ${g1.kill} / recycle ${g1.recycle}`,
    })
  }

  sections.push({
    heading: "パイプライン健全性",
    body: `Gate通過率 ${Math.round(pipelineStats.gate3_pass_rate * 100)}% | 連続失敗 ${pipelineStats.consecutive_failures}`,
  })

  if (total === 0) {
    sections.push({ heading: "備考", body: "夜間の稼働タスクはありませんでした" })
  }

  return { title, summary: summaryText, sections }
}

export async function sendMorningReport(shiftStartIso: string): Promise<void> {
  const summary = collectShiftData(shiftStartIso)
  const report = formatReport(summary)

  console.log(`[morning-report] sending: ${summary.completed.length} done, ${summary.failed.length} failed, $${summary.totalCost.toFixed(2)}`)
  try {
    await getNotifier().sendReport(report)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit({ type: "morning_report.failed", error: msg })
    throw err
  }
}
