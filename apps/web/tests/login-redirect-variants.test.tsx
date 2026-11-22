import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/features/auth/login-form";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { makeUser, renderWithProviders } from "./utils";

/** QA re-verification of P1-001 at the UI level: where does the browser go after a real login? */
vi.mock("@/services/auth.service");
const loginMock = vi.mocked(authService.login);

async function loginWithNext(next: string) {
  setLocation("/login", `next=${encodeURIComponent(next)}`);
  loginMock.mockResolvedValue(makeUser());
  const { user } = renderWithProviders(<LoginForm />);
  await user.type(screen.getByLabelText("Email"), "a@example.com");
  await user.type(screen.getByLabelText("Password"), "Sample-pass-1");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  return String(router.replace.mock.calls[0]?.[0]);
}

describe("LoginForm: post-login destination after the P1-001 fix", () => {
  it.each([
    "/a/../..//evil.example",
    "/%2e/%2e//evil.example",
    "/%2E%2e//evil.example",
    "/..;//evil.example",
    "/..//evil.example",
    "/.%2e//evil.example",
    "/../..///evil.example",
    "/dashboard\t",
    "/%2e%2e/%2e%2e//evil.example",
  ])("next=%j never leaves the origin", async (next) => {
    const target = await loginWithNext(next);
    expect(target.startsWith("//")).toBe(false);
    expect(target.startsWith("/")).toBe(true);
    expect(target).not.toContain("\\");
    expect(new URL(target, "http://app.invalid").origin).toBe("http://app.invalid");
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/clients?page=2", "/clients?page=2"],
    ["/engagements/abc#notes", "/engagements/abc#notes"],
    ["/a/../clients", "/clients"],
    ["/settings", "/settings"],
  ])("a legitimate next=%j is still honoured", async (next, expected) => {
    expect(await loginWithNext(next)).toBe(expected);
  });
});
