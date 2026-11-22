import { beforeEach, describe, expect, it, vi } from "vitest";
import { authService } from "@/services/auth.service";
import { requestData } from "@/lib/api-client";
import { makeUser } from "./utils";

vi.mock("@/lib/api-client", () => ({ requestData: vi.fn() }));
const requestDataMock = vi.mocked(requestData);

beforeEach(() => {
  requestDataMock.mockResolvedValue(null);
});

describe("authService", () => {
  it("register posts the body and returns the user", async () => {
    const user = makeUser("owner");
    requestDataMock.mockResolvedValueOnce(user);
    const input = {
      name: "Asha Rao",
      email: "asha@example.com",
      password: "Sample-pass-1",
      firm_name: "Demo CA Associates",
    };
    await expect(authService.register(input)).resolves.toEqual(user);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "POST",
      url: "/auth/register",
      data: input,
    });
  });

  it("login posts credentials", async () => {
    const input = { email: "asha@example.com", password: "Sample-pass-1" };
    await authService.login(input);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "POST",
      url: "/auth/login",
      data: input,
    });
  });

  it("logout posts without a body", async () => {
    await authService.logout();
    expect(requestDataMock).toHaveBeenCalledWith({ method: "POST", url: "/auth/logout" });
  });

  it("me gets the current user", async () => {
    await authService.me();
    expect(requestDataMock).toHaveBeenCalledWith({ method: "GET", url: "/auth/me" });
  });

  it("forgotPassword posts the email", async () => {
    await authService.forgotPassword({ email: "asha@example.com" });
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "POST",
      url: "/auth/forgot-password",
      data: { email: "asha@example.com" },
    });
  });

  it("resetPassword posts token and password", async () => {
    await authService.resetPassword({ token: "tok", password: "NewPass123" });
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "POST",
      url: "/auth/reset-password",
      data: { token: "tok", password: "NewPass123" },
    });
  });
});
