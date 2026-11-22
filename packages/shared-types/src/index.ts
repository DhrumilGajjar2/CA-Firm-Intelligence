/**
 * Shared contracts between apps/web and apps/api (both owned by Dhrumil).
 * Source: PRD v1.0 §3 (roles), §4 FR-06 (engagement statuses), §9.1 (API response).
 * Any change here is a contract change: update both sides and docs/API_SPECIFICATION.md together.
 */

// ---------- Standard API response (PRD §9.1) ----------

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  errors: ApiErrorDetail[];
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ---------- Roles (PRD §3) ----------

export const USER_ROLES = ["owner", "manager", "employee", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ---------- Engagements (PRD FR-06) ----------

export const ENGAGEMENT_STATUSES = [
  "not_started",
  "in_progress",
  "under_review",
  "completed",
  "on_hold",
  "cancelled",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type EngagementPriority = (typeof ENGAGEMENT_PRIORITIES)[number];

// ---------- Clients (PRD §14 example) ----------

export const CLIENT_TYPES = [
  "individual",
  "company",
  "partnership",
  "llp",
  "huf",
  "trust",
  "other",
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export interface Client {
  id: string;
  client_code: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  client_type: ClientType;
}

// ---------- Auth / current user (PRD §9.2) ----------

export interface Firm {
  id: string;
  name: string;
  timezone: string;
  /** Derived from firm settings; false until the owner finishes onboarding. */
  onboarding_completed: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  firm: Firm;
}

// ---------- Firms (P1) ----------

export interface FirmProfile {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  created_at: string;
}

export interface FirmSettings {
  /** 1-12; Indian financial year starts in April. */
  financial_year_start_month: number;
  onboarding_completed: boolean;
}

// ---------- Users and invitations (P1) ----------

export const USER_STATUS_FILTERS = ["active", "inactive"] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

/** A member of the current firm (user + membership). `id` is the user id. */
export interface FirmUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  invited_by: { id: string; name: string };
}

/** Returned once, by POST /users/invite. The raw token is never stored or returned again. */
export interface CreatedInvitation extends Invitation {
  invite_url: string;
}

/** Public preview used by the accept-invitation page. */
export interface InvitationPreview {
  email: string;
  role: UserRole;
  firm_name: string;
  expires_at: string;
}
