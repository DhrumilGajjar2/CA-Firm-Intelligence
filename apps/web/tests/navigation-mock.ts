import { vi } from "vitest";

/** Controllable stand-in for `next/navigation` (installed globally in tests/setup.ts). */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

export const nav = {
  pathname: "/",
  searchParams: new URLSearchParams(),
};

export function setLocation(pathname: string, search = "") {
  nav.pathname = pathname;
  nav.searchParams = new URLSearchParams(search);
  window.history.replaceState(null, "", `${pathname}${search ? `?${search}` : ""}`);
}

export function resetNavigation() {
  setLocation("/");
}

export const useRouter = () => router;
export const usePathname = () => nav.pathname;
export const useSearchParams = () => nav.searchParams;
export const redirect = vi.fn();
