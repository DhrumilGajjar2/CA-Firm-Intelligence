"use client";

import { cn } from "cn";
import { useApiHealth } from "@/features/system/use-api-health";

/** Small connectivity indicator for the header: shows whether the API (and its database) is reachable. */
export function ApiStatus() {
  const { isPending, isError, error } = useApiHealth();

  const state = isPending ? "checking" : isError ? "offline" : "online";
  const label = {
    checking: "Checking API…",
    offline: "API offline",
    online: "API online",
  }[state];

  return (
    <span
      role="status"
      title={isError ? error.message : undefined}
      className="text-muted-foreground flex items-center gap-1.5 text-xs"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "online" && "bg-green-500",
          state === "offline" && "bg-destructive",
          state === "checking" && "bg-muted-foreground/50",
        )}
      />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </span>
  );
}
