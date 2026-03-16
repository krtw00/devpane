import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { useTasks } from '../composables/useApi'

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

describe('useTasks error ref', () => {
  it('error is null on successful fetch', async () => {
    fetchMock.mockReturnValue(jsonResponse([]))

    const { error, refresh } = useTasks()
    await refresh()

    expect(error.value).toBeNull()
  })

  it('error contains message on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const { error, refresh } = useTasks()
    await refresh().catch(() => {})

    expect(error.value).toBeTruthy()
    expect(typeof error.value).toBe('string')
  })

  it('error contains message on non-ok HTTP status', async () => {
    fetchMock.mockReturnValue(jsonResponse(null, 500))

    const { error, refresh } = useTasks()
    await refresh().catch(() => {})

    expect(error.value).toBeTruthy()
    expect(typeof error.value).toBe('string')
  })

  it('error is cleared on subsequent successful fetch', async () => {
    // First call fails
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { error, refresh } = useTasks()
    await refresh().catch(() => {})
    expect(error.value).toBeTruthy()

    // Second call succeeds
    fetchMock.mockReturnValue(jsonResponse([]))
    await refresh()
    expect(error.value).toBeNull()
  })

  it('error contains message on timeout', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
      })
    })

    const { error, refresh } = useTasks()
    const promise = refresh()
    await vi.advanceTimersByTimeAsync(10_000)
    await promise.catch(() => {})

    expect(error.value).toBeTruthy()
    expect(error.value).toMatch(/タイムアウト|timeout/i)
  })
})
