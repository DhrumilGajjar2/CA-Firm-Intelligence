import {
  BarChart3,
  Briefcase,
  LayoutDashboard,
  Layers,
  Settings,
  Upload,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@ca-firm/shared-types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles that see this item. UI-only convenience: the API enforces real permissions (PRD §3). */
  roles: readonly UserRole[];
}

const ALL: readonly UserRole[] = ["owner", "manager", "employee", "viewer"];

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ALL },
  {
    label: "Clients",
    href: "/clients",
    icon: Users,
    roles: ["owner", "manager", "viewer"],
  },
  { label: "Engagements", href: "/engagements", icon: Briefcase, roles: ALL },
  { label: "Services", href: "/services", icon: Layers, roles: ["owner", "manager"] },
  { label: "Employees", href: "/employees", icon: UserCog, roles: ["owner", "manager"] },
  // Employees cannot access restricted financial information (PRD §3).
  { label: "Finance", href: "/finance", icon: Wallet, roles: ["owner", "manager"] },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["owner", "manager", "viewer"],
  },
  { label: "Imports", href: "/imports", icon: Upload, roles: ["owner", "manager"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["owner"] },
];

/** Items visible to a role. No role (not loaded / signed out) shows nothing, never everything. */
export function navItemsForRole(role: UserRole | undefined): readonly NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
