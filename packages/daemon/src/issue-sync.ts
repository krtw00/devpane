import { execFileSync } from "node:child_process"
import { config } from "./config.js"
import { createTask, getAllTasks } from "./db.js"

export type GhIssue = {
  number: number
  title: string
  body: string
  labels: { name: string }[]
  state: string
}

export function fetchGhIssues(): GhIssue[] {
  try {
    const result = execFileSync("gh", [
      "issue", "list",
      "--json", "number,title,body,labels,state",
      "--state", "open",
      "--limit", "20"
    ], { cwd: config.PROJECT_ROOT, encoding: "utf-8" }).trim()
    return JSON.parse(result)
  } catch (err) {
    console.error(`[issue-sync] Failed to fetch issues:`, err)
    return []
  }
}

export function syncIssues(): void {
  console.log("[issue-sync] starting sync...")
  const issues = fetchGhIssues()
  const allTasks = getAllTasks()

  const syncLabels = config.ISSUE_SYNC_LABELS?.split(",").map(l => l.trim()).filter(Boolean) ?? null
  const excludeLabels = ["good first issue", "wontfix", "duplicate"]

  for (const issue of issues) {
    // Label filtering
    const issueLabels = issue.labels.map(l => l.name)
    
    // If syncLabels is set, issue MUST have at least one of them
    if (syncLabels && syncLabels.length > 0) {
      if (!issueLabels.some(l => syncLabels.includes(l))) {
        continue
      }
    }

    // If issue has any of excludeLabels, skip it
    if (issueLabels.some(l => excludeLabels.includes(l))) {
      continue
    }

    // Duplicate check
    const issueMark = `[#${issue.number}]`
    const alreadyTasked = allTasks.some(t => 
      t.title.includes(issueMark) || 
      t.description.includes(issueMark) || 
      t.description.includes(`Closes #${issue.number}`) ||
      t.description.includes(`Fixes #${issue.number}`) ||
      t.description.includes(`Resolves #${issue.number}`)
    )
    
    if (alreadyTasked) {
      continue
    }

    // Create task
    createTask(
      `[#${issue.number}] ${issue.title}`,
      issue.body + `\n\nCloses #${issue.number}`,
      "human",
      60
    )
    console.log(`[issue-sync] Created task for Issue #${issue.number}: ${issue.title}`)
  }
}

export function closeIssue(issueNumber: number): void {
  try {
    execFileSync("gh", ["issue", "close", String(issueNumber)], {
      cwd: config.PROJECT_ROOT,
      encoding: "utf-8"
    })
    console.log(`[issue-sync] Closed Issue #${issueNumber}`)
  } catch (err) {
    console.error(`[issue-sync] Failed to close Issue #${issueNumber}:`, err)
  }
}
