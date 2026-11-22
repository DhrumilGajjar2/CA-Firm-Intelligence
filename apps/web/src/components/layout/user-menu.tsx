"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { useLogout } from "@/features/auth/use-logout";
import { ROLE_LABELS, canManageFirm } from "@/lib/roles";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu() {
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();

  if (isPending) return <Skeleton className="size-9 rounded-full" />;
  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden min-w-0 flex-col items-end leading-tight md:flex">
        <span className="max-w-40 truncate text-sm font-medium">{user.name}</span>
        <Badge variant="secondary" className="mt-0.5">
          {ROLE_LABELS[user.role]}
        </Badge>
      </div>
      {logout.isError ? (
        <span role="alert" className="text-destructive text-xs">
          Could not log out. Try again.
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="Open user menu"
            />
          }
        >
          <Avatar>
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col">
              <span className="text-foreground text-sm font-medium">{user.name}</span>
              <span className="text-muted-foreground text-xs font-normal">
                {user.email} · {ROLE_LABELS[user.role]}
              </span>
              <span className="text-muted-foreground text-xs font-normal">
                {user.firm.name}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/profile" />}>
            <UserRound /> Profile
          </DropdownMenuItem>
          {canManageFirm(user.role) ? (
            <DropdownMenuItem render={<Link href="/settings" />}>
              <Settings /> Settings
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut /> {logout.isPending ? "Logging out…" : "Log out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
