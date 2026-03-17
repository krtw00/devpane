import { WebSocketServer, WebSocket } from "ws"
import type { ServerType } from "@hono/node-server"
import { config } from "./config.js"

let wss: WebSocketServer | null = null

function parseUpgradeUrl(rawUrl: string | undefined): URL | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl, "http://localhost")
  } catch {
    return null
  }
}

function isAuthorizedWebSocket(url: URL): boolean {
  if (!config.API_TOKEN) return true
  return url.searchParams.get("token") === config.API_TOKEN
}

export function attachWebSocket(server: ServerType): void {
  wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    const url = parseUpgradeUrl(req.url)
    if (!url || url.pathname !== "/ws") {
      socket.destroy()
      return
    }
    if (!isAuthorizedWebSocket(url)) {
      socket.destroy()
      return
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit("connection", ws, req)
    })
  })

  wss.on("connection", () => {
    console.log("[ws] client connected")
  })

  console.log("[ws] WebSocket server attached")
}

export function broadcast(type: string, payload: unknown): void {
  if (!wss) return
  const message = JSON.stringify({ type, payload })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message)
      } catch (err) {
        console.warn("[ws] send failed:", err)
      }
    }
  }
}
