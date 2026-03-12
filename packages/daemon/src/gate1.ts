import type { Task } from "@devpane/shared"
import { getAllDoneTitles } from "./db.js"
import { recall } from "./memory.js"
import { isDuplicate } from "./pm.js"
import { emit } from "./events.js"
import { appendLog } from "./db.js"

export type Gate1Result = {
  verdict: "go" | "kill"
  reasons: string[]
}

const MIN_DESCRIPTION_LENGTH = 20

export function runGate1(task: Task): Gate1Result {
  const reasons: string[] = []

  // Rule 1: descriptionが短すぎる → Workerが実装できない
  if (!task.description || task.description.length < MIN_DESCRIPTION_LENGTH) {
    reasons.push(`description too short (${task.description?.length ?? 0} chars, min ${MIN_DESCRIPTION_LENGTH})`)
  }

  // Rule 2: 完了済みタスクとのタイトル重複
  const doneTitles = getAllDoneTitles()
  if (isDuplicate(task.title, doneTitles)) {
    reasons.push(`duplicate of completed task`)
  }

  // Rule 3: 実装済みfeature記憶との衝突
  const features = recall("feature")
  const featureContents = features.map(m => m.content)
  if (isDuplicate(task.title, featureContents)) {
    reasons.push(`conflicts with existing feature memory`)
  }

  const verdict = reasons.length > 0 ? "kill" : "go"

  if (verdict === "go") {
    emit({ type: "gate.passed", taskId: task.id, gate: "gate1" })
    appendLog(task.id, "gate1", "[pass] all checks passed")
  } else {
    emit({ type: "gate.rejected", taskId: task.id, gate: "gate1", verdict: "kill", reason: reasons.join("; ") })
    appendLog(task.id, "gate1", `[kill] ${reasons.join("; ")}`)
  }

  return { verdict, reasons }
}
