import { describe, expect, it } from "vitest";
import { KLM, click, clickAgain, parseOps, read, taskTime, type } from "./klm";

describe("parseOps", () => {
  it("expands repeats", () => {
    expect(parseOps("M P B B K*3")).toEqual(["M", "P", "B", "B", "K", "K", "K"]);
  });
  it("ignores extra spaces", () => {
    expect(parseOps("  M   P ")).toEqual(["M", "P"]);
  });
  it("rejects unknown operators", () => {
    expect(() => parseOps("M X")).toThrow(/Unknown KLM operator/);
    expect(() => parseOps("K*")).toThrow();
  });
});

describe("operator times", () => {
  it("uses the Card, Moran & Newell values", () => {
    expect(KLM).toEqual({ K: 0.28, P: 1.1, B: 0.1, H: 0.4, M: 1.35 });
  });
});

describe("taskTime", () => {
  it("a click on a new target is M + P + B + B = 2.65 s", () => {
    const t = taskTime([click("button")]);
    expect(t.user).toBe(2.65);
    expect(t.counts).toEqual({ K: 0, P: 1, B: 2, H: 0, M: 1 });
  });
  it("clicking the same target again costs only B B", () => {
    expect(taskTime([clickAgain("+", 2)]).user).toBe(0.4);
  });
  it("typing 'hi' + Enter = H + M + 3K", () => {
    expect(taskTime([type("hi", "chat")]).user).toBeCloseTo(0.4 + 1.35 + 3 * 0.28, 10);
  });
  it("typing without Enter, with the hand back to the mouse", () => {
    const t = taskTime([type("abc", "field", { enter: false, handBack: true })]);
    expect(t.counts).toEqual({ K: 3, P: 0, B: 0, H: 2, M: 1 });
  });
  it("keeps system time separate from user time", () => {
    const t = taskTime([click("book", 0.5), read("confirmation")]);
    expect(t.user).toBe(4);
    expect(t.system).toBe(0.5);
    expect(t.total).toBe(4.5);
    expect(t.steps).toBe(2);
  });
  it("accepts custom operator times (sensitivity checks)", () => {
    const t = taskTime([type("ab", "x", { enter: false })], { ...KLM, K: 0.2 });
    expect(t.user).toBeCloseTo(0.4 + 1.35 + 0.4, 10);
  });
});
