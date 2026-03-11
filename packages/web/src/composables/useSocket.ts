import { ref, onMounted, onUnmounted } from 'vue'

export type WsMessage = {
  type: string
  payload: unknown
}

type Handler = (payload: unknown) => void

const handlers = new Map<string, Set<Handler>>()
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const connected = ref(false)

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

function connect() {
  if (ws && ws.readyState <= WebSocket.OPEN) return

  ws = new WebSocket(getWsUrl())

  ws.onopen = () => {
    connected.value = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  ws.onclose = () => {
    connected.value = false
    ws = null
    reconnectTimer = setTimeout(connect, 3000)
  }

  ws.onerror = () => {
    ws?.close()
  }

  ws.onmessage = (ev) => {
    try {
      const msg: WsMessage = JSON.parse(ev.data)
      const set = handlers.get(msg.type)
      if (set) {
        for (const h of set) h(msg.payload)
      }
    } catch {
      // ignore malformed messages
    }
  }
}

export function useSocket() {
  onMounted(() => {
    connect()
  })

  return { connected }
}

export function onWsEvent(type: string, handler: Handler) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(handler)

  onUnmounted(() => {
    handlers.get(type)?.delete(handler)
  })
}

export function sendChat(message: string): Promise<unknown> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }).then(r => r.json())
}
