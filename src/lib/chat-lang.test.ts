import { describe, it, expect } from "vitest";
import { detectLanguage, replyLanguage, fmtTimeMs, fmtRelativeDayMs, FIXED } from "./chat-lang";
import { myAt } from "./time";

const NOW = myAt("2026-10-02", "09:00"); // Friday

describe("chatbot language", () => {
  it("detects Malay and English", () => {
    expect(detectLanguage("Gelanggang badminton kosong esok petang?").lang).toBe("ms");
    expect(detectLanguage("Bila tempahan saya seterusnya?").lang).toBe("ms");
    expect(detectLanguage("Is the futsal court free tomorrow evening?").lang).toBe("en");
    expect(detectLanguage("When is my next booking?").lang).toBe("en");
  });

  it("a question with no clues keeps the conversation's language", () => {
    expect(replyLanguage("Court 2?", ["Gelanggang badminton kosong esok?"])).toBe("ms");
    expect(replyLanguage("Court 2?", ["Is court 1 free?"])).toBe("en");
    expect(replyLanguage("Court 2?", [])).toBe("en");
    // switching language mid-chat is followed
    expect(replyLanguage("Is court 1 free tomorrow?", ["Gelanggang kosong esok?"])).toBe("en");
  });

  it("formats Malay times and days in Malaysia time", () => {
    expect(fmtTimeMs(myAt("2026-10-02", "15:00"))).toBe("3:00 petang");
    expect(fmtTimeMs(myAt("2026-10-02", "10:30"))).toBe("10:30 pagi");
    expect(fmtTimeMs(myAt("2026-10-02", "12:00"))).toBe("12:00 tengah hari");
    expect(fmtTimeMs(myAt("2026-10-02", "20:00"))).toBe("8:00 malam");
    expect(fmtRelativeDayMs("2026-10-02", NOW)).toBe("hari ini");
    expect(fmtRelativeDayMs("2026-10-03", NOW)).toBe("esok");
    expect(fmtRelativeDayMs("2026-10-04", NOW)).toBe("lusa");
    expect(fmtRelativeDayMs("2026-10-06", NOW)).toBe("Selasa 6 Okt");
  });

  it("every fixed reply exists in both languages", () => {
    expect(Object.keys(FIXED.ms).sort()).toEqual(Object.keys(FIXED.en).sort());
  });
});

describe("other scripts", () => {
  it("spots non-Latin questions so the AI answers in that language", async () => {
    const { hasOtherScript } = await import("./chat-lang");
    expect(hasOtherScript("هل غرفة النقاش أ متاحة؟")).toBe(true);
    expect(hasOtherScript("讨论室A有空吗")).toBe(true);
    expect(hasOtherScript("Is room A free?")).toBe(false);
    expect(hasOtherScript("Bilik A kosong esok?")).toBe(false);
  });
});
