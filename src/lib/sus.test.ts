import { describe, it, expect } from "vitest";
import { susScore, susSummary } from "./sus";

describe("SUS scoring", () => {
  it("scores the textbook extremes", () => {
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
  });
  it("scores a typical answer sheet", () => {
    // odd: 4,4,5,4,4 -> 3+3+4+3+3 = 16; even: 2,2,1,2,2 -> 3+3+4+3+3 = 16; (16+16)*2.5 = 80
    expect(susScore([4, 2, 4, 2, 5, 1, 4, 2, 4, 2])).toBe(80);
  });
  it("rejects bad answer sheets", () => {
    expect(() => susScore([5, 5, 5])).toThrow();
    expect(() => susScore([6, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toThrow();
  });
  it("summarises a sample", () => {
    const s = susSummary([[5, 1, 5, 1, 5, 1, 5, 1, 5, 1], [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], [4, 2, 4, 2, 5, 1, 4, 2, 4, 2]]);
    expect(s.n).toBe(3);
    expect(s.mean).toBe(76.7);
    expect(s.median).toBe(80);
    expect(s.aboveTarget).toBe(2);
    expect(s.ci95[0]).toBeLessThan(s.mean);
  });
});
