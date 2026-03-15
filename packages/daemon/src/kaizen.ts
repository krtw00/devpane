import type { WhyWhyAnalysis } from "@devpane/shared/schemas"
import { WhyWhyAnalysisSchema } from "@devpane/shared/schemas"
import { getFailedTasks, getRecentImprovements } from "./db.js"
import { recall } from "./memory.js"
import { spawnClaude } from "./claude.js"
import { config } from "./config.js"

const CLAUDE_TIMEOUT_MS = 120_000
const MAX_INPUT_TASKS = 20

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "")
}

function buildContextSection(): string {
  const parts: string[] = []

  // 過去のimprovement履歴（矛盾防止の核心）
  const improvements = getRecentImprovements(20)
  if (improvements.length > 0) {
    const lines = improvements.map(imp => {
      const analysis = (() => { try { return JSON.parse(imp.trigger_analysis) } catch { return null } })()
      const reason = analysis?.top_failure ?? "unknown"
      return `- [${imp.status}] ${imp.target}/${imp.action}: reason=${reason}, verdict=${imp.verdict ?? "pending"} (${imp.applied_at.slice(0, 10)})`
    })
    parts.push(`Past improvements (DO NOT propose contradicting these):\n${lines.join("\n")}`)
  }

  // decision + lessonメモリ
  const decisions = recall("decision").slice(0, 15)
  const lessons = recall("lesson").slice(0, 15)

  if (decisions.length > 0) {
    parts.push(`Architecture decisions (MUST respect):\n${decisions.map(d => `- ${d.content}`).join("\n")}`)
  }
  if (lessons.length > 0) {
    parts.push(`Lessons learned:\n${lessons.map(l => `- ${l.content}`).join("\n")}`)
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : ""
}

export async function analyze(): Promise<WhyWhyAnalysis | null> {
  const failures = getFailedTasks().slice(0, MAX_INPUT_TASKS)
  if (failures.length === 0) return null

  const taskSummaries = failures.map(t =>
    `- [${t.id}] ${t.title} (finished: ${t.finished_at ?? "unknown"}, result: ${t.result ?? "N/A"})`,
  ).join("\n")

  const context = buildContextSection()

  const prompt = `You are a root-cause analyst. Analyze the following failed tasks and produce a JSON object with this exact structure:
{
  "analysis": {
    "top_failure": "<one of: spec_ambiguity, test_gap, scope_creep, api_misuse, env_issue, regression, timeout, unknown>",
    "frequency": "<e.g. 3/10>",
    "why_chain": ["why1", "why2", ...] // 1-5 items
  },
  "improvements": [
    { "target": "<component>", "action": "<action>", "description": "<what to do>" }
  ] // 1-5 items
}

IMPORTANT RULES:
- Do NOT propose improvements that contradict or undo past improvements listed below (especially those with status=active or verdict=effective).
- Do NOT propose the same improvement that was already tried and found ineffective or harmful.
- Respect architecture decisions and lessons learned.
- Only propose improvements that address NEW root causes not already covered.

Failed tasks:
${taskSummaries}${context}

Respond with ONLY the JSON object, no markdown fences or explanation.`

  try {
    const output = await spawnClaude(["-p", prompt, "--output-format", "json"], config.PROJECT_ROOT, CLAUDE_TIMEOUT_MS)

    const cleaned = stripMarkdownFences(output)
    const parsed = JSON.parse(cleaned)
    const result = WhyWhyAnalysisSchema.safeParse(parsed)
    if (!result.success) {
      console.warn("[kaizen] analysis failed validation:", result.error.message)
      return null
    }
    return result.data
  } catch (err) {
    console.warn("[kaizen] analysis failed:", err instanceof Error ? err.message : err)
    return null
  }
}
