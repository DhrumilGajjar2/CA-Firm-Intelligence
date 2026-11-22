"use client";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api-client";

export function FirmFormSkeleton({ label = "Loading firm details" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-1/3" />
    </div>
  );
}

/** Failed GET (network, 5xx, 403): say what happened and offer a retry. */
export function FirmLoadError({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const forbidden = error instanceof ApiRequestError && error.status === 403;
  const message = forbidden
    ? "You do not have permission to view the firm details."
    : error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>We couldn&apos;t load the firm details</AlertTitle>
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
