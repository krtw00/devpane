import { spawn } from "node:child_process"
import type { Task } from "@devpane/shared"
import type { RootCauseType, WhyWhyAnalysis } from "@devpane/shared/schemas"
import { RootCause, WhyWhyAnalysisSchema } from "@devpane/shared/schemas"
import { config } from "./config.js"
import { getRecentFailed, insertImprovement, appendLog } from "./db.js"
import { emit } from "./events.js"

function spawnClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn("claude", ["-p", prompt, "--output-format", "json"], {
      cwd: config.PROJECT_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM")
    }, config.PM_TIMEOUT_MS)

    proc.on("close", (code, signal) => {
      clearTimeout(timeout)
      if (signal) {
        reject(new Error(`claude killed by signal ${signal}. stderr: ${stderr.slice(0, 500)}`))
      } else if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 1000)}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    proc.stdin.end()
  })
}

type RootCauseCount = { cause: RootCauseType; count: number }

export function collectRootCauses(tasks: Task[]): RootCauseCount[] {
  const counts = new Map<RootCauseType, number>()

  for (const task of tasks) {
    if (!task.result) continue
    try {
      const parsed = JSON.parse(task.result)
      const cause = parsed.gate3?.failure?.root_cause
      if (cause && RootCause.safeParse(cause).success) {
        counts.set(cause, (counts.get(cause) ?? 0) + 1)
      }
    } catch {
      // skip unparseable results
    }
  }

  return Array.from(counts.entries())
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count)
}

function buildWhyWhyPrompt(topCause: RootCauseType, frequency: string, examples: string[]): string {
  return [
    "あなたはソフトウェア開発チームの品質改善アナリストです。",
    "以下の失敗パターンに対して「なぜなぜ5回」分析を実施し、改善アクションを提案してください。",
    "",
    `## 最頻失敗パターン: ${topCause}`,
    `## 出現頻度: ${frequency}`,
    "",
    "## 失敗事例:",
    ...examples.map((e, i) => `${i + 1}. ${e}`),
    "",
    "以下のJSON形式のみで回答せよ（説明文は不要）:",
    JSON.stringify({
      analysis: {
        top_failure: topCause,
        frequency,
        why_chain: ["なぜ1: ...", "なぜ2: ...", "なぜ3: ...", "なぜ4: ...", "なぜ5: ..."],
      },
      improvements: [
        { target: "gate3|pm_template|worker_instruction|...", action: "add_check|remove_check|adjust_threshold|add_field|add_constraint", description: "..." },
      ],
    }),
  ].join("\n")
}

function parseWhyWhyOutput(stdout: string): WhyWhyAnalysis {
  let text: string
  try {
    const json = JSON.parse(stdout)
    text = json.result ?? stdout
  } catch {
    text = stdout
  }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`WhyWhy output does not contain valid JSON: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(match[0])
  const result = WhyWhyAnalysisSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`WhyWhy output validation failed: ${issues}`)
  }

  return result.data
}

export async function runWhyWhyAnalysis(n = 10): Promise<WhyWhyAnalysis> {
  const failedTasks = getRecentFailed(n)
  if (failedTasks.length === 0) {
    throw new Error("No failed tasks to analyze")
  }

  const rootCauses = collectRootCauses(failedTasks)
  if (rootCauses.length === 0) {
    throw new Error("No root causes found in failed tasks")
  }

  const topCause = rootCauses[0]
  const total = failedTasks.length
  const frequency = `${topCause.count}/${total} (${Math.round((topCause.count / total) * 100)}%)`

  const examples = failedTasks
    .filter((t) => {
      try {
        const parsed = JSON.parse(t.result ?? "{}")
        return parsed.gate3?.failure?.root_cause === topCause.cause
      } catch {
        return false
      }
    })
    .slice(0, 5)
    .map((t) => `${t.title}: ${t.result?.slice(0, 200) ?? "no result"}`)

  const prompt = buildWhyWhyPrompt(topCause.cause, frequency, examples)
  console.log(`[whywhy] analyzing top failure: ${topCause.cause} (${frequency})`)

  const stdout = await spawnClaude(prompt)
  const analysis = parseWhyWhyOutput(stdout)

  // Record improvements
  for (const improvement of analysis.improvements) {
    const record = insertImprovement(
      JSON.stringify(analysis.analysis),
      improvement.target,
      improvement.action,
    )
    emit({ type: "improvement.applied", improvementId: record.id, target: improvement.target })
    appendLog("whywhy", "system", `[improvement] ${improvement.target}: ${improvement.description}`)
  }

  console.log(`[whywhy] analysis complete: ${analysis.improvements.length} improvements proposed`)
  return analysis
}
