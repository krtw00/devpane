import type { AgentEvent } from "@devpane/shared/schemas"
import { type Notifier, type ReportPayload, formatEventPlain } from "./notifier.js"

/** Mattermost Incoming Webhook notifier */
export class MattermostNotifier implements Notifier {
  constructor(private webhookUrl: string) {}

  async sendMessage(text: string): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
    } catch (err) {
      console.warn(`[mattermost] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async sendReport(report: ReportPayload): Promise<void> {
    const parts = [`### ${report.title}\n${report.summary}`]
    for (const s of report.sections) {
      parts.push(`#### ${s.heading}\n\`\`\`\n${s.body}\n\`\`\``)
    }
    // Mattermost post limit is ~16383 chars
    const text = parts.join("\n\n").slice(0, 16000)
    await this.sendMessage(text)
  }

  async notify(event: AgentEvent): Promise<void> {
    const plain = formatEventPlain(event)
    if (!plain) return
    await this.sendMessage(plain)
  }
}
