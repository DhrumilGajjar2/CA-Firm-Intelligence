import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurrentUser, UserRole } from "@ca-firm/shared-types";
import { ApiRequestError } from "@/lib/api-client";
import { TooltipProvider } from "@/components/ui/tooltip";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(ui: ReactElement, queryClient = makeQueryClient()) {
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
  return { user, queryClient, ...utils };
}

export function makeUser(
  role: UserRole = "owner",
  overrides: Partial<CurrentUser> = {},
): CurrentUser {
  return {
    id: "user-1",
    name: "Asha Rao",
    email: "asha@example.com",
    role,
    firm: {
      id: "firm-1",
      name: "Demo CA Associates",
      timezone: "Asia/Kolkata",
      onboarding_completed: true,
    },
    ...overrides,
  };
}

export function apiError(
  status: number | null,
  message: string,
  opts: { code?: string; errors?: { field?: string; message: string }[] } = {},
) {
  return new ApiRequestError(message, {
    status,
    code: opts.code ?? "ERROR",
    errors: opts.errors,
  });
}

/** A promise you resolve or reject by hand, to observe in-flight (pending) UI. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
