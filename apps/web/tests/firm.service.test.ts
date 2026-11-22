import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestData } from "@/lib/api-client";
import { firmService } from "@/services/firm.service";
import { makeProfile, makeSettings } from "./firm-fixtures";

vi.mock("@/lib/api-client", () => ({ requestData: vi.fn() }));
const requestDataMock = vi.mocked(requestData);

beforeEach(() => {
  requestDataMock.mockResolvedValue(null);
});

describe("firmService", () => {
  it("getFirm gets /firms/current and returns the profile", async () => {
    const profile = makeProfile();
    requestDataMock.mockResolvedValueOnce(profile);
    await expect(firmService.getFirm()).resolves.toEqual(profile);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "GET",
      url: "/firms/current",
    });
  });

  it("updateFirm patches /firms/current with the partial body", async () => {
    const saved = makeProfile({ phone: "+91 98765 43210" });
    requestDataMock.mockResolvedValueOnce(saved);
    const body = { phone: "+91 98765 43210", address: "" };
    await expect(firmService.updateFirm(body)).resolves.toEqual(saved);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "PATCH",
      url: "/firms/current",
      data: body,
    });
  });

  it("getSettings gets /firms/current/settings", async () => {
    const settings = makeSettings();
    requestDataMock.mockResolvedValueOnce(settings);
    await expect(firmService.getSettings()).resolves.toEqual(settings);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "GET",
      url: "/firms/current/settings",
    });
  });

  it("updateSettings patches /firms/current/settings", async () => {
    const body = { financial_year_start_month: 4, onboarding_completed: true };
    requestDataMock.mockResolvedValueOnce(makeSettings(body));
    await firmService.updateSettings(body);
    expect(requestDataMock).toHaveBeenCalledWith({
      method: "PATCH",
      url: "/firms/current/settings",
      data: body,
    });
  });

  it("never sends a firm id", async () => {
    await firmService.getFirm();
    await firmService.updateFirm({ name: "X" });
    for (const [config] of requestDataMock.mock.calls) {
      expect(config.url).not.toMatch(/firm-1|firm_id/);
      expect(config.data ?? {}).not.toHaveProperty("firm_id");
    }
  });
});
