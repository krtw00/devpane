const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

export async function notify(content: string): Promise<void> {
  if (!WEBHOOK_URL) {
    console.log("[discord] DISCORD_WEBHOOK_URL not set, skipping notification");
    console.log(content);
    return;
  }

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    console.error(`[discord] webhook failed: ${res.status} ${res.statusText}`);
  }
}
