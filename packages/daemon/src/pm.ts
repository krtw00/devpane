import { spawn } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Task, PmOutput } from "@devpane/shared"
import { config } from "./config.js"
import { getRecentDone, getFailedTasks, getTasksByStatus, createTask } from "./db.js"

function spawnClaude(args: string[], cwd: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn("claude", args, { cwd, env })

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`claude killed by signal ${signal} (timeout?). stderr: ${stderr.slice(0, 500)}`))
      } else if (code !== 0) {
        const detail = stderr || stdout
        reject(new Error(`claude exited ${code}: ${detail.slice(0, 1000)}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on("error", reject)

    if (stdin) {
      proc.stdin.write(stdin)
    }
    proc.stdin.end()
  })
}

type PmContext = {
  claudeMd: string
  readme: string
  recentDone: Task[]
  failedTasks: Task[]
  pendingTasks: Task[]
}

function readFileOr(path: string, fallback: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf-8") : fallback
  } catch {
    return fallback
  }
}

function summarizeFacts(resultJson: string | null): string {
  if (!resultJson) return "no result"
  try {
    const f = JSON.parse(resultJson)
    const parts = [`exit:${f.exit_code}`, `files:${f.files_changed?.length ?? 0}`]
    if (f.diff_stats) parts.push(`+${f.diff_stats.additions}/-${f.diff_stats.deletions}`)
    if (f.test_result) parts.push(`tests:${f.test_result.passed}ok/${f.test_result.failed}fail`)
    return parts.join(", ")
  } catch {
    return "parse error"
  }
}

function buildPmPrompt(context: PmContext): string {
  return [
    "## プロジェクト定義",
    context.claudeMd,
    context.readme ? `\n## README\n${context.readme}` : "",
    "",
    "## 直近の完了タスク（最新5件）",
    context.recentDone.length > 0
      ? context.recentDone.map(t => `- [done] ${t.title}: ${summarizeFacts(t.result)}`).join("\n")
      : "（なし）",
    "",
    "## 失敗タスク（未解決）",
    context.failedTasks.length > 0
      ? context.failedTasks.map(t => `- [failed] ${t.title}: exit ${JSON.parse(t.result ?? "{}").exit_code ?? "?"}`).join("\n")
      : "（なし）",
    "",
    "## 現在のキュー",
    context.pendingTasks.length > 0
      ? context.pendingTasks.map(t => `- [pending] ${t.title}`).join("\n")
      : "（なし）",
    "",
    "上記を踏まえ、次に実装すべきタスクを優先度順に生成せよ。",
    "既にpendingのタスクと重複しないこと。",
    "各タスクのdescriptionは、Workerが単独で実装できる具体的な指示にすること。",
    "",
    "以下のJSON形式のみで回答せよ（説明文は不要）:",
    '{"tasks": [{"title": "...", "description": "...", "priority": 1}], "reasoning": "..."}',
  ].join("\n")
}

export function parsePmOutput(stdout: string): PmOutput {
  // claude -p --output-format json returns JSON with a result field
  let text: string
  try {
    const json = JSON.parse(stdout)
    text = json.result ?? stdout
  } catch {
    text = stdout
  }

  // Extract JSON object from text
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`PM output does not contain valid JSON: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(match[0])
  if (!Array.isArray(parsed.tasks)) throw new Error("PM output missing tasks array")

  return parsed as PmOutput
}

export async function runPm(): Promise<PmOutput> {
  const context: PmContext = {
    claudeMd: readFileOr(join(config.PROJECT_ROOT, "CLAUDE.md"), "（CLAUDE.mdなし）"),
    readme: readFileOr(join(config.PROJECT_ROOT, "README.md"), ""),
    recentDone: getRecentDone(5),
    failedTasks: getFailedTasks(),
    pendingTasks: getTasksByStatus("pending"),
  }

  const prompt = buildPmPrompt(context)

  const args = ["-p", prompt, "--allowedTools", "Read,Glob,Grep", "--output-format", "json"]
  console.log(`[pm] generating tasks... (prompt: ${prompt.length} chars, timeout: ${config.PM_TIMEOUT_MS}ms)`)
  console.log(`[pm] running: claude ${args.filter(a => a !== prompt).join(" ")} [prompt omitted]`)

  const stdout = await spawnClaude(args, config.PROJECT_ROOT, "")

  const output = parsePmOutput(stdout)
  console.log(`[pm] generated ${output.tasks.length} tasks: ${output.reasoning}`)

  return output
}

export function ingestPmTasks(output: PmOutput): Task[] {
  const created: Task[] = []
  for (const t of output.tasks) {
    const task = createTask(t.title, t.description, "pm", t.priority)
    created.push(task)
  }
  return created
}
