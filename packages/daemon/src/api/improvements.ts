import { Hono } from "hono"
import { getImprovements, getImprovement } from "../db.js"

export const improvementsApi = new Hono()

improvementsApi.get("/", (c) => {
  const status = c.req.query("status")
  const improvements = status ? getImprovements(status) : getImprovements()
  return c.json(improvements)
})

improvementsApi.get("/:id", (c) => {
  const improvement = getImprovement(c.req.param("id"))
  if (!improvement) return c.json({ error: "not found" }, 404)
  return c.json(improvement)
})
