import { spawn, type ChildProcess } from "node:child_process"
import { ulid } from "ulid"
import type { Task } from "@devpane/shared"
import type { RootCauseType, KaizenResult, WhyWhyAnalysis } from "@devpane/shared/schemas"
import { WhyWhyAnalysisSchema } from "@devpane/shared/schemas"
import { getDb } from "./db.js"
import { config } from "./config.js"
import { emit } from "./events.js"

type Gate3Result = {
  verdict: string
  reasons: string[]
  failure?: {
    root_cause: RootCauseType
    why_chain: string[]
  }
}

type FailureSummary = {
  task_id: string
  title: string
  root_cause: RootCauseType
}

function extractFailures(tasks: Task[]): FailureSummary[] {
  const failures: FailureSummary[] = []
  for (const t of tasks) {
    if (!t.result) continue
    try {
      const parsed = JSON.parse(t.result)
      const gate3 = parsed.gate3 as Gate3Result | undefined
      if (gate3?.failure?.root_cause) {
        failures.push({
          task_id: t.id,
          title: t.title,
          root_cause: gate3.failure.root_cause,
        })
      }
    } catch {
      // skip unparseable results
    }
  }
  return failures
}

function findTopCause(failures: FailureSummary[]): { cause: RootCauseType; count: number } | null {
  if (failures.length === 0) return null
  const counts = new Map<RootCauseType, number>()
  for (const f of failures) {
    counts.set(f.root_cause, (counts.get(f.root_cause) ?? 0) + 1)
  }
  let topCause: RootCauseType = failures[0].root_cause
  let topCount = 0
  for (const [cause, count] of counts) {
    if (count > topCount) {
      topCause = cause
      topCount = count
    }
  }
  return { cause: topCause, count: topCount }
}

function buildAnalysisPrompt(topCause: RootCauseType, count: number, total: number, examples: FailureSummary[]): string {
  const exampleLines = examples.slice(0, 5).map(e => `- ${e.title} (task: ${e.task_id})`).join("\n")
  return [
    `## 5 Whys 分析`,
    ``,
    `直近${total}件の失敗タスクのうち、最頻の root_cause は "${topCause}" で ${count}件発生。`,
    ``,
    `### 該当タスク例:`,
    exampleLines,
    ``,
    `プロジェクトのコードを調査し、この root_cause が繰り返し発生する構造的原因を 5 Whys で分析せよ。`,
    `そして、再発防止のための改善提案を1〜5件生成せよ。`,
    ``,
    `以下のJSON形式のみで回答せよ（説明文は不要）:`,
    `{`,
    `  "analysis": {`,
    `    "top_failure": "${topCause}",`,
    `    "frequency": "${count}/${total}",`,
    `    "why_chain": ["Why1", "Why2", "Why3", "Why4", "Why5"]`,
    `  },`,
    `  "improvements": [`,
    `    {`,
    `      "target": "gate1|gate2|gate3|pm_template|worker_instruction|spc_threshold",`,
    `      "action": "add_check|remove_check|adjust_threshold|add_field|add_constraint",`,
    `      "description": "改善内容",`,
    `      "detail": "具体的な変更内容（任意）"`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n")
}

function runClaudeAnalysis(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc: ChildProcess = spawn("claude", [
      "-p", prompt,
      "--allowedTools", "Read,Glob,Grep",
      "--output-format", "json",
    ], {
      cwd: config.PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    proc.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM")
    }, config.PM_TIMEOUT_MS)

    proc.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timeout)
      if (signal) {
        reject(new Error(`kaizen claude killed by signal ${signal}`))
      } else if (code !== 0) {
        reject(new Error(`kaizen claude exited ${code}: ${(stderr || stdout).slice(0, 1000)}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on("error", (err: Error) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function parseAnalysisOutput(stdout: string): WhyWhyAnalysis {
  let text: string
  try {
    const json = JSON.parse(stdout)
    text = json.result ?? stdout
  } catch {
    text = stdout
  }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Kaizen output does not contain valid JSON: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(match[0])
  const result = WhyWhyAnalysisSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Kaizen output validation failed: ${issues}`)
  }
  return result.data
}

function recordImprovement(analysis: WhyWhyAnalysis): string[] {
  const db = getDb()
  const insertStmt = db.prepare(`
    INSERT INTO improvements (id, trigger_analysis, target, action, applied_at, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `)

  const ids: string[] = []
  const now = new Date().toISOString()
  const triggerJson = JSON.stringify(analysis.analysis)

  for (const imp of analysis.improvements) {
    const id = ulid()
    insertStmt.run(id, triggerJson, imp.target, `${imp.action}: ${imp.description}`, now)
    ids.push(id)
    emit({ type: "improvement.applied", improvementId: id, target: imp.target })
  }
  return ids
}

export async function analyzeFailures(limit = 10): Promise<KaizenResult> {
  const db = getDb()
  const failedTasks = db.prepare(
    `SELECT * FROM tasks WHERE status = 'failed' ORDER BY finished_at DESC LIMIT ?`,
  ).all(limit) as Task[]

  const failures = extractFailures(failedTasks)

  if (failures.length === 0) {
    return {
      analyzed_count: failedTasks.length,
      top_root_cause: null,
      frequency: 0,
      analysis: null,
      improvements_applied: 0,
    }
  }

  const top = findTopCause(failures)!
  const examples = failures.filter(f => f.root_cause === top.cause)
  const prompt = buildAnalysisPrompt(top.cause, top.count, failures.length, examples)

  console.log(`[kaizen] analyzing ${failures.length} failures, top cause: ${top.cause} (${top.count}x)`)

  const stdout = await runClaudeAnalysis(prompt)
  const analysis = parseAnalysisOutput(stdout)
  const ids = recordImprovement(analysis)

  console.log(`[kaizen] recorded ${ids.length} improvements for root_cause="${top.cause}"`)

  return {
    analyzed_count: failures.length,
    top_root_cause: top.cause,
    frequency: top.count,
    analysis,
    improvements_applied: ids.length,
  }
}
