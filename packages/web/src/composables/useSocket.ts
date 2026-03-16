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
const retryCount = ref(0)

const BACKOFF_BASE = 3000
const BACKOFF_MAX = 60000

let backoffDelay = BACKOFF_BASE

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

function connect() {
  if (ws && ws.readyState <= WebSocket.OPEN) return

  ws = new WebSocket(getWsUrl())

  ws.onopen = () => {
    connected.value = true
    backoffDelay = BACKOFF_BASE
    retryCount.value = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  ws.onclose = () => {
    connected.value = false
    ws = null
    retryCount.value++
    reconnectTimer = setTimeout(connect, backoffDelay)
    backoffDelay = Math.min(backoffDelay * 2, BACKOFF_MAX)
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

  return { connected, retryCount }
}

export function onWsEvent(type: string, handler: Handler) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(handler)

  onUnmounted(() => {
    handlers.get(type)?.delete(handler)
  })
}

export function sendChat(message: string, category?: string): Promise<unknown> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, category }),
  }).then(r => r.json())
}
