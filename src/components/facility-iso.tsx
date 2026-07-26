"use client";

import { Facility } from "@/lib/types";

/**
 * Isometric 2.5D illustrations per facility type, tinted by live status.
 * Pure inline SVG - no assets, instant load, theme-aware.
 */
export default function FacilityIso({
  type,
  busy,
}: {
  type: Facility["type"];
  busy: boolean;
}) {
  const floor = busy ? "#fee2e2" : "#dcfce7";
  const floorSide = busy ? "#fecaca" : "#bbf7d0";
  const accent = busy ? "#dc2626" : "#16a34a";
  const wall = "#e7e5e4";
  const wallDark = "#d6d3d1";

  const Base = ({ children }: { children: React.ReactNode }) => (
    <svg viewBox="0 0 200 140" className="h-full w-full" aria-hidden>
      {/* floor diamond */}
      <polygon points="100,30 190,75 100,120 10,75" fill={floor} />
      <polygon points="10,75 100,120 100,132 10,87" fill={floorSide} />
      <polygon points="190,75 100,120 100,132 190,87" fill={floorSide} opacity="0.7" />
      {children}
      {/* status lamp */}
      <circle cx="182" cy="20" r="6" fill={accent}>
        {!busy && <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
      </circle>
    </svg>
  );

  switch (type) {
    case "discussion_room":
    case "meeting_room":
      return (
        <Base>
          {/* back walls */}
          <polygon points="100,30 10,75 10,45 100,0" fill={wall} />
          <polygon points="100,30 190,75 190,45 100,0" fill={wallDark} />
          {/* table */}
          <polygon points="100,55 140,75 100,95 60,75" fill="#a16207" />
          <polygon points="60,75 100,95 100,102 60,82" fill="#854d0e" />
          <polygon points="140,75 100,95 100,102 140,82" fill="#713f12" />
          {/* chairs */}
          {[[52, 62], [74, 51], [126, 51], [148, 62], [74, 99], [126, 99]].map(([x, y], i) => (
            <ellipse key={i} cx={x} cy={y} rx="7" ry="4.5" fill="#57534e" />
          ))}
          {/* screen on wall */}
          <polygon points="120,12 158,31 158,49 120,30" fill="#1c1917" />
          <polygon points="123,16 154,32 154,45 123,29" fill={busy ? "#7f1d1d" : "#166534"} />
        </Base>
      );
    case "futsal":
    case "basketball":
      return (
        <Base>
          {/* court markings */}
          <polygon points="100,38 175,75 100,112 25,75" fill="none" stroke="#ffffff" strokeWidth="2.5" />
          <ellipse cx="100" cy="75" rx="22" ry="11" fill="none" stroke="#ffffff" strokeWidth="2.5" />
          <line x1="100" y1="38" x2="100" y2="112" stroke="#ffffff" strokeWidth="2" opacity="0.7" />
          {/* goals / hoops */}
          <polygon points="25,63 25,75 40,82 40,70" fill="none" stroke={accent} strokeWidth="2.5" />
          <polygon points="175,63 175,75 160,82 160,70" fill="none" stroke={accent} strokeWidth="2.5" />
          {/* ball */}
          <circle cx="112" cy="70" r="5" fill="#f59e0b" />
        </Base>
      );
    case "badminton":
      return (
        <Base>
          <polygon points="100,42 168,75 100,108 32,75" fill="none" stroke="#ffffff" strokeWidth="2.5" />
          {/* net across the middle */}
          <line x1="66" y1="58" x2="134" y2="92" stroke="#44403c" strokeWidth="1.5" />
          <line x1="66" y1="50" x2="134" y2="84" stroke="#44403c" strokeWidth="1.5" />
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1={66 + i * 9.7} y1={50 + i * 4.85} x2={66 + i * 9.7} y2={58 + i * 4.85}
              stroke="#78716c" strokeWidth="1" />
          ))}
          {/* racket + shuttle */}
          <ellipse cx="80" cy="90" rx="7" ry="4" fill="none" stroke={accent} strokeWidth="2" />
          <line x1="86" y1="93" x2="94" y2="98" stroke={accent} strokeWidth="2" />
          <circle cx="122" cy="62" r="3.5" fill="#fafaf9" stroke="#a8a29e" />
        </Base>
      );
    case "event_hall":
      return (
        <Base>
          {/* back walls */}
          <polygon points="100,30 10,75 10,40 100,-5" fill={wall} />
          <polygon points="100,30 190,75 190,40 100,-5" fill={wallDark} />
          {/* stage */}
          <polygon points="100,18 145,40 100,62 55,40" fill="#7c2d12" />
          <polygon points="55,40 100,62 100,70 55,48" fill="#5c1f0c" />
          <polygon points="145,40 100,62 100,70 145,48" fill="#431407" />
          {/* seat rows */}
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <ellipse key={`${row}-${col}`}
                cx={62 + col * 22 + row * 8} cy={82 + row * 10 - col * 2.5}
                rx="6" ry="4" fill="#57534e" />
            ))
          )}
          {/* spotlight */}
          <polygon points="100,8 88,26 112,26" fill={busy ? "#fca5a5" : "#fde68a"} opacity="0.6" />
        </Base>
      );
    default:
      return (
        <Base>
          <polygon points="100,45 160,75 100,105 40,75" fill="none" stroke={accent} strokeWidth="2.5" />
        </Base>
      );
  }
}
