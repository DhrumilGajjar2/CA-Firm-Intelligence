import type { InvitationStatus, UserRole } from "@ca-firm/shared-types";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/roles";

const GREEN = "border-green-600/30 text-green-700 dark:text-green-400";

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge variant={role === "owner" ? "default" : "secondary"}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}

export function UserStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className={GREEN}>
      Active
    </Badge>
  ) : (
    <Badge variant="secondary">Inactive</Badge>
  );
}

const INVITATION_BADGES: Record<
  InvitationStatus,
  { label: string; variant: "outline" | "secondary" | "destructive"; className?: string }
> = {
  pending: { label: "Pending", variant: "outline" },
  accepted: { label: "Accepted", variant: "outline", className: GREEN },
  revoked: { label: "Revoked", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
};

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const { label, variant, className } = INVITATION_BADGES[status];
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
