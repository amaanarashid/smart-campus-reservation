import { describe, it, expect } from "vitest";
import { uniqueSlug, roomPrefix, nextRoomNames, typicalCapacity, ruleProblems, findPreset, DEFAULT_RULES } from "./facility-setup";

describe("facility setup helpers", () => {
  it("makes campus-unique slugs", () => {
    expect(uniqueSlug("Badminton", "Sport Hall", [])).toBe("badminton");
    expect(uniqueSlug("Badminton", "Sports Complex", ["badminton"])).toBe("badminton_sports_complex");
    expect(uniqueSlug("Badminton", "Sports Complex", ["badminton", "badminton_sports_complex"])).toBe("badminton_sports_complex_2");
    expect(uniqueSlug("  Discussion Room! ", "Library", [])).toBe("discussion_room");
  });

  it("picks a room prefix from the type or the existing names", () => {
    expect(roomPrefix("Futsal")).toBe("Court");
    expect(roomPrefix("Badminton")).toBe("Court");
    expect(roomPrefix("Swimming Pool")).toBe("Lane");
    expect(roomPrefix("Discussion Room")).toBe("Room");
    expect(roomPrefix("Event Hall")).toBe("Hall");
    expect(roomPrefix("Futsal", ["Pitch 1", "Pitch 2"])).toBe("Pitch");
    expect(roomPrefix("Discussion Room", ["Room A", "Room B"])).toBe("Room");
  });

  it("suggests the next free names", () => {
    expect(nextRoomNames([], "Court", 3)).toEqual(["Court 1", "Court 2", "Court 3"]);
    expect(nextRoomNames(["Court 1", "Court 2", "Court 4"], "Court", 2)).toEqual(["Court 3", "Court 5"]);
    expect(nextRoomNames(["Room A", "Room B"], "Room", 2)).toEqual(["Room C", "Room D"]);
    expect(nextRoomNames(["court 1"], "Court", 1)).toEqual(["Court 2"]);
  });

  it("uses the capacity most sibling rooms have", () => {
    expect(typicalCapacity([], 6)).toBe(6);
    expect(typicalCapacity([4, 4, 10], 6)).toBe(4);
    expect(typicalCapacity([4, 10], 6)).toBe(10);
  });

  it("explains bad rules in plain words", () => {
    expect(ruleProblems(DEFAULT_RULES)).toEqual([]);
    expect(ruleProblems({ ...DEFAULT_RULES, open_time: "22:00", close_time: "08:00" })).toContain("Closing time must be after opening time.");
    expect(ruleProblems({ ...DEFAULT_RULES, min_duration_mins: 180, max_duration_mins: 60 })).toContain("Shortest booking is longer than the longest.");
  });

  it("has presets for common facilities", () => {
    expect(findPreset("discussion room")?.rules.auto_approve).toBe(true);
    expect(findPreset("Event Hall")?.rules.max_duration_mins).toBe(480);
    expect(findPreset("Rocket Lab")).toBeUndefined();
  });
});
