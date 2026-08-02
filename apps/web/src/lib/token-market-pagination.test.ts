import { describe, expect, it } from "vitest";
import { pageWindow, TOKEN_MARKET_PAGE_SIZE } from "./token-market-pagination";

describe("token market pagination", () => {
  const values = Array.from({ length: 24 }, (_, index) => index + 1);

  it("returns bounded pages without dropping later entries", () => {
    expect(TOKEN_MARKET_PAGE_SIZE).toBe(10);
    expect(pageWindow(values, 1).items).toEqual(values.slice(0, 10));
    expect(pageWindow(values, 2).items).toEqual(values.slice(10, 20));
    expect(pageWindow(values, 3).items).toEqual(values.slice(20, 24));
  });

  it("clamps stale page numbers when the collection changes", () => {
    expect(pageWindow(values, 99)).toMatchObject({
      page: 3,
      totalPages: 3,
      startIndex: 20,
      endIndex: 24,
    });
    expect(pageWindow(values, -4).page).toBe(1);
  });

  it("keeps empty collections on a stable first page", () => {
    expect(pageWindow([], 4)).toEqual({
      items: [],
      page: 1,
      totalPages: 1,
      startIndex: 0,
      endIndex: 0,
    });
  });
});
