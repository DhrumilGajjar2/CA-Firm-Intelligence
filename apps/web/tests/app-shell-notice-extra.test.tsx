import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser, UserRole } from "@ca-firm/shared-types";
import { AppShell } from "@/components/layout/app-shell";
import { currentUserQueryKey } from "@/features/auth/use-current-user";
import { authService } from "@/services/auth.service";
import { makeUser, renderWithProviders } from "./utils";

/** QA slice 2 gate: the "firm setup not finished" notice for non-owners. */
vi.mock("@/services/auth.service");
vi.mock("@/features/system/use-api-health", () => ({
  useApiHealth: () => ({ isPending: false, isError: false, error: null }),
}));
const meMock = vi.mocked(authService.me);

const NOTICE = /firm's setup is not finished/i;
const firm = (done: boolean): CurrentUser["firm"] => ({
  id: "firm-1",
  name: "Demo CA Associates",
  timezone: "Asia/Kolkata",
  onboarding_completed: done,
});

function renderShell(role: UserRole, done: boolean) {
  meMock.mockResolvedValue(makeUser(role, { firm: firm(done) }));
  return renderWithProviders(
    <AppShell>
      <p>Page content</p>
    </AppShell>,
  );
}

describe("AppShell notice: who sees it", () => {
  it.each(["manager", "employee", "viewer"] as const)(
    "a %s of an unfinished firm sees it once, as a polite status (not an alert), with the page still rendered",
    async (role) => {
      renderShell(role, false);
      const notice = await screen.findByText(NOTICE);
      expect(screen.getAllByText(NOTICE)).toHaveLength(1);
      expect(notice.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText("Page content")).toBeInTheDocument();
      // It is information only: no link or button leads to the owner-only onboarding screen.
      expect(document.querySelector('a[href="/onboarding"]')).toBeNull();
    },
  );

  it.each(["manager", "employee", "viewer"] as const)(
    "a %s of a finished firm never sees it",
    async (role) => {
      renderShell(role, true);
      await screen.findAllByText("Demo CA Associates");
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    },
  );

  it("an owner never sees the non-owner notice (the guard sends them to /onboarding instead)", async () => {
    renderShell("owner", false);
    await screen.findAllByText("Demo CA Associates");
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("the notice appears only after the role is known: nothing flashes while /auth/me is loading", () => {
    meMock.mockReturnValue(new Promise(() => {}));
    renderWithProviders(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("disappears as soon as the session reports onboarding as completed", async () => {
    const { queryClient } = renderShell("manager", false);
    await screen.findByText(NOTICE);
    act(() => {
      queryClient.setQueryData(currentUserQueryKey, makeUser("manager", { firm: firm(true) }));
    });
    await waitFor(() => expect(screen.queryByText(NOTICE)).not.toBeInTheDocument());
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("does not hide the navigation: each role still gets its own menu", async () => {
    renderShell("viewer", false);
    await screen.findByText(NOTICE);
    const nav = screen.getAllByRole("navigation")[0]!;
    expect(nav).toHaveTextContent("Dashboard");
    expect(nav).not.toHaveTextContent("Settings");
  });
});
