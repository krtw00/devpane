import type { AgentEvent } from "@devpane/shared/schemas"
import { type Notifier, type ReportPayload, formatEventPlain } from "./notifier.js"

/** Slack Incoming Webhook notifier with Block Kit support */
export class SlackNotifier implements Notifier {
  constructor(private webhookUrl: string) {}

  async sendMessage(text: string): Promise<void> {
    await this.post({ text })
  }

  async sendReport(report: ReportPayload): Promise<void> {
    const blocks: SlackBlock[] = [
      { type: "header", text: { type: "plain_text", text: report.title } },
      { type: "section", text: { type: "mrkdwn", text: report.summary } },
    ]

    for (const section of report.sections) {
      blocks.push({ type: "divider" })
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${section.heading}*\n${section.body}` },
      })
    }

    // Slack blocks have a limit of 50 blocks
    const trimmed = blocks.slice(0, 50)
    await this.post({ text: report.summary, blocks: trimmed })
  }

  async notify(event: AgentEvent): Promise<void> {
    const plain = formatEventPlain(event)
    if (!plain) return
    await this.sendMessage(plain)
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    } catch (err) {
      console.warn(`[slack] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

type SlackBlock =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "divider" }
