import type { UserRole } from "../src/generated/prisma/client.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMember,
  hasTestDb,
  loginCookie,
  makeTestApp,
  registerOwner,
  resetDb,
  type RegisteredOwner,
  type TestApp,
} from "./db-helpers.js";

const FIRM = "/api/v1/firms/current";
const SETTINGS = "/api/v1/firms/current/settings";
const ROLES: UserRole[] = ["owner", "manager", "employee", "viewer"];

/** P1 slice 2: GET/PATCH /firms/current and /firms/current/settings against the real test database. */
describe.skipIf(!hasTestDb)("firm profile and settings", () => {
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

  const call = (
    method: "GET" | "PATCH",
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    t.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** One firm with a session cookie for every role. */
  async function firmWithAllRoles(firm_name = "Role Matrix & Co") {
    const owner = await registerOwner(t, { firm_name });
    const cookies: Record<UserRole, string> = {
      owner: owner.cookie,
      manager: "",
      employee: "",
      viewer: "",
    };
    for (const role of ["manager", "employee", "viewer"] as const) {
      const m = await createMember(t.prisma, { firm_id: owner.user.firm.id, role });
      cookies[role] = await loginCookie(t, m.email);
    }
    return { owner, firmId: owner.user.firm.id, cookies };
  }

  const firmRow = (id: string) => t.prisma.firm.findUniqueOrThrow({ where: { id } });

  describe("GET /firms/current", () => {
    it("returns the FirmProfile in the standard envelope for every role", async () => {
      const { firmId, cookies } = await firmWithAllRoles("Role Matrix & Co");
      for (const role of ROLES) {
        const res = await call("GET", FIRM, cookies[role]);
        expect(res.statusCode, role).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ success: true, message: expect.any(String) });
        expect(body.data).toEqual({
          id: firmId,
          name: "Role Matrix & Co",
          address: null,
          email: null,
          phone: null,
          timezone: "Asia/Kolkata",
          created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        });
        // Settings and internals are not part of the profile.
        expect(body.data).not.toHaveProperty("settings");
        expect(body.data).not.toHaveProperty("updated_at");
      }
    });

    it("401s an anonymous caller without leaking data", async () => {
      await firmWithAllRoles();
      const res = await call("GET", FIRM);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
      expect(res.json()).not.toHaveProperty("data");
    });
  });

  describe("PATCH /firms/current", () => {
    it("owner updates every field and the change is persisted", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      const res = await call("PATCH", FIRM, cookies.owner, {
        name: "  Sharma & Associates  ",
        address: "12 Example Road\nSample City 400001",
        email: "  Office@Example.COM ",
        phone: "+91 98765 43210",
        timezone: "Asia/Dubai",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        id: firmId,
        name: "Sharma & Associates",
        address: "12 Example Road\nSample City 400001",
        email: "office@example.com",
        phone: "+91 98765 43210",
        timezone: "Asia/Dubai",
      });
      const row = await firmRow(firmId);
      expect(row).toMatchObject({
        name: "Sharma & Associates",
        email: "office@example.com",
        timezone: "Asia/Dubai",
      });
      // A follow-up GET by any role sees it.
      const get = await call("GET", FIRM, cookies.viewer);
      expect(get.json().data.name).toBe("Sharma & Associates");
    });

    it("partial updates change only the provided field", async () => {
      const { firmId, cookies } = await firmWithAllRoles("Original Firm");
      await call("PATCH", FIRM, cookies.owner, {
        address: "Somewhere 1",
        email: "a@example.com",
        phone: "9876543210",
        timezone: "Asia/Tokyo",
      });
      const before = await firmRow(firmId);

      const res = await call("PATCH", FIRM, cookies.owner, { name: "Renamed Firm" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        name: "Renamed Firm",
        address: "Somewhere 1",
        email: "a@example.com",
        phone: "9876543210",
        timezone: "Asia/Tokyo",
      });
      const after = await firmRow(firmId);
      expect(after.settings).toEqual(before.settings);
      expect(after.created_at).toEqual(before.created_at);

      const tz = await call("PATCH", FIRM, cookies.owner, { timezone: "Asia/Kolkata" });
      expect(tz.json().data).toMatchObject({
        name: "Renamed Firm",
        address: "Somewhere 1",
        timezone: "Asia/Kolkata",
      });
    });

    it("an empty string clears address, email and phone (stored as null)", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      await call("PATCH", FIRM, cookies.owner, {
        address: "Somewhere 1",
        email: "a@example.com",
        phone: "9876543210",
      });
      const res = await call("PATCH", FIRM, cookies.owner, {
        address: "",
        email: "",
        phone: "",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ address: null, email: null, phone: null });
      expect(await firmRow(firmId)).toMatchObject({
        address: null,
        email: null,
        phone: null,
      });
      // Whitespace-only counts as empty too.
      await call("PATCH", FIRM, cookies.owner, { address: "Somewhere 2" });
      const ws = await call("PATCH", FIRM, cookies.owner, { address: "   " });
      expect(ws.json().data.address).toBeNull();
    });

    it("clearing one optional field leaves the others untouched", async () => {
      const { cookies } = await firmWithAllRoles();
      await call("PATCH", FIRM, cookies.owner, {
        address: "Somewhere 1",
        email: "a@example.com",
        phone: "9876543210",
      });
      const res = await call("PATCH", FIRM, cookies.owner, { email: "" });
      expect(res.json().data).toMatchObject({
        address: "Somewhere 1",
        email: null,
        phone: "9876543210",
      });
    });

    it("keeps newlines in the address", async () => {
      const { cookies } = await firmWithAllRoles();
      const res = await call("PATCH", FIRM, cookies.owner, {
        address: "Line 1\r\nLine 2\tTabbed",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.address).toBe("Line 1\r\nLine 2\tTabbed");
    });

    it.each([
      ["name", { name: "" }],
      ["name", { name: "   " }],
      ["name", { name: "a".repeat(201) }],
      ["name", { name: null }],
      ["name", { name: 42 }],
      ["name", { name: "bad\u0000name" }],
      ["name", { name: "line\nbreak" }],
      ["email", { email: "not-an-email" }],
      ["email", { email: "a@b" }],
      ["email", { email: `${"a".repeat(250)}@example.com` }],
      ["phone", { phone: "12345" }],
      ["phone", { phone: "call me maybe" }],
      ["phone", { phone: "1".repeat(16) }],
      ["address", { address: "a".repeat(501) }],
      ["address", { address: "bad\u0000address" }],
      ["address", { address: "bell\u0007char" }],
      ["timezone", { timezone: "Mars/Olympus" }],
      ["timezone", { timezone: "" }],
      ["timezone", { timezone: "not a zone" }],
    ])("rejects an invalid %s with a field error: %j", async (field, payload) => {
      const { firmId, cookies } = await firmWithAllRoles("Untouched Firm");
      const res = await call("PATCH", FIRM, cookies.owner, payload);
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(body.errors.map((e: { field?: string }) => e.field)).toContain(field);
      expect((await firmRow(firmId)).name).toBe("Untouched Firm");
    });

    it("rejects an empty body, an empty object and a body with only unknown keys", async () => {
      const { firmId, cookies } = await firmWithAllRoles("Untouched Firm");
      for (const payload of [
        {},
        { unknown_field: "x" },
        { id: firmId },
        { firm_id: firmId },
      ]) {
        const res = await call("PATCH", FIRM, cookies.owner, payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(res.json().code).toBe("VALIDATION_ERROR");
      }
      const noBody = await t.app.inject({
        method: "PATCH",
        url: FIRM,
        headers: { cookie: cookies.owner },
      });
      expect(noBody.statusCode).toBe(400);
      expect((await firmRow(firmId)).name).toBe("Untouched Firm");
    });

    it("accepts several valid IANA timezones", async () => {
      const { cookies } = await firmWithAllRoles();
      for (const timezone of [
        "UTC",
        "Asia/Kolkata",
        "America/New_York",
        "Europe/London",
      ]) {
        const res = await call("PATCH", FIRM, cookies.owner, { timezone });
        expect(res.statusCode, timezone).toBe(200);
        expect(res.json().data.timezone).toBe(timezone);
      }
    });

    it("ignores id / firm_id / settings smuggled next to valid fields", async () => {
      const a = await firmWithAllRoles("Firm A");
      const b = await registerOwner(t, { firm_name: "Firm B" });
      const bId = b.user.firm.id;
      const bBefore = await firmRow(bId);

      const res = await call("PATCH", FIRM, a.cookies.owner, {
        name: "Firm A renamed",
        id: bId,
        firm_id: bId,
        settings: { onboarding_completed: true },
        created_at: "2001-01-01T00:00:00.000Z",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(a.firmId);
      expect(res.json().data.name).toBe("Firm A renamed");

      const aRow = await firmRow(a.firmId);
      expect(aRow.name).toBe("Firm A renamed");
      expect(aRow.created_at.getUTCFullYear()).not.toBe(2001);
      expect(aRow.settings).toMatchObject({ onboarding_completed: false });
      expect(await firmRow(bId)).toEqual(bBefore);
    });
  });

  describe("GET /firms/current/settings", () => {
    it("returns FirmSettings for every role (defaults for a new firm)", async () => {
      const { cookies } = await firmWithAllRoles();
      for (const role of ROLES) {
        const res = await call("GET", SETTINGS, cookies[role]);
        expect(res.statusCode, role).toBe(200);
        expect(res.json()).toMatchObject({
          success: true,
          data: { financial_year_start_month: 4, onboarding_completed: false },
        });
      }
    });

    it("401s an anonymous caller", async () => {
      const res = await call("GET", SETTINGS);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHENTICATED");
    });

    it("applies defaults when keys are missing or malformed (old rows) and hides unknown keys", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      const cases: [
        unknown,
        { financial_year_start_month: number; onboarding_completed: boolean },
      ][] = [
        [{}, { financial_year_start_month: 4, onboarding_completed: false }],
        [
          { onboarding_completed: true },
          { financial_year_start_month: 4, onboarding_completed: true },
        ],
        [
          { financial_year_start_month: 1 },
          { financial_year_start_month: 1, onboarding_completed: false },
        ],
        [
          { financial_year_start_month: 13, onboarding_completed: "yes" },
          { financial_year_start_month: 4, onboarding_completed: false },
        ],
        [
          { financial_year_start_month: "7" },
          { financial_year_start_month: 4, onboarding_completed: false },
        ],
        [[1, 2], { financial_year_start_month: 4, onboarding_completed: false }],
        [
          { legacy_flag: "x", financial_year_start_month: 6 },
          { financial_year_start_month: 6, onboarding_completed: false },
        ],
      ];
      for (const [settings, expected] of cases) {
        await t.prisma.firm.update({
          where: { id: firmId },
          data: { settings: settings as object },
        });
        const res = await call("GET", SETTINGS, cookies.viewer);
        expect(res.statusCode, JSON.stringify(settings)).toBe(200);
        expect(res.json().data).toEqual(expected);
      }
    });
  });

  describe("PATCH /firms/current/settings", () => {
    it("owner changes the financial year start month", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      const res = await call("PATCH", SETTINGS, cookies.owner, {
        financial_year_start_month: 1,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({
        financial_year_start_month: 1,
        onboarding_completed: false,
      });
      expect((await firmRow(firmId)).settings).toMatchObject({
        financial_year_start_month: 1,
      });
      const get = await call("GET", SETTINGS, cookies.employee);
      expect(get.json().data.financial_year_start_month).toBe(1);
    });

    it.each([
      ["financial_year_start_month", { financial_year_start_month: 0 }],
      ["financial_year_start_month", { financial_year_start_month: 13 }],
      ["financial_year_start_month", { financial_year_start_month: 4.5 }],
      ["financial_year_start_month", { financial_year_start_month: "4" }],
      ["financial_year_start_month", { financial_year_start_month: null }],
      ["onboarding_completed", { onboarding_completed: "true" }],
      ["onboarding_completed", { onboarding_completed: 1 }],
    ])("rejects an invalid %s with a field error: %j", async (field, payload) => {
      const { firmId, cookies } = await firmWithAllRoles();
      const res = await call("PATCH", SETTINGS, cookies.owner, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(res.json().errors.map((e: { field?: string }) => e.field)).toContain(field);
      expect((await firmRow(firmId)).settings).toMatchObject({
        financial_year_start_month: 4,
        onboarding_completed: false,
      });
    });

    it("rejects an empty body or only unknown keys", async () => {
      const { cookies } = await firmWithAllRoles();
      for (const payload of [{}, { unknown: 1 }, { firm_id: "x" }]) {
        const res = await call("PATCH", SETTINGS, cookies.owner, payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(res.json().code).toBe("VALIDATION_ERROR");
      }
    });

    it("merges only the provided keys and never clobbers unknown keys", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      await t.prisma.firm.update({
        where: { id: firmId },
        data: {
          settings: {
            financial_year_start_month: 4,
            onboarding_completed: false,
            legacy_flag: "keep-me",
            nested: { a: 1 },
          },
        },
      });

      const m = await call("PATCH", SETTINGS, cookies.owner, {
        financial_year_start_month: 10,
      });
      expect(m.json().data).toEqual({
        financial_year_start_month: 10,
        onboarding_completed: false,
      });
      expect((await firmRow(firmId)).settings).toEqual({
        financial_year_start_month: 10,
        onboarding_completed: false,
        legacy_flag: "keep-me",
        nested: { a: 1 },
      });

      const o = await call("PATCH", SETTINGS, cookies.owner, {
        onboarding_completed: true,
      });
      expect(o.json().data).toEqual({
        financial_year_start_month: 10,
        onboarding_completed: true,
      });
      expect((await firmRow(firmId)).settings).toEqual({
        financial_year_start_month: 10,
        onboarding_completed: true,
        legacy_flag: "keep-me",
        nested: { a: 1 },
      });
    });

    it("works on an old row with an empty settings object", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      await t.prisma.firm.update({ where: { id: firmId }, data: { settings: {} } });
      const res = await call("PATCH", SETTINGS, cookies.owner, {
        financial_year_start_month: 7,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({
        financial_year_start_month: 7,
        onboarding_completed: false,
      });
    });

    it("onboarding_completed can only be set to true: false is a 400 with a field error", async () => {
      const { firmId, cookies } = await firmWithAllRoles();

      const rejected = await call("PATCH", SETTINGS, cookies.owner, {
        onboarding_completed: false,
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      expect(rejected.json().errors).toEqual([
        { field: "onboarding_completed", message: expect.any(String) },
      ]);

      const done = await call("PATCH", SETTINGS, cookies.owner, {
        onboarding_completed: true,
      });
      expect(done.statusCode).toBe(200);
      expect(done.json().data.onboarding_completed).toBe(true);

      // Idempotent: true again is fine.
      const again = await call("PATCH", SETTINGS, cookies.owner, {
        onboarding_completed: true,
      });
      expect(again.statusCode).toBe(200);

      // No un-completing, and a rejected false never touches other keys in the same request.
      const undo = await call("PATCH", SETTINGS, cookies.owner, {
        onboarding_completed: false,
        financial_year_start_month: 2,
      });
      expect(undo.statusCode).toBe(400);
      expect((await firmRow(firmId)).settings).toMatchObject({
        onboarding_completed: true,
        financial_year_start_month: 4,
      });
    });

    it("both keys in one request update together", async () => {
      const { cookies } = await firmWithAllRoles();
      const res = await call("PATCH", SETTINGS, cookies.owner, {
        financial_year_start_month: 9,
        onboarding_completed: true,
      });
      expect(res.json().data).toEqual({
        financial_year_start_month: 9,
        onboarding_completed: true,
      });
    });

    it("concurrent PATCHes of different keys do not overwrite each other", async () => {
      const { firmId, cookies } = await firmWithAllRoles();
      const [a, b] = await Promise.all([
        call("PATCH", SETTINGS, cookies.owner, { financial_year_start_month: 6 }),
        call("PATCH", SETTINGS, cookies.owner, { onboarding_completed: true }),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect((await firmRow(firmId)).settings).toMatchObject({
        financial_year_start_month: 6,
        onboarding_completed: true,
      });
    });
  });

  describe("authorization", () => {
    it("PATCH on both endpoints is owner-only: manager, employee, viewer get 403 and nothing changes", async () => {
      const { firmId, cookies } = await firmWithAllRoles("Locked Firm");
      const before = await firmRow(firmId);
      for (const role of ["manager", "employee", "viewer"] as const) {
        const profile = await call("PATCH", FIRM, cookies[role], {
          name: `Hacked by ${role}`,
        });
        expect(profile.statusCode, `profile ${role}`).toBe(403);
        expect(profile.json()).toMatchObject({ success: false, code: "FORBIDDEN" });
        expect(profile.json()).not.toHaveProperty("data");

        const settings = await call("PATCH", SETTINGS, cookies[role], {
          financial_year_start_month: 1,
          onboarding_completed: true,
        });
        expect(settings.statusCode, `settings ${role}`).toBe(403);
        expect(settings.json().code).toBe("FORBIDDEN");
      }
      const after = await firmRow(firmId);
      expect(after.name).toBe("Locked Firm");
      expect(after.settings).toEqual(before.settings);
      expect(after.updated_at).toEqual(before.updated_at);
    });

    it("authentication and role checks run before body validation (invalid body is still 401 / 403)", async () => {
      const { cookies } = await firmWithAllRoles();
      for (const url of [FIRM, SETTINGS]) {
        expect(
          (
            await call("PATCH", url, cookies.manager, {
              name: "",
              financial_year_start_month: 99,
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await call("PATCH", url, undefined, {
              name: "",
              financial_year_start_month: 99,
            })
          ).statusCode,
        ).toBe(401);
      }
    });

    it("anonymous PATCH on both endpoints is 401 and changes nothing", async () => {
      const { firmId } = await firmWithAllRoles("Anon Firm");
      for (const url of [FIRM, SETTINGS]) {
        const res = await call("PATCH", url, undefined, {
          name: "Hacked",
          financial_year_start_month: 1,
        });
        expect(res.statusCode, url).toBe(401);
        expect(res.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
      }
      expect((await firmRow(firmId)).name).toBe("Anon Firm");
    });

    it("a deactivated owner gets 401 on every endpoint and cannot patch", async () => {
      const { firmId, owner } = await firmWithAllRoles("Deactivated Firm");
      await t.prisma.firmMember.update({
        where: { firm_id_user_id: { firm_id: firmId, user_id: owner.user.id } },
        data: { is_active: false },
      });
      for (const [method, url, payload] of [
        ["GET", FIRM, undefined],
        ["PATCH", FIRM, { name: "Nope" }],
        ["GET", SETTINGS, undefined],
        ["PATCH", SETTINGS, { financial_year_start_month: 2 }],
      ] as const) {
        const res = await call(method, url, owner.cookie, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
      expect((await firmRow(firmId)).name).toBe("Deactivated Firm");
    });

    it("uses the database role, not the token: a demoted owner loses write access at once", async () => {
      const { firmId, owner } = await firmWithAllRoles();
      await t.prisma.firmMember.update({
        where: { firm_id_user_id: { firm_id: firmId, user_id: owner.user.id } },
        data: { role: "viewer" },
      });
      expect((await call("GET", FIRM, owner.cookie)).statusCode).toBe(200);
      expect((await call("PATCH", FIRM, owner.cookie, { name: "Nope" })).statusCode).toBe(
        403,
      );
    });
  });

  describe("tenant isolation", () => {
    async function twoFirms() {
      const a = await firmWithAllRoles("Firm A Pvt Ltd");
      const bOwner: RegisteredOwner = await registerOwner(t, {
        firm_name: "Firm B Pvt Ltd",
      });
      await call("PATCH", FIRM, bOwner.cookie, {
        address: "B Street 9",
        email: "b-firm@example.com",
        phone: "9000000002",
        timezone: "Asia/Tokyo",
      });
      await call("PATCH", SETTINGS, bOwner.cookie, { financial_year_start_month: 1 });
      return { a, b: { cookie: bOwner.cookie, firmId: bOwner.user.firm.id } };
    }

    it("A's owner patching never modifies B, and A's reads never return B's data", async () => {
      const { a, b } = await twoFirms();
      const bBefore = await firmRow(b.firmId);

      const p = await call("PATCH", FIRM, a.cookies.owner, {
        name: "Firm A renamed",
        address: "A Street 1",
        email: "a-firm@example.com",
        phone: "9000000001",
        timezone: "UTC",
      });
      expect(p.statusCode).toBe(200);
      const s = await call("PATCH", SETTINGS, a.cookies.owner, {
        financial_year_start_month: 7,
        onboarding_completed: true,
      });
      expect(s.statusCode).toBe(200);

      // B is byte-for-byte unchanged in the database (including updated_at).
      expect(await firmRow(b.firmId)).toEqual(bBefore);

      // A's reads return only A's data, for every role.
      for (const role of ROLES) {
        const profile = (await call("GET", FIRM, a.cookies[role])).json().data;
        expect(profile).toMatchObject({
          id: a.firmId,
          name: "Firm A renamed",
          timezone: "UTC",
        });
        const raw = JSON.stringify([
          profile,
          (await call("GET", SETTINGS, a.cookies[role])).json().data,
        ]);
        for (const bValue of [
          "Firm B",
          b.firmId,
          "B Street",
          "b-firm@example.com",
          "9000000002",
          "Asia/Tokyo",
        ]) {
          expect(raw, `${role} must not see ${bValue}`).not.toContain(bValue);
        }
      }

      // B's own view is intact.
      const bProfile = (await call("GET", FIRM, b.cookie)).json().data;
      expect(bProfile).toMatchObject({
        id: b.firmId,
        name: "Firm B Pvt Ltd",
        address: "B Street 9",
        timezone: "Asia/Tokyo",
      });
      expect((await call("GET", SETTINGS, b.cookie)).json().data).toEqual({
        financial_year_start_month: 1,
        onboarding_completed: false,
      });
    });

    it("smuggling B's id as id / firm_id in the PATCH body (profile or settings) cannot reach B", async () => {
      const { a, b } = await twoFirms();
      const bBefore = await firmRow(b.firmId);

      const profile = await call("PATCH", FIRM, a.cookies.owner, {
        id: b.firmId,
        firm_id: b.firmId,
        name: "A only",
      });
      const settings = await call("PATCH", SETTINGS, a.cookies.owner, {
        id: b.firmId,
        firm_id: b.firmId,
        financial_year_start_month: 12,
        onboarding_completed: true,
      });
      expect(profile.statusCode).toBe(200);
      expect(settings.statusCode).toBe(200);
      expect(profile.json().data.id).toBe(a.firmId);
      expect(await firmRow(b.firmId)).toEqual(bBefore);
      expect((await firmRow(a.firmId)).settings).toMatchObject({
        financial_year_start_month: 12,
        onboarding_completed: true,
      });
    });

    it("a firm id in the path, query or headers is ignored: the route has no firm parameter", async () => {
      const { a, b } = await twoFirms();
      const bBefore = await firmRow(b.firmId);

      const viaQuery = await call(
        "GET",
        `${FIRM}?firm_id=${b.firmId}&id=${b.firmId}`,
        a.cookies.owner,
      );
      expect(viaQuery.json().data.id).toBe(a.firmId);
      const viaHeader = await t.app.inject({
        method: "GET",
        url: FIRM,
        headers: { cookie: a.cookies.owner, "x-firm-id": b.firmId },
      });
      expect(viaHeader.json().data.id).toBe(a.firmId);
      // /firms/<id> is not a route at all.
      for (const method of ["GET", "PATCH"] as const) {
        const res = await call(
          method,
          `/api/v1/firms/${b.firmId}`,
          a.cookies.owner,
          method === "PATCH" ? { name: "x" } : undefined,
        );
        expect(res.statusCode).toBe(404);
      }
      expect(await firmRow(b.firmId)).toEqual(bBefore);
    });

    it("A's manager cannot patch A (403) and B is untouched either way", async () => {
      const { a, b } = await twoFirms();
      const bBefore = await firmRow(b.firmId);
      const res = await call("PATCH", FIRM, a.cookies.manager, {
        name: "Manager coup",
        id: b.firmId,
      });
      expect(res.statusCode).toBe(403);
      const res2 = await call("PATCH", SETTINGS, a.cookies.manager, {
        onboarding_completed: true,
      });
      expect(res2.statusCode).toBe(403);
      expect((await firmRow(a.firmId)).name).toBe("Firm A Pvt Ltd");
      expect(await firmRow(b.firmId)).toEqual(bBefore);
    });

    it("a token naming B's firm with A's user id is rejected (membership is re-checked)", async () => {
      const { a, b } = await twoFirms();
      const forged = await t.app.jwt.sign({
        sub: a.owner.user.id,
        firm_id: b.firmId,
        role: "owner",
      });
      const res = await call("GET", FIRM, `access_token=${forged}`);
      expect(res.statusCode).toBe(401);
      const patch = await call("PATCH", FIRM, `access_token=${forged}`, {
        name: "Forged",
      });
      expect(patch.statusCode).toBe(401);
      expect((await firmRow(b.firmId)).name).toBe("Firm B Pvt Ltd");
    });
  });

  describe("consistency with /auth/me and login", () => {
    const me = async (cookie: string) =>
      (await call("GET", "/api/v1/auth/me", cookie)).json().data.firm;

    it("/auth/me reflects renames, timezone and onboarding changes immediately", async () => {
      const { cookies } = await firmWithAllRoles("Before Name");
      expect(await me(cookies.owner)).toMatchObject({
        name: "Before Name",
        timezone: "Asia/Kolkata",
        onboarding_completed: false,
      });

      await call("PATCH", FIRM, cookies.owner, {
        name: "After Name",
        timezone: "Asia/Dubai",
      });
      expect(await me(cookies.owner)).toMatchObject({
        name: "After Name",
        timezone: "Asia/Dubai",
        onboarding_completed: false,
      });

      await call("PATCH", SETTINGS, cookies.owner, { onboarding_completed: true });
      // Other roles of the same firm see the same state.
      for (const role of ROLES) {
        expect(await me(cookies[role]), role).toMatchObject({
          name: "After Name",
          onboarding_completed: true,
        });
      }
    });

    it("login returns the updated firm state too", async () => {
      const { owner, cookies } = await firmWithAllRoles("Login Firm");
      await call("PATCH", FIRM, cookies.owner, { name: "Login Firm 2" });
      await call("PATCH", SETTINGS, cookies.owner, { onboarding_completed: true });
      const res = await t.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: owner.email, password: owner.password },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.firm).toMatchObject({
        name: "Login Firm 2",
        onboarding_completed: true,
      });
    });

    it("a rejected onboarding PATCH leaves /auth/me unchanged", async () => {
      const { cookies } = await firmWithAllRoles();
      await call("PATCH", SETTINGS, cookies.owner, { onboarding_completed: true });
      await call("PATCH", SETTINGS, cookies.owner, { onboarding_completed: false });
      expect((await me(cookies.owner)).onboarding_completed).toBe(true);
    });
  });
});
