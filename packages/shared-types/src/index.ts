/**
 * Shared contracts between apps/web (Dhrumil) and apps/api (Sampat).
 * Source: PRD v1.0 §3 (roles), §4 FR-06 (engagement statuses), §9.1 (API response).
 * Any change here is a contract change: review it with the other developer.
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
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  firm: Firm;
}
