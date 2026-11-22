import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { AuthCardSkeleton } from "@/features/auth/auth-states";
import { RedirectIfAuthenticated } from "@/features/auth/redirect-if-authenticated";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
          <Building2 className="size-5" aria-hidden />
        </span>
        <span className="text-lg font-semibold">CA Firm Intelligence</span>
      </div>
      <div className="w-full max-w-sm">
        {/* useSearchParams (?next=, ?token=) in the auth client components needs a Suspense boundary. */}
        <Suspense fallback={<AuthCardSkeleton />}>
          <RedirectIfAuthenticated>{children}</RedirectIfAuthenticated>
        </Suspense>
      </div>
    </div>
  );
}
