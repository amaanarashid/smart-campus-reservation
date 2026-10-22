import { daysBetween, fmtTime, myAt, myDateKey } from "./time";

/**
 * Chatbot language: English or Bahasa Melayu. The assistant answers in the
 * language the student writes in. Detection is a small word list (no
 * external service), so it works offline and is unit-tested; a question with
 * no language clues (e.g. "Court 1?") keeps the language of the conversation.
 */
export type Lang = "en" | "ms";

// common Malay words that are not English words (and the reverse). Facility
// names ("court", "room") are left out: Malay speakers use them too.
const MS_WORDS = [
  "saya", "aku", "boleh", "tak", "tidak", "ada", "kosong", "esok", "lusa", "hari", "ini", "bilik", "gelanggang",
  "dewan", "tempah", "tempahan", "bila", "berapa", "pukul", "jam", "peraturan", "apa", "mana", "untuk", "dengan",
  "nak", "mahu", "ke", "kah", "pagi", "petang", "malam", "minggu", "depan", "isnin", "selasa", "rabu", "khamis",
  "jumaat", "sabtu", "ahad", "kemudahan", "senarai", "tersedia", "penuh", "sibuk", "batal", "buka", "tutup",
  "terima", "kasih", "tolong", "sila", "orang", "seterusnya", "perbincangan", "mesyuarat", "lama", "minit", "sejam",
  "yang", "dan", "atau", "pada", "di", "tu", "itu", "lah",
];
const EN_WORDS = [
  "the", "is", "are", "can", "i", "my", "free", "available", "tomorrow", "today", "when", "what", "which", "book",
  "booking", "bookings", "rules", "at", "for", "next", "how", "long", "open", "please", "any",
  "there", "do", "have", "will", "evening", "morning", "afternoon", "and", "or", "to", "on", "show", "list",
];

export function detectLanguage(q: string): { lang: Lang; confident: boolean } {
  const words = q.toLowerCase().match(/[a-z]+/g) ?? [];
  let ms = 0, en = 0;
  for (const w of words) {
    if (MS_WORDS.includes(w)) ms++;
    if (EN_WORDS.includes(w)) en++;
  }
  if (ms === 0 && en === 0) return { lang: "en", confident: false };
  return { lang: ms > en ? "ms" : "en", confident: Math.abs(ms - en) >= 1 };
}

/** Language for this turn: the question's, or the conversation's if the question gives no clue. */
export function replyLanguage(q: string, earlierUserMessages: string[]): Lang {
  const cur = detectLanguage(q);
  if (cur.confident) return cur.lang;
  for (const m of [...earlierUserMessages].reverse()) {
    const d = detectLanguage(m);
    if (d.confident) return d.lang;
  }
  return cur.lang;
}

// ------------------------------------------------------------ formatting --
const DAYS_MS = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
const MONTHS_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];

/** "3:00 petang", "10:30 pagi", "8:00 malam", "12:00 tengah hari" (Malaysia time). */
export function fmtTimeMs(d: Date): string {
  const en = fmtTime(d);                       // "3:00 pm" in Malaysia time
  const [hm, ap] = en.split(" ");
  const h12 = Number(hm.split(":")[0]);
  const h24 = ap === "am" ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);
  const part = h24 < 12 ? "pagi" : h24 < 14 ? "tengah hari" : h24 < 19 ? "petang" : "malam";
  return `${hm} ${part}`;
}

/** "hari ini", "esok", "lusa", or "Jumaat 2 Okt". */
export function fmtRelativeDayMs(dateKey: string, now: Date): string {
  const diff = daysBetween(myDateKey(now), dateKey);
  if (diff === 0) return "hari ini";
  if (diff === 1) return "esok";
  if (diff === 2) return "lusa";
  const d = myAt(dateKey, "12:00");
  const w = new Date(d.getTime() + 8 * 3_600_000);
  return `${DAYS_MS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS_MS[w.getUTCMonth()]}`;
}

/** The recommender's English reasons, in Malay. */
export const REASON_MS: Record<string, string> = {
  "close to your preferred time": "dekat dengan masa pilihan anda",
  "good fit for your group size": "sesuai dengan saiz kumpulan anda",
  "off-peak, likely quieter": "luar waktu puncak, mungkin lebih lengang",
  "same type of facility": "kemudahan jenis yang sama",
  "nearest day with space": "hari terdekat yang masih ada ruang",
};
export const PART_MS = { morning: "pagi", afternoon: "petang", evening: "malam" } as const;

/** Fixed replies that are not built from data. */
export const FIXED: Record<Lang, Record<"invalid" | "ask" | "signIn" | "slow" | "expired" | "offTopic" | "none" | "noFacilities", string>> = {
  en: {
    invalid: "Invalid request.",
    ask: "Ask me about facility availability, rules, or your bookings.",
    signIn: "Please sign in to use the assistant.",
    slow: "You're sending messages quickly - give me a few seconds and try again.",
    expired: "Your session has expired - please sign in again.",
    offTopic: "I can help with facility availability, booking rules, and your own bookings. For anything else (payments, lost property, complaints), please contact the campus service desk.",
    none: "You have no upcoming bookings.",
    noFacilities: "No facilities are open for booking right now.",
  },
  ms: {
    invalid: "Permintaan tidak sah.",
    ask: "Tanya saya tentang kekosongan kemudahan, peraturan tempahan, atau tempahan anda.",
    signIn: "Sila log masuk untuk menggunakan pembantu ini.",
    slow: "Anda menghantar mesej terlalu cepat - tunggu beberapa saat dan cuba lagi.",
    expired: "Sesi anda telah tamat - sila log masuk semula.",
    offTopic: "Saya boleh membantu tentang kekosongan kemudahan, peraturan tempahan dan tempahan anda sendiri. Untuk perkara lain (bayaran, barang hilang, aduan), sila hubungi kaunter perkhidmatan kampus.",
    none: "Anda tiada tempahan akan datang.",
    noFacilities: "Tiada kemudahan yang dibuka untuk tempahan sekarang.",
  },
};

/**
 * True when the question is written in a non-Latin script (Arabic, Chinese,
 * Tamil, Hindi, Japanese, Korean, Thai, Cyrillic ...). The facts are then
 * built in English and the AI phrases the answer in the student's language.
 * Without an AI key the answer stays in English.
 */
export function hasOtherScript(q: string): boolean {
  return /[Ѐ-ӿ֐-ࣿऀ-෿฀-໿぀-ヿ㐀-鿿가-힯]/.test(q);
}
