import type { Notifier } from "./notifier.js"
import { NullNotifier } from "./notifier.js"
import { SlackNotifier } from "./slack.js"
import { DiscordNotifier } from "./discord.js"

let instance: Notifier | null = null

/** Create and cache the notifier based on environment variables.
 *  Priority: SLACK_WEBHOOK_URL > DISCORD_WEBHOOK_URL > NullNotifier */
export function getNotifier(): Notifier {
  if (instance) return instance

  const slackUrl = process.env.SLACK_WEBHOOK_URL
  const discordUrl = process.env.DISCORD_WEBHOOK_URL

  if (slackUrl) {
    console.log("[notifier] using Slack webhook")
    instance = new SlackNotifier(slackUrl)
  } else if (discordUrl) {
    console.log("[notifier] using Discord webhook")
    instance = new DiscordNotifier(discordUrl)
  } else {
    console.log("[notifier] no webhook configured, notifications disabled")
    instance = new NullNotifier()
  }

  return instance
}

/** Reset cached instance (for testing) */
export function resetNotifier(): void {
  instance = null
}
