import { describe, expect, it } from "vitest";
import { freeCount, gridColumns, gridStep, inRange, rowCells } from "./availability";
import type { FormRule } from "./booking-form";

const rule: FormRule = {
  open_time: "08:00:00", close_time: "12:00:00", slot_minutes: 30,
  min_duration_mins: 30, max_duration_mins: 120, max_advance_days: 14,
};
const day = "2026-11-10";
const before = new Date("2026-11-09T12:00:00+08:00");
const busy = [{ start_time: "2026-11-10T09:00:00+08:00", end_time: "2026-11-10T10:00:00+08:00" }];

describe("grid shape", () => {
  it("uses the smallest slot of the rooms", () => {
    expect(gridStep([rule, { slot_minutes: 60 }])).toBe(30);
    expect(gridStep([{ slot_minutes: 60 }])).toBe(60);
    expect(gridStep([])).toBe(30);
  });
  it("lists columns across the hours", () => {
    expect(gridColumns(8, 10, 30)).toEqual(["08:00", "08:30", "09:00", "09:30"]);
  });
});

describe("rowCells", () => {
  const cols = gridColumns(7, 13, 30);

  it("marks closed, taken and free cells (Malaysia time)", () => {
    const cells = rowCells(rule, day, cols, 30, busy, 60, before);
    const state = Object.fromEntries(cells.map((c) => [c.time, c.state]));
    expect(state["07:30"]).toBe("closed");
    expect(state["08:00"]).toBe("free");
    expect(state["09:00"]).toBe("taken");
    expect(state["09:30"]).toBe("taken");
    expect(state["10:00"]).toBe("free");
    expect(state["12:00"]).toBe("closed");
  });

  it("only lets a booking start where the whole length is free", () => {
    const cells = rowCells(rule, day, cols, 30, busy, 60, before);
    const can = cells.filter((c) => c.canStart).map((c) => c.time);
    // 08:30 + 60 min runs into the 09:00 booking; 11:30 + 60 runs past closing
    expect(can).toEqual(["08:00", "10:00", "10:30", "11:00"]);
  });

  it("still lets a taken start be asked for (that is what brings up suggestions)", () => {
    const cells = rowCells(rule, day, cols, 30, busy, 60, before);
    const nine = cells.find((c) => c.time === "09:00")!;
    expect(nine.canStart).toBe(false);
    expect(nine.onGrid).toBe(true);
    expect(cells.find((c) => c.time === "07:30")!.onGrid).toBe(false);
  });

  it("greys out what has passed today", () => {
    const now = new Date("2026-11-10T10:10:00+08:00");
    const cells = rowCells(rule, day, cols, 30, [], 30, now);
    const byTime = Object.fromEntries(cells.map((c) => [c.time, c]));
    expect(byTime["09:30"].state).toBe("past");
    expect(byTime["10:00"].state).toBe("free");      // running now: still shown, but
    expect(byTime["10:00"].canStart).toBe(false);    // too late to start
    expect(byTime["10:30"].canStart).toBe(true);
  });

  it("is all closed without a rule", () => {
    expect(rowCells(null, day, cols, 30, [], 60, before).every((c) => c.state === "closed" && !c.canStart)).toBe(true);
  });

  it("counts what is still free", () => {
    expect(freeCount(rowCells(rule, day, cols, 30, busy, 60, before))).toBe(6);
  });
});

describe("inRange", () => {
  it("covers the booked cells only", () => {
    expect(inRange("09:00", "09:00", 60)).toBe(true);
    expect(inRange("09:30", "09:00", 60)).toBe(true);
    expect(inRange("10:00", "09:00", 60)).toBe(false);
    expect(inRange("09:00", "", 60)).toBe(false);
  });
});
