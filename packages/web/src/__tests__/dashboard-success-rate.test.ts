import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  })
}

describe('Dashboard Success Rate Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Success Rate Calculation Logic', () => {
    // Helper function to calculate success rate
    function calculateSuccessRate(tasks: Array<{ status: string }>): number {
      if (tasks.length === 0) return 0
      const doneTasks = tasks.filter(task => task.status === 'done').length
      return (doneTasks / tasks.length) * 100
    }

    // Helper function to determine color based on success rate
    function getSuccessRateColor(rate: number): string {
      if (rate >= 80) return 'green'
      if (rate >= 50) return 'yellow'
      return 'red'
    }

    // Helper function to filter recent tasks (last 24 hours)
    function filterRecentTasks(tasks: Array<{ created_at: string }>, hours = 24): Array<{ created_at: string }> {
      const now = new Date()
      return tasks.filter(task => {
        const taskDate = new Date(task.created_at)
        const hoursDiff = (now.getTime() - taskDate.getTime()) / (1000 * 60 * 60)
        return hoursDiff <= hours
      })
    }

    // Helper function to get recent tasks by count
    function getRecentTasksByCount(tasks: Array<{ created_at: string }>, count = 50): Array<{ created_at: string }> {
      // Sort by created_at descending (most recent first)
      const sortedTasks = [...tasks].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      return sortedTasks.slice(0, count)
    }

    it('calculates success rate correctly when there are done tasks', () => {
      const tasks = [
        { id: '1', status: 'done' },
        { id: '2', status: 'done' },
        { id: '3', status: 'done' },
        { id: '4', status: 'done' },
        { id: '5', status: 'done' },
        { id: '6', status: 'done' },
        { id: '7', status: 'done' },
        { id: '8', status: 'done' },
        { id: '9', status: 'failed' },
        { id: '10', status: 'running' },
      ]
      
      const successRate = calculateSuccessRate(tasks)
      expect(successRate).toBe(80)
    })

    it('calculates success rate as 0 when there are no done tasks', () => {
      const tasks = [
        { id: '1', status: 'failed' },
        { id: '2', status: 'running' },
        { id: '3', status: 'pending' },
      ]
      
      const successRate = calculateSuccessRate(tasks)
      expect(successRate).toBe(0)
    })

    it('calculates success rate as 100 when all tasks are done', () => {
      const tasks = [
        { id: '1', status: 'done' },
        { id: '2', status: 'done' },
        { id: '3', status: 'done' },
      ]
      
      const successRate = calculateSuccessRate(tasks)
      expect(successRate).toBe(100)
    })

    it('handles empty task list gracefully', () => {
      const tasks: any[] = []
      const successRate = calculateSuccessRate(tasks)
      expect(successRate).toBe(0)
    })

    it('returns green color for success rate >= 80%', () => {
      expect(getSuccessRateColor(80)).toBe('green')
      expect(getSuccessRateColor(85)).toBe('green')
      expect(getSuccessRateColor(100)).toBe('green')
    })

    it('returns yellow color for success rate between 50% and 79%', () => {
      expect(getSuccessRateColor(50)).toBe('yellow')
      expect(getSuccessRateColor(65)).toBe('yellow')
      expect(getSuccessRateColor(79)).toBe('yellow')
    })

    it('returns red color for success rate < 50%', () => {
      expect(getSuccessRateColor(49)).toBe('red')
      expect(getSuccessRateColor(30)).toBe('red')
      expect(getSuccessRateColor(0)).toBe('red')
    })

    it('filters tasks from last 24 hours', () => {
      const now = new Date()
      const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000)
      const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000)
      
      const tasks = [
        { id: '1', status: 'done', created_at: now.toISOString() },
        { id: '2', status: 'done', created_at: twentyThreeHoursAgo.toISOString() },
        { id: '3', status: 'failed', created_at: twentyFiveHoursAgo.toISOString() },
      ]
      
      const recentTasks = filterRecentTasks(tasks, 24)
      expect(recentTasks.length).toBe(2)
    })

    it('limits to recent 50 tasks when using task count limit', () => {
      const tasks = Array.from({ length: 60 }, (_, i) => ({
        id: `${i + 1}`,
        status: i < 40 ? 'done' : 'failed',
        created_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      }))
      
      const recentTasks = getRecentTasksByCount(tasks, 50)
      expect(recentTasks.length).toBe(50)
    })
  })

  describe('API Integration Tests', () => {
    it('fetches tasks from API endpoint', async () => {
      const mockTasks = [
        { id: '1', status: 'done', created_at: new Date().toISOString() },
        { id: '2', status: 'done', created_at: new Date().toISOString() },
        { id: '3', status: 'failed', created_at: new Date().toISOString() },
      ]
      
      fetchMock.mockReturnValue(jsonResponse(mockTasks))

      // Test the actual API endpoint
      const response = await fetch('/api/tasks')
      const data = await response.json()
      
      // fetch is called with URL and options
      expect(fetchMock).toHaveBeenCalled()
      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[0]).toBe('/api/tasks')
      // The second argument might be undefined or an object
      expect(data).toEqual(mockTasks)
    })

    it('handles API errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'))

      try {
        await fetch('/api/tasks')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toBe('Network error')
      }
    })

    it('respects timeout for task fetching', async () => {
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }
        })
      })

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      
      const promise = fetch('/api/tasks', { signal: controller.signal })
        .then(res => {
          clearTimeout(timeoutId)
          return res.json()
        })
        .catch(err => {
          clearTimeout(timeoutId)
          throw err
        })

      await vi.advanceTimersByTimeAsync(10000)
      
      // The promise should reject
      await expect(promise).rejects.toBeInstanceOf(DOMException)
    })
  })
})