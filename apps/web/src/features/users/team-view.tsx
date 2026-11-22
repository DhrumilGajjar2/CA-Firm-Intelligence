"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { canManageUsers, canViewTeam } from "@/lib/roles";
import { InvitationsSection } from "./invitations-section";
import { InviteUserDialog } from "./invite-user-dialog";
import { ListSkeleton } from "./list-states";
import { TeamNotice, type Notice } from "./team-notice";
import { UsersSection } from "./users-section";

/**
 * Team page body. Owner: list, invite, role/status actions and invitations. Manager: the list,
 * read-only. Everyone else gets a "no access" state (the API answers 403 to them anyway).
 */
export function TeamView() {
  const { data: user, isPending } = useCurrentUser();
  const [notice, setNotice] = useState<Notice | null>(null);

  if (isPending) {
    return (
      <>
        <PageHeader title="Team" />
        <ListSkeleton label="Loading team" />
      </>
    );
  }
  // Signed out or failed to load: the dashboard guard owns that screen.
  if (!user) return null;

  if (!canViewTeam(user.role)) {
    return (
      <>
        <PageHeader title="Team" />
        <EmptyState
          icon={ShieldAlert}
          title="You do not have access to the team list"
          description="Only owners and managers can view team members. Ask your firm owner if you need access."
        />
      </>
    );
  }

  const manage = canManageUsers(user.role);
  const timezone = user.firm.timezone;

  return (
    <>
      <PageHeader
        title="Team"
        description={
          manage
            ? "Invite people to your firm and manage their roles and access."
            : "People in your firm. Only the owner can invite users or change their access."
        }
        actions={manage ? <InviteUserDialog timezone={timezone} /> : undefined}
      />
      <TeamNotice notice={notice} onDismiss={() => setNotice(null)} />
      <UsersSection
        canManage={manage}
        currentUserId={user.id}
        timezone={timezone}
        onNotice={setNotice}
      />
      {manage ? <InvitationsSection timezone={timezone} onNotice={setNotice} /> : null}
    </>
  );
}
