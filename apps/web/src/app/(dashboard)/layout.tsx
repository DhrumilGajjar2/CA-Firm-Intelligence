import { AppShell } from "@/components/layout/app-shell";
import { RequireAuth } from "@/features/auth/require-auth";

// UX guard only (loading / 401 redirect / retry). The API enforces the real access rules.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
