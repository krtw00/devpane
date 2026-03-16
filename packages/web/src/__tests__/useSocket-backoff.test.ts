import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Vue lifecycle hooks
let mountedCallbacks: Array<() => void> = []
let unmountedCallbacks: Array<() => void> = []

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onMounted: (cb: () => void) => { mountedCallbacks.push(cb) },
    onUnmounted: (cb: () => void) => { unmountedCallbacks.push(cb) },
  }
})

// Track setTimeout calls to verify backoff delays
const setTimeoutSpy = vi.fn<(cb: () => void, ms: number) => ReturnType<typeof setTimeout>>()
vi.stubGlobal('setTimeout', setTimeoutSpy)
vi.stubGlobal('clearTimeout', vi.fn())

// Mock WebSocket
let wsInstances: MockWebSocket[] = []

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  close() { this.readyState = 3 }
  constructor() { wsInstances.push(this) }
}
vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' })

// Must import after mocks are set up
// Use resetModules to get fresh module state per test
beforeEach(() => {
  mountedCallbacks = []
  unmountedCallbacks = []
  wsInstances = []
  setTimeoutSpy.mockReset()
  setTimeoutSpy.mockReturnValue(0 as unknown as ReturnType<typeof setTimeout>)
  // Reset the module so that module-level state (ws, reconnectTimer, backoff) is fresh
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function loadModule() {
  const mod = await import('../composables/useSocket')
  return mod
}

describe('useSocket exponential backoff', () => {
  it('first reconnection uses base interval of 3 seconds', async () => {
    const { useSocket } = await loadModule()
    useSocket()
    for (const cb of mountedCallbacks) cb()

    const ws = wsInstances[0]
    // Simulate connection close
    ws.onclose?.()

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
    const delay = setTimeoutSpy.mock.calls[0][1]
    expect(delay).toBe(3000)
  })

  it('retry interval doubles on each consecutive disconnect (3s → 6s → 12s → 24s)', async () => {
    const { useSocket } = await loadModule()
    useSocket()
    for (const cb of mountedCallbacks) cb()

    const expectedDelays = [3000, 6000, 12000, 24000]

    for (let i = 0; i < expectedDelays.length; i++) {
      const ws = wsInstances[wsInstances.length - 1]
      // Trigger close
      ws.onclose?.()

      const delay = setTimeoutSpy.mock.calls[i][1]
      expect(delay).toBe(expectedDelays[i])

      // Execute the setTimeout callback to trigger reconnect
      const reconnectCb = setTimeoutSpy.mock.calls[i][0]
      reconnectCb()
    }
  })

  it('maximum retry interval is capped at 60 seconds', async () => {
    const { useSocket } = await loadModule()
    useSocket()
    for (const cb of mountedCallbacks) cb()

    // Trigger enough disconnections to exceed 60s cap
    // 3s → 6s → 12s → 24s → 48s → 60s (capped, not 96s)
    const closeTimes = 6
    for (let i = 0; i < closeTimes; i++) {
      const ws = wsInstances[wsInstances.length - 1]
      ws.onclose?.()
      const reconnectCb = setTimeoutSpy.mock.calls[i][0]
      reconnectCb()
    }

    // The 6th disconnect (index 5) would be 3*2^5 = 96s, should be capped at 60s
    const fifthDelay = setTimeoutSpy.mock.calls[4][1]
    const sixthDelay = setTimeoutSpy.mock.calls[5][1]
    expect(fifthDelay).toBe(48000)
    expect(sixthDelay).toBe(60000)

    // Further disconnects should also stay at 60s
    const ws = wsInstances[wsInstances.length - 1]
    ws.onclose?.()
    const seventhDelay = setTimeoutSpy.mock.calls[6][1]
    expect(seventhDelay).toBe(60000)
  })

  it('successful connection resets backoff to base interval', async () => {
    const { useSocket } = await loadModule()
    useSocket()
    for (const cb of mountedCallbacks) cb()

    // Disconnect twice to escalate backoff
    for (let i = 0; i < 2; i++) {
      const ws = wsInstances[wsInstances.length - 1]
      ws.onclose?.()
      const reconnectCb = setTimeoutSpy.mock.calls[i][0]
      reconnectCb()
    }

    // Verify backoff has escalated: delays should be 3000, 6000
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(3000)
    expect(setTimeoutSpy.mock.calls[1][1]).toBe(6000)

    // Now simulate successful connection on the latest WebSocket
    const ws = wsInstances[wsInstances.length - 1]
    ws.readyState = MockWebSocket.OPEN
    ws.onopen?.()

    // Disconnect again — backoff should be reset back to 3000
    ws.onclose?.()
    const resetDelay = setTimeoutSpy.mock.calls[2][1]
    expect(resetDelay).toBe(3000)
  })

  it('retryCount ref is exposed and tracks reconnection attempts', async () => {
    const { useSocket } = await loadModule()
    const { retryCount } = useSocket()
    for (const cb of mountedCallbacks) cb()

    // retryCount should be available (may be optional in the composable)
    // If retryCount is not exposed, this test documents the desired API
    expect(retryCount).toBeDefined()
    expect(retryCount.value).toBe(0)

    // Disconnect
    const ws = wsInstances[0]
    ws.onclose?.()
    expect(retryCount.value).toBe(1)

    // Execute reconnect, then disconnect again
    const reconnectCb = setTimeoutSpy.mock.calls[0][0]
    reconnectCb()
    const ws2 = wsInstances[wsInstances.length - 1]
    ws2.onclose?.()
    expect(retryCount.value).toBe(2)

    // Successful connection resets retryCount
    const reconnectCb2 = setTimeoutSpy.mock.calls[1][0]
    reconnectCb2()
    const ws3 = wsInstances[wsInstances.length - 1]
    ws3.readyState = MockWebSocket.OPEN
    ws3.onopen?.()
    expect(retryCount.value).toBe(0)
  })
})
