import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Task, Memory, PmOutput } from "@devpane/shared"
import { PmOutputSchema } from "@devpane/shared/schemas"
import { config } from "./config.js"
import { getRecentDone, getAllDoneTitles, getFailedTasks, getTasksByStatus, createTask, appendLog } from "./db.js"
import { broadcast } from "./ws.js"
import { recall } from "./memory.js"
import { killAllClaude } from "./claude.js"
import { callLlm } from "./llm-bridge.js"

export const killAllPm = killAllClaude

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
  if (memories.length === 0) return ["(no memories — first run)"]

  const grouped = new Map<string, Memory[]>()
  for (const m of memories) {
    const list = grouped.get(m.category) ?? []
    list.push(m)
    grouped.set(m.category, list)
  }

  const labels: Record<string, string> = {
    feature: "Implemented Features",
    decision: "Architecture Decisions",
    lesson: "Lessons Learned",
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
    "## Project Definition",
    context.claudeMd,
    context.readme ? `\n## README\n${context.readme}` : "",
    context.vision ? `\n## Design Vision (reference only — do not implement everything, focus on what is relevant to current issues)\n${context.vision}` : "",
    "",
    "## Recent Completed Tasks (latest 5)",
    context.recentDone.length > 0
      ? context.recentDone.map(t => `- [done] ${t.title}: ${summarizeFacts(t.result)}`).join("\n")
      : "(none)",
    "",
    "## All Completed Tasks (DO NOT generate duplicates)",
    context.allDoneTitles.length > 0
      ? context.allDoneTitles.map(t => `- ${t}`).join("\n")
      : "(none)",
    "",
    "## Failed Tasks (unresolved)",
    context.failedTasks.length > 0
      ? context.failedTasks.map(t => `- [failed] ${t.title}: ${summarizeFacts(t.result)}`).join("\n")
      : "(none)",
    "",
    "## Current Queue",
    context.pendingTasks.length > 0
      ? context.pendingTasks.map(t => `- [pending] ${t.title}`).join("\n")
      : "(none)",
    "",
    "## Project Memory",
    ...formatMemories(context.memories),
    "",
    "Based on the above, generate the next tasks to implement in priority order.",
    "",
    "【Task Generation Rules (STRICT)】",
    "1. No duplicates: Do NOT generate tasks identical or similar to those in 'All Completed Tasks', 'Current Queue', or 'Implemented Features' in memory. Different title but same functionality = duplicate. Violations are auto-rejected.",
    "2. Scope: Prioritize improvements, bug fixes, test coverage, and stability over adding new features. Do NOT try to implement all unfinished features from vision.md.",
    `3. Implementability: Each task description must be specific enough for a Worker to implement independently. Include target files, expected behavior, and test plan. Max diff size: ${config.MAX_DIFF_SIZE} lines.`,
    "4. Granularity: 1 task = 1 PR. Split large tasks.",
    "5. Generate at most 3 tasks.",
    "",
    "Do NOT generate tasks that would break or remove already implemented features.",
    "",
    "Respond with ONLY the following JSON format (no explanation):",
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

  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    throw new Error(`PM output contains invalid JSON: ${match[0].slice(0, 200)}`)
  }

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
    claudeMd: readFileOr(join(config.PROJECT_ROOT, "CLAUDE.md"), "(no CLAUDE.md)"),
    readme: readFileOr(join(config.PROJECT_ROOT, "README.md"), ""),
    vision: readFileOr(join(config.PROJECT_ROOT, "docs", "vision.md"), ""),
    recentDone: getRecentDone(5),
    allDoneTitles: getAllDoneTitles(),
    failedTasks: getFailedTasks(),
    pendingTasks: getTasksByStatus("pending"),
    memories: recall(),
  }

  const prompt = buildPmPrompt(context)

  console.log(`[pm] generating tasks... (prompt: ${prompt.length} chars, timeout: ${config.PM_TIMEOUT_MS}ms, backend: ${config.LLM_BACKEND})`)

  const bridgeResult = await callLlm(prompt, config.PROJECT_ROOT, config.PM_TIMEOUT_MS)

  const output = parsePmOutput(bridgeResult.text)
  console.log(`[pm] generated ${output.tasks.length} tasks: ${output.reasoning}`)

  // PM reasoning をログに保存 + WebSocket配信（Shogun UI用）
  appendLog("scheduler", "pm", `[reasoning] ${output.reasoning}`)
  broadcast("pm:reasoning", { reasoning: output.reasoning })
  for (const t of output.tasks) {
    appendLog("scheduler", "pm", `[task] ${t.title} (priority=${t.priority})`)
    broadcast("pm:task_generated", { title: t.title, priority: t.priority })
  }

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
  const failedTitles = getTasksByStatus("failed").map(t => t.title)
  const existingTitles = [...doneTitles, ...pendingTitles, ...failedTitles]

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
