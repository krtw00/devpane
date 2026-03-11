import { execFileSync } from "node:child_process"
import { ulid } from "ulid"
import { WhyWhyAnalysisSchema } from "@devpane/shared/schemas"
import type { WhyWhyAnalysis, RootCauseType, ImprovementAction } from "@devpane/shared/schemas"
import type { Task, Improvement } from "@devpane/shared"
import { getRecentFailures, insertImprovement, getActiveImprovements, appendLog } from "./db.js"
import { queryEventsByType } from "./events.js"
import { emit } from "./events.js"
import { config } from "./config.js"

const VALID_TARGETS = new Set(["gate1", "gate3", "pm_template", "worker_prompt"])

export function aggregateRejections(): Map<string, number> {
  const events = queryEventsByType("gate.rejected", 100)
  const counts = new Map<string, string>()
  for (const e of events) {
    if (e.type === "gate.rejected") {
      const key = `${e.gate}:${e.verdict}`
      counts.set(key, (counts.get(key) ?? "") + "1")
    }
  }
  const result = new Map<string, number>()
  for (const [k, v] of counts) {
    result.set(k, v.length)
  }
  return result
}

export function aggregateRootCauses(failures: Task[]): Map<RootCauseType, number> {
  const counts = new Map<RootCauseType, number>()
  for (const task of failures) {
    if (!task.result) continue
    try {
      const result = JSON.parse(task.result)
      const failure = result.gate3?.failure ?? result.failure
      if (failure?.root_cause) {
        const rc = failure.root_cause as RootCauseType
        counts.set(rc, (counts.get(rc) ?? 0) + 1)
      }
    } catch {
      // skip unparseable results
    }
  }
  return counts
}

export function findTopRootCause(counts: Map<RootCauseType, number>): RootCauseType {
  let top: RootCauseType = "unknown"
  let max = 0
  for (const [cause, count] of counts) {
    if (count > max) {
      max = count
      top = cause
    }
  }
  return top
}

function buildAnalysisPrompt(
  failures: Task[],
  rejections: Map<string, number>,
  rootCauseCounts: Map<RootCauseType, number>,
  improvements: Improvement[],
): string {
  const failureSummary = failures.map(t => {
    const rc = extractRootCause(t)
    return `- task ${t.id.slice(0, 8)}: ${t.title} → root_cause=${rc}`
  }).join("\n")

  const rejectionSummary = Array.from(rejections.entries())
    .map(([k, v]) => `- ${k}: ${v}件`)
    .join("\n")

  const rootCauseSummary = Array.from(rootCauseCounts.entries())
    .map(([k, v]) => `- ${k}: ${v}件`)
    .join("\n")

  const improvementSummary = improvements.length > 0
    ? improvements.map(i => `- [${i.status}] target=${i.target} action=${i.action}`).join("\n")
    : "(なし)"

  return `あなたはソフトウェア開発プロセスの改善アナリストです。
以下のデータを分析し、最も頻出する失敗パターンとその根本原因を特定してください。

## 直近の失敗タスク
${failureSummary || "(なし)"}

## Gate拒否イベント集計
${rejectionSummary || "(なし)"}

## Root Cause頻度
${rootCauseSummary || "(なし)"}

## 現在の改善履歴
${improvementSummary}

## 改善提案の対象
target は以下のいずれかに限定: gate1, gate3, pm_template, worker_prompt
action は以下のいずれか: add_check, remove_check, adjust_threshold, add_field, add_constraint

## 出力形式
以下のJSON形式で出力してください（他のテキストは不要）:
{
  "analysis": {
    "top_failure": "<RootCause enum値>",
    "frequency": "<頻度の説明>",
    "why_chain": ["なぜ1", "なぜ2", ...]
  },
  "improvements": [
    {
      "target": "<対象>",
      "action": "<アクション>",
      "description": "<改善内容>"
    }
  ]
}`
}

function extractRootCause(task: Task): string {
  if (!task.result) return "unknown"
  try {
    const result = JSON.parse(task.result)
    return result.gate3?.failure?.root_cause ?? result.failure?.root_cause ?? "unknown"
  } catch {
    return "unknown"
  }
}

export function runAnalysisAgent(prompt: string): WhyWhyAnalysis {
  const result = execFileSync("claude", [
    "-p", prompt,
    "--output-format", "json",
    "--max-turns", "10",
    "--allowedTools", "Read,Glob,Grep",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
  ], {
    cwd: config.PROJECT_ROOT,
    timeout: 120_000,
    env: { ...process.env, CLAUDECODE: undefined },
  })

  const output = result.toString().trim()
  // claude --output-format json wraps in {"result": "..."} — extract inner JSON
  let parsed: unknown
  try {
    const wrapper = JSON.parse(output)
    if (typeof wrapper === "object" && wrapper !== null && "result" in wrapper) {
      parsed = JSON.parse((wrapper as { result: string }).result)
    } else {
      parsed = wrapper
    }
  } catch {
    // Try extracting JSON from text
    const match = output.match(/\{[\s\S]*\}/)
    if (!match) throw new Error(`Failed to parse analysis output: ${output.slice(0, 200)}`)
    parsed = JSON.parse(match[0])
  }

  const validated = WhyWhyAnalysisSchema.parse(parsed)
  return validated
}

function filterValidImprovements(improvements: ImprovementAction[]): ImprovementAction[] {
  return improvements.filter(i => VALID_TARGETS.has(i.target))
}

export async function runWhyWhyAnalysis(): Promise<WhyWhyAnalysis | null> {
  const failures = getRecentFailures(10)
  if (failures.length === 0) {
    console.log("[whywhy] no recent failures, skipping analysis")
    return null
  }

  const rejections = aggregateRejections()
  const rootCauseCounts = aggregateRootCauses(failures)

  if (rootCauseCounts.size === 0) {
    console.log("[whywhy] no structured failures found, skipping analysis")
    return null
  }

  const improvements = getActiveImprovements()
  const prompt = buildAnalysisPrompt(failures, rejections, rootCauseCounts, improvements)

  console.log("[whywhy] starting analysis agent...")
  const analysis = runAnalysisAgent(prompt)

  const validImprovements = filterValidImprovements(analysis.improvements)
  if (validImprovements.length === 0) {
    console.log("[whywhy] no valid improvements proposed")
    return analysis
  }

  for (const imp of validImprovements) {
    const id = ulid()
    insertImprovement(id, JSON.stringify(analysis.analysis), imp.target, JSON.stringify(imp))
    emit({ type: "improvement.applied", improvementId: id, target: imp.target })
    appendLog("whywhy", "system", `[improvement] ${imp.target}: ${imp.description}`)
    console.log(`[whywhy] improvement applied: ${imp.target} — ${imp.description}`)
  }

  return analysis
}
