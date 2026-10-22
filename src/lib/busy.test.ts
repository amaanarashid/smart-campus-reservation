import { describe, it, expect, beforeEach } from "vitest";
import { busyQuery, isMissingRelation, resetBusyFallback, BUSY_VIEW } from "./busy";

describe("free/busy reads", () => {
  beforeEach(() => resetBusyFallback());

  it("reads the private-safe view when it exists", async () => {
    const asked: string[] = [];
    const r = await busyQuery(async (t) => { asked.push(t); return { data: [1], error: null }; });
    expect(asked).toEqual([BUSY_VIEW]);
    expect(r.data).toEqual([1]);
  });

  it("falls back to the table once if the migration has not run, then remembers", async () => {
    const asked: string[] = [];
    const run = async (t: string) => {
      asked.push(t);
      return t === BUSY_VIEW
        ? { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.reservation_busy' in the schema cache" } }
        : { data: [2], error: null };
    };
    expect((await busyQuery(run)).data).toEqual([2]);
    expect((await busyQuery(run)).data).toEqual([2]);
    expect(asked).toEqual([BUSY_VIEW, "reservations", "reservations"]);
  });

  it("does not hide real errors behind the fallback", async () => {
    const r = await busyQuery(async () => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    expect(r.error?.code).toBe("42501");
    expect(isMissingRelation({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isMissingRelation({ message: "permission denied" })).toBe(false);
  });
});
