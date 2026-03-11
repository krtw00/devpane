import type { PmTask } from "@devpane/shared/schemas"
import type { Memory } from "@devpane/shared"
import { emit } from "./events.js"
import { getTasksByStatus, appendLog } from "./db.js"

// Gate 1: PM生成タスクの方針チェック
// 原理1: 判定はコード（ルールベース）。LLMには委託しない。

export type Gate1Verdict = "go" | "kill" | "recycle"

export type Gate1Result = {
  task: PmTask
  verdict: Gate1Verdict
  reasons: string[]
}

const MIN_DESCRIPTION_LENGTH = 50

export function runGate1(
  tasks: PmTask[],
  memories: Memory[],
  _claudeMd: string,
): Gate1Result[] {
  const existingTitles = new Set(
    [...getTasksByStatus("pending"), ...getTasksByStatus("running")]
      .map(t => t.title.toLowerCase()),
  )

  const blockedLessons = memories
    .filter(m => m.category === "lesson" && /不要|禁止/.test(m.content))
    .map(m => m.content)

  return tasks.map(task => checkTask(task, existingTitles, blockedLessons))
}

function checkTask(
  task: PmTask,
  existingTitles: Set<string>,
  blockedLessons: string[],
): Gate1Result {
  const reasons: string[] = []
  let verdict: Gate1Verdict = "go"

  // Rule 1: タイトル重複（pending/running）→ Kill
  if (existingTitles.has(task.title.toLowerCase())) {
    verdict = "kill"
    reasons.push(`duplicate title: "${task.title}"`)
  }

  // Rule 2: memoriesのlessonで「不要」「禁止」の機能に合致 → Kill
  const titleLower = task.title.toLowerCase()
  for (const lesson of blockedLessons) {
    const lessonLower = lesson.toLowerCase()
    if (lessonLower.includes(titleLower) || titleLower.includes(lessonLower)) {
      verdict = "kill"
      reasons.push(`policy violation: matches lesson "${lesson}"`)
      break
    }
  }

  // Rule 3: description空 or 50文字未満 → Recycle
  if (!task.description || task.description.length < MIN_DESCRIPTION_LENGTH) {
    if (verdict !== "kill") verdict = "recycle"
    reasons.push(`description too short: ${task.description?.length ?? 0} chars (min ${MIN_DESCRIPTION_LENGTH})`)
  }

  // Rule 4: priority範囲外(1-100) → Recycle
  if (task.priority < 1 || task.priority > 100) {
    if (verdict !== "kill") verdict = "recycle"
    reasons.push(`priority out of range: ${task.priority} (must be 1-100)`)
  }

  return { task, verdict, reasons }
}

export function emitGate1Events(results: Gate1Result[]): void {
  for (const r of results) {
    const taskId = `gate1:${r.task.title}`
    if (r.verdict === "go") {
      emit({ type: "gate.passed", taskId, gate: "gate1" })
      appendLog(taskId, "gate1", `[pass] ${r.task.title}`)
    } else {
      emit({ type: "gate.rejected", taskId, gate: "gate1", verdict: r.verdict, reason: r.reasons.join("; ") })
      appendLog(taskId, "gate1", `[${r.verdict}] ${r.task.title}: ${r.reasons.join("; ")}`)
    }
  }
}

export function filterApproved(results: Gate1Result[]): PmTask[] {
  return results.filter(r => r.verdict === "go").map(r => r.task)
}
