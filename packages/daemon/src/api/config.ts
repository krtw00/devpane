import { Hono } from "hono"
import { config } from "../config.js"

export const configApi = new Hono()

configApi.get("/", (c) => {
  return c.json({ appName: config.APP_NAME })
})
