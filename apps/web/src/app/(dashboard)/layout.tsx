import { AppShell } from "@/components/layout/app-shell";

// Route protection (redirect to /login when unauthenticated) is added in P1 with the auth APIs.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
