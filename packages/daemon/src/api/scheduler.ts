import { Hono } from "hono"
import { getSchedulerState, pauseScheduler, resumeScheduler } from "../scheduler.js"

export const schedulerApi = new Hono()

schedulerApi.get("/status", (c) => {
  return c.json(getSchedulerState())
})

schedulerApi.post("/pause", (c) => {
  pauseScheduler()
  return c.json({ ok: true })
})

schedulerApi.post("/resume", (c) => {
  resumeScheduler()
  return c.json({ ok: true })
})
