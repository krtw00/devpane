import { WebSocketServer, WebSocket } from "ws"
import type { ServerType } from "@hono/node-server"

let wss: WebSocketServer | null = null

export function attachWebSocket(server: ServerType): void {
  wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
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
