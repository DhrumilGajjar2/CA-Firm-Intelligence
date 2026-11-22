"use client";

import { useState } from "react";
import type { FirmUser } from "@ca-firm/shared-types";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { SelectInput } from "@/components/forms/native-controls";
import { Label } from "@/components/ui/label";
import { getErrorMessage, isStatus } from "@/lib/error-message";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type AssignableRole } from "@/lib/roles";
import type { Notice } from "./team-notice";
import { useUserActions } from "./use-users";

export type UserAction =
  { type: "role"; user: FirmUser } | { type: "status"; user: FirmUser };

interface DialogProps {
  user: FirmUser;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}

/** Message for a target that changed or vanished while the dialog was open. */
function staleMessage(error: unknown): string {
  return isStatus(error, 404)
    ? "That user is no longer part of your firm. The list has been refreshed."
    : `${getErrorMessage(error)} The list has been refreshed.`;
}

export function UserActionDialog({
  action,
  ...rest
}: { action: UserAction } & Omit<DialogProps, "user">) {
  return action.type === "role" ? (
    <RoleDialog user={action.user} {...rest} />
  ) : (
    <StatusDialog user={action.user} {...rest} />
  );
}

function RoleDialog({ user, onClose, onNotice }: DialogProps) {
  const { changeRole } = useUserActions();
  const [role, setRole] = useState<AssignableRole>(
    user.role === "owner" ? "employee" : user.role,
  );

  const confirm = () =>
    changeRole.mutate(
      { id: user.id, role },
      {
        onSuccess: () => {
          onNotice({
            kind: "success",
            message: `${user.name} is now ${ROLE_LABELS[role]}.`,
          });
          onClose();
        },
        onError: (error) => {
          if (isStatus(error, 404, 409)) {
            onNotice({ kind: "error", message: staleMessage(error) });
            onClose();
          }
        },
      },
    );

  const inlineError =
    changeRole.error && !isStatus(changeRole.error, 404, 409)
      ? getErrorMessage(changeRole.error)
      : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Change role for ${user.name}`}
      description="The new role takes effect immediately."
      confirmLabel="Change role"
      pendingLabel="Saving…"
      pending={changeRole.isPending}
      confirmDisabled={role === user.role}
      error={inlineError}
      onConfirm={confirm}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="change-role">New role</Label>
        <SelectInput
          id="change-role"
          value={role}
          onChange={(e) => setRole(e.target.value as AssignableRole)}
          disabled={changeRole.isPending}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectInput>
      </div>
    </ConfirmDialog>
  );
}

function StatusDialog({ user, onClose, onNotice }: DialogProps) {
  const { setActive } = useUserActions();
  const reactivating = !user.is_active;

  const confirm = () =>
    setActive.mutate(
      { id: user.id, is_active: reactivating },
      {
        onSuccess: () => {
          onNotice({
            kind: "success",
            message: reactivating
              ? `${user.name} has been reactivated.`
              : `${user.name} has been deactivated.`,
          });
          onClose();
        },
        onError: (error) => {
          if (isStatus(error, 404, 409)) {
            onNotice({ kind: "error", message: staleMessage(error) });
            onClose();
          }
        },
      },
    );

  const inlineError =
    setActive.error && !isStatus(setActive.error, 404, 409)
      ? getErrorMessage(setActive.error)
      : null;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={reactivating ? `Reactivate ${user.name}?` : `Deactivate ${user.name}?`}
      description={
        reactivating
          ? "They will be able to sign in again with their existing password."
          : "They will lose access right away and will not be able to sign in. You can reactivate them later."
      }
      confirmLabel={reactivating ? "Reactivate" : "Deactivate"}
      pendingLabel={reactivating ? "Reactivating…" : "Deactivating…"}
      destructive={!reactivating}
      pending={setActive.isPending}
      error={inlineError}
      onConfirm={confirm}
    />
  );
}
