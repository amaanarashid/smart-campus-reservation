/**
 * Flat 2D picture of a campus venue, picked from its name and the kinds of
 * facility inside: a sports hall, a library, an office/teaching block, or a
 * generic building. Pure SVG drawn with the theme tokens, so it follows light
 * and dark mode. `busy` lights the windows/entrance crimson.
 */
export type VenueKind = "sports" | "library" | "block" | "generic";

const SPORT_TYPES = ["badminton", "futsal", "basketball", "tennis", "volleyball", "squash", "football", "netball", "gym", "swimming"];

export function venueKind(name: string, types: string[] = []): VenueKind {
  const n = name.toLowerCase();
  if (/sport|complex|arena|stadium|gym|court|field|pool|dewan sukan/.test(n)) return "sports";
  if (/librar|perpustakaan|learning|study/.test(n)) return "library";
  if (/block|blok|building|wing|tower|bangunan|level|floor/.test(n)) return "block";
  if (types.some((t) => SPORT_TYPES.some((s) => t.includes(s)))) return "sports";
  if (types.some((t) => /discussion|study/.test(t))) return "library";
  if (types.some((t) => /meeting|event|seminar|lecture|lab/.test(t))) return "block";
  return "generic";
}

/** "Block A" -> "A", "Blok 3" -> "3". */
function blockLabel(name: string): string | null {
  const m = name.match(/\b(?:block|blok|building|wing|tower)\s+([A-Z0-9]{1,3})\b/i);
  return m ? m[1].toUpperCase() : null;
}

const C = {
  sky: "var(--muted)",
  ground: "var(--border)",
  wall: "color-mix(in oklch, var(--card) 86%, var(--foreground))",
  line: "var(--muted-foreground)",
  accent: "var(--primary)",
  glass: "var(--accent)",
  grass: "color-mix(in oklch, var(--chart-4) 55%, var(--card))",
};

function Tree({ x, y = 112, s = 1 }: { x: number; y?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-1.5} y={-10} width={3} height={10} fill={C.line} opacity={0.5} />
      <circle cx={0} cy={-16} r={9} fill={C.grass} />
    </g>
  );
}

function Sports({ busy }: { busy: boolean }) {
  return (
    <g>
      {/* court in front */}
      <rect x={14} y={114} width={212} height={18} rx={2} fill={C.grass} opacity={0.7} />
      <rect x={30} y={117} width={180} height={12} fill="none" stroke={C.wall} strokeWidth={1} opacity={0.9} />
      <line x1={120} y1={117} x2={120} y2={129} stroke={C.wall} strokeWidth={1} opacity={0.9} />
      <circle cx={120} cy={123} r={3} fill="none" stroke={C.wall} strokeWidth={1} opacity={0.9} />
      {/* hall with arched roof */}
      <path d="M40 112 V66 Q120 22 200 66 V112 Z" fill={C.wall} stroke={C.line} strokeOpacity={0.35} strokeWidth={1.2} />
      <path d="M40 66 Q120 22 200 66" fill="none" stroke={C.accent} strokeWidth={4} strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${64 + i * 28} 60 Q${64 + i * 28} 52 ${64 + i * 28} 44`} stroke={C.line} strokeOpacity={0.15} strokeWidth={1} />
      ))}
      {/* windows band */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={52 + i * 24} y={72} width={16} height={10} rx={1.5}
          fill={busy && i % 2 === 0 ? C.accent : C.glass} opacity={busy && i % 2 === 0 ? 0.85 : 1} />
      ))}
      {/* entrance + sign */}
      <rect x={104} y={90} width={32} height={22} rx={2} fill={busy ? C.accent : C.glass} />
      <line x1={120} y1={90} x2={120} y2={112} stroke={C.wall} strokeWidth={1.2} />
      <rect x={94} y={62} width={52} height={8} rx={4} fill={C.accent} />
      {/* ball on the sign */}
      <circle cx={186} cy={36} r={8} fill={C.accent} opacity={0.9} />
      <path d="M178 36 H194 M186 28 V44 M180.5 30.5 Q186 36 180.5 41.5 M191.5 30.5 Q186 36 191.5 41.5" stroke={C.wall} strokeWidth={1} fill="none" />
      {/* flag */}
      <line x1={52} y1={58} x2={52} y2={34} stroke={C.line} strokeOpacity={0.6} strokeWidth={1.2} />
      <path d="M52 34 L66 38 L52 42 Z" fill={C.accent} />
      <Tree x={24} /><Tree x={216} s={0.85} />
    </g>
  );
}

function Library({ busy }: { busy: boolean }) {
  return (
    <g>
      {/* steps */}
      <rect x={52} y={106} width={136} height={6} fill={C.line} opacity={0.2} />
      <rect x={44} y={112} width={152} height={6} fill={C.line} opacity={0.14} />
      {/* body */}
      <rect x={60} y={58} width={120} height={48} fill={C.wall} stroke={C.line} strokeOpacity={0.35} strokeWidth={1.2} />
      {/* pediment */}
      <path d="M52 58 L120 26 L188 58 Z" fill={C.wall} stroke={C.line} strokeOpacity={0.35} strokeWidth={1.2} />
      <path d="M66 54 L120 32 L174 54 Z" fill={C.accent} opacity={0.9} />
      {/* open book in the pediment */}
      <path d="M108 47 Q114 43 120 46 Q126 43 132 47 V50 Q126 47 120 50 Q114 47 108 50 Z" fill={C.wall} />
      {/* columns */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={68 + i * 24} y={62} width={8} height={42} fill={C.sky} stroke={C.line} strokeOpacity={0.25} />
          <rect x={66 + i * 24} y={60} width={12} height={3} fill={C.line} opacity={0.3} />
        </g>
      ))}
      {/* door + windows between columns */}
      <rect x={112} y={80} width={16} height={24} rx={8} fill={busy ? C.accent : C.glass} />
      {[0, 1, 3].map((i) => (
        <rect key={i} x={79 + i * 24} y={72} width={10} height={14} rx={5} fill={busy && i === 1 ? C.accent : C.glass} />
      ))}
      <rect x={60} y={56} width={120} height={3} fill={C.accent} />
      <Tree x={30} /><Tree x={210} /><Tree x={222} s={0.7} />
    </g>
  );
}

function Block({ busy, label }: { busy: boolean; label: string | null }) {
  const rows = 5, cols = 5;
  return (
    <g>
      {/* low wing */}
      <rect x={146} y={78} width={58} height={34} fill={C.wall} stroke={C.line} strokeOpacity={0.3} strokeWidth={1.2} />
      {[0, 1, 2].map((i) => <rect key={i} x={154 + i * 16} y={88} width={10} height={8} rx={1} fill={C.glass} />)}
      {/* tower */}
      <rect x={70} y={24} width={80} height={88} fill={C.wall} stroke={C.line} strokeOpacity={0.35} strokeWidth={1.2} />
      <rect x={70} y={24} width={80} height={6} fill={C.accent} />
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((__, c) => {
          const lit = busy && (r * cols + c) % 4 === 1;
          return <rect key={`${r}-${c}`} x={78 + c * 14} y={36 + r * 12} width={9} height={7} rx={1}
            fill={lit ? C.accent : C.glass} opacity={lit ? 0.9 : 1} />;
        }))}
      {/* entrance canopy */}
      <rect x={98} y={98} width={24} height={14} fill={busy ? C.accent : C.glass} />
      <rect x={92} y={95} width={36} height={4} rx={1} fill={C.accent} />
      {/* block letter badge */}
      {label && (
        <g>
          <circle cx={110} cy={14} r={11} fill={C.accent} />
          <text x={110} y={18.5} textAnchor="middle" fontSize={label.length > 1 ? 10 : 13} fontWeight={700}
            fill="var(--primary-foreground)" fontFamily="inherit">{label}</text>
        </g>
      )}
      <Tree x={40} /><Tree x={54} s={0.75} /><Tree x={216} />
    </g>
  );
}

function Generic({ busy }: { busy: boolean }) {
  return (
    <g>
      <rect x={60} y={56} width={120} height={56} fill={C.wall} stroke={C.line} strokeOpacity={0.35} strokeWidth={1.2} />
      <path d="M52 58 H188 L172 40 H68 Z" fill={C.accent} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={72 + i * 26} y={68} width={16} height={12} rx={1.5} fill={C.glass} />)}
      <rect x={108} y={88} width={24} height={24} rx={2} fill={busy ? C.accent : C.glass} />
      <Tree x={30} /><Tree x={210} />
    </g>
  );
}

export default function VenueArt({ name, types = [], busy = false, className = "" }: {
  name: string; types?: string[]; busy?: boolean; className?: string;
}) {
  const kind = venueKind(name, types);
  return (
    <svg viewBox="0 0 240 140" className={`h-full w-full ${className}`} role="img"
      aria-label={`${name} (${kind === "generic" ? "building" : kind === "block" ? "teaching block" : kind === "sports" ? "sports hall" : "library"})`}>
      <rect width={240} height={140} fill={C.sky} opacity={0.6} />
      <circle cx={30} cy={26} r={10} fill={C.accent} opacity={0.12} />
      <rect x={0} y={112} width={240} height={28} fill={C.ground} opacity={0.5} />
      {kind === "sports" && <Sports busy={busy} />}
      {kind === "library" && <Library busy={busy} />}
      {kind === "block" && <Block busy={busy} label={blockLabel(name)} />}
      {kind === "generic" && <Generic busy={busy} />}
    </svg>
  );
}
