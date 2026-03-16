import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../events.js", () => ({
  queryRecentEvents: vi.fn(() => []),
  queryEventsByType: vi.fn(() => []),
  queryEventsByTaskId: vi.fn(() => []),
}))

const mod = await import("../events.js") as Record<string, unknown>
const { eventsApi } = await import("../api/events.js")

const mockRecent = vi.mocked(mod.queryRecentEvents as (...args: unknown[]) => unknown[])
const mockByType = vi.mocked(mod.queryEventsByType as (...args: unknown[]) => unknown[])
const mockByTaskId = vi.mocked(mod.queryEventsByTaskId as (...args: unknown[]) => unknown[])

beforeEach(() => {
  mockRecent.mockClear()
  mockByType.mockClear()
  mockByTaskId.mockClear()
})

describe("GET /events taskId parameter", () => {
  it("uses queryEventsByTaskId when taskId is specified", async () => {
    const res = await eventsApi.request("/?taskId=task-123")
    expect(res.status).toBe(200)
    expect(mockByTaskId).toHaveBeenCalledWith("task-123", undefined, 100)
    expect(mockRecent).not.toHaveBeenCalled()
    expect(mockByType).not.toHaveBeenCalled()
  })

  it("passes type as AND condition with taskId", async () => {
    const res = await eventsApi.request("/?taskId=task-456&type=pr.created")
    expect(res.status).toBe(200)
    expect(mockByTaskId).toHaveBeenCalledWith("task-456", "pr.created", 100)
  })

  it("passes limit together with taskId", async () => {
    const res = await eventsApi.request("/?taskId=task-789&limit=10")
    expect(res.status).toBe(200)
    expect(mockByTaskId).toHaveBeenCalledWith("task-789", undefined, 10)
  })

  it("passes taskId, type, and limit together", async () => {
    const res = await eventsApi.request("/?taskId=task-abc&type=pr.created&limit=5")
    expect(res.status).toBe(200)
    expect(mockByTaskId).toHaveBeenCalledWith("task-abc", "pr.created", 5)
  })

  it("returns the filtered events as JSON", async () => {
    const events = [
      { type: "pr.created", taskId: "task-123", url: "https://github.com/org/repo/pull/1" },
    ]
    mockByTaskId.mockReturnValueOnce(events)

    const res = await eventsApi.request("/?taskId=task-123&type=pr.created")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(events)
  })

  it("falls back to normal query when taskId is not specified", async () => {
    const res = await eventsApi.request("/?type=pr.created&limit=25")
    expect(res.status).toBe(200)
    expect(mockByType).toHaveBeenCalledWith("pr.created", 25)
    expect(mockByTaskId).not.toHaveBeenCalled()
  })

  it("caps limit at 500 even with taskId", async () => {
    const res = await eventsApi.request("/?taskId=task-big&limit=999")
    expect(res.status).toBe(200)
    expect(mockByTaskId).toHaveBeenCalledWith("task-big", undefined, 500)
  })
})
