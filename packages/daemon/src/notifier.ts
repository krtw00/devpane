import type { AgentEvent } from "@devpane/shared/schemas"
import { getTask } from "./db.js"

/** Chat tool notification interface — OSS users can implement their own */
export interface Notifier {
  /** Send a free-form message */
  sendMessage(text: string): Promise<void>
  /** Send a structured event notification (implementation decides which events to surface) */
  notify(event: AgentEvent): Promise<void>
}

/** Format an AgentEvent into a human-readable line (plain text, no platform markup) */
export function formatEventPlain(event: AgentEvent): string | null {
  switch (event.type) {
    case "task.completed": {
      const task = getTask(event.taskId)
      const title = task?.title ?? event.taskId
      return `[完了] ${title} (コスト: $${event.costUsd.toFixed(4)})`
    }
    case "task.failed": {
      const task = getTask(event.taskId)
      const title = task?.title ?? event.taskId
      return `[失敗] ${title} (原因: ${event.rootCause})`
    }
    case "spc.alert":
      return `[SPC異常] ${event.metric}: ${event.value.toFixed(4)} / UCL: ${event.ucl.toFixed(4)}`
    case "gate.rejected": {
      if (event.verdict !== "kill") return null
      const task = getTask(event.taskId)
      const title = task?.title ?? event.taskId
      return `[Gate Kill] ${title}: ${event.reason}`
    }
    case "improvement.reverted":
      return `[改善リバート] ${event.improvementId}: ${event.reason}`
    default:
      return null
  }
}

/** No-op notifier for when no chat tool is configured */
export class NullNotifier implements Notifier {
  async sendMessage(): Promise<void> {}
  async notify(): Promise<void> {}
}
