"use client";

/**
 * Isometric 2.5D illustrations for facilities, tinted by live status.
 *
 * Admins can invent any facility type, so the artwork is chosen by keyword
 * matching on the type name rather than a fixed list: "Olympic Swimming Pool"
 * and "pool_lane_1" both resolve to the pool scene. Anything unmatched gets a
 * neutral room-with-door scene instead of an empty placeholder.
 *
 * Pure inline SVG - no assets, instant load, theme-aware.
 */

type Scene = "room" | "court" | "net_court" | "hall" | "pool" | "gym" | "generic";

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

export default function FacilityIso({
  type,
  busy,
}: {
  type: string;
  busy: boolean;
}) {
  const scene = resolveScene(type);

  const floor = busy ? "#fee2e2" : "#dcfce7";
  const floorSide = busy ? "#fecaca" : "#bbf7d0";
  const accent = busy ? "#dc2626" : "#16a34a";
  const wall = "#e7e5e4";
  const wallDark = "#d6d3d1";

  const Base = ({ children }: { children: React.ReactNode }) => (
    <svg viewBox="0 0 200 140" className="h-full w-full" aria-hidden>
      <polygon points="100,30 190,75 100,120 10,75" fill={floor} />
      <polygon points="10,75 100,120 100,132 10,87" fill={floorSide} />
      <polygon points="190,75 100,120 100,132 190,87" fill={floorSide} opacity="0.7" />
      {children}
      <circle cx="182" cy="20" r="6" fill={accent}>
        {!busy && <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
      </circle>
    </svg>
  );

  switch (scene) {
    case "room":
      return (
        <Base>
          <polygon points="100,30 10,75 10,45 100,0" fill={wall} />
          <polygon points="100,30 190,75 190,45 100,0" fill={wallDark} />
          <polygon points="100,55 140,75 100,95 60,75" fill="#a16207" />
          <polygon points="60,75 100,95 100,102 60,82" fill="#854d0e" />
          <polygon points="140,75 100,95 100,102 140,82" fill="#713f12" />
          {[[52, 62], [74, 51], [126, 51], [148, 62], [74, 99], [126, 99]].map(([x, y], i) => (
            <ellipse key={i} cx={x} cy={y} rx="7" ry="4.5" fill="#57534e" />
          ))}
          <polygon points="120,12 158,31 158,49 120,30" fill="#1c1917" />
          <polygon points="123,16 154,32 154,45 123,29" fill={busy ? "#7f1d1d" : "#166534"} />
        </Base>
      );

    case "court":
      return (
        <Base>
          <polygon points="100,38 175,75 100,112 25,75" fill="none" stroke="#ffffff" strokeWidth="2.5" />
          <ellipse cx="100" cy="75" rx="22" ry="11" fill="none" stroke="#ffffff" strokeWidth="2.5" />
          <line x1="100" y1="38" x2="100" y2="112" stroke="#ffffff" strokeWidth="2" opacity="0.7" />
          <polygon points="25,63 25,75 40,82 40,70" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="175,63 175,75 160,82 160,70" fill="none" stroke={accent} strokeWidth="2.5" />
          <circle cx="112" cy="70" r="5" fill="#f59e0b" />
        </Base>
      );

    case "net_court":
      return (
        <Base>
          <polygon points="100,42 168,75 100,108 32,75" fill="none" stroke="#ffffff" strokeWidth="2.5" />
          <line x1="66" y1="58" x2="134" y2="92" stroke="#44403c" strokeWidth="1.5" />
          <line x1="66" y1="50" x2="134" y2="84" stroke="#44403c" strokeWidth="1.5" />
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1={66 + i * 9.7} y1={50 + i * 4.85} x2={66 + i * 9.7} y2={58 + i * 4.85}
              stroke="#78716c" strokeWidth="1" />
          ))}
          <ellipse cx="80" cy="90" rx="7" ry="4" fill="none" stroke={accent} strokeWidth="2" />
          <line x1="86" y1="93" x2="94" y2="98" stroke={accent} strokeWidth="2" />
          <circle cx="122" cy="62" r="3.5" fill="#fafaf9" stroke="#a8a29e" />
        </Base>
      );

    case "hall":
      return (
        <Base>
          <polygon points="100,30 10,75 10,40 100,-5" fill={wall} />
          <polygon points="100,30 190,75 190,40 100,-5" fill={wallDark} />
          <polygon points="100,18 145,40 100,62 55,40" fill="#7c2d12" />
          <polygon points="55,40 100,62 100,70 55,48" fill="#5c1f0c" />
          <polygon points="145,40 100,62 100,70 145,48" fill="#431407" />
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <ellipse key={`${row}-${col}`}
                cx={62 + col * 22 + row * 8} cy={82 + row * 10 - col * 2.5}
                rx="6" ry="4" fill="#57534e" />
            ))
          )}
          <polygon points="100,8 88,26 112,26" fill={busy ? "#fca5a5" : "#fde68a"} opacity="0.6" />
        </Base>
      );

    case "pool":
      return (
        <Base>
          {/* water */}
          <polygon points="100,40 172,76 100,112 28,76" fill="#7dd3fc" />
          <polygon points="100,46 162,76 100,106 38,76" fill="#38bdf8" />
          {/* lane ropes */}
          {[-1, 0, 1].map((k, i) => (
            <line key={i}
              x1={70 + k * 14} y1={61 + k * 7} x2={130 + k * 14} y2={91 + k * 7}
              stroke="#ffffff" strokeWidth="1.6" opacity="0.85" strokeDasharray="4 3" />
          ))}
          {/* ladder + diving block */}
          <polygon points="28,76 34,73 34,79 28,82" fill={accent} />
          <polygon points="166,72 174,68 174,76 166,80" fill="#e7e5e4" stroke="#a8a29e" strokeWidth="0.8" />
        </Base>
      );

    case "gym":
      return (
        <Base>
          <polygon points="100,30 10,75 10,48 100,3" fill={wall} />
          <polygon points="100,30 190,75 190,48 100,3" fill={wallDark} />
          {/* bench */}
          <polygon points="72,74 100,88 88,94 60,80" fill="#44403c" />
          <line x1="66" y1="82" x2="66" y2="92" stroke="#57534e" strokeWidth="2.5" />
          <line x1="94" y1="90" x2="94" y2="100" stroke="#57534e" strokeWidth="2.5" />
          {/* barbell */}
          <line x1="58" y1="70" x2="102" y2="92" stroke="#78716c" strokeWidth="2.5" />
          <circle cx="58" cy="70" r="5.5" fill="#1c1917" />
          <circle cx="102" cy="92" r="5.5" fill="#1c1917" />
          {/* rack */}
          <polygon points="118,60 142,72 142,92 118,80" fill="none" stroke={accent} strokeWidth="2" />
          <line x1="118" y1="70" x2="142" y2="82" stroke={accent} strokeWidth="1.6" />
          {/* dumbbells */}
          <circle cx="126" cy="98" r="4" fill="#57534e" />
          <circle cx="136" cy="103" r="4" fill="#57534e" />
        </Base>
      );

    default:
      // neutral space: walls, a door and a window - reads as "a facility"
      return (
        <Base>
          <polygon points="100,30 10,75 10,45 100,0" fill={wall} />
          <polygon points="100,30 190,75 190,45 100,0" fill={wallDark} />
          {/* door */}
          <polygon points="52,58 72,47 72,72 52,83" fill="#a16207" />
          <circle cx="68" cy="61" r="1.8" fill="#fde68a" />
          {/* window */}
          <polygon points="120,32 152,48 152,66 120,50" fill={busy ? "#fca5a5" : "#bae6fd"} />
          <line x1="136" y1="40" x2="136" y2="58" stroke="#ffffff" strokeWidth="1.2" />
          {/* floor marker */}
          <ellipse cx="110" cy="88" rx="26" ry="13" fill="none" stroke={accent} strokeWidth="2" strokeDasharray="5 4" />
        </Base>
      );
  }
}
