import type { AgentEvent } from "@devpane/shared/schemas"
import { type Notifier, type ReportPayload, formatEventPlain } from "./notifier.js"

/** Discord Incoming Webhook notifier */
export class DiscordNotifier implements Notifier {
  constructor(private webhookUrl: string) {}

  async sendMessage(text: string): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      })
    } catch (err) {
      console.warn(`[discord] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async sendReport(report: ReportPayload): Promise<void> {
    // Discord supports markdown tables in code blocks
    const parts = [`**${report.title}**\n${report.summary}`]
    for (const s of report.sections) {
      parts.push(`**${s.heading}**\n\`\`\`\n${s.body}\n\`\`\``)
    }
    // Discord message limit is 2000 chars
    const text = parts.join("\n\n").slice(0, 2000)
    await this.sendMessage(text)
  }

  async notify(event: AgentEvent): Promise<void> {
    const plain = formatEventPlain(event)
    if (!plain) return
    await this.sendMessage(plain)
  }
}
