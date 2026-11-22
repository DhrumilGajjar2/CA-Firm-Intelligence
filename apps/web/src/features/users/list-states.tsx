"use client";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage, isStatus } from "@/lib/error-message";

export function ListSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Failed list request: say what happened (403 gets its own wording) and offer a retry. */
export function ListError({
  title,
  error,
  onRetry,
  retrying,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const message = isStatus(error, 403)
    ? "You do not have permission to view this."
    : getErrorMessage(error);
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
