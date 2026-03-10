import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { config } from "./config.js"

const app = new Hono()

app.get("/health", (c) => c.json({ status: "ok" }))

console.log(`[devpane] starting daemon on port ${config.API_PORT}`)

serve({ fetch: app.fetch, port: config.API_PORT }, () => {
  console.log(`[devpane] daemon listening on http://localhost:${config.API_PORT}`)
})
