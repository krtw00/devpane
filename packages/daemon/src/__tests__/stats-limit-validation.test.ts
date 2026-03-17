import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../db.js", () => ({
  getSpcMetrics: vi.fn(() => ({ metric: "test", points: [] })),
  getRecentImprovements: vi.fn(() => []),
  getCostStats: vi.fn(() => ({})),
  getPipelineStats: vi.fn(() => ({})),
}))

const { getSpcMetrics, getRecentImprovements } = await import("../db.js")
const { statsApi } = await import("../api/stats.js")

const mockSpc = vi.mocked(getSpcMetrics)
const mockImprovements = vi.mocked(getRecentImprovements)

beforeEach(() => {
  mockSpc.mockClear()
  mockImprovements.mockClear()
})

describe("GET /spc/:metric limit parameter", () => {
  it("defaults to 20 when limit is not specified", async () => {
    const res = await statsApi.request("/spc/duration")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })

  it("uses the provided numeric limit", async () => {
    const res = await statsApi.request("/spc/duration?limit=50")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 50)
  })

  it("caps limit at 100", async () => {
    const res = await statsApi.request("/spc/duration?limit=999")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 100)
  })

  it("falls back to 20 when limit is negative", async () => {
    const res = await statsApi.request("/spc/duration?limit=-5")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })

  it("falls back to 20 when limit is 0", async () => {
    const res = await statsApi.request("/spc/duration?limit=0")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })

  it("falls back to 20 when limit is NaN", async () => {
    const res = await statsApi.request("/spc/duration?limit=NaN")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })

  it("falls back to 20 when limit is non-numeric string", async () => {
    const res = await statsApi.request("/spc/duration?limit=abc")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })

  it("falls back to 20 when limit is Infinity", async () => {
    const res = await statsApi.request("/spc/duration?limit=Infinity")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })

  it("falls back to 20 when limit is -Infinity", async () => {
    const res = await statsApi.request("/spc/duration?limit=-Infinity")
    expect(res.status).toBe(200)
    expect(mockSpc).toHaveBeenCalledWith("duration", 20)
  })
})

describe("GET /improvements limit parameter", () => {
  it("defaults to 30 when limit is not specified", async () => {
    const res = await statsApi.request("/improvements")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })

  it("uses the provided numeric limit", async () => {
    const res = await statsApi.request("/improvements?limit=10")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(10)
  })

  it("caps limit at 100", async () => {
    const res = await statsApi.request("/improvements?limit=500")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(100)
  })

  it("falls back to 30 when limit is negative", async () => {
    const res = await statsApi.request("/improvements?limit=-10")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })

  it("falls back to 30 when limit is 0", async () => {
    const res = await statsApi.request("/improvements?limit=0")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })

  it("falls back to 30 when limit is NaN", async () => {
    const res = await statsApi.request("/improvements?limit=NaN")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })

  it("falls back to 30 when limit is non-numeric string", async () => {
    const res = await statsApi.request("/improvements?limit=abc")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })

  it("falls back to 30 when limit is Infinity", async () => {
    const res = await statsApi.request("/improvements?limit=Infinity")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })

  it("falls back to 30 when limit is -Infinity", async () => {
    const res = await statsApi.request("/improvements?limit=-Infinity")
    expect(res.status).toBe(200)
    expect(mockImprovements).toHaveBeenCalledWith(30)
  })
})
