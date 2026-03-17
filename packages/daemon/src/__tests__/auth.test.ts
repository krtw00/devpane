import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import type { Hono } from "hono"

const handleUpgradeSpy = vi.fn()

vi.mock("ws", async () => {
  const { EventEmitter: EE } = await import("node:events")

  class MockWSS extends EE {
    clients = new Set()
    handleUpgrade = handleUpgradeSpy.mockImplementation((_req, _socket, _head, callback) => {
      callback({} as never)
    })
  }

  return {
    WebSocketServer: MockWSS,
    WebSocket: { OPEN: 1 },
  }
})

async function loadApp(): Promise<Hono> {
  vi.resetModules()
  const mod = await import("../index.js")
  return mod.createApp()
}

describe("API auth middleware", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("API_TOKEN未設定時は認証なしで通過する", async () => {
    delete process.env.API_TOKEN

    const app = await loadApp()
    const res = await app.request("/api/config")

    expect(res.status).toBe(200)
  })

  it("API_TOKEN設定時にBearerトークンなしは401", async () => {
    vi.stubEnv("API_TOKEN", "secret-token")

    const app = await loadApp()
    const res = await app.request("/api/config")

    expect(res.status).toBe(401)
  })

  it("API_TOKEN設定時に正しいBearerトークンなら200", async () => {
    vi.stubEnv("API_TOKEN", "secret-token")

    const app = await loadApp()
    const res = await app.request("/api/config", {
      headers: { Authorization: "Bearer secret-token" },
    })

    expect(res.status).toBe(200)
  })

  it("/health は API_TOKEN 設定時でも認証不要", async () => {
    vi.stubEnv("API_TOKEN", "secret-token")

    const app = await loadApp()
    const res = await app.request("/health")

    expect(res.status).toBe(200)
  })
})

describe("CORS", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("CORS_ORIGIN未設定時は * を許可する", async () => {
    delete process.env.CORS_ORIGIN

    const app = await loadApp()
    const res = await app.request("/api/config", {
      headers: { Origin: "https://any-origin.example" },
    })

    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("CORS_ORIGIN設定時は指定オリジンのみ許可する", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://allowed.example,https://allowed-2.example")

    const app = await loadApp()
    const allowed = await app.request("/api/config", {
      headers: { Origin: "https://allowed-2.example" },
    })
    const blocked = await app.request("/api/config", {
      headers: { Origin: "https://blocked.example" },
    })

    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed-2.example")
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("WebSocket auth", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    handleUpgradeSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("API_TOKEN設定時にtokenクエリなしはsocket.destroy()される", async () => {
    vi.stubEnv("API_TOKEN", "secret-token")

    const { attachWebSocket } = await import("../ws.js")
    const server = new EventEmitter() as any
    attachWebSocket(server)

    const socket = { destroy: vi.fn() } as any
    server.emit("upgrade", { url: "/ws" }, socket, Buffer.alloc(0))

    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(handleUpgradeSpy).not.toHaveBeenCalled()
  })

  it("API_TOKEN設定時に正しいtokenクエリなら接続成功", async () => {
    vi.stubEnv("API_TOKEN", "secret-token")

    const { attachWebSocket } = await import("../ws.js")
    const server = new EventEmitter() as any
    attachWebSocket(server)

    const socket = { destroy: vi.fn() } as any
    server.emit("upgrade", { url: "/ws?token=secret-token" }, socket, Buffer.alloc(0))

    expect(socket.destroy).not.toHaveBeenCalled()
    expect(handleUpgradeSpy).toHaveBeenCalledTimes(1)
  })
})
