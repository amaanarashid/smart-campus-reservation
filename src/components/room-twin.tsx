"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { createTwin, type Twin, type TwinState } from "@/lib/twin-scene";
import FacilityIso from "@/components/facility-iso";

/**
 * React wrapper around the three.js twin. Load it with next/dynamic
 * (ssr: false) so three.js is only downloaded when a facility is opened.
 */
export default function RoomTwin({ type, capacity, state }: {
  type: string; capacity: number; state: TwinState;
}) {
  const host = useRef<HTMLDivElement>(null);
  const twin = useRef<Twin | null>(null);
  const firstUpdate = useRef(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let t: Twin | null = null;
    try {
      t = createTwin(host.current, { type, capacity });
    } catch {
      // no WebGL (old browser, disabled GPU): fall back to the 2.5D picture
      queueMicrotask(() => setFailed(true));
      return;
    }
    twin.current = t;
    firstUpdate.current = true;
    return () => { t?.dispose(); twin.current = null; };
  }, [type, capacity]);

  const { lights, ac, people, doorOpen, unlocked, status } = state;
  useEffect(() => {
    // the first reading snaps into place; later changes ease in
    twin.current?.update({ lights, ac, people, doorOpen, unlocked, status }, firstUpdate.current);
    firstUpdate.current = false;
  }, [type, capacity, lights, ac, people, doorOpen, unlocked, status]);

  if (failed) {
    return (
      <div className="relative h-full w-full">
        <FacilityIso type={type} busy={status === "in_use"} />
        <p className="absolute bottom-3 left-3 rounded-full bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow">
          3D needs WebGL - showing the 2D view
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-card/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        Drag to rotate · scroll to zoom
      </div>
      <button onClick={() => twin.current?.resetView()} title="Reset view"
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow transition-colors hover:text-foreground">
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );
}
