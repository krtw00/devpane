import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

describe("GET /api/config", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns appName from config", async () => {
    vi.stubEnv("APP_NAME", "DevPane")

    const { config } = await import("../config.js")
    const { configApi } = await import("../api/config.js")

    const app = new Hono()
    app.route("/api/config", configApi)

    const res = await app.request("/api/config")
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ appName: config.APP_NAME })
    expect(body.appName).toBe("DevPane")

    vi.unstubAllEnvs()
  })

  it("returns custom appName when APP_NAME env is set", async () => {
    vi.stubEnv("APP_NAME", "MyCustomApp")

    const { configApi } = await import("../api/config.js")

    const app = new Hono()
    app.route("/api/config", configApi)

    const res = await app.request("/api/config")
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.appName).toBe("MyCustomApp")

    vi.unstubAllEnvs()
  })

  it("returns JSON content type", async () => {
    const { configApi } = await import("../api/config.js")

    const app = new Hono()
    app.route("/api/config", configApi)

    const res = await app.request("/api/config")
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
  })
})
