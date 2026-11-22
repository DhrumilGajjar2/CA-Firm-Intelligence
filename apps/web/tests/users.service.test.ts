import { beforeEach, describe, expect, it, vi } from "vitest";
import { request, requestData } from "@/lib/api-client";
import { authService } from "@/services/auth.service";
import { invitationsService } from "@/services/invitations.service";
import { usersService } from "@/services/users.service";
import {
  envelope,
  makeCreatedInvitation,
  makeFirmUser,
  makeInvitation,
} from "./team-fixtures";
import { makeUser } from "./utils";

vi.mock("@/lib/api-client", () => ({ request: vi.fn(), requestData: vi.fn() }));
const requestMock = vi.mocked(request);
const requestDataMock = vi.mocked(requestData);

beforeEach(() => {
  requestMock.mockResolvedValue(envelope([]));
  requestDataMock.mockResolvedValue(null);
});

describe("usersService", () => {
  it("list returns the full envelope (data + meta) from GET /users", async () => {
    const page = envelope([makeFirmUser()], { page: 2, limit: 20, total: 21 });
    requestMock.mockResolvedValueOnce(page);
    await expect(usersService.list({ page: 2, limit: 20 })).resolves.toEqual(page);
    expect(requestMock).toHaveBeenCalledWith({
      method: "GET",
      url: "/users",
      params: { page: 2, limit: 20 },
    });
  });

  it("list sends search, role and status and drops unset or empty filters", async () => {
    await usersService.list({
      page: 1,
      limit: 20,
      search: "asha",
      role: "manager",
      status: "inactive",
    });
    expect(requestMock).toHaveBeenLastCalledWith({
      method: "GET",
      url: "/users",
      params: { page: 1, limit: 20, search: "asha", role: "manager", status: "inactive" },
    });

    await usersService.list({ page: 1, search: "", role: undefined });
    expect(requestMock).toHaveBeenLastCalledWith({
      method: "GET",
      url: "/users",
      params: { page: 1 },
    });
  });

  it("get fetches GET /users/:id", async () => {
    const found = makeFirmUser({ id: "u-9" });
    requestDataMock.mockResolvedValueOnce(found);
    await expect(usersService.get("u-9")).resolves.toEqual(found);
    expect(requestDataMock).toHaveBeenCalledWith({ method: "GET", url: "/users/u-9" });
  });

  it("update patches /users/:id with the name only", async () => {
    await usersService.update("u-9", { name: "New Name" });
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "PATCH",
      url: "/users/u-9",
      data: { name: "New Name" },
    });
  });

  it("updateRole patches /users/:id/role", async () => {
    await usersService.updateRole("u-9", { role: "viewer" });
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "PATCH",
      url: "/users/u-9/role",
      data: { role: "viewer" },
    });
  });

  it("updateStatus patches /users/:id/status", async () => {
    await usersService.updateStatus("u-9", { is_active: false });
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "PATCH",
      url: "/users/u-9/status",
      data: { is_active: false },
    });
  });

  it("invite posts /users/invite and returns the one-time invite_url", async () => {
    const created = makeCreatedInvitation();
    requestDataMock.mockResolvedValueOnce(created);
    await expect(
      usersService.invite({ email: "staff@example.com", role: "employee" }),
    ).resolves.toEqual(created);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "POST",
      url: "/users/invite",
      data: { email: "staff@example.com", role: "employee" },
    });
  });

  it("never sends a firm id", async () => {
    await usersService.list({ page: 1 });
    await usersService.invite({ email: "a@b.co", role: "viewer" });
    for (const [config] of [...requestMock.mock.calls, ...requestDataMock.mock.calls]) {
      expect(config.url).not.toMatch(/firm/);
      expect(config.data ?? {}).not.toHaveProperty("firm_id");
      expect(config.params ?? {}).not.toHaveProperty("firm_id");
    }
  });
});

describe("invitationsService", () => {
  it("list returns the full envelope from GET /invitations with status and paging", async () => {
    const page = envelope([makeInvitation()], { total: 1 });
    requestMock.mockResolvedValueOnce(page);
    await expect(
      invitationsService.list({ page: 1, limit: 10, status: "pending" }),
    ).resolves.toEqual(page);
    expect(requestMock).toHaveBeenCalledWith({
      method: "GET",
      url: "/invitations",
      params: { page: 1, limit: 10, status: "pending" },
    });
  });

  it("list omits the status when no filter is set", async () => {
    await invitationsService.list({ page: 3, limit: 10 });
    expect(requestMock).toHaveBeenCalledWith({
      method: "GET",
      url: "/invitations",
      params: { page: 3, limit: 10 },
    });
  });

  it("revoke sends DELETE /invitations/:id", async () => {
    const revoked = makeInvitation({ status: "revoked" });
    requestDataMock.mockResolvedValueOnce(revoked);
    await expect(invitationsService.revoke("inv-1")).resolves.toEqual(revoked);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "DELETE",
      url: "/invitations/inv-1",
    });
  });
});

describe("authService invitation calls", () => {
  it("getInvitation gets /auth/invitations/:token and url-encodes the token", async () => {
    const preview = {
      email: "staff@example.com",
      role: "employee",
      firm_name: "Demo CA Associates",
      expires_at: "2026-11-28T10:00:00.000Z",
    };
    requestDataMock.mockResolvedValueOnce(preview);
    await expect(authService.getInvitation("tok/en+1")).resolves.toEqual(preview);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "GET",
      url: "/auth/invitations/tok%2Fen%2B1",
    });
  });

  it("acceptInvitation posts token, name and password to /auth/accept-invitation", async () => {
    const created = makeUser("employee");
    requestDataMock.mockResolvedValueOnce(created);
    const input = { token: "abc123", name: "Karan Patel", password: "Sample-pass-1" };
    await expect(authService.acceptInvitation(input)).resolves.toEqual(created);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "POST",
      url: "/auth/accept-invitation",
      data: input,
    });
  });
});
