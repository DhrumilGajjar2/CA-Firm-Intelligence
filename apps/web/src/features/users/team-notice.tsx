"use client";

import { CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Outcome of an action, shown above the tables (the app has no toast component). */
export interface Notice {
  kind: "success" | "error";
  message: string;
}

export function TeamNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  const success = notice.kind === "success";
  return (
    <Alert
      variant={success ? "default" : "destructive"}
      role={success ? "status" : "alert"}
      className="mb-4"
    >
      {success ? <CheckCircle2 aria-hidden /> : null}
      <AlertDescription className={success ? undefined : "flex items-center gap-2"}>
        <span className="flex-1">{notice.message}</span>
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}
