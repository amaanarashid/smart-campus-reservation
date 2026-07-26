"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error occurred. Try again, or sign out and back in. If it keeps
        happening, contact the administrator.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/")}>Go home</Button>
      </div>
      {process.env.NODE_ENV === "development" && (
        <pre className="max-w-lg overflow-auto rounded bg-muted p-3 text-left text-xs">{error.message}</pre>
      )}
    </div>
  );
}
