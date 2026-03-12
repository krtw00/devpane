import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// fetchJson is not exported directly, so we test through the public API functions
// that depend on it: fetchPipelineStats, fetchCostStats, useTasks, etc.

// Mock global fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import {
  fetchPipelineStats,
  fetchSchedulerStatus,
  useTasks,
} from '../composables/useApi'

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  })
}

describe('fetchJson timeout', () => {
  it('resolves normally when response arrives within timeout', async () => {
    fetchMock.mockReturnValue(jsonResponse({ alive: true, rateLimitHits: 0, pmConsecutiveFailures: 0 }))

    const result = await fetchSchedulerStatus()
    expect(result).toEqual({ alive: true, rateLimitHits: 0, pmConsecutiveFailures: 0 })
  })

  it('aborts and throws a user-friendly error after 10s timeout', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        // Simulate AbortController behavior
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
      })
    })

    const promise = fetchSchedulerStatus()

    // Advance time past the 10s timeout
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(promise).rejects.toThrow()
    // The error message should be user-friendly, not a raw AbortError
    await expect(promise).rejects.toThrow(/タイムアウト|timeout/i)
  })

  it('passes AbortSignal to fetch', async () => {
    fetchMock.mockReturnValue(jsonResponse({ alive: true, rateLimitHits: 0, pmConsecutiveFailures: 0 }))

    await fetchSchedulerStatus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callArgs = fetchMock.mock.calls[0]!
    // Second argument should contain signal from AbortController
    expect(callArgs[1]).toBeDefined()
    expect(callArgs[1]!.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchJson error handling', () => {
  it('throws on non-ok HTTP status', async () => {
    fetchMock.mockReturnValue(jsonResponse(null, 500))

    await expect(fetchSchedulerStatus()).rejects.toThrow('500')
  })

  it('throws on network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(fetchSchedulerStatus()).rejects.toThrow('Failed to fetch')
  })
})

describe('useTasks with timeout', () => {
  it('refresh resolves when fetch succeeds within timeout', async () => {
    fetchMock.mockReturnValue(jsonResponse([]))

    const { tasks, loading, refresh } = useTasks()
    await refresh()

    expect(tasks.value).toEqual([])
    expect(loading.value).toBe(false)
  })

  it('refresh throws when fetch times out', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
      })
    })

    const { loading, refresh } = useTasks()
    const promise = refresh()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(promise).rejects.toThrow(/タイムアウト|timeout/i)
    expect(loading.value).toBe(false)
  })
})

describe('fetchPipelineStats timeout', () => {
  it('times out after 10 seconds', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
      })
    })

    const promise = fetchPipelineStats()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(promise).rejects.toThrow(/タイムアウト|timeout/i)
  })
})
