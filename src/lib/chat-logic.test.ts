import { describe, it, expect } from "vitest";
import {
  parseIntent, parseDate, parseHour, parseDuration, parseMinute, parseRange, withContext, matchFacilities,
  freeWindows, fitsIn, roomLabels, sanitiseIntent, describeWindows, understoodLocally, windowsFrom,
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

describe("chatbot - room lists", () => {
  it("uses just the room name, adding the type only when names clash", () => {
    expect(roomLabels([FAC[3], FAC[4]])).toEqual(["Room A", "Room AB"]);
    expect(roomLabels([FAC[0], FAC[1], FAC[2]])).toEqual(["Court 1 (Badminton Court)", "Court 2", "Court 1 (Futsal Court)"]);
  });
});

describe("chatbot - when the AI is not needed", () => {
  const clear = (q: string, history: string[] = []) =>
    understoodLocally(withContext(parseIntent(q, FAC, NOW), history.map((h) => parseIntent(h, FAC, NOW))));

  it("answers clear questions without it", () => {
    expect(clear("is discussion room available on 6th from 3:00pm")).toBe(true);
    expect(clear("Gelanggang badminton kosong esok?")).toBe(true);
    expect(clear("when is my next booking")).toBe(true);
    expect(clear("which facilities can I book?")).toBe(true);
    expect(clear("what about tomorrow?", ["is court 2 free today?"])).toBe(true);
  });

  it("asks it when the question was not understood", () => {
    expect(clear("hmm any place to study quietly tomorrow?")).toBe(false);
    expect(clear("is anything free tomorrow?")).toBe(false);
    expect(clear("where do I pay my fine?")).toBe(false);
  });
});

describe("chatbot - a date with no month", () => {
  it("reads the reported question: discussion room on 6th from 3:00pm", () => {
    const i = parseIntent("is discussion room available on 6th from 3:00pm", FAC, NOW);
    expect(i.intent).toBe("availability");
    expect(i.date).toBe("2026-10-06");
    expect(i.hour).toBe(15);
    expect(i.minute).toBe(0);
    expect(i.from).toBe(true);
    expect(matchFacilities(i.facility, FAC).map((x) => x.id)).toEqual(["d1", "d2"]);
  });

  it("uses this month, or next month once that day has gone", () => {
    expect(parseDate("free on the 6th?", NOW)).toBe("2026-10-06");
    expect(parseDate("free on 2nd?", NOW)).toBe("2026-10-02");   // today counts
    expect(parseDate("free on 1st?", NOW)).toBe("2026-11-01");
    expect(parseDate("free on 6?", NOW)).toBe("2026-10-06");
    expect(parseDate("the 6th next month", NOW)).toBe("2026-11-06");
    expect(parseDate("bilik kosong 6hb?", NOW)).toBe("2026-10-06");
  });

  it("skips a month too short for that day, and crosses the year", () => {
    expect(parseDate("on 31st", myAt("2026-11-05", "09:00"))).toBe("2026-12-31");
    expect(parseDate("on 1st", myAt("2026-12-20", "09:00"))).toBe("2027-01-01");
  });

  it("reads other ways of writing a date", () => {
    expect(parseDate("on 6th of november", NOW)).toBe("2026-11-06");
    expect(parseDate("on 6/11", NOW)).toBe("2026-11-06");
    expect(parseDate("on 6/11/2027", NOW)).toBe("2027-11-06");
    expect(parseDate("6hb november", NOW)).toBe("2026-11-06");
  });

  it("does not mistake other numbers for a date", () => {
    expect(parseDate("is discussion 2 free", NOW)).toBeNull();
    expect(parseDate("book 3 discussion rooms", NOW)).toBeNull();
    expect(parseDate("is mark 5 free", NOW)).toBeNull();
    expect(parseDate("on 6 people", NOW)).toBeNull();
    expect(parseDate("on 3pm", NOW)).toBeNull();
    expect(parseDate("on 3:30", NOW)).toBeNull();
    expect(parseDate("on court 1", NOW)).toBeNull();
    expect(parseDate("5th floor room", NOW)).toBeNull();
  });
});

describe("chatbot - times", () => {
  it("keeps the minutes", () => {
    expect(parseHour("at 3:30pm")).toBe(15);
    expect(parseMinute("at 3:30pm")).toBe(30);
    expect(parseHour("at 3.30pm")).toBe(15);
    expect(parseMinute("at 3.30pm")).toBe(30);
    expect(parseMinute("pukul 3.30 petang")).toBe(30);
    expect(parseMinute("at 3pm")).toBe(0);
  });

  it("reads 3:00 with no am or pm as the afternoon, and leaves 24-hour times alone", () => {
    expect(parseHour("from 3:00")).toBe(15);
    expect(parseHour("at 15:00")).toBe(15);
    expect(parseHour("at 09:00")).toBe(9);
  });

  it("tells 'from 3pm' from 'at 3pm'", () => {
    for (const q of ["free from 3pm?", "after 3", "3pm onwards", "kosong dari pukul 3 petang"]) {
      const i = parseIntent(`court 1 ${q}`, FAC, NOW);
      expect(i.from).toBe(true);
      expect(i.hour).toBe(15);
    }
    expect(parseIntent("court 1 free at 3pm", FAC, NOW).from).toBe(false);
    expect(parseIntent("court 1 free tomorrow", FAC, NOW).from).toBe(false);
  });

  it("treats a range as one slot of that length", () => {
    expect(parseRange("from 3pm to 5pm")).toEqual({ hour: 15, minute: 0, duration: 120 });
    expect(parseRange("3-5pm")).toEqual({ hour: 15, minute: 0, duration: 120 });
    expect(parseRange("10:30 to 1pm")).toEqual({ hour: 10, minute: 30, duration: 150 });
    expect(parseRange("3 hingga 5 petang")).toEqual({ hour: 15, minute: 0, duration: 120 });
    expect(parseRange("free at 3pm")).toBeNull();
    const i = parseIntent("is court 2 free from 3pm to 5pm", FAC, NOW);
    expect([i.hour, i.duration, i.from]).toEqual([15, 120, false]);
  });

  it("lists the free time from a given moment, dropping what is too short", () => {
    const at = (t: string) => myAt("2026-10-06", t);
    const wins = [{ start: at("08:00"), end: at("10:00") }, { start: at("14:00"), end: at("15:20") }, { start: at("16:00"), end: at("22:00") }];
    expect(describeWindows(windowsFrom(wins, at("15:00"), 30))).toBe("4:00 pm to 10:00 pm");
    expect(describeWindows(windowsFrom(wins, at("14:30"), 30))).toBe("2:30 pm to 3:20 pm, 4:00 pm to 10:00 pm");
    expect(windowsFrom(wins, at("22:00"), 30)).toEqual([]);
  });
});

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

describe("chatbot - Bahasa Melayu questions", () => {
  it("understands Malay availability questions", () => {
    const a = parseIntent("Gelanggang badminton 1 kosong esok petang?", FAC, NOW);
    expect(a.intent).toBe("availability");
    expect(a.date).toBe("2026-10-03");
    expect(a.part_of_day).toBe("afternoon");
    expect(matchFacilities(a.facility, FAC).map((x) => x.id)).toEqual(["b1"]);

    const b = parseIntent("Boleh saya tempah bilik perbincangan A pukul 3 petang?", FAC, NOW);
    expect(b.intent).toBe("availability");
    expect(b.hour).toBe(15);
    expect(matchFacilities(b.facility, FAC).map((x) => x.id)).toContain("d1");
  });

  it("understands Malay own-booking, rules and listing questions", () => {
    expect(parseIntent("Bila tempahan saya seterusnya?", FAC, NOW).intent).toBe("mine");
    expect(parseIntent("Apa peraturan pembatalan bilik perbincangan?", FAC, NOW).intent).toBe("rules");
    expect(parseIntent("Senaraikan kemudahan yang ada", FAC, NOW).intent).toBe("list");
  });

  it("reads Malay dates, times and durations", () => {
    expect(parseDate("lusa", NOW)).toBe("2026-10-04");
    expect(parseDate("hari isnin", NOW)).toBe("2026-10-05");
    expect(parseDate("5 okt", NOW)).toBe("2026-10-05");
    expect(parseHour("pukul 10 pagi")).toBe(10);
    expect(parseHour("8 malam")).toBe(20);
    expect(parseHour("tengah hari")).toBe(12);
    expect(parseDuration("2 jam")).toBe(120);
    expect(parseDuration("setengah jam")).toBe(30);
  });
});
