"use client";

import { useState, type ReactNode } from "react";
import { Info, Menu } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ApiStatus } from "./api-status";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { useCurrentUser } from "@/features/auth/use-current-user";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: user } = useCurrentUser();

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar (desktop-first, PRD §16) */}
      <aside className="bg-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto pb-4">
          <SidebarNav />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
          {/* Mobile navigation drawer */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="bg-sidebar w-64 gap-0 p-0"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
            {user?.firm.name}
          </div>
          <ApiStatus />
          <UserMenu />
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {user && user.role !== "owner" && !user.firm.onboarding_completed ? (
            <Alert role="status" className="mb-4">
              <Info aria-hidden />
              <AlertDescription>
                Your firm&apos;s setup is not finished yet. The owner will complete it.
              </AlertDescription>
            </Alert>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
