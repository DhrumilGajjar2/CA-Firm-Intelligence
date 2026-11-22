"use client";

import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Label while the request is running. */
  pendingLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  confirmDisabled?: boolean;
  /** Inline error from the failed attempt; the dialog stays open so the user can retry or cancel. */
  error?: string | null;
  onConfirm: () => void;
  /** Extra controls between the description and the buttons (e.g. a role select). */
  children?: ReactNode;
}

/** Confirm step for risky actions. It cannot be dismissed while the request is in flight. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  destructive,
  pending,
  confirmDisabled,
  error,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancel
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
