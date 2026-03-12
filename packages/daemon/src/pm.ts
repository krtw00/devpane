import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Task, Memory, PmOutput } from "@devpane/shared"
import { PmOutputSchema } from "@devpane/shared/schemas"
import { config } from "./config.js"
import { getRecentDone, getAllDoneTitles, getFailedTasks, getTasksByStatus, createTask } from "./db.js"
import { recall } from "./memory.js"

const activeProcs = new Set<ChildProcess>()

export function killAllPm(): void {
  for (const proc of activeProcs) {
    proc.kill("SIGTERM")
  }
  activeProcs.clear()
}

function spawnClaude(args: string[], cwd: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CLAUDECODE

    const proc = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    activeProcs.add(proc)

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM")
    }, config.PM_TIMEOUT_MS)

    proc.on("close", (code, signal) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      if (signal) {
        reject(new Error(`claude killed by signal ${signal} (timeout?). stderr: ${stderr.slice(0, 500)}`))
      } else if (code !== 0) {
        const detail = stderr || stdout
        reject(new Error(`claude exited ${code}: ${detail.slice(0, 1000)}`))
      } else {
        resolve(stdout)
      }
    })
    proc.on("error", (err) => {
      activeProcs.delete(proc)
      clearTimeout(timeout)
      reject(err)
    })

    if (stdin) {
      proc.stdin.write(stdin)
    }
    proc.stdin.end()
  })
}

type PmContext = {
  claudeMd: string
  readme: string
  vision: string
  recentDone: Task[]
  allDoneTitles: string[]
  failedTasks: Task[]
  pendingTasks: Task[]
  memories: Memory[]
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

function formatMemories(memories: Memory[]): string[] {
  if (memories.length === 0) return ["（記憶なし — 初回起動）"]

  const grouped = new Map<string, Memory[]>()
  for (const m of memories) {
    const list = grouped.get(m.category) ?? []
    list.push(m)
    grouped.set(m.category, list)
  }

  const labels: Record<string, string> = {
    feature: "実装済み機能",
    decision: "アーキテクチャ判断",
    lesson: "学んだ教訓",
  }

  const lines: string[] = []
  for (const [cat, items] of grouped) {
    lines.push(`### ${labels[cat] ?? cat}`)
    for (const m of items) {
      lines.push(`- ${m.content}`)
    }
  }
  return lines
}

function buildPmPrompt(context: PmContext): string {
  return [
    "## プロジェクト定義",
    context.claudeMd,
    context.readme ? `\n## README\n${context.readme}` : "",
    context.vision ? `\n## 設計方針（docs/vision.md）\n${context.vision}` : "",
    "",
    "## 直近の完了タスク（最新5件）",
    context.recentDone.length > 0
      ? context.recentDone.map(t => `- [done] ${t.title}: ${summarizeFacts(t.result)}`).join("\n")
      : "（なし）",
    "",
    "## 全完了タスク一覧（重複生成禁止）",
    context.allDoneTitles.length > 0
      ? context.allDoneTitles.map(t => `- ${t}`).join("\n")
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
    "## プロジェクト記憶",
    ...formatMemories(context.memories),
    "",
    "上記を踏まえ、次に実装すべきタスクを優先度順に生成せよ。",
    "",
    "【重複禁止ルール（厳守）】",
    "- 「全完了タスク一覧」「現在のキュー」「プロジェクト記憶の実装済み機能」に含まれる機能と同一・類似のタスクは絶対に生成しないこと。",
    "- タイトルが異なっても機能的に同じものは重複とみなす。",
    "- 違反した場合、タスクは自動却下される。",
    "",
    "既に実装済みの機能を壊したり削除するタスクは生成しないこと。",
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

  // Contract: Zodスキーマでバリデーション（原理3）
  const result = PmOutputSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`PM output validation failed: ${issues}`)
  }

  return result.data as PmOutput
}

export async function runPm(): Promise<PmOutput> {
  const context: PmContext = {
    claudeMd: readFileOr(join(config.PROJECT_ROOT, "CLAUDE.md"), "（CLAUDE.mdなし）"),
    readme: readFileOr(join(config.PROJECT_ROOT, "README.md"), ""),
    vision: readFileOr(join(config.PROJECT_ROOT, "docs", "vision.md"), ""),
    recentDone: getRecentDone(5),
    allDoneTitles: getAllDoneTitles(),
    failedTasks: getFailedTasks(),
    pendingTasks: getTasksByStatus("pending"),
    memories: recall(),
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

export function isDuplicate(newTitle: string, existingTitles: string[]): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_（）()「」:：・]/g, "")
  const norm = normalize(newTitle)
  return existingTitles.some(t => {
    const nt = normalize(t)
    // 完全一致 or 一方が他方を含む
    return norm === nt || norm.includes(nt) || nt.includes(norm)
  })
}

export function ingestPmTasks(output: PmOutput): Task[] {
  const doneTitles = getAllDoneTitles()
  const pendingTitles = getTasksByStatus("pending").map(t => t.title)
  const existingTitles = [...doneTitles, ...pendingTitles]

  const created: Task[] = []
  for (const t of output.tasks) {
    if (isDuplicate(t.title, existingTitles)) {
      console.log(`[pm] skipped duplicate task: ${t.title}`)
      continue
    }
    const task = createTask(t.title, t.description, "pm", t.priority, null, t.constraints ?? null)
    created.push(task)
    existingTitles.push(t.title)
  }
  return created
}
