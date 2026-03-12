import type { AgentEvent } from "@devpane/shared/schemas"
import { getTask } from "./db.js"

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

function buildContent(event: AgentEvent): string | null {
  switch (event.type) {
    case "task.completed": {
      const task = getTask(event.taskId)
      const title = task?.title ?? event.taskId
      return `✅ **タスク完了**: ${title}\nコスト: $${event.costUsd.toFixed(4)}`
    }
    case "task.failed": {
      const task = getTask(event.taskId)
      const title = task?.title ?? event.taskId
      return `❌ **タスク失敗**: ${title}\n原因: ${event.rootCause}`
    }
    case "spc.alert":
      return `⚠️ **SPC異常検知**: ${event.metric}\n値: ${event.value.toFixed(4)} / UCL: ${event.ucl.toFixed(4)}`
    case "gate.rejected": {
      if (event.verdict !== "kill") return null
      const task = getTask(event.taskId)
      const title = task?.title ?? event.taskId
      return `🛑 **Gate Kill**: ${title}\n理由: ${event.reason}`
    }
    default:
      return null
  }
}

export async function sendDiscordMessage(content: string): Promise<void> {
  if (!WEBHOOK_URL) return

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
  } catch (err) {
    console.warn(`[discord] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function notify(event: AgentEvent): Promise<void> {
  if (!WEBHOOK_URL) return

  const content = buildContent(event)
  if (!content) return

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
  } catch (err) {
    console.warn(`[discord] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
