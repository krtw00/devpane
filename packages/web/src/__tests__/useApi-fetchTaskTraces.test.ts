import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Import after mock setup
const { fetchTaskTraces } = await import('../composables/useApi')

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  })
}

describe('fetchTaskTraces', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches traces from /api/tasks/traces', async () => {
    const traces = [
      { taskId: 'a', title: 'Task A', gate1: 'pass', tester: 'pass', gate2: 'pass', worker: 'pass', gate3: 'pass', outcome: 'merged', costUsd: 0.02 },
    ]
    fetchMock.mockReturnValue(jsonResponse(traces))

    const result = await fetchTaskTraces()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('/api/tasks/traces')
    expect(result).toEqual(traces)
  })

  it('returns empty array when no traces', async () => {
    fetchMock.mockReturnValue(jsonResponse([]))

    const result = await fetchTaskTraces()
    expect(result).toEqual([])
  })

  it('throws on non-ok response', async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: 'server error' }, 500))

    await expect(fetchTaskTraces()).rejects.toThrow(/500/)
  })

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

    const promise = fetchTaskTraces()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(promise).rejects.toThrow(/タイムアウト|timeout/i)
  })
})
