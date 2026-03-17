import { Hono } from "hono"
import { runCredentialHealthChecks, summarizeOverallHealth } from "../health-check.js"

export const healthApi = new Hono()

healthApi.get("/health", (c) => {
  const checks = runCredentialHealthChecks()
  const overall = summarizeOverallHealth(checks)
  return c.json({ checks, overall })
})
