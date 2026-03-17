import type { Task } from "@devpane/shared"

const DUPLICATE_PATTERNS = [
  /duplicate/i,
  /already implemented/i,
  /already fully implemented/i,
  /fully implemented/i,
  /already covers/i,
  /redundant reimplementation/i,
]

export function getTaskFailureText(task: Pick<Task, "result">): string {
  if (!task.result) return ""
  try {
    const parsed = JSON.parse(task.result) as {
      error?: string
      gate1?: { reasons?: string[] }
      gate3?: { reasons?: string[], failure?: { root_cause?: string } }
    }
    return [
      parsed.error,
      ...(parsed.gate1?.reasons ?? []),
      ...(parsed.gate3?.reasons ?? []),
      parsed.gate3?.failure?.root_cause,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase()
  } catch {
    return task.result.toLowerCase()
  }
}

export function getSuppressionReason(task: Pick<Task, "status" | "result">): string | null {
  if (task.status !== "failed") return null

  const failureText = getTaskFailureText(task)
  if (!failureText) return null

  if (/max retries exceeded/i.test(failureText)) {
    return "max retries exceeded"
  }
  if (DUPLICATE_PATTERNS.some((pattern) => pattern.test(failureText))) {
    return "duplicate or already implemented"
  }
  return null
}

export function shouldSuppressFailedTask(task: Pick<Task, "status" | "result">): boolean {
  return getSuppressionReason(task) !== null
}
