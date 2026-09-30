import { describe, it, expect } from "vitest";
import {
  parseIntent, parseDate, parseHour, parseDuration, withContext, matchFacilities,
  freeWindows, fitsIn, sanitiseIntent, describeWindows,
} from "./chat-logic";
import { myAt } from "./time";
import type { Facility } from "./types";

const f = (id: string, name: string, cat: string, catId: string, type: string): Facility => ({
  id, name, category_id: catId, category_name: cat, type, venue: "Hall", location: "Hall",
  capacity: 4, description: null, status: "active",
});

const FAC = [
  f("b1", "Court 1", "Badminton Court", "cb", "badminton"),
  f("b2", "Court 2", "Badminton Court", "cb", "badminton"),
  f("s1", "Court 1", "Futsal Court", "cf", "futsal"),
  f("d1", "Room A", "Discussion Room", "cd", "discussion_room"),
  f("d2", "Room AB", "Discussion Room", "cd", "discussion_room"),
];

// Friday 2 October 2026, 09:00 in Malaysia
const NOW = myAt("2026-10-02", "09:00");

describe("chatbot - understanding the question", () => {
  it("recognises questions about the student's own bookings", () => {
    for (const q of ["What are my bookings?", "when is my next booking", "did I book anything tomorrow", "show my reservations"])
      expect(parseIntent(q, FAC, NOW).intent).toBe("mine");
  });

  it("tells availability, rules and listing apart", () => {
    expect(parseIntent("Is Court 2 free tomorrow?", FAC, NOW).intent).toBe("availability");
    expect(parseIntent("What time does the futsal court close?", FAC, NOW).intent).toBe("rules");
    expect(parseIntent("What is the cancellation policy for discussion rooms", FAC, NOW).intent).toBe("rules");
    expect(parseIntent("Which facilities can I book?", FAC, NOW).intent).toBe("list");
    expect(parseIntent("Where do I pay my fine?", FAC, NOW).intent).toBe("other");
  });

  it("does not mistake a rules or availability question for a listing request", () => {
    expect(parseIntent("What is the cancellation policy for discussion rooms", FAC, NOW).intent).toBe("rules");
    expect(parseIntent("What rooms are free tomorrow?", FAC, NOW).intent).toBe("availability");
    expect(parseIntent("Is court 1 open tomorrow?", FAC, NOW).intent).toBe("availability");
    expect(parseIntent("What time does room A open?", FAC, NOW).intent).toBe("rules");
    expect(parseIntent("How long can I book a discussion room for?", FAC, NOW).intent).toBe("rules");
  });

  it("matches real facility names offline, not a hardcoded word list", () => {
    const it1 = parseIntent("is court 2 free", FAC, NOW);
    expect(matchFacilities(it1.facility, FAC).map((x) => x.id)).toEqual(["b2"]);
  });

  it("uses the category to disambiguate a shared name", () => {
    const it1 = parseIntent("is badminton court 1 free today", FAC, NOW);
    expect(matchFacilities(it1.facility, FAC).map((x) => x.id)).toEqual(["b1"]);
  });

  it("a category alone means every facility in it", () => {
    const ids = matchFacilities("badminton", FAC).map((x) => x.id).sort();
    expect(ids).toEqual(["b1", "b2"]);
  });

  it("does not match a short name inside a longer one", () => {
    expect(matchFacilities("is room ab free", FAC).map((x) => x.id)).toEqual(["d2"]);
  });

  it("parses dates in Malaysia time", () => {
    expect(parseDate("today", NOW)).toBe("2026-10-02");
    expect(parseDate("tomorrow evening", NOW)).toBe("2026-10-03");
    expect(parseDate("day after tomorrow", NOW)).toBe("2026-10-04");
    expect(parseDate("on monday", NOW)).toBe("2026-10-05");
    expect(parseDate("friday", NOW)).toBe("2026-10-02");
    expect(parseDate("5 oct", NOW)).toBe("2026-10-05");
    expect(parseDate("jan 3", NOW)).toBe("2027-01-03");
    expect(parseDate("2026-10-09", NOW)).toBe("2026-10-09");
    // just after midnight in Malaysia is still the previous day in UTC
    expect(parseDate("today", myAt("2026-10-03", "00:30"))).toBe("2026-10-03");
  });

  it("parses the hour asked for", () => {
    expect(parseHour("at 3pm")).toBe(15);
    expect(parseHour("3:30 pm")).toBe(15);
    expect(parseHour("10am")).toBe(10);
    expect(parseHour("12 am")).toBe(0);
    expect(parseHour("at 15:00")).toBe(15);
    expect(parseHour("court 1 at 3")).toBe(15);  // bare hour read as afternoon
    expect(parseHour("is court 1 free")).toBeNull();
    expect(parseHour("at 2 hours")).toBeNull();
  });

  it("parses a duration", () => {
    expect(parseDuration("for 2 hours")).toBe(120);
    expect(parseDuration("for 90 minutes")).toBe(90);
    expect(parseDuration("for 1.5 hrs")).toBe(90);
    expect(parseDuration("is it free")).toBeNull();
  });
});

describe("chatbot - follow-up questions", () => {
  const first = parseIntent("Is Court 2 free tomorrow?", FAC, NOW);

  it("keeps the facility and day for 'what about the evening?'", () => {
    const cur = withContext(parseIntent("what about the evening?", FAC, NOW), [first]);
    expect(cur.intent).toBe("availability");
    expect(matchFacilities(cur.facility, FAC).map((x) => x.id)).toEqual(["b2"]);
    expect(cur.date).toBe("2026-10-03");
    expect(cur.part_of_day).toBe("evening");
  });

  it("keeps the facility but takes a new day for 'and on monday?'", () => {
    const cur = withContext(parseIntent("and on monday?", FAC, NOW), [first]);
    expect(cur.date).toBe("2026-10-05");
    expect(matchFacilities(cur.facility, FAC).map((x) => x.id)).toEqual(["b2"]);
  });

  it("does not drag context into an unrelated question", () => {
    const cur = withContext(parseIntent("thanks!", FAC, NOW), [first]);
    expect(cur.intent).toBe("other");
  });

  it("does not carry a facility into a my-bookings question", () => {
    const cur = withContext(parseIntent("what are my bookings", FAC, NOW), [first]);
    expect(cur.intent).toBe("mine");
    expect(cur.facility).toBeNull();
  });
});

describe("chatbot - free windows", () => {
  const rule = { open_time: "08:00:00", close_time: "22:00:00", min_duration_mins: 30 };
  const day = "2026-10-03";
  const booked = [
    { start_time: myAt(day, "10:00").toISOString(), end_time: myAt(day, "12:00").toISOString(), status: "approved" as const },
    { start_time: myAt(day, "15:00").toISOString(), end_time: myAt(day, "16:00").toISOString(), status: "pending" as const },
    { start_time: myAt(day, "18:00").toISOString(), end_time: myAt(day, "19:00").toISOString(), status: "cancelled" as const },
  ];

  it("subtracts live bookings from operating hours, ignoring cancelled ones", () => {
    const w = freeWindows(rule, booked, day, NOW);
    expect(describeWindows(w)).toBe("8:00 am to 10:00 am, 12:00 pm to 3:00 pm, 4:00 pm to 10:00 pm");
  });

  it("clips to the part of day asked for", () => {
    expect(describeWindows(freeWindows(rule, booked, day, NOW, "afternoon"))).toBe("12:00 pm to 3:00 pm, 4:00 pm to 5:00 pm");
    expect(describeWindows(freeWindows(rule, booked, day, NOW, "evening"))).toBe("5:00 pm to 10:00 pm");
  });

  it("never offers time that has already passed", () => {
    const w = freeWindows(rule, [], day, myAt(day, "13:07"));
    expect(describeWindows(w)).toBe("1:15 pm to 10:00 pm");
  });

  it("drops gaps shorter than the minimum booking", () => {
    const tight = [
      { start_time: myAt(day, "08:00").toISOString(), end_time: myAt(day, "10:00").toISOString(), status: "approved" as const },
      { start_time: myAt(day, "10:20").toISOString(), end_time: myAt(day, "22:00").toISOString(), status: "approved" as const },
    ];
    expect(freeWindows(rule, tight, day, NOW)).toHaveLength(0);
  });

  it("checks whether a specific booking fits", () => {
    const w = freeWindows(rule, booked, day, NOW);
    expect(fitsIn(w, myAt(day, "13:00"), 60)).toBe(true);
    expect(fitsIn(w, myAt(day, "14:30"), 60)).toBe(false); // runs into the 3 pm booking
    expect(fitsIn(w, myAt(day, "11:00"), 60)).toBe(false);
  });
});

describe("chatbot - LLM output is validated", () => {
  it("keeps well-formed fields and drops anything else", () => {
    expect(sanitiseIntent({
      intent: "availability", facility: "Court 1", date: "2026-10-03", hour: 15, part_of_day: "evening", duration: 60,
    })).toEqual({
      intent: "availability", facility: "Court 1", date: "2026-10-03", hour: 15, part_of_day: "evening", duration: 60,
    });
    expect(sanitiseIntent({ intent: "drop tables", date: "tomorrow", hour: 99, duration: -5 })).toEqual({});
    expect(sanitiseIntent("not an object")).toEqual({});
  });
});
