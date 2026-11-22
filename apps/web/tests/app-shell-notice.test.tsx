import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/app-shell";
import { authService } from "@/services/auth.service";
import { makeUser, renderWithProviders } from "./utils";

vi.mock("@/services/auth.service");
vi.mock("@/features/system/use-api-health", () => ({
  useApiHealth: () => ({ isPending: false, isError: false, error: null }),
}));
const meMock = vi.mocked(authService.me);

const NOTICE = /firm's setup is not finished/i;
const unfinished = {
  firm: {
    id: "firm-1",
    name: "Demo CA Associates",
    timezone: "Asia/Kolkata",
    onboarding_completed: false,
  },
};

describe("AppShell: unfinished firm setup notice", () => {
  it("shows a non-blocking notice to a non-owner and still renders the page", async () => {
    meMock.mockResolvedValue(makeUser("manager", unfinished));
    renderWithProviders(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("does not show it once setup is complete", async () => {
    meMock.mockResolvedValue(makeUser("manager"));
    renderWithProviders(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );
    expect(await screen.findAllByText("Demo CA Associates")).not.toHaveLength(0);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
