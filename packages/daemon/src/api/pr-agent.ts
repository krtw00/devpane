import { Hono } from "hono"
import { runPrAgent } from "../pr-agent.js"

export const prAgentApi = new Hono()

prAgentApi.post("/run", async (c) => {
  const result = await runPrAgent()
  return c.json({ ok: true, prCount: result.reports.length, message: result.message })
})
