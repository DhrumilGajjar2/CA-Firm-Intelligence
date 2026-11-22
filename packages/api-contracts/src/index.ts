/**
 * Endpoint paths from PRD v1.0 §9. Base URL: /api/v1.
 * Frontend must not call an endpoint until the backend has documented and implemented it (PRD §14).
 */

export const API_BASE_PATH = "/api/v1";

export const endpoints = {
  system: {
    /** Public. Reports API + database status (added in P0; not part of PRD section 9). */
    health: "/health",
  },
  auth: {
    register: "/auth/register",
    login: "/auth/login",
    logout: "/auth/logout",
    me: "/auth/me",
    forgotPassword: "/auth/forgot-password",
    resetPassword: "/auth/reset-password",
    /** P1 addition (FR-03 "accept invitations"; not in PRD section 9). Public. */
    invitationByToken: (token: string) =>
      `/auth/invitations/${encodeURIComponent(token)}`,
    acceptInvitation: "/auth/accept-invitation",
  },
  firms: {
    current: "/firms/current",
    settings: "/firms/current/settings",
  },
  users: {
    list: "/users",
    invite: "/users/invite",
    byId: (id: string) => `/users/${id}`,
    role: (id: string) => `/users/${id}/role`,
    status: (id: string) => `/users/${id}/status`,
  },
  /** P1 addition (FR-03 invitation management; not in PRD section 9). */
  invitations: {
    list: "/invitations",
    byId: (id: string) => `/invitations/${id}`,
  },
  clients: {
    list: "/clients",
    byId: (id: string) => `/clients/${id}`,
    engagements: (id: string) => `/clients/${id}/engagements`,
  },
  services: {
    list: "/services",
    byId: (id: string) => `/services/${id}`,
  },
  engagements: {
    list: "/engagements",
    overdue: "/engagements/overdue",
    byId: (id: string) => `/engagements/${id}`,
    status: (id: string) => `/engagements/${id}/status`,
    assign: (id: string) => `/engagements/${id}/assign`,
  },
  imports: {
    upload: "/imports/upload",
    list: "/imports",
    byId: (id: string) => `/imports/${id}`,
    preview: (id: string) => `/imports/${id}/preview`,
    confirm: (id: string) => `/imports/${id}/confirm`,
    errors: (id: string) => `/imports/${id}/errors`,
    status: (id: string) => `/imports/${id}/status`,
  },
  invoices: {
    list: "/invoices",
    byId: (id: string) => `/invoices/${id}`,
  },
  payments: {
    list: "/payments",
    allocate: (id: string) => `/payments/${id}/allocate`,
  },
  finance: {
    outstanding: "/finance/outstanding",
    summary: "/finance/summary",
  },
  dashboard: {
    overview: "/dashboard/overview",
    engagements: "/dashboard/engagements",
    overdue: "/dashboard/overdue",
    workload: "/dashboard/workload",
    finance: "/dashboard/finance",
    services: "/dashboard/services",
  },
  reports: {
    clients: "/reports/clients",
    engagements: "/reports/engagements",
    workload: "/reports/workload",
    finance: "/reports/finance",
    services: "/reports/services",
    export: "/reports/export",
  },
} as const;
