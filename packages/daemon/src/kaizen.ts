import { execFileSync } from "node:child_process"
import type { WhyWhyAnalysis } from "@devpane/shared/schemas"
import { WhyWhyAnalysisSchema } from "@devpane/shared/schemas"
import { getFailedTasks } from "./db.js"

const CLAUDE_TIMEOUT_MS = 120_000

export function analyze(): WhyWhyAnalysis | null {
  const failures = getFailedTasks()
  if (failures.length === 0) return null

  const taskSummaries = failures.map(t =>
    `- [${t.id}] ${t.title} (finished: ${t.finished_at ?? "unknown"}, result: ${t.result ?? "N/A"})`,
  ).join("\n")

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

Failed tasks:
${taskSummaries}

Respond with ONLY the JSON object, no markdown fences or explanation.`

  try {
    const output = execFileSync("claude", ["-p", prompt, "--output-format", "json"], {
      encoding: "utf-8",
      timeout: CLAUDE_TIMEOUT_MS,
    })

    const parsed = JSON.parse(output)
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
