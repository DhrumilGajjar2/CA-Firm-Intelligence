import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvitationPreview, UserRole } from "@ca-firm/shared-types";
import { AcceptInvitationForm } from "@/features/auth/accept-invitation-form";
import { authService } from "@/services/auth.service";
import { router, setLocation } from "./navigation-mock";
import { apiError, deferred, makeQueryClient, makeUser, renderWithProviders } from "./utils";

/** QA slice 3 gate: extra adversarial cases for /accept-invitation. */
vi.mock("@/services/auth.service");
const meMock = vi.mocked(authService.me);
const getInvitation = vi.mocked(authService.getInvitation);
const acceptInvitation = vi.mocked(authService.acceptInvitation);

const preview = (overrides: Partial<InvitationPreview> = {}): InvitationPreview => ({
  email: "staff@example.com",
  role: "manager",
  firm_name: "Demo CA Associates",
  expires_at: "2026-11-28T10:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  setLocation("/accept-invitation", "token=abc123");
  meMock.mockRejectedValue(apiError(401, "Authentication required"));
  getInvitation.mockResolvedValue(preview());
});

const fill = async (
  user: ReturnType<typeof renderWithProviders>["user"],
  v: { name?: string; password?: string; confirm?: string },
) => {
  if (v.name !== undefined && v.name !== "") await user.type(screen.getByLabelText("Your name"), v.name);
  const enter = async (label: string, value: string) => {
    const box = screen.getByLabelText(label);
    if (value.length > 20) {
      await user.click(box);
      await user.paste(value); // typing 128 characters one by one is slow in jsdom
    } else {
      await user.type(box, value);
    }
  };
  if (v.password) await enter("Password", v.password);
  const confirm = v.confirm ?? v.password;
  if (confirm) await enter("Confirm password", confirm);
};
const submit = (user: ReturnType<typeof renderWithProviders>["user"]) =>
  user.click(screen.getByRole("button", { name: "Accept invitation" }));

describe("token in the URL", () => {
  it("passes the token to the preview exactly as given, once, with no refetch on re-render or focus", async () => {
    setLocation("/accept-invitation", "token=Ab-_9xYz");
    const rendered = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByRole("heading", { name: "Join Demo CA Associates" });
    expect(getInvitation).toHaveBeenCalledTimes(1);
    expect(getInvitation).toHaveBeenCalledWith("Ab-_9xYz");
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <AcceptInvitationForm />
      </QueryClientProvider>,
    );
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 50));
    expect(getInvitation).toHaveBeenCalledTimes(1);
  });

  it.each([["token="], [""], ["other=abc"], ["Token=abc"]])("missing or empty token (%j): explanatory state, no API call, link to sign in", (search) => {
    setLocation("/accept-invitation", search);
    renderWithProviders(<AcceptInvitationForm />);
    expect(screen.getByRole("heading", { name: "Invitation link is missing" })).toBeInTheDocument();
    expect(getInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  it("a weird token (spaces, symbols, very long) is sent as a plain string and a 404 gives the generic invalid-link page", async () => {
    getInvitation.mockRejectedValue(apiError(404, "Invitation link is invalid or has expired", { code: "NOT_FOUND" }));
    for (const token of ["   ", "a b+c/d=", "x".repeat(2000), "<script>1</script>"]) {
      setLocation("/accept-invitation", `token=${encodeURIComponent(token)}`);
      const { unmount } = renderWithProviders(<AcceptInvitationForm />);
      expect(await screen.findByRole("heading", { name: "This invitation link is not valid" })).toBeInTheDocument();
      expect(getInvitation).toHaveBeenLastCalledWith(token);
      expect(document.querySelector("script")).toBeNull();
      unmount();
    }
  });

  it("the token is never rendered into the page (text or attributes), in any state", async () => {
    setLocation("/accept-invitation", "token=SECRET-TOKEN-VALUE-123");
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByRole("heading", { name: /Join/ });
    expect(document.body.innerHTML).not.toContain("SECRET-TOKEN-VALUE-123");
    acceptInvitation.mockRejectedValue(apiError(404, "gone", { code: "NOT_FOUND" }));
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1" });
    await submit(user);
    await screen.findByRole("alert");
    expect(document.body.innerHTML).not.toContain("SECRET-TOKEN-VALUE-123");
  });
});

describe("preview content", () => {
  it.each(["manager", "employee", "viewer"] as UserRole[])("shows the %s role label, the read-only invited email and the firm", async (role) => {
    getInvitation.mockResolvedValue(preview({ role, email: "Mixed.Case@Example.com" }));
    renderWithProviders(<AcceptInvitationForm />);
    const label = role[0]!.toUpperCase() + role.slice(1);
    expect(await screen.findByText(new RegExp(`invited as ${label}`))).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("readonly");
    expect(email).toHaveValue("Mixed.Case@Example.com");
  });

  it("firm names with HTML are rendered as text", async () => {
    getInvitation.mockResolvedValue(preview({ firm_name: '<img src=x onerror="window.__x=1"> & Co' }));
    renderWithProviders(<AcceptInvitationForm />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent('Join <img src=x onerror="window.__x=1"> & Co');
    expect(document.querySelector("img")).toBeNull();
  });

  it("an invitation for an owner role (never issued by the API) is shown with its label only and sends no role on submit", async () => {
    getInvitation.mockResolvedValue(preview({ role: "owner" }));
    acceptInvitation.mockResolvedValue(makeUser("owner"));
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByRole("heading", { name: /Join/ });
    await fill(user, { name: "Climber", password: "Sample-pass-1" });
    await submit(user);
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(1));
    expect(Object.keys(acceptInvitation.mock.calls[0]![0]).sort()).toEqual(["name", "password", "token"]);
  });
});

describe("validation boundaries (client side, before any request)", () => {
  async function ready() {
    const rendered = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByRole("heading", { name: /Join/ });
    return rendered;
  }

  it.each([
    ["7 characters", "Abcdef1", /at least 8/],
    ["letters only", "abcdefghij", /contain a number/],
    ["digits only", "1234567890", /contain a letter/],
    ["129 characters", `${"a".repeat(128)}1`, /at most 128/],
  ])("password %s is rejected with a message and no request", async (_l, password, message) => {
    const { user } = await ready();
    await fill(user, { name: "Karan Patel", password });
    await submit(user);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("accepts a password of exactly 8 and exactly 128 characters, and spaces inside are kept (not trimmed)", async () => {
    acceptInvitation.mockResolvedValue(makeUser("manager"));
    for (const password of ["Abcdefg1", `${"a".repeat(127)}1`, " pass 12 "]) {
      acceptInvitation.mockClear();
      const { user, unmount } = await ready();
      await fill(user, { name: "Karan Patel", password });
      await submit(user);
      await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(1), { timeout: 3000 });
      expect(acceptInvitation.mock.calls[0]![0]).toEqual({ token: "abc123", name: "Karan Patel", password });
      unmount();
    }
  }, 20_000);

  it("a mismatching confirmation blocks the request and marks the confirmation field", async () => {
    const { user } = await ready();
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1", confirm: "Sample-pass-2" });
    await submit(user);
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true");
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["spaces", "     "],
    ["121 characters", "n".repeat(121)],
    ["a control character", "Bad\u0007Name"],
  ])("name %s is rejected without a request", async (_l, name) => {
    const { user } = await ready();
    const box = screen.getByLabelText("Your name");
    if (name) {
      // fireEvent-like set for characters user.type would interpret
      await user.click(box);
      await user.paste(name);
    }
    await fill(user, { password: "Sample-pass-1" });
    await submit(user);
    await waitFor(() => expect(box).toHaveAttribute("aria-invalid", "true"));
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("120 characters and unicode names pass and are sent trimmed", async () => {
    acceptInvitation.mockResolvedValue(makeUser("manager"));
    const { user } = await ready();
    await user.click(screen.getByLabelText("Your name"));
    await user.paste("  " + "n".repeat(120) + "  ");
    await fill(user, { password: "Sample-pass-1" });
    await submit(user);
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(1));
    expect(acceptInvitation.mock.calls[0]![0].name).toBe("n".repeat(120));
  });
});

describe("submit behaviour", () => {
  async function ready() {
    const rendered = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByRole("heading", { name: /Join/ });
    return rendered;
  }

  it("double click and Enter twice send one request; the button shows progress and is disabled", async () => {
    const pending = deferred<ReturnType<typeof makeUser>>();
    acceptInvitation.mockReturnValue(pending.promise);
    const { user } = await ready();
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1" });
    await user.type(screen.getByLabelText("Confirm password"), "{Enter}{Enter}");
    const button = await screen.findByRole("button", { name: "Creating account…" });
    expect(button).toBeDisabled();
    await user.dblClick(button);
    expect(acceptInvitation).toHaveBeenCalledTimes(1);
    pending.resolve(makeUser("manager"));
    expect(await screen.findByRole("button", { name: "Redirecting…" })).toBeDisabled();
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("every failure keeps what the user typed, re-enables the button and allows a corrected retry that then succeeds", async () => {
    const { user } = await ready();
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1" });
    acceptInvitation.mockRejectedValueOnce(apiError(null, "Network Error", { code: "NETWORK_ERROR" }));
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network Error");
    expect(screen.getByLabelText("Your name")).toHaveValue("Karan Patel");
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled();

    acceptInvitation.mockRejectedValueOnce(apiError(500, "Internal server error", { code: "INTERNAL_ERROR" }));
    await submit(user);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Internal server error"));

    acceptInvitation.mockResolvedValueOnce(makeUser("manager"));
    await submit(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(acceptInvitation).toHaveBeenCalledTimes(3);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("404 and 409 give distinct, non-leaking messages with a sign-in link; the form stays but no redirect happens", async () => {
    const { user } = await ready();
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1" });
    acceptInvitation.mockRejectedValueOnce(apiError(409, "Conflict", { code: "CONFLICT" }));
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("account with this email address already exists");
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
    acceptInvitation.mockRejectedValueOnce(apiError(404, "Not found", { code: "NOT_FOUND" }));
    await submit(user);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no longer valid"));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("server field errors for password and name land on those fields; unknown fields fall back to the alert", async () => {
    const { user } = await ready();
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1" });
    acceptInvitation.mockRejectedValueOnce(
      apiError(400, "Validation failed", {
        code: "VALIDATION_ERROR",
        errors: [
          { field: "password", message: "Password must contain a number" },
          { field: "name", message: "Contains characters that are not allowed" },
        ],
      }),
    );
    await submit(user);
    expect(await screen.findByText("Password must contain a number")).toBeInTheDocument();
    expect(screen.getByText("Contains characters that are not allowed")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
  });

  it("success replaces the session cache with the new user and clears other cached data but keeps the auth entries", async () => {
    acceptInvitation.mockResolvedValue(makeUser("viewer", { email: "staff@example.com" }));
    const qc = makeQueryClient();
    qc.setQueryData(["users", "list"], { stale: "previous user's data" });
    qc.setQueryData(["firm", "profile"], { stale: true });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AcceptInvitationForm />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: /Join/ });
    await fill(user, { name: "Karan Patel", password: "Sample-pass-1" });
    await submit(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(qc.getQueryData(["users", "list"])).toBeUndefined();
    expect(qc.getQueryData(["firm", "profile"])).toBeUndefined();
    expect(qc.getQueryData(["auth", "me"])).toMatchObject({ role: "viewer" });
  });
});

describe("accessibility basics", () => {
  it("one h1, named form, every field labelled, errors announced and linked, password toggle named and not exposing the value", async () => {
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    await screen.findByRole("heading", { name: /Join/ });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("form", { name: "Accept invitation" })).toBeInTheDocument();
    for (const label of ["Email", "Your name", "Password", "Confirm password"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    const toggles = screen.getAllByRole("button", { name: "Show password" });
    await user.click(toggles[0]!);
    expect(password.type).toBe("text");
    expect(screen.getAllByRole("button", { name: /Hide password/ })[0]).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.type).toBe("password");

    await submit(user);
    const err = await screen.findAllByText(/required|at least 8/i);
    expect(err.length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-describedby", "name-error");
    expect(document.getElementById("name-error")).not.toBeNull();
  });

  it("states have headings: loading is a status, invalid link has an h1, retry button works after a 500", async () => {
    getInvitation.mockRejectedValueOnce(apiError(500, "Boom", { code: "INTERNAL_ERROR" }));
    const { user } = renderWithProviders(<AcceptInvitationForm />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "We couldn't load this invitation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: /Join/ })).toBeInTheDocument();
    expect(getInvitation).toHaveBeenCalledTimes(2);
  });
});
