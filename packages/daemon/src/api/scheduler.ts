import { Hono } from "hono"
import { getSchedulerStatus, pauseScheduler, resumeScheduler } from "../scheduler.js"

export const schedulerApi = new Hono()

schedulerApi.get("/status", (c) => {
  return c.json(getSchedulerStatus())
})

schedulerApi.post("/pause", (c) => {
  pauseScheduler()
  return c.json({ ok: true, state: "paused" })
})

schedulerApi.post("/resume", (c) => {
  resumeScheduler()
  return c.json({ ok: true, state: "running" })
})
