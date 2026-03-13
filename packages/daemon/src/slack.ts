import type { AgentEvent } from "@devpane/shared/schemas"
import { type Notifier, formatEventPlain } from "./notifier.js"

/** Slack Incoming Webhook notifier */
export class SlackNotifier implements Notifier {
  constructor(private webhookUrl: string) {}

  async sendMessage(text: string): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
    } catch (err) {
      console.warn(`[slack] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async notify(event: AgentEvent): Promise<void> {
    const plain = formatEventPlain(event)
    if (!plain) return
    await this.sendMessage(plain)
  }
}
