import type { FirmProfile, FirmSettings } from "@ca-firm/shared-types";
import type { UpdateFirmInput, UpdateFirmSettingsInput } from "@ca-firm/validation";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";

export const DEFAULT_FIRM_SETTINGS: FirmSettings = {
  financial_year_start_month: 4,
  onboarding_completed: false,
};

const PROFILE_SELECT = {
  id: true,
  name: true,
  address: true,
  email: true,
  phone: true,
  timezone: true,
  created_at: true,
} as const;

/** `firms.settings` may be missing keys (older rows) or hold unknown keys; always a plain object. */
function settingsObject(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Settings with defaults applied for missing or malformed keys. Unknown keys are not exposed. */
export function toFirmSettings(raw: unknown): FirmSettings {
  const stored = settingsObject(raw);
  const month = stored["financial_year_start_month"];
  return {
    financial_year_start_month:
      typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12
        ? month
        : DEFAULT_FIRM_SETTINGS.financial_year_start_month,
    onboarding_completed: stored["onboarding_completed"] === true,
  };
}

function toProfile(row: {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  created_at: Date;
}): FirmProfile {
  return { ...row, created_at: row.created_at.toISOString() };
}

/**
 * Firm profile and settings. The firm id ALWAYS comes from the verified session (`firmIdOf(request)`),
 * never from client input, so every query here is scoped to the caller's own firm.
 */
export function createFirmsService({ prisma }: { prisma: PrismaClient }) {
  const firmNotFound = () => AppError.notFound("Firm not found");

  async function getProfile(firmId: string): Promise<FirmProfile> {
    const firm = await prisma.firm.findUnique({
      where: { id: firmId },
      select: PROFILE_SELECT,
    });
    if (!firm) throw firmNotFound();
    return toProfile(firm);
  }

  return {
    getProfile,

    /** Only the provided fields change; `null` (an empty string in the request) clears address/email/phone. */
    async updateProfile(firmId: string, input: UpdateFirmInput): Promise<FirmProfile> {
      const data: Prisma.FirmUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.address !== undefined) data.address = input.address;
      if (input.email !== undefined) data.email = input.email;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.timezone !== undefined) data.timezone = input.timezone;

      const result = await prisma.firm.updateMany({ where: { id: firmId }, data });
      if (result.count !== 1) throw firmNotFound();
      return getProfile(firmId);
    },

    async getSettings(firmId: string): Promise<FirmSettings> {
      const firm = await prisma.firm.findUnique({
        where: { id: firmId },
        select: { settings: true },
      });
      if (!firm) throw firmNotFound();
      return toFirmSettings(firm.settings);
    },

    /**
     * Merges only the provided keys into `firms.settings`, keeping every other (unknown) key.
     * `onboarding_completed` can only become `true`: there is no un-completing in P1.
     * Read-modify-write runs in one transaction with the row locked, so concurrent PATCHes cannot
     * overwrite each other's keys.
     */
    async updateSettings(
      firmId: string,
      input: UpdateFirmSettingsInput,
    ): Promise<FirmSettings> {
      if (input.onboarding_completed === false) {
        throw AppError.validation([
          {
            field: "onboarding_completed",
            message: "Onboarding can only be marked as completed",
          },
        ]);
      }

      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ settings: unknown }[]>`
          SELECT settings FROM firms WHERE id = ${firmId}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row) throw firmNotFound();

        const merged: Record<string, unknown> = { ...settingsObject(row.settings) };
        if (input.financial_year_start_month !== undefined) {
          merged["financial_year_start_month"] = input.financial_year_start_month;
        }
        if (input.onboarding_completed === true) {
          merged["onboarding_completed"] = true;
        }

        const updated = await tx.firm.update({
          where: { id: firmId },
          data: { settings: merged as Prisma.InputJsonObject },
          select: { settings: true },
        });
        return toFirmSettings(updated.settings);
      });
    },
  };
}

export type FirmsService = ReturnType<typeof createFirmsService>;
