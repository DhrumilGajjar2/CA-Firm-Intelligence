"use client";

import { useState } from "react";
import { MailPlus } from "lucide-react";
import {
  INVITATION_STATUSES,
  type Invitation,
  type InvitationStatus,
} from "@ca-firm/shared-types";
import { SelectInput } from "@/components/forms/native-controls";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Pagination } from "@/components/tables/pagination";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { getErrorMessage, isStatus } from "@/lib/error-message";
import { ListError, ListSkeleton } from "./list-states";
import type { Notice } from "./team-notice";
import { InvitationStatusBadge, RoleBadge } from "./user-badges";
import { useInvitationsList, useRevokeInvitation } from "./use-users";
import { metaFor } from "./users-section";

export const INVITATIONS_PAGE_SIZE = 10;

const STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};

/** Owner-only list of invitations (pending by default) with revoke. */
export function InvitationsSection({
  timezone,
  onNotice,
}: {
  timezone: string;
  onNotice: (notice: Notice) => void;
}) {
  const [status, setStatus] = useState<InvitationStatus | "">("pending");
  // Changing the status filter always goes back to page 1 (see UsersSection): the stored key
  // follows the filter, so an earlier page is never restored when a status is revisited.
  const [pageState, setPageState] = useState({ key: "pending", page: 1 });
  if (pageState.key !== status) setPageState({ key: status, page: 1 });
  const page = pageState.key === status ? pageState.page : 1;
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } =
    useInvitationsList({
      page,
      limit: INVITATIONS_PAGE_SIZE,
      status: status || undefined,
    });

  return (
    <section aria-labelledby="invitations-heading" className="mt-10 flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="invitations-heading" className="text-lg font-semibold tracking-tight">
            Invitations
          </h2>
          <p className="text-muted-foreground text-sm">
            Invitations expire after 7 days. Revoke one to stop its link from working.
          </p>
        </div>
        <SelectInput
          aria-label="Filter invitations by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as InvitationStatus | "")}
          className="sm:w-44"
        >
          <option value="">All statuses</option>
          {INVITATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </SelectInput>
      </div>

      {isPending ? (
        <ListSkeleton label="Loading invitations" rows={3} />
      ) : isError || !data ? (
        <ListError
          title="We couldn't load the invitations"
          error={error}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={MailPlus}
          title={
            page > 1
              ? "No invitations on this page"
              : status === "pending"
                ? "No pending invitations"
                : status
                  ? `No ${status} invitations`
                  : "No invitations yet"
          }
          description="Use Invite user to add someone to your firm."
          action={
            page > 1 ? (
              <Button
                variant="outline"
                onClick={() => setPageState({ key: status, page: 1 })}
              >
                Go to first page
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}
          aria-busy={isPlaceholderData}
        >
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Invited by</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>
                      <RoleBadge role={invitation.role} />
                    </TableCell>
                    <TableCell>
                      <InvitationStatusBadge status={invitation.status} />
                    </TableCell>
                    <TableCell>{formatDate(invitation.expires_at, timezone)}</TableCell>
                    <TableCell>{invitation.invited_by.name}</TableCell>
                    <TableCell className="text-right">
                      {invitation.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Revoke invitation for ${invitation.email}`}
                          onClick={() => setRevoking(invitation)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4">
            <Pagination
              meta={metaFor(data.meta, page, data.data.length)}
              noun="invitations"
              disabled={isPlaceholderData}
              onPageChange={(next) => setPageState({ key: status, page: next })}
            />
          </div>
        </div>
      )}

      {revoking ? (
        <RevokeDialog
          invitation={revoking}
          onClose={() => setRevoking(null)}
          onNotice={onNotice}
        />
      ) : null}
    </section>
  );
}

function RevokeDialog({
  invitation,
  onClose,
  onNotice,
}: {
  invitation: Invitation;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const revoke = useRevokeInvitation();

  const confirm = () =>
    revoke.mutate(invitation.id, {
      onSuccess: () => {
        onNotice({
          kind: "success",
          message: `Invitation for ${invitation.email} revoked.`,
        });
        onClose();
      },
      onError: (error) => {
        // 404/409: it was accepted, revoked or expired meanwhile. The list is refetched by the hook.
        if (isStatus(error, 404, 409)) {
          onNotice({
            kind: "error",
            message: isStatus(error, 404)
              ? "That invitation no longer exists. The list has been refreshed."
              : "That invitation is no longer pending, so it could not be revoked. The list has been refreshed.",
          });
          onClose();
        }
      },
    });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Revoke this invitation?"
      description={`The link sent to ${invitation.email} will stop working. You can invite them again later.`}
      confirmLabel="Revoke invitation"
      pendingLabel="Revoking…"
      destructive
      pending={revoke.isPending}
      error={
        revoke.error && !isStatus(revoke.error, 404, 409)
          ? getErrorMessage(revoke.error)
          : null
      }
      onConfirm={confirm}
    />
  );
}
