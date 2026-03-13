import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"

type MockClient = { readyState: number; send: ReturnType<typeof vi.fn> }
const mockClients = new Set<MockClient>()

vi.mock("ws", async () => {
  const { EventEmitter: EE } = await import("node:events")
  class MockWSS extends EE {
    clients = mockClients
    handleUpgrade = vi.fn()
  }
  return {
    WebSocketServer: MockWSS,
    WebSocket: { OPEN: 1 },
  }
})

const WS_OPEN = 1

describe("ws.ts broadcast()", () => {
  beforeEach(() => {
    mockClients.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function setup() {
    const mod = await import("../ws.js")
    const mockServer = new EventEmitter() as any
    mod.attachWebSocket(mockServer)
    return mod
  }

  it("send()がthrowしてもクラッシュせずエラーを飲み込む", async () => {
    const { broadcast } = await setup()

    mockClients.add({
      readyState: WS_OPEN,
      send: vi.fn().mockImplementation(() => {
        throw new Error("connection reset")
      }),
    })

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(() => broadcast("test.event", { data: 1 })).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
  })

  it("送信失敗したクライアントをスキップし、他のクライアントには送信を継続する", async () => {
    const { broadcast } = await setup()

    const failClient = {
      readyState: WS_OPEN,
      send: vi.fn().mockImplementation(() => {
        throw new Error("broken pipe")
      }),
    }
    const okClient = {
      readyState: WS_OPEN,
      send: vi.fn(),
    }
    mockClients.add(failClient)
    mockClients.add(okClient)

    vi.spyOn(console, "warn").mockImplementation(() => {})

    broadcast("task.updated", { taskId: "t-001" })

    expect(okClient.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "task.updated", payload: { taskId: "t-001" } }),
    )
  })

  it("全クライアントのsend()が失敗してもクラッシュしない", async () => {
    const { broadcast } = await setup()

    for (let i = 0; i < 3; i++) {
      mockClients.add({
        readyState: WS_OPEN,
        send: vi.fn().mockImplementation(() => {
          throw new Error(`client ${i} disconnected`)
        }),
      })
    }

    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(() => broadcast("status", {})).not.toThrow()
  })
})
