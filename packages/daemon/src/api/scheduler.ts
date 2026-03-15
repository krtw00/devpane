import { Hono } from "hono"
import { getSchedulerState, pauseScheduler, resumeScheduler } from "../scheduler.js"
import { broadcast } from "../ws.js"

export const schedulerApi = new Hono()

schedulerApi.get("/status", (c) => {
  return c.json(getSchedulerState())
})

schedulerApi.post("/pause", (c) => {
  pauseScheduler()
  const state = getSchedulerState()
  broadcast("scheduler:state", { paused: state.paused })
  return c.json({ ok: true })
})

schedulerApi.post("/resume", (c) => {
  resumeScheduler()
  const state = getSchedulerState()
  broadcast("scheduler:state", { paused: state.paused })
  return c.json({ ok: true })
})
