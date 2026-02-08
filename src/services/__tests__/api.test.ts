import { beforeEach, describe, expect, it, vi } from "vitest";
import { pythonApi, tradeEngineApi } from "@/services/api";

describe("API services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("fetches trade engine news successfully", async () => {
    const mockPayload = { items: [{ id: 1, headline: "Test" }], next_cursor: null };
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockPayload,
    });

    const result = await tradeEngineApi.getNews(5);

    expect(result).toEqual(mockPayload);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/news?limit=5"),
    );
  });

  it("throws when trade engine news endpoint fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      statusText: "Service Unavailable",
    });

    await expect(tradeEngineApi.getNews()).rejects.toThrow("Trade Engine API error: Service Unavailable");
  });

  it("throws when stock price endpoint is unsuccessful", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
    });

    await expect(pythonApi.getStockPrice("AAPL")).rejects.toThrow("Failed to fetch price for AAPL");
  });
});
