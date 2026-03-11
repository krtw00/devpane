import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { config } from "./config.js"
import { getRecentDone, getFailedTasks, getTasksByStatus } from "./db.js"
import type { Task, ObservableFacts } from "@devpane/shared"

const CLAUDE_MD_PATH = () => join(config.PROJECT_ROOT, "CLAUDE.md")

const SECTION_DONE = "## 直近の完了タスク"
const SECTION_FAILED = "## 失敗タスク"
const SECTION_QUEUE = "## 現在のキュー"

const MANAGED_SECTIONS = [SECTION_DONE, SECTION_FAILED, SECTION_QUEUE]

function parseFacts(task: Task): ObservableFacts | null {
  if (!task.result) return null
  try {
    return JSON.parse(task.result) as ObservableFacts
  } catch {
    return null
  }
}

function formatFactsSummary(facts: ObservableFacts): string {
  const parts: string[] = []
  parts.push(`+${facts.diff_stats.additions}/-${facts.diff_stats.deletions}`)
  parts.push(`${facts.files_changed.length} files`)
  if (facts.test_result) {
    parts.push(`tests: ${facts.test_result.passed} passed`)
  }
  return parts.join(", ")
}

function renderDoneSection(tasks: Task[]): string {
  if (tasks.length === 0) return `${SECTION_DONE}\n\nなし\n`
  const lines = tasks.map((t) => {
    const facts = parseFacts(t)
    const summary = facts ? ` — ${formatFactsSummary(facts)}` : ""
    return `- **${t.title}** (${t.id})${summary}`
  })
  return `${SECTION_DONE}\n\n${lines.join("\n")}\n`
}

function renderFailedSection(tasks: Task[]): string {
  if (tasks.length === 0) return `${SECTION_FAILED}\n\nなし\n`
  const lines = tasks.map((t) => {
    const facts = parseFacts(t)
    let reason = ""
    if (facts) {
      const gate3 = (facts as Record<string, unknown>).gate3 as { reasons?: string[] } | undefined
      if (gate3?.reasons?.length) {
        reason = ` — ${gate3.reasons[0]}`
      }
    }
    return `- **${t.title}** (${t.id})${reason}`
  })
  return `${SECTION_FAILED}\n\n${lines.join("\n")}\n`
}

function renderQueueSection(tasks: Task[]): string {
  if (tasks.length === 0) return `${SECTION_QUEUE}\n\nなし\n`
  const lines = tasks.map((t) => `- **${t.title}** (${t.id}) [priority: ${t.priority}]`)
  return `${SECTION_QUEUE}\n\n${lines.join("\n")}\n`
}

/**
 * Remove managed sections from CLAUDE.md content, preserving everything else.
 */
function stripManagedSections(content: string): string {
  const lines = content.split("\n")
  const result: string[] = []
  let skipping = false

  for (const line of lines) {
    if (MANAGED_SECTIONS.some((s) => line.startsWith(s))) {
      skipping = true
      continue
    }
    if (skipping && line.startsWith("## ")) {
      skipping = false
    }
    if (!skipping) {
      result.push(line)
    }
  }

  // Trim trailing blank lines
  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop()
  }

  return result.join("\n")
}

export function updateClaudeMd(overridePath?: string): void {
  const filePath = overridePath ?? CLAUDE_MD_PATH()
  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch {
    return // CLAUDE.md doesn't exist, skip
  }

  const base = stripManagedSections(content)
  const doneTasks = getRecentDone(5)
  const failedTasks = getFailedTasks()
  const pendingTasks = getTasksByStatus("pending")

  const updated = [
    base,
    "",
    renderDoneSection(doneTasks),
    "",
    renderFailedSection(failedTasks),
    "",
    renderQueueSection(pendingTasks),
  ].join("\n")

  writeFileSync(filePath, updated, "utf-8")
}
