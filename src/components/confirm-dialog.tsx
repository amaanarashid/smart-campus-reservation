"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Ask { title: string; body: ReactNode; action: string; destructive?: boolean }

/**
 * An in-page "Are you sure?" instead of window.confirm(), which freezes the
 * page until it is answered (browsers then report a slow click, INP).
 *
 *   const [confirmDialog, confirm] = useConfirm();
 *   if (!(await confirm({ title: "Delete room?", body: "...", action: "Delete", destructive: true }))) return;
 *   ...
 *   return <>{confirmDialog} ...</>;
 */
export function useConfirm() {
  const [ask, setAsk] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = (a: Ask) => new Promise<boolean>((resolve) => {
    // open on the next tick: when asked from a dropdown menu item, the menu
    // finishes closing first and does not leave the page unclickable
    setTimeout(() => setAsk({ ...a, resolve }), 0);
  });
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  const dialog = (
    <Dialog open={!!ask} onOpenChange={(open) => { if (!open) answer(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{ask?.title}</DialogTitle>
          <DialogDescription>{ask?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>Cancel</Button>
          <Button variant={ask?.destructive ? "destructive" : "default"} onClick={() => answer(true)} autoFocus>
            {ask?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [dialog, confirm] as const;
}
