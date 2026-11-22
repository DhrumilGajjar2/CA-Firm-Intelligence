import { Building2 } from "lucide-react";
import { RequireAuth } from "@/features/auth/require-auth";
import { OnboardingSignOut } from "@/features/firm/onboarding-sign-out";

// Same auth guard as the dashboard, but no sidebar: the owner finishes firm setup first.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="bg-muted/40 flex min-h-screen flex-col items-center px-4 py-10">
        <div className="mb-6 flex w-full max-w-xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
              <Building2 className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold">CA Firm Intelligence</span>
          </div>
          <OnboardingSignOut />
        </div>
        <main className="w-full max-w-xl">{children}</main>
      </div>
    </RequireAuth>
  );
}
