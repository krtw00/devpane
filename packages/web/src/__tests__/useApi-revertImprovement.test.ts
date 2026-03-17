import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { revertImprovement } = await import('../composables/useApi')

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  })
}

describe('revertImprovement', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('posts to the improvement revert endpoint', async () => {
    fetchMock.mockReturnValue(jsonResponse({ id: 'imp-1', status: 'reverted' }))

    const result = await revertImprovement('imp-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/stats/improvements/imp-1/revert', { method: 'POST' })
    expect(result).toEqual({ id: 'imp-1', status: 'reverted' })
  })

  it('throws on non-ok response', async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: 'bad request' }, 400))

    await expect(revertImprovement('imp-1')).rejects.toThrow(/400/)
  })
})
