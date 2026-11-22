"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Full-screen placeholder shown while the session is being resolved (no protected content). */
export function AuthLoading({ label = "Loading your workspace" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-3"
    >
      <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden />
      <p className="text-muted-foreground text-sm">{label}…</p>
    </div>
  );
}

/** Placeholder card used inside the auth layout while the session is being resolved. */
export function AuthCardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/** Server/network failure while resolving the session: offer a retry instead of redirecting. */
export function AuthError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertCircle className="text-destructive size-8" aria-hidden />
      <div role="alert" className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">We couldn&apos;t load your session</h1>
        <p className="text-muted-foreground max-w-sm text-sm">{message}</p>
      </div>
      <Button onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
