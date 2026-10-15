/**
 * Which picture to draw for a facility type. Admins can invent any type, so
 * this matches keywords rather than a fixed list: "Olympic Swimming Pool" and
 * "pool_lane_1" both resolve to the pool scene. Shared by the 2.5D
 * illustrations (facility-iso.tsx) and the 3D twin (twin-scene.ts).
 */
export type Scene = "room" | "court" | "net_court" | "hall" | "pool" | "gym" | "generic";

const KEYWORDS: [RegExp, Scene][] = [
  [/pool|swim|aquat/, "pool"],
  [/gym|fitness|weight|workout|exercis/, "gym"],
  [/badminton|tennis|squash|volley|net|table.?tennis|ping/, "net_court"],
  [/futsal|foot|soccer|basket|netball|hockey|court|pitch|field|turf|track/, "court"],
  [/hall|auditor|theat|stage|event|ballroom|arena/, "hall"],
  [/room|lab|studio|meeting|discussion|seminar|class|office|library|booth|suite/, "room"],
];

export function resolveScene(type: string): Scene {
  const t = (type || "").toLowerCase().replace(/[_-]+/g, " ");
  for (const [re, scene] of KEYWORDS) if (re.test(t)) return scene;
  return "generic";
}
