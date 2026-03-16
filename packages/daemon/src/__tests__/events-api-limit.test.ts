import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../events.js", () => ({
  queryRecentEvents: vi.fn(() => []),
  queryEventsByType: vi.fn(() => []),
}))

const { queryRecentEvents, queryEventsByType } = await import("../events.js")
const { eventsApi } = await import("../api/events.js")

const mockRecent = vi.mocked(queryRecentEvents)
const mockByType = vi.mocked(queryEventsByType)

beforeEach(() => {
  mockRecent.mockClear()
  mockByType.mockClear()
})

describe("GET /events limit parameter", () => {
  it("defaults to 100 when limit is not specified", async () => {
    const res = await eventsApi.request("/")
    expect(res.status).toBe(200)
    expect(mockRecent).toHaveBeenCalledWith(100)
  })

  it("uses the provided numeric limit", async () => {
    const res = await eventsApi.request("/?limit=50")
    expect(res.status).toBe(200)
    expect(mockRecent).toHaveBeenCalledWith(50)
  })

  it("caps limit at 500", async () => {
    const res = await eventsApi.request("/?limit=999")
    expect(res.status).toBe(200)
    expect(mockRecent).toHaveBeenCalledWith(500)
  })

  it("falls back to 100 when limit is NaN string like 'abc'", async () => {
    const res = await eventsApi.request("/?limit=abc")
    expect(res.status).toBe(200)
    expect(mockRecent).toHaveBeenCalledWith(100)
  })

  it("falls back to 100 when limit is 'NaN'", async () => {
    const res = await eventsApi.request("/?limit=NaN")
    expect(res.status).toBe(200)
    expect(mockRecent).toHaveBeenCalledWith(100)
  })

  it("passes limit to queryEventsByType when type is specified", async () => {
    const res = await eventsApi.request("/?type=task.started&limit=25")
    expect(res.status).toBe(200)
    expect(mockByType).toHaveBeenCalledWith("task.started", 25)
  })
})
