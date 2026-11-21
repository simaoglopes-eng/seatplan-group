import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_HEADLINE, visitHeadline } from "./visitHeadline";

describe("discovery headline", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("keeps the headline stable on the first visit and on a return", () => {
    expect(visitHeadline()).toBe(FIRST_HEADLINE);
    expect(visitHeadline()).toBe(FIRST_HEADLINE);
    window.sessionStorage.clear();
    const returning = visitHeadline();
    expect(returning).not.toBe(FIRST_HEADLINE);
    expect(visitHeadline()).toBe(returning);
  });

  it("rotates the regular visitor copy from the fifth visit", () => {
    const headlines = [];
    for (let visit = 1; visit <= 30; visit += 1) {
      window.sessionStorage.clear();
      headlines.push(visitHeadline());
    }
    expect(headlines[4]).toBe("The usual, or somewhere new?");
    expect(new Set(headlines.slice(4)).size).toBe(26);
  });

  it("falls back to the first headline if storage is unavailable", () => {
    const storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    try {
      expect(visitHeadline()).toBe(FIRST_HEADLINE);
    } finally {
      storage.mockRestore();
    }
  });
});
