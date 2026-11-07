"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Usb } from "lucide-react";

/**
 * Installs the door firmware on an ESP32 straight from the browser, over USB
 * (Web Serial, Chrome or Edge on a computer). ESP Web Tools does the flashing;
 * the firmware itself is public/firmware/<board>/, refreshed by
 * `pio run -e board` / `pio run -e cam` (firmware/door-wokwi/publish_web.py).
 */
const INSTALLER = "https://unpkg.com/esp-web-tools@10.4.0/dist/web/install-button.js?module";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- how React types custom elements
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": HTMLAttributes<HTMLElement> & { manifest: string };
    }
  }
}

let loading: Promise<void> | null = null;
function loadInstaller(): Promise<void> {
  if (customElements.get("esp-web-install-button")) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = INSTALLER;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; s.remove(); reject(new Error("installer did not load")); };
    document.head.appendChild(s);
  }).then(() => customElements.whenDefined("esp-web-install-button").then(() => undefined));
  return loading;
}

type State = "loading" | "ready" | "unsupported" | "no-firmware" | "failed";

/** onStart runs as the browser's port picker opens: close any modal dialog then. */
export default function FirmwareInstallButton({ manifest, onStart }: { manifest: string; onStart?: () => void }) {
  const [state, setState] = useState<State>("loading");
  const [version, setVersion] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      if (!("serial" in navigator) || !window.isSecureContext) { if (live) setState("unsupported"); return; }
      let info: { version?: string };
      try {
        const r = await fetch(manifest, { cache: "no-store" });
        if (!r.ok) throw new Error("no manifest");
        info = await r.json();
      } catch {
        if (live) setState("no-firmware");
        return;
      }
      if (live) setVersion(info.version ?? "");
      try {
        await loadInstaller();
        if (live) setState("ready");
      } catch {
        if (live) setState("failed");
      }
    })();
    return () => { live = false; };
  }, [manifest]);

  if (state === "unsupported") {
    return <p className="text-muted-foreground">Open this page in <b className="text-foreground">Chrome or Edge on a computer</b> to install from here.</p>;
  }
  if (state === "no-firmware") {
    return (
      <p className="text-muted-foreground">
        No firmware published for this board yet. Build it with PlatformIO (<code className="font-mono">pio run -e board</code> or <code className="font-mono">-e cam</code>), then commit <code className="font-mono">public/firmware</code> and deploy.
      </p>
    );
  }
  if (state === "failed") {
    return (
      <p className="text-muted-foreground">
        The installer could not load (no internet?). Instead, install from VS Code with <code className="font-mono">pio run -e board -t upload</code> (or <code className="font-mono">-e cam</code>).
      </p>
    );
  }
  if (state === "loading") {
    return (
      <Button type="button" size="sm" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Install firmware
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <esp-web-install-button manifest={manifest}>
        {/* type=button: this sits inside the connect form */}
        <Button slot="activate" type="button" size="sm" className="gap-2" onClick={() => onStart?.()}>
          <Usb className="h-4 w-4" /> Install firmware
        </Button>
      </esp-web-install-button>
      {version && <span className="text-muted-foreground">Version {version}</span>}
    </div>
  );
}
