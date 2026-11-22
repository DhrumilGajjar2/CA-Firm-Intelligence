import type { UserRole } from "@ca-firm/shared-types";

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  manager: "Manager",
  employee: "Employee",
  viewer: "Viewer",
};

/**
 * Roles an owner can give out. Ownership cannot be assigned or transferred in P1
 * (docs/API_SPECIFICATION.md, P1 decision 7).
 */
export const ASSIGNABLE_ROLES = ["manager", "employee", "viewer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/*
 * Role checks below only decide what the UI shows. The API enforces every one of them
 * (403) regardless, so they are a convenience and never a security control.
 */

/** Who may open the team list (GET /users): owner and manager. */
export const canViewTeam = (role: UserRole | undefined): boolean =>
  role === "owner" || role === "manager";

/** Who may invite users, change roles/status and manage invitations: owner only. */
export const canManageUsers = (role: UserRole | undefined): boolean => role === "owner";

/** Who may open firm settings: owner only. */
export const canManageFirm = (role: UserRole | undefined): boolean => role === "owner";
