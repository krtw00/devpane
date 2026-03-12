import type { PmOutput, Memory } from "@devpane/shared"

// Gate 1: PM出力の構造化仕様チェック
// 原理1: 判定はコード（ルールベース）。LLMには委託しない。

const MIN_DESCRIPTION_LENGTH = 50
const MIN_PRIORITY = 1
const MAX_PRIORITY = 5

export type Gate1Result = {
  verdict: "go" | "kill" | "recycle"
  reasons: string[]
}

export function runGate1(spec: PmOutput, memories: Memory[]): Gate1Result {
  const reasons: string[] = []
  let verdict: "go" | "kill" | "recycle" = "go"

  for (let i = 0; i < spec.tasks.length; i++) {
    const task = spec.tasks[i]

    // Rule 1: title/descriptionが空でない
    if (!task.title.trim()) {
      verdict = "kill"
      reasons.push(`task[${i}]: title is empty`)
    }
    if (!task.description.trim()) {
      verdict = "kill"
      reasons.push(`task[${i}]: description is empty`)
    }

    // Rule 2: priorityが1-5の範囲
    if (task.priority < MIN_PRIORITY || task.priority > MAX_PRIORITY) {
      verdict = verdict === "kill" ? "kill" : "recycle"
      reasons.push(`task[${i}]: priority=${task.priority} out of range ${MIN_PRIORITY}-${MAX_PRIORITY}`)
    }

    // Rule 3: memoriesのfeatureカテゴリと類似タイトルがあればrecycle
    if (task.title.trim() && hasSimilarFeature(task.title, memories)) {
      verdict = verdict === "kill" ? "kill" : "recycle"
      reasons.push(`task[${i}]: similar feature already exists for "${task.title}"`)
    }

    // Rule 4: descriptionに具体的な実装指示が含まれる（50文字以上）
    if (task.description.trim().length < MIN_DESCRIPTION_LENGTH) {
      verdict = verdict === "kill" ? "kill" : "recycle"
      reasons.push(`task[${i}]: description too short (${task.description.trim().length} < ${MIN_DESCRIPTION_LENGTH})`)
    }
  }

  return { verdict, reasons }
}

function hasSimilarFeature(title: string, memories: Memory[]): boolean {
  const normalized = title.toLowerCase()
  return memories.some(
    (m) => m.category === "feature" && m.content.toLowerCase().includes(normalized),
  )
}
