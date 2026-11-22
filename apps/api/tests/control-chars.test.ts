import {
  acceptInvitationSchema,
  listUsersQuerySchema,
  registerSchema,
  updateFirmSchema,
  updateUserSchema,
} from "@ca-firm/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDb, makeTestApp, resetDb, type TestApp } from "./db-helpers.js";

const valid = {
  name: "Asha Rao",
  email: "asha@example.com",
  password: "Sample-pass-1",
  firm_name: "Demo CA",
};
const BAD = [
  "bad\u0000name",
  "tab\there",
  "line\nbreak",
  "bell\u0007",
  "del\u007f",
  "c1\u0085x",
];

describe("P1-003: control characters in shared free-text schemas", () => {
  it.each(BAD)("single-line fields reject %j", (value) => {
    expect(registerSchema.safeParse({ ...valid, name: value }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, firm_name: value }).success).toBe(false);
    expect(
      acceptInvitationSchema.safeParse({
        token: "t",
        name: value,
        password: "Sample-pass-1",
      }).success,
    ).toBe(false);
    expect(updateUserSchema.safeParse({ name: value }).success).toBe(false);
    expect(updateFirmSchema.safeParse({ name: value }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ search: value }).success).toBe(false);
  });

  it("address allows tab, LF and CR but rejects NUL and other control characters", () => {
    expect(updateFirmSchema.safeParse({ address: "a\nb\r\nc\td" }).success).toBe(true);
    for (const bad of ["a\u0000b", "a\u0007b", "a\u001bb", "a\u007fb"]) {
      expect(
        updateFirmSchema.safeParse({ address: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("still accepts ordinary unicode names", () => {
    expect(
      registerSchema.safeParse({
        ...valid,
        name: "Zoë 张伟 🙂 مرحبا",
        firm_name: "事務所 & Sons",
      }).success,
    ).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("P1-003: POST /auth/register with control characters", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
  });

  it.each(["name", "firm_name"])(
    "answers 400 VALIDATION_ERROR with a field error for NUL in %s",
    async (field) => {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { ...valid, [field]: "bad\u0000value" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(res.json().errors.map((e: { field?: string }) => e.field)).toContain(field);
      expect(await t.prisma.user.count()).toBe(0);
      expect(await t.prisma.firm.count()).toBe(0);
    },
  );
});
